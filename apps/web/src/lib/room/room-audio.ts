// Room audio: the device-local player for room-audible sounds (buzz-ins, stings). Two owner
// directives are load-bearing here (docs/research/00-user-directives.md "Audio pipeline"):
//
// - Only the winning buzz is heard: playback keys off the adjudicated buzz-won event alone,
//   and the room channel is an EXCLUSIVE SLOT - a sound that would overlap a playing one is
//   DROPPED, never queued (a late sound after the moment is confusing). The one exception is
//   the host's sound-check mode, which plays every team's sound serialized through a queue.
// - Pre-decoded Web Audio buffers: decode once at prime() time, so the press-to-sound path
//   is a buffer start, not a fetch.
//
// Audio FILES are not bundled yet (the trim/onset/LUFS pipeline is the M5 bundling pass -
// docs/content/media-and-sounds.md section 9). Until then every catalog id decodes to a
// generated placeholder tone whose pitch is derived from the sound id, so buzz identity is
// audibly distinguishable in dev without shipping unvetted audio. Swapping in real files
// changes ONLY primeBuffers() below.
//
// Routing is per-device (resolved UX question 3): every client owns an `enabled` toggle,
// default on for displays, off elsewhere; there is no server routing logic.
import { buzzSoundCatalog } from "#lib/room/buzz-sound-catalog.ts";

/** The subset of AudioContext the module touches - injectable so tests run without a DOM. */
export type RoomAudioContextLike = {
  currentTime: number;
  sampleRate: number;
  destination: AudioNode | object;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  resume?: () => Promise<void>;
};

export type RoomAudioOptions = {
  /** Per-device room-audio toggle default; the display route passes true. */
  enabled?: boolean;
  /** Injected for tests; defaults to a real AudioContext in the browser. */
  context?: RoomAudioContextLike;
};

const placeholderDurationSeconds = 0.6;

function stableHash(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export class RoomAudio {
  enabled: boolean;
  private context: RoomAudioContextLike | null = null;
  private readonly injectedContext: RoomAudioContextLike | undefined;
  private buffers = new Map<string, AudioBuffer>();
  /** context.currentTime until which the exclusive room slot is occupied. */
  private slotBusyUntil = 0;
  /** Sound-check serialization point (the one sanctioned queue). */
  private checkQueueUntil = 0;

  constructor(options: RoomAudioOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.injectedContext = options.context;
  }

  /**
   * Create the context and pre-decode every catalog sound. Must be called from a user
   * gesture on iOS (autoplay policy) - the routes call it on the first tap/keypress.
   */
  prime(): void {
    if (this.context !== null) return;
    const context =
      this.injectedContext ?? (typeof AudioContext === "undefined" ? null : new AudioContext());
    if (context === null) return;
    this.context = context;
    void context.resume?.();
    this.primeBuffers(context);
  }

  get primed(): boolean {
    return this.context !== null;
  }

  private primeBuffers(context: RoomAudioContextLike): void {
    // PLACEHOLDER SYNTHESIS - replaced by decodeAudioData over bundled files in M5. A short
    // two-partial tone with an exponential decay and a ~10 ms onset ramp (the uniform-onset
    // spec applies to placeholders too: onset IS perceived buzz latency).
    for (const sound of buzzSoundCatalog) {
      const frequency = 320 + (stableHash(sound.id) % 24) * 55;
      this.buffers.set(sound.id, this.synthesizeTone(context, frequency));
    }
    this.buffers.set("default", this.synthesizeTone(context, 440));
  }

  private synthesizeTone(context: RoomAudioContextLike, frequency: number): AudioBuffer {
    const sampleRate = context.sampleRate;
    const length = Math.round(placeholderDurationSeconds * sampleRate);
    const buffer = context.createBuffer(1, length, sampleRate);
    const channel = buffer.getChannelData(0);
    const onsetSamples = Math.round(0.01 * sampleRate);
    for (let index = 0; index < length; index += 1) {
      const time = index / sampleRate;
      const onset = index < onsetSamples ? index / onsetSamples : 1;
      const decay = Math.exp(-4 * time);
      channel[index] =
        onset *
        decay *
        0.25 *
        (Math.sin(2 * Math.PI * frequency * time) +
          0.4 * Math.sin(2 * Math.PI * frequency * 1.5 * time));
    }
    return buffer;
  }

  private startBuffer(soundId: string | null): number {
    const context = this.context;
    if (context === null) return 0;
    const buffer = this.buffers.get(soundId ?? "default") ?? this.buffers.get("default");
    if (buffer === undefined) return 0;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination as AudioNode);
    source.start();
    return buffer.duration;
  }

  /**
   * Play a room-audible buzz sound through the exclusive slot. Returns whether it played:
   * false = disabled, unprimed, or the slot was busy (the drop-not-queue rule).
   */
  playBuzz(soundId: string | null): boolean {
    const context = this.context;
    if (!this.enabled || context === null) return false;
    if (context.currentTime < this.slotBusyUntil) return false;
    const duration = this.startBuffer(soundId);
    if (duration === 0) return false;
    this.slotBusyUntil = context.currentTime + duration;
    return true;
  }

  /**
   * Sound-check mode (C3): intentionally plays EVERY requested sound, serialized through a
   * queue instead of the exclusive slot - the one sanctioned exception to drop-not-queue.
   */
  playSoundCheck(soundId: string | null): void {
    const context = this.context;
    if (!this.enabled || context === null) return;
    const buffer = this.buffers.get(soundId ?? "default") ?? this.buffers.get("default");
    if (buffer === undefined) return;
    const startAt = Math.max(context.currentTime, this.checkQueueUntil);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination as AudioNode);
    source.start(startAt);
    this.checkQueueUntil = startAt + buffer.duration;
  }

  /**
   * Local-only preview (join-screen tap-to-preview, losing-buzz personal feedback). Local
   * feedback is outside the room slot on purpose: it plays on the picker's own device and
   * can never collide with the room channel semantics.
   */
  playLocalPreview(soundId: string | null): void {
    if (this.context === null) return;
    this.startBuffer(soundId);
  }
}
