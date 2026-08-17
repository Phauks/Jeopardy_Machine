// The lobby endpoint's HONESTY contract (owner report 2026-08-14: "creating a public room
// does not appear to have it appear in the lobby ... I cannot tell if the rooms are actually
// created"). The reproduction was a missing D1 migration, and the design flaw it exposed was
// that every registry failure was swallowed into `{rooms: []}` - indistinguishable from a
// quiet night. These tests hold the fixed contract: rooms still work when the registry does
// not, and the response always says which world it is in.
import { describe, expect, it } from "vitest";
import { GET, POST } from "./+server.ts";
import type { LobbyListing } from "@jeopardy/protocol/room/registry";
import type { RequestHandler } from "@sveltejs/kit";

type Handler = NonNullable<RequestHandler>;
type Event = Parameters<Handler>[0];

// D1 stand-ins. The failing one throws the exact wrapper shape D1 produces for a missing
// table (message + nested cause), because that string IS the signal `no-table` is read from.
function workingDatabase(rows: Record<string, unknown>[] = []) {
  return {
    prepare: () => ({
      bind() {
        return this;
      },
      run: () => Promise.resolve({}),
      all: () => Promise.resolve({ results: rows }),
    }),
    batch: () => Promise.resolve([]),
  };
}

function failingDatabase(message: string, cause?: string) {
  return {
    prepare: () => {
      throw Object.assign(new Error(message), {
        cause: cause === undefined ? undefined : new Error(cause),
      });
    },
    batch: () => Promise.resolve([]),
  };
}

// The DO's initialize answer: token, deadline, and the settings it actually recorded (which
// is what the route echoes and what the lobby row is built from).
const initializedSettings = {
  listing: "public",
  entry: "open",
  maxPlayers: 100,
  maxSpectators: 50,
  spectatorsAllowed: true,
  hideJoinCode: false,
  title: "Repro room",
  hostLabel: "",
};

const initializingNamespace = {
  idFromName: (name: string) => name,
  get: () => ({
    fetch: () =>
      Promise.resolve(
        Response.json(
          {
            hostToken: "0".repeat(32),
            expiresAt: Date.now() + 7_200_000,
            settings: initializedSettings,
          },
          { status: 201 },
        ),
      ),
  }),
};

function listingEvent(database?: unknown): Event {
  return {
    platform: { env: { DB: database } },
    setHeaders: () => undefined,
  } as unknown as Event;
}

function createEvent(body: unknown, database?: unknown): Event {
  return {
    request: new Request("https://test/api/rooms", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    platform: { env: { GAME_ROOM: initializingNamespace, DB: database } },
  } as unknown as Event;
}

const publicRoom = {
  game: { kind: "compact", rounds: [{ columns: 3, rows: 3 }] },
  listing: "public",
  title: "Repro room",
};

describe("GET /api/rooms - the lobby listing", () => {
  it("says `no-binding` when the Worker has no D1 at all (vite dev)", async () => {
    const body = (await (await GET(listingEvent(undefined))).json()) as LobbyListing;
    expect(body.rooms).toEqual([]);
    expect(body.registry).toEqual({ status: "unavailable", reason: "no-binding" });
  });

  it("says `no-table` when the migration was never applied - THE reported bug", async () => {
    const database = failingDatabase("D1_ERROR: no such table: rooms: SQLITE_ERROR");
    const body = (await (await GET(listingEvent(database))).json()) as LobbyListing;
    expect(body.rooms).toEqual([]);
    expect(body.registry.status).toBe("unavailable");
    expect(body.registry).toMatchObject({ reason: "no-table" });
  });

  it("reads the reason out of D1's nested cause too (the wrapper hides the real message)", async () => {
    const database = failingDatabase("D1_ERROR", "no such table: rooms: SQLITE_ERROR");
    const body = (await (await GET(listingEvent(database))).json()) as LobbyListing;
    expect(body.registry).toMatchObject({ reason: "no-table" });
  });

  it("says `error` for any other D1 fault, and still answers a usable empty lobby", async () => {
    const database = failingDatabase("D1_ERROR: database is locked");
    const body = (await (await GET(listingEvent(database))).json()) as LobbyListing;
    expect(body.rooms).toEqual([]);
    expect(body.registry).toMatchObject({ reason: "error" });
  });

  it("says `ok` for a healthy registry - including a genuinely quiet lobby", async () => {
    const body = (await (await GET(listingEvent(workingDatabase()))).json()) as LobbyListing;
    expect(body.rooms).toEqual([]);
    expect(body.registry).toEqual({ status: "ok" });
  });

  it("never caches a broken registry (an applied migration must show up immediately)", async () => {
    const headers: Record<string, string> = {};
    const capture = (values: Record<string, string>) => Object.assign(headers, values);
    await GET({
      platform: { env: { DB: failingDatabase("no such table: rooms") } },
      setHeaders: capture,
    } as unknown as Event);
    expect(headers["cache-control"]).toBe("no-store");

    const healthy: Record<string, string> = {};
    await GET({
      platform: { env: { DB: workingDatabase() } },
      setHeaders: (values: Record<string, string>) => Object.assign(healthy, values),
    } as unknown as Event);
    expect(healthy["cache-control"]).toContain("max-age");
  });
});

describe("POST /api/rooms - creation reports its own listability", () => {
  it("creates the room AND reports the registry write succeeded", async () => {
    const response = await POST(createEvent(publicRoom, workingDatabase()));
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      code: string;
      registry: unknown;
      settings: { listing: string; entry: string };
    };
    expect(body.code).toMatch(/^[A-Z0-9]{5}$/);
    expect(body.registry).toEqual({ status: "ok" });
    // The echo is the DO's own reading, not the request body read back to itself.
    expect(body.settings).toMatchObject({ listing: "public", entry: "open", maxPlayers: 100 });
  });

  it("refuses the retired `unlisted` listing value outright (no alias, no coercion)", async () => {
    const response = await POST(
      createEvent(
        { game: publicRoom.game, listing: "unlisted", title: "Repro room" },
        workingDatabase(),
      ),
    );
    expect(response.status).toBe(400);
  });

  it("still creates the room when the registry is missing - and SAYS it is not listed", async () => {
    // The exact state the owner was in: a real room, a real code, no lobby row, no clue why.
    const response = await POST(
      createEvent(publicRoom, failingDatabase("D1_ERROR: no such table: rooms: SQLITE_ERROR")),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { code: string; registry: { reason?: string } };
    expect(body.code).toMatch(/^[A-Z0-9]{5}$/);
    expect(body.registry).toMatchObject({ status: "unavailable", reason: "no-table" });
  });

  it("refuses without the realtime binding (rooms cannot exist under vite dev)", async () => {
    const response = await POST({
      request: new Request("https://test/api/rooms", {
        method: "POST",
        body: JSON.stringify(publicRoom),
      }),
      platform: { env: {} },
    } as unknown as Event);
    expect(response.status).toBe(503);
  });
});
