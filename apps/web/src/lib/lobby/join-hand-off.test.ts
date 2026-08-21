// The host token's storage, which is M6's "resume a crashed game" in one credential.
//
// It rode sessionStorage until 2026-08-19, and the cost of that was not a console: it was the
// ROOM. A host whose tab died - a crashed browser, a laptop asleep too long, a window closed at
// the worst moment - could never host that room again, the players stayed connected to a game
// with no driver, and the console's own screen told them to make a new one. The token now
// survives the tab and names its own death.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
import { recallHostToken, rememberHostToken } from "#lib/lobby/join-hand-off.ts";

/** A minimal Storage over a Map - enough for the two calls this module makes. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => entries.set(key, value),
  } as Storage;
}

const globals = globalThis as { localStorage?: Storage };
let original: Storage | undefined;

beforeEach(() => {
  original = globals.localStorage;
  globals.localStorage = memoryStorage();
});

afterEach(() => {
  if (original === undefined) delete globals.localStorage;
  else globals.localStorage = original;
});

const now = 1_760_000_000_000;

describe("the host token survives the tab that made the room", () => {
  it("comes back after the browser is closed and reopened", () => {
    rememberHostToken("BQKX7", "secret-token", now);
    // A new tab, a new window, a restarted browser: localStorage is the same store for all
    // three, which is exactly the property sessionStorage did not have.
    expect(recallHostToken("BQKX7", now + 60_000)).toBe("secret-token");
  });

  it("is scoped to its own room, never to the browser", () => {
    rememberHostToken("BQKX7", "secret-token", now);
    expect(recallHostToken("ZZZZZ", now)).toBe("");
  });

  it("normalizes the code, so a lowercase URL finds the same room's key", () => {
    rememberHostToken("BQKX7", "secret-token", now);
    expect(recallHostToken("bqkx7", now)).toBe("secret-token");
  });

  it("is cleared by an empty token - what a closed room does on the way out", () => {
    rememberHostToken("BQKX7", "secret-token", now);
    rememberHostToken("BQKX7", "", now);
    expect(recallHostToken("BQKX7", now)).toBe("");
  });
});

describe("...and dies with the room, rather than living in the browser forever", () => {
  it("expires after the room's own idle life", () => {
    rememberHostToken("BQKX7", "secret-token", now);
    const wellPastExpiry = now + limits.room.idleExpiryMs + 2 * 60 * 60 * 1000;
    expect(recallHostToken("BQKX7", wellPastExpiry)).toBe("");
  });

  it("DELETES the expired record rather than stepping over it", () => {
    // A browser that hosts a quiz a month must not accumulate a drawer of dead credentials.
    rememberHostToken("BQKX7", "secret-token", now);
    recallHostToken("BQKX7", now + limits.room.idleExpiryMs + 2 * 60 * 60 * 1000);
    expect(globals.localStorage?.length).toBe(0);
  });

  it("treats an unreadable record as absent, and removes it", () => {
    globals.localStorage?.setItem("jeopardy.host-token.BQKX7", "not json");
    expect(recallHostToken("BQKX7", now)).toBe("");
    expect(globals.localStorage?.length).toBe(0);
  });

  it("answers empty when the browser has no storage at all", () => {
    delete globals.localStorage;
    expect(() => {
      rememberHostToken("BQKX7", "secret-token", now);
    }).not.toThrow();
    expect(recallHostToken("BQKX7", now)).toBe("");
  });
});
