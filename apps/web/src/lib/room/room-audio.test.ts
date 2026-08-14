// The exclusive-slot rule under test (owner directive "Only the winning buzz is heard"):
// a would-overlap room sound is dropped, never queued; sound-check is the one sanctioned
// queue. Runs against a fake AudioContext so node vitest needs no DOM.
import { describe, expect, it } from "vitest";
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
        start: (at?: number) => {
          started.push({ at: at ?? clock.now, duration: buffer?.duration ?? 0 });
        },
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

  it("unknown sound ids fall back to the default placeholder, never error mid-game", () => {
    const { context, started } = fakeContext();
    const audio = new RoomAudio({ enabled: true, context });
    audio.prime();
    expect(audio.playBuzz("not-a-real-sound")).toBe(true);
    expect(audio.playBuzz(null)).toBe(false); // slot busy - still the drop rule
    expect(started).toHaveLength(1);
  });
});
