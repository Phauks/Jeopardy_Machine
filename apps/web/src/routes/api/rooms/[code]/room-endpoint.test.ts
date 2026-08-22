// The host's ops door: who may open it, and what comes back through it. The DO owns the
// token check (apps/realtime/test/diagnostics.test.ts covers the verdicts against a real
// room); this suite holds the ROUTE's half - that a missing token never reaches the DO at
// all, that the DO's refusals are relayed rather than rewritten, and that the registry's
// second opinion travels beside the DO's reading instead of replacing it.
import { describe, expect, it } from "vitest";
import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
import { DELETE, GET, PATCH } from "./+server.ts";
import type {
  RoomInspection,
  UpdateRoomSettingsResponse,
} from "@jeopardy/protocol/room/diagnostics";
import type { RequestHandler } from "@sveltejs/kit";

type Event = Parameters<NonNullable<RequestHandler>>[0];

const hostToken = "a".repeat(32);

const settings = {
  listing: "public",
  entry: "open",
  maxPlayers: 100,
  maxSpectators: 50,
  spectatorsAllowed: true,
  hideJoinCode: false,
  title: "Repro room",
  hostLabel: "Agent",
};

const diagnostics = {
  code: "BQKX7",
  lifecycle: "lobby",
  settings,
  createdAt: 1_760_000_000_000,
  lastActivityAt: 1_760_000_000_000,
  expiresAt: 1_760_007_200_000,
  paused: false,
  stateVersion: 0,
  connections: { total: 1, host: 1, player: 0, display: 0, spectator: 0, unjoined: 0 },
  participants: {
    players: { seated: 0, connected: 0, max: 100 },
    spectators: { connected: 0, max: 50, allowed: true },
  },
  roster: { players: 0, connected: 0, teams: 0 },
  alarm: { nextWakeAt: 1_760_007_200_000, entries: [] },
  storage: { totalBytes: 10, keys: [{ key: "meta", bytes: 10 }] },
};

// A DO stand-in that enforces the same token rule the real one does, so a route that
// "forgot" to forward the header would fail here too.
function namespace(
  options: { token?: string; missingRoom?: boolean; refuseSettings?: boolean } = {},
) {
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
        if (request.url.endsWith("/close")) {
          return Promise.resolve(Response.json({ closed: true, code: "BQKX7" }));
        }
        if (request.url.endsWith("/settings")) {
          // The real DO answers with the settings AFTER the edit; the refusal case is the
          // 409 below, which the route must relay rather than flatten into a 404.
          if (options.refuseSettings === true) {
            return Promise.resolve(Response.json({ error: "title-required" }, { status: 409 }));
          }
          return Promise.resolve(
            Response.json({ code: "BQKX7", settings: { ...settings, hideJoinCode: true } }),
          );
        }
        return Promise.resolve(Response.json(diagnostics));
      },
    }),
  };
}

// Liveness is measured against the wall clock (the listing predicate filters on expires_at),
// so this row's deadline is relative to now rather than a frozen literal.
const registryRow = {
  code: "BQKX7",
  listing: "public",
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
  // Present = a PATCH body; absent = the GET/DELETE shape.
  patch?: unknown;
}): Event {
  const headers = new Headers();
  if (options.token !== null && options.token !== undefined) {
    headers.set(hostTokenHeader, options.token);
  }
  const request =
    options.patch === undefined
      ? new Request("https://test/api/rooms/BQKX7", { headers })
      : new Request("https://test/api/rooms/BQKX7", {
          method: "PATCH",
          headers,
          body: JSON.stringify(options.patch),
        });
  return {
    params: { code: options.code ?? "BQKX7" },
    request,
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

describe("PATCH /api/rooms/<CODE> - changing a live room's settings", () => {
  it("forwards the host token and answers with the settings AFTER the edit", async () => {
    const durableObject = namespace();
    const response = await PATCH(
      event({
        token: hostToken,
        namespace: durableObject,
        database: database(),
        patch: { settings: { hideJoinCode: true } },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as UpdateRoomSettingsResponse;
    expect(body.settings.hideJoinCode).toBe(true);
    expect(body.registry).toEqual({ status: "ok" });
    // The token is checked INSIDE the DO, so the route's whole job is carrying it there.
    expect(durableObject.seen[0]?.token).toBe(hostToken);
    expect(durableObject.seen[0]?.url).toContain("/settings");
  });

  it("refuses a malformed patch before it reaches the room", async () => {
    const durableObject = namespace();
    // An empty patch changes nothing, and `unlisted` is not a listing value any more.
    for (const patch of [{ settings: {} }, { settings: { listing: "unlisted" } }, {}]) {
      // oxlint-disable-next-line no-await-in-loop
      const response = await PATCH(event({ token: hostToken, namespace: durableObject, patch }));
      expect(response.status).toBe(400);
    }
    expect(durableObject.seen).toHaveLength(0);
  });

  it("relays the room's own refusal (a public room needs a title) as 409", async () => {
    const response = await PATCH(
      event({
        token: hostToken,
        namespace: namespace({ refuseSettings: true }),
        patch: { settings: { listing: "public" } },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "title-required" });
  });

  it("is host-only, like every other door on this route", async () => {
    const durableObject = namespace();
    expect(
      (
        await PATCH(
          event({
            token: null,
            namespace: durableObject,
            patch: { settings: { listing: "private" } },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await PATCH(
          event({
            token: "c".repeat(32),
            namespace: namespace(),
            patch: { settings: { listing: "private" } },
          }),
        )
      ).status,
    ).toBe(403);
    expect(durableObject.seen).toHaveLength(0);
  });

  // Rooms carry no password since 2026-08-20 (@jeopardy/protocol room/visibility.ts). The
  // patch schema is strict, so the field is not merely ignored - it is a malformed body, and
  // this route fails fast on it BEFORE the DO is dialled. That last part is the assertion
  // worth keeping: a stale console that still sends one must not be able to reach the room
  // with it and have the DO decide what a password means.
  it("refuses a password patch at the door, and never dials the room with it", async () => {
    const durableObject = namespace();
    const response = await PATCH(
      event({
        token: hostToken,
        namespace: durableObject,
        database: database(),
        patch: { settings: { password: "sequoia-2026" } },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("sequoia-2026");
    expect(durableObject.seen).toHaveLength(0);
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
