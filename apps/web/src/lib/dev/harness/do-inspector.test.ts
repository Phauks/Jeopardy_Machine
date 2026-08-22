// Server-render test of the DO inspector block (same approach as the other component tests:
// svelte/server render, no browser mode - docs/DEVELOPMENT.md).
//
// Two things are worth holding: the inspector must render the drift case in words (a live
// room with no registry row is exactly the owner's empty-lobby bug, seen from the other end),
// and it must render nothing at all before a reading exists rather than inventing zeroes.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import DoInspector from "#lib/dev/harness/do-inspector.svelte";
import type { RoomInspection } from "@jeopardy/protocol/room/diagnostics";

const now = 1_760_000_100_000;

const inspection: RoomInspection = {
  room: {
    code: "BQKX7",
    lifecycle: "active",
    settings: {
      listing: "public",
      maxPlayers: 24,
      maxSpectators: 50,
      spectatorsAllowed: true,
      hideJoinCode: true,
      title: "Pub quiz night",
      hostLabel: "Board Game Club",
    },
    createdAt: 1_760_000_000_000,
    lastActivityAt: 1_760_000_060_000,
    expiresAt: now + 90 * 60_000,
    paused: true,
    stateVersion: 12,
    connections: { total: 5, host: 1, player: 3, display: 1, spectator: 0, unjoined: 0 },
    participants: {
      players: { seated: 3, connected: 2, max: 24 },
      spectators: { connected: 0, max: 50, allowed: true },
    },
    roster: { players: 3, connected: 2, teams: 1 },
    alarm: {
      nextWakeAt: now + 30_000,
      entries: [{ source: "engine-timer", label: "clue-answer", dueAt: now + 30_000 }],
    },
    storage: { totalBytes: 8192, keys: [{ key: "state", bytes: 6000 }] },
  },
  registry: { status: "ok" },
  registryRow: {
    listed: true,
    phase: "active",
    playerCount: 3,
    expiresAt: now + 90 * 60_000,
    endedAt: null,
  },
};

describe("the DO inspector block", () => {
  it("renders the room's own reading: phase, counts, versions and countdowns", () => {
    const { body } = render(DoInspector, { props: { inspection, now, error: null } });
    expect(body).toContain("BQKX7");
    expect(body).toContain("active");
    expect(body).toContain("PAUSED");
    expect(body).toContain("3 seated");
    expect(body).toContain("1h 30m");
    expect(body).toContain("state");
  });

  it("renders the room controls and the split census, streamer mode included", () => {
    const { body } = render(DoInspector, { props: { inspection, now, error: null } });
    expect(body).toContain("join code hidden");
    // Both budgets, each as its own fraction - one number could never say which door refuses.
    expect(body).toContain("players 2/24 (3 seated)");
    expect(body).toContain("spectators 0/50");
  });

  it("says out loud when spectators are turned off", () => {
    const off: RoomInspection = {
      ...inspection,
      room: {
        ...inspection.room,
        settings: { ...inspection.room.settings, spectatorsAllowed: false },
        participants: {
          ...inspection.room.participants,
          spectators: { connected: 0, max: 50, allowed: false },
        },
      },
    };
    const { body } = render(DoInspector, { props: { inspection: off, now, error: null } });
    expect(body).toContain("spectators off");
  });

  it("says plainly when a live room has NO registry row - the drift behind an empty lobby", () => {
    const { body } = render(DoInspector, {
      props: { inspection: { ...inspection, registryRow: null }, now, error: null },
    });
    expect(body).toContain("NO ROW");
  });

  it("blames the registry, not the room, when the row could not be read", () => {
    const { body } = render(DoInspector, {
      props: {
        inspection: {
          ...inspection,
          registry: { status: "unavailable", reason: "no-table" },
          registryRow: null,
        },
        now,
        error: null,
      },
    });
    expect(body).toContain("no-table");
    expect(body).not.toContain("NO ROW");
  });

  it("names the cache lag when the row's phase trails the room's", () => {
    const { body } = render(DoInspector, {
      props: {
        inspection: {
          ...inspection,
          registryRow: { ...inspection.registryRow!, phase: "lobby" },
        },
        now,
        error: null,
      },
    });
    expect(body).toContain("catches up");
  });

  it("shows a placeholder rather than zeroes before any reading exists", () => {
    const { body } = render(DoInspector, { props: { inspection: null, now, error: null } });
    expect(body).toContain("No reading yet");
    expect(body).not.toContain("state version");
  });
});
