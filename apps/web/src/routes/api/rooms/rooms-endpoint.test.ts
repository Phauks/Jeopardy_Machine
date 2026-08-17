// The lobby endpoint's HONESTY contract (owner report 2026-08-14: "creating a public room
// does not appear to have it appear in the lobby ... I cannot tell if the rooms are actually
// created"). The reproduction was a missing D1 migration, and the design flaw it exposed was
// that every registry failure was swallowed into `{rooms: []}` - indistinguishable from a
// quiet night. These tests hold the fixed contract: rooms still work when the registry does
// not, and the response always says which world it is in.
import { describe, expect, it } from "vitest";
import { GET, POST } from "./+server.ts";
import { blankCreateForm, createRoomBody } from "#lib/landing/create-room-request.ts";
import { createRoomRequestSchema } from "@jeopardy/protocol/room/create";
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

// ---------------------------------------------------------------------------------------
// The create payload, end to end (owner report 2026-08-17: "I made a public room but settings
// said it was private. Also didn't carry title or host name.").
//
// The chain is: the front door's form -> createRoomBody -> POST /api/rooms -> the DO's
// initialize -> the settings the room reports back. This test walks all of it EXCEPT the DO
// itself, which lives in another Worker: the stub below parses the forwarded body with the
// real protocol schema and derives the settings exactly as apps/realtime/src/room/storage.ts's
// roomSettingsPayload does, so a field that this route drops, renames or fails to forward
// shows up here as a settings object that disagrees with the form.
//
// It found no drop. The chain carries listing, title and host label intact, and the registry
// row is written from the DO's own reading rather than from the body we happened to send. The
// symptom the owner saw comes from the far end: the host console the front door hands off to
// still runs the MOCK store (apps/web/src/lib/room/create-room-store.ts returns
// LocalSimRoomStore unconditionally until the M3 reconcile), whose settings are
// defaultRoomSettings + empty strings - private, untitled, unattributed - for every room.
// ---------------------------------------------------------------------------------------

/** The DO's initialize, in miniature: parse, derive, answer 201 - and record what it got. */
function recordingNamespace(): {
  namespace: unknown;
  initialized: () => Record<string, unknown> | null;
} {
  let seen: Record<string, unknown> | null = null;
  return {
    initialized: () => seen,
    namespace: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (request: Request) => {
          const parsed = createRoomRequestSchema.safeParse(await request.json());
          if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
          seen = parsed.data as unknown as Record<string, unknown>;
          const body = parsed.data;
          return Response.json(
            {
              hostToken: "0".repeat(32),
              expiresAt: Date.now() + 7_200_000,
              settings: {
                listing: body.listing,
                // Derived from whether a password was set, never stored twice
                // (packages/protocol/src/room/visibility.ts).
                entry: body.password === undefined ? "open" : "password",
                maxPlayers: body.maxPlayers,
                maxSpectators: body.maxSpectators,
                spectatorsAllowed: body.spectatorsAllowed,
                hideJoinCode: body.hideJoinCode,
                title: body.title ?? "",
                hostLabel: body.hostLabel ?? "",
              },
            },
            { status: 201 },
          );
        },
      }),
    },
  };
}

/** A D1 stand-in that keeps the bound values, so the lobby row can be inspected. */
function recordingDatabase(): { database: unknown; binds: () => unknown[][] } {
  const calls: unknown[][] = [];
  return {
    binds: () => calls,
    database: {
      prepare: () => ({
        bind(...values: unknown[]) {
          calls.push(values);
          return this;
        },
        run: () => Promise.resolve({}),
        all: () => Promise.resolve({ results: [] }),
      }),
      batch: () => Promise.resolve([]),
    },
  };
}

describe("POST /api/rooms - a public titled room stays public and titled", () => {
  const filledForm = {
    ...blankCreateForm(),
    listing: "public" as const,
    title: "Thursday pub quiz",
    hostLabel: "Board Game Club",
    maxPlayers: 40,
  };

  it("carries the form's listing, title and host label all the way to the room", async () => {
    const { namespace, initialized } = recordingNamespace();
    const { database } = recordingDatabase();
    const response = await POST({
      request: new Request("https://test/api/rooms", {
        method: "POST",
        body: JSON.stringify(
          createRoomBody(filledForm, { kind: "compact", rounds: [{ columns: 3, rows: 3 }] }),
        ),
      }),
      platform: { env: { GAME_ROOM: namespace, DB: database } },
    } as unknown as Event);

    expect(response.status).toBe(201);
    // What the DO was actually asked for - the link the report suspected was broken.
    expect(initialized()).toMatchObject({
      listing: "public",
      title: "Thursday pub quiz",
      hostLabel: "Board Game Club",
      maxPlayers: 40,
    });
    // What the room reports back about itself.
    const body = (await response.json()) as {
      settings: { listing: string; title: string; hostLabel: string; maxPlayers: number };
      registry: unknown;
    };
    expect(body.settings.listing).toBe("public");
    expect(body.settings.title).toBe("Thursday pub quiz");
    expect(body.settings.hostLabel).toBe("Board Game Club");
    expect(body.settings.maxPlayers).toBe(40);
    expect(body.registry).toEqual({ status: "ok" });
  });

  it("writes the same three facts into the lobby row, from the room's own reading", async () => {
    const { namespace } = recordingNamespace();
    const { database, binds } = recordingDatabase();
    await POST({
      request: new Request("https://test/api/rooms", {
        method: "POST",
        body: JSON.stringify(
          createRoomBody(filledForm, { kind: "compact", rounds: [{ columns: 3, rows: 3 }] }),
        ),
      }),
      platform: { env: { GAME_ROOM: namespace, DB: database } },
    } as unknown as Event);

    // The upsert binds code, title, host_label, listing, has_password, ... in that order
    // (src/lib/server/room-registry.ts). A row that came out private or unnamed is the lobby
    // half of the reported bug.
    const upsert = binds()[0] ?? [];
    expect(upsert[1]).toBe("Thursday pub quiz");
    expect(upsert[2]).toBe("Board Game Club");
    expect(upsert[3]).toBe("public");
  });

  it("keeps a private titled room private, and still carries its name", async () => {
    const { namespace } = recordingNamespace();
    const { database } = recordingDatabase();
    const response = await POST({
      request: new Request("https://test/api/rooms", {
        method: "POST",
        body: JSON.stringify(
          createRoomBody(
            { ...filledForm, listing: "private", password: "quizzy" },
            { kind: "compact", rounds: [{ columns: 3, rows: 3 }] },
          ),
        ),
      }),
      platform: { env: { GAME_ROOM: namespace, DB: database } },
    } as unknown as Event);
    const body = (await response.json()) as {
      settings: { listing: string; entry: string; title: string; hostLabel: string };
    };
    expect(body.settings).toMatchObject({
      listing: "private",
      entry: "password",
      title: "Thursday pub quiz",
      hostLabel: "Board Game Club",
    });
  });
});
