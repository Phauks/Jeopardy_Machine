// The host's ops door: who may open it, and what comes back through it. The DO owns the
// token check (apps/realtime/test/diagnostics.test.ts covers the verdicts against a real
// room); this suite holds the ROUTE's half - that a missing token never reaches the DO at
// all, that the DO's refusals are relayed rather than rewritten, and that the registry's
// second opinion travels beside the DO's reading instead of replacing it.
import { describe, expect, it } from "vitest";
import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
import { DELETE, GET } from "./+server.ts";
import type { RoomInspection } from "@jeopardy/protocol/room/diagnostics";
import type { RequestHandler } from "@sveltejs/kit";

type Event = Parameters<NonNullable<RequestHandler>>[0];

const hostToken = "a".repeat(32);

const diagnostics = {
  code: "BQKX7",
  lifecycle: "lobby",
  visibility: "public",
  title: "Repro room",
  hostLabel: "Agent",
  hasPassword: false,
  createdAt: 1_760_000_000_000,
  lastActivityAt: 1_760_000_000_000,
  expiresAt: 1_760_007_200_000,
  paused: false,
  stateVersion: 0,
  connections: { total: 1, host: 1, player: 0, display: 0, spectator: 0, unjoined: 0 },
  roster: { players: 0, connected: 0, teams: 0 },
  alarm: { nextWakeAt: 1_760_007_200_000, entries: [] },
  storage: { totalBytes: 10, keys: [{ key: "meta", bytes: 10 }] },
};

// A DO stand-in that enforces the same token rule the real one does, so a route that
// "forgot" to forward the header would fail here too.
function namespace(options: { token?: string; missingRoom?: boolean } = {}) {
  const expected = options.token ?? hostToken;
  const seen: { url: string; token: string | null }[] = [];
  return {
    seen,
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (request: Request) => {
        seen.push({ url: request.url, token: request.headers.get(hostTokenHeader) });
        if (options.missingRoom === true) {
          return Promise.resolve(Response.json({ error: "no-such-room" }, { status: 404 }));
        }
        if (request.headers.get(hostTokenHeader) !== expected) {
          return Promise.resolve(Response.json({ error: "bad-host-token" }, { status: 403 }));
        }
        return Promise.resolve(
          request.url.endsWith("/close")
            ? Response.json({ closed: true, code: "BQKX7" })
            : Response.json(diagnostics),
        );
      },
    }),
  };
}

// Liveness is measured against the wall clock (the listing predicate filters on expires_at),
// so this row's deadline is relative to now rather than a frozen literal.
const registryRow = {
  code: "BQKX7",
  visibility: "public",
  phase: "lobby",
  player_count: 0,
  expires_at: Date.now() + 7_200_000,
  ended_at: null,
};

function database(rows: Record<string, unknown>[] = [registryRow]) {
  const statements: string[] = [];
  return {
    statements,
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind() {
          return this;
        },
        run: () => Promise.resolve({}),
        all: () => Promise.resolve({ results: rows }),
      };
    },
    batch: () => Promise.resolve([]),
  };
}

function event(options: {
  code?: string;
  token?: string | null;
  namespace?: unknown;
  database?: unknown;
}): Event {
  const headers = new Headers();
  if (options.token !== null && options.token !== undefined) {
    headers.set(hostTokenHeader, options.token);
  }
  return {
    params: { code: options.code ?? "BQKX7" },
    request: new Request("https://test/api/rooms/BQKX7", { headers }),
    platform: { env: { GAME_ROOM: options.namespace, DB: options.database } },
    setHeaders: () => undefined,
  } as unknown as Event;
}

describe("GET /api/rooms/<CODE> - the DO inspector", () => {
  it("returns the DO reading beside what the registry believes", async () => {
    const response = await GET(
      event({ token: hostToken, namespace: namespace(), database: database() }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as RoomInspection;
    expect(body.room.code).toBe("BQKX7");
    expect(body.registry).toEqual({ status: "ok" });
    expect(body.registryRow).toMatchObject({ listed: true, phase: "lobby" });
  });

  it("shows a live room with NO registry row rather than pretending it is fine", async () => {
    // Exactly the owner's state: the room exists, the lobby has never heard of it.
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: no such table: rooms: SQLITE_ERROR");
      },
      batch: () => Promise.resolve([]),
    };
    const body = (await (
      await GET(event({ token: hostToken, namespace: namespace(), database: broken }))
    ).json()) as RoomInspection;
    expect(body.room.code).toBe("BQKX7");
    expect(body.registryRow).toBeNull();
    expect(body.registry).toMatchObject({ reason: "no-table" });
  });

  it("refuses without a token BEFORE touching the room", async () => {
    const durableObject = namespace();
    const response = await GET(event({ token: null, namespace: durableObject }));
    expect(response.status).toBe(401);
    expect(durableObject.seen).toHaveLength(0);
  });

  it("relays the DO's refusals: wrong token is 403, unknown room is 404", async () => {
    expect((await GET(event({ token: "b".repeat(32), namespace: namespace() }))).status).toBe(403);
    expect(
      (await GET(event({ token: hostToken, namespace: namespace({ missingRoom: true }) }))).status,
    ).toBe(404);
    // A code that cannot name a room never reaches the binding either.
    expect(
      (await GET(event({ code: "nope", token: hostToken, namespace: namespace() }))).status,
    ).toBe(404);
  });

  it("answers 503 where the realtime binding does not exist (vite dev)", async () => {
    expect((await GET(event({ token: hostToken, namespace: undefined }))).status).toBe(503);
  });
});

describe("DELETE /api/rooms/<CODE> - closing a room", () => {
  it("closes the room and deletes its lobby row", async () => {
    const registry = database();
    const response = await DELETE(
      event({ token: hostToken, namespace: namespace(), database: registry }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: "BQKX7",
      closed: true,
      registry: { status: "ok" },
    });
    expect(registry.statements.join(" ")).toContain("DELETE FROM rooms");
  });

  it("reports the room closed even when the row could not be deleted", async () => {
    // The DO said the room is over; a registry fault may only cost the lobby a ghost row.
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: no such table: rooms");
      },
      batch: () => Promise.resolve([]),
    };
    const body = (await (
      await DELETE(event({ token: hostToken, namespace: namespace(), database: broken }))
    ).json()) as { closed: boolean; registry: { reason?: string } };
    expect(body.closed).toBe(true);
    expect(body.registry).toMatchObject({ reason: "no-table" });
  });

  it("is host-only: no token is 401, a wrong token is 403, and neither closes anything", async () => {
    const registry = database();
    expect(
      (await DELETE(event({ token: null, namespace: namespace(), database: registry }))).status,
    ).toBe(401);
    expect(
      (await DELETE(event({ token: "c".repeat(32), namespace: namespace(), database: registry })))
        .status,
    ).toBe(403);
    // The row survives both refusals - an unauthorized delete must not delist a live room.
    expect(registry.statements).toHaveLength(0);
  });
});
