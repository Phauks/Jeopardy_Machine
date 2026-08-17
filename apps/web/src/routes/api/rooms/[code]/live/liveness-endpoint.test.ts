// The rejoin probe's contract. The interesting cases are all failure cases: this endpoint's
// whole job is to let the front door DELETE a stale rejoin offer, so every way of being wrong
// about "dead" has to be distinguishable from actually being dead.
import { describe, expect, it } from "vitest";
import { GET } from "./+server.ts";
import { verdictFor, verdictForStatus } from "#lib/lobby/room-liveness.ts";
import type { RoomLiveness } from "#lib/lobby/room-liveness.ts";
import type { RequestHandler } from "@sveltejs/kit";

type Handler = NonNullable<RequestHandler>;
type Event = Parameters<Handler>[0];

const now = Date.now();

function databaseWith(rows: Record<string, unknown>[]) {
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

function failingDatabase(message: string) {
  return {
    prepare: () => {
      throw new Error(message);
    },
    batch: () => Promise.resolve([]),
  };
}

function probeEvent(code: string, database?: unknown): Event {
  return {
    params: { code },
    platform: database === undefined ? undefined : { env: { DB: database } },
    setHeaders: () => undefined,
  } as unknown as Event;
}

async function probe(code: string, database?: unknown): Promise<Response> {
  return (await GET(probeEvent(code, database))) as Response;
}

function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    listing: "private",
    phase: "lobby",
    player_count: 3,
    expires_at: now + 3_600_000,
    ended_at: null,
    ...overrides,
  };
}

describe("room liveness probe", () => {
  it("answers live for a private room - being unlisted is not being dead", async () => {
    const response = await probe("bqkx7", databaseWith([liveRow()]));
    const body = (await response.json()) as RoomLiveness;
    expect(response.status).toBe(200);
    // Normalized on the way in: a code out of sessionStorage may be any case.
    expect(body).toEqual({ code: "BQKX7", live: true, registry: { status: "ok" } });
    expect(verdictFor(body)).toBe("live");
  });

  it("answers live for a game already in progress - late arrivals are the room's call", async () => {
    const body = (await (
      await probe("BQKX7", databaseWith([liveRow({ phase: "active" })]))
    ).json()) as RoomLiveness;
    expect(body.live).toBe(true);
  });

  it("is dead for an ended room, an expired room, and a room with no row at all", async () => {
    const answers = await Promise.all(
      [
        [liveRow({ ended_at: now - 1000 })],
        [liveRow({ phase: "ended" })],
        [liveRow({ expires_at: now - 1000 })],
        [],
      ].map(
        async (rows) => (await (await probe("BQKX7", databaseWith(rows))).json()) as RoomLiveness,
      ),
    );
    for (const body of answers) {
      expect(body.live).toBe(false);
      expect(verdictFor(body)).toBe("gone");
    }
  });

  it("never reports 'dead' when the registry could not answer", async () => {
    const noBinding = (await (await probe("BQKX7")).json()) as RoomLiveness;
    expect(noBinding.registry).toEqual({ status: "unavailable", reason: "no-binding" });
    expect(verdictFor(noBinding)).toBe("unknown");

    const broken = (await (
      await probe("BQKX7", failingDatabase("D1_ERROR: no such table: rooms"))
    ).json()) as RoomLiveness;
    expect(broken.registry).toEqual({
      status: "unavailable",
      reason: "no-table",
      detail: "D1_ERROR: no such table: rooms",
    });
    expect(verdictFor(broken)).toBe("unknown");
  });

  it("refuses a malformed code outright, which is a settled answer", async () => {
    const response = await probe("nope", databaseWith([liveRow()]));
    expect(response.status).toBe(400);
    expect(verdictForStatus(response.status)).toBe("gone");
  });

  it("tells no more about a room than that it exists", async () => {
    const body = await (await probe("BQKX7", databaseWith([liveRow()]))).text();
    // A probe reachable with a code alone must not become a description of a private room.
    for (const leak of ["title", "phase", "player", "listing", "host"]) {
      expect(body).not.toContain(leak);
    }
  });

  it("is never cached - a room that just ended must stop being offered", async () => {
    const headers: Record<string, string> = {};
    await GET({
      params: { code: "BQKX7" },
      platform: { env: { DB: databaseWith([liveRow()]) } },
      setHeaders: (set: Record<string, string>) => Object.assign(headers, set),
    } as unknown as Event);
    expect(headers["cache-control"]).toBe("no-store");
  });

  it("treats a transient failure as unknown, so a live room survives a hiccup", () => {
    expect(verdictForStatus(500)).toBe("unknown");
    expect(verdictForStatus(503)).toBe("unknown");
    expect(verdictForStatus(404)).toBe("gone");
  });
});
