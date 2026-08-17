// The exclusive-slot rule under test (owner directive "Only the winning buzz is heard"):
// a would-overlap room sound is dropped, never queued; sound-check is the one sanctioned
// queue. Runs against a fake AudioContext so node vitest needs no DOM.
import { describe, expect, it, vi } from "vitest";
import { RoomAudio } from "#lib/room/room-audio.ts";
import type { RoomAudioContextLike } from "#lib/room/room-audio.ts";

type StartedSource = { at: number; duration: number };

function fakeContext(): {
  context: RoomAudioContextLike;
  started: StartedSource[];
  clock: { now: number };
} {
  const started: StartedSource[] = [];
  const clock = { now: 0 };
  const context: RoomAudioContextLike = {
    get currentTime() {
      return clock.now;
    },
    sampleRate: 8000,
    destination: {},
    createBuffer(_channels: number, length: number, sampleRate: number) {
      const data = new Float32Array(length);
      return {
        duration: length / sampleRate,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
    },
    createBufferSource() {
      let buffer: AudioBuffer | null = null;
      const source = {
        get buffer() {
          return buffer;
        },
        set buffer(next: AudioBuffer | null) {
          buffer = next;
        },
        connect: () => undefined,
        // `loop` and `stop` exist for the music channel, which is the one caller that keeps a
        // source around long enough to need either.
        loop: false,
        start: (at?: number) => {
          started.push({ at: at ?? clock.now, duration: buffer?.duration ?? 0 });
        },
        stop: () => undefined,
      };
      return source as unknown as AudioBufferSourceNode;
    },
  };
  return { context, started, clock };
}

describe("room-audio exclusive slot", () => {
  it("plays nothing until primed or while routing is disabled (per-device toggle)", () => {
    const { context, started } = fakeContext();
    const disabled = new RoomAudio({ enabled: false, context });
    disabled.prime();
    expect(disabled.playBuzz("gong")).toBe(false);
    const unprimed = new RoomAudio({ enabled: true });
    expect(unprimed.playBuzz("gong")).toBe(false);
    expect(started).toHaveLength(0);
  });

  it("drops a second buzz while the slot is busy, allows one after it frees", () => {
    const { context, started, clock } = fakeContext();
    const audio = new RoomAudio({ enabled: true, context });
    audio.prime();
    expect(audio.playBuzz("klaxon")).toBe(true);
    // Overlap attempt: dropped, not queued - nothing new started.
    expect(audio.playBuzz("gong")).toBe(false);
    expect(started).toHaveLength(1);
    // After the buffer's duration passes, the slot frees.
    clock.now = (started[0]?.duration ?? 0) + 0.01;
    expect(audio.playBuzz("gong")).toBe(true);
    expect(started).toHaveLength(2);
  });

  it("sound-check serializes every requested sound through a queue instead", () => {
    const { context, started } = fakeContext();
    const audio = new RoomAudio({ enabled: true, context });
    audio.prime();
    audio.playSoundCheck("klaxon");
    audio.playSoundCheck("gong");
    audio.playSoundCheck("airhorn");
    expect(started).toHaveLength(3);
    // Each start time is the previous sound's end - serialized, none dropped.
    const first = started[0];
    const second = started[1];
    const third = started[2];
    expect(second?.at).toBeCloseTo((first?.at ?? 0) + (first?.duration ?? 0), 5);
    expect(third?.at).toBeCloseTo((second?.at ?? 0) + (second?.duration ?? 0), 5);
  });

  it("local previews bypass the room slot entirely (losing buzzes stay personal)", () => {
    const { context, started } = fakeContext();
    const audio = new RoomAudio({ enabled: true, context });
    audio.prime();
    expect(audio.playBuzz("klaxon")).toBe(true);
    audio.playLocalPreview("ding");
    // The preview started even though the room slot was busy.
    expect(started).toHaveLength(2);
    // And it did not extend the room slot: the slot still frees at the first buzz's end.
    expect(audio.playBuzz("gong")).toBe(false);
  });

  it("shares the one room channel with system cues - a cue cannot talk over a buzz", () => {
    const { context, started, clock } = fakeContext();
    const audio = new RoomAudio({ enabled: true, context });
    audio.prime();
    expect(audio.playBuzz("klaxon")).toBe(true);
    expect(audio.playCue("time-up")).toBe(false);
    clock.now = (started[0]?.duration ?? 0) + 0.01;
    expect(audio.playCue("time-up")).toBe(true);
    expect(started).toHaveLength(2);
  });

  it("synthesizes time-up at prime time - the one cue with no file to load", () => {
    const { context, started } = fakeContext();
    const audio = new RoomAudio({ enabled: true, context });
    audio.prime();
    // Two 150 ms beeps 120 ms apart plus the 10 ms onset = 430 ms, built from the manifest's
    // recorded parameters rather than from a magic number here.
    expect(audio.playCue("time-up")).toBe(true);
    expect(started[0]?.duration).toBeCloseTo(0.01 + 2 * 0.15 + 0.12, 3);
  });

  it("keeps music out of the room slot and out of prime() (no context, nothing to decode)", async () => {
    const { context, started } = fakeContext();
    const audio = new RoomAudio({ enabled: true, context });
    audio.prime();
    // The fake context has no decodeAudioData, so no file ever loads - which is exactly the
    // "music is fetched on demand, never at prime" contract seen from the test's side.
    expect(await audio.playLobbyMusic()).toBe(false);
    expect(started).toHaveLength(0);
    // And the room slot is untouched by the attempt.
    expect(audio.playBuzz("gong")).toBe(true);
  });

  it("treats a repeat request for the playing track as a no-op, never a restart", async () => {
    // The display drives this off a room phase that re-evaluates on every roster change, so
    // "play the lobby track" arrives many times; restarting from the top on each join would
    // be worse than no lobby music at all.
    const { context, started } = fakeContext();
    const decoded = context.createBuffer(2, 8000, 8000);
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    });
    const audio = new RoomAudio({
      enabled: true,
      context: { ...context, decodeAudioData: async () => decoded },
    });
    audio.prime();

    expect(await audio.playLobbyMusic()).toBe(true);
    expect(await audio.playLobbyMusic()).toBe(true);
    expect(await audio.playLobbyMusic()).toBe(true);
    const musicStarts = started.filter((entry) => entry.duration === decoded.duration);
    expect(musicStarts).toHaveLength(1);
    // And the file was fetched once, not once per call.
    expect(fetched.filter((url) => url === "/sounds/lobby-theme.mp3")).toHaveLength(1);

    // Stopping and asking again is a real restart - idempotence is per playing track, not a
    // permanent latch.
    audio.stopMusic();
    expect(await audio.playLobbyMusic()).toBe(true);
    expect(started.filter((entry) => entry.duration === decoded.duration)).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("unknown sound ids fall back to the default placeholder, never error mid-game", () => {
    const { context, started } = fakeContext();
    const audio = new RoomAudio({ enabled: true, context });
    audio.prime();
    expect(audio.playBuzz("not-a-real-sound")).toBe(true);
    expect(audio.playBuzz(null)).toBe(false); // slot busy - still the drop rule
    expect(started).toHaveLength(1);
  });
});
