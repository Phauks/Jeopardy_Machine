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
// The bundled pack (M5) is real now: apps/web/static/sounds/, indexed by sound-manifest.json,
// produced by tools/audio-bake. prime() still returns synchronously and every id is playable
// the instant it does, because it seeds a generated placeholder tone per id FIRST and then
// swaps in decoded files as they arrive. That is not a nicety - prime() must run inside a user
// gesture on iOS, so it cannot await a network round-trip, and a buzzer that is silent for the
// first second of a lobby is worse than one that is briefly a tone.
//
// Music (think beds, the lobby track) is deliberately NOT part of prime(): the lobby track
// alone is ~3.8 MB, and every phone in the room runs this module. It loads on demand.
//
// Routing is per-device (resolved UX question 3): every client owns an `enabled` toggle,
// default on for displays, off elsewhere; there is no server routing logic.
import { buzzSoundCatalog } from "#lib/room/buzz-sound-catalog.ts";
import { soundManifest, soundUrl } from "#lib/room/sound-manifest.ts";
import type { SoundEntry, SynthesizedCue } from "#lib/room/sound-manifest.ts";

/** The subset of AudioContext the module touches - injectable so tests run without a DOM. */
export type RoomAudioContextLike = {
  currentTime: number;
  sampleRate: number;
  destination: AudioNode | object;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  resume?: () => Promise<void>;
  /** Absent in the test fake: without it the pack never loads and placeholders stay. */
  decodeAudioData?: (audioData: ArrayBuffer) => Promise<AudioBuffer>;
};

export type RoomAudioOptions = {
  /** Per-device room-audio toggle default; the display route passes true. */
  enabled?: boolean;
  /** Injected for tests; defaults to a real AudioContext in the browser. */
  context?: RoomAudioContextLike;
};

const placeholderDurationSeconds = 0.6;

/** ids the pack loads eagerly at prime(): everything room-audible and latency-critical. */
const eagerKinds = new Set(["buzz", "cue"]);

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
  /** Ids whose real file is decoded and in `buffers` - the rest are still placeholder tones. */
  private loaded = new Set<string>();
  /** The looping music source, if any. Music lives outside the exclusive room slot. */
  private musicSource: AudioBufferSourceNode | null = null;
  /** context.currentTime until which the exclusive room slot is occupied. */
  private slotBusyUntil = 0;
  /** Sound-check serialization point (the one sanctioned queue). */
  private checkQueueUntil = 0;

  constructor(options: RoomAudioOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.injectedContext = options.context;
  }

  /**
   * Create the context and make every sound playable. Must be called from a user gesture on
   * iOS (autoplay policy) - the routes call it on the first tap/keypress.
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

  /** How much of the eager pack has finished decoding - surfaced for a sound-check readout. */
  get packLoadedCount(): number {
    return this.loaded.size;
  }

  private primeBuffers(context: RoomAudioContextLike): void {
    // Seed every id with a generated tone so nothing is ever silent, then upgrade in place.
    // The tone's pitch is derived from the sound id, so ids stay audibly distinguishable even
    // in the window before the files land (and forever, in tests and SSR-less environments).
    for (const sound of buzzSoundCatalog) {
      const frequency = 320 + (stableHash(sound.id) % 24) * 55;
      this.buffers.set(sound.id, this.synthesizeTone(context, frequency));
    }
    this.buffers.set("default", this.synthesizeTone(context, 440));

    // The one cue with no file anywhere: no CC0 double-beep exists, so the owner approved
    // synthesizing it (docs/content/media-and-sounds.md section 3). Its parameters ride in the
    // manifest with everything else, so the pack has one index, not two.
    for (const cue of soundManifest.synthesizedCues) {
      this.buffers.set(cue.id, this.synthesizeDoubleBeep(context, cue));
      this.loaded.add(cue.id);
    }

    void this.loadPack(context);
  }

  /** Fetch + decode the eager half of the bundled pack, replacing placeholders as they land. */
  private async loadPack(context: RoomAudioContextLike): Promise<void> {
    const decode = context.decodeAudioData;
    if (decode === undefined || typeof fetch === "undefined") return;
    await Promise.all(
      soundManifest.sounds
        .filter((entry) => eagerKinds.has(entry.kind))
        .map((entry) => this.loadOne(context, entry)),
    );
  }

  private async loadOne(context: RoomAudioContextLike, entry: SoundEntry): Promise<void> {
    const decode = context.decodeAudioData;
    if (decode === undefined) return;
    try {
      const response = await fetch(soundUrl(entry));
      if (!response.ok) return;
      const buffer = await decode.call(context, await response.arrayBuffer());
      this.buffers.set(entry.id, buffer);
      this.loaded.add(entry.id);
    } catch {
      // A failed fetch or decode leaves the placeholder tone in place. Room audio degrading to
      // a tone is a cosmetic problem; throwing here would take a live game's audio down.
    }
  }

  private synthesizeTone(context: RoomAudioContextLike, frequency: number): AudioBuffer {
    const sampleRate = context.sampleRate;
    const length = Math.round(placeholderDurationSeconds * sampleRate);
    const buffer = context.createBuffer(1, length, sampleRate);
    const channel = buffer.getChannelData(0);
    const onsetSamples = Math.round(soundManifest.onset.targetSeconds * sampleRate);
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

  /**
   * The time-up cue, built rather than sourced: N beeps of `beepSeconds` at `frequencyHertz`,
   * `gapSeconds` apart. Each beep gets the same ~10 ms onset ramp the bundled files carry -
   * the uniform-onset spec is about what a room hears, and a synthesized cue is not exempt.
   */
  private synthesizeDoubleBeep(context: RoomAudioContextLike, cue: SynthesizedCue): AudioBuffer {
    const sampleRate = context.sampleRate;
    const { frequencyHertz, beepSeconds, gapSeconds, beeps } = cue.synthesis;
    const onsetSeconds = soundManifest.onset.targetSeconds;
    const totalSeconds = onsetSeconds + beeps * beepSeconds + (beeps - 1) * gapSeconds;
    const buffer = context.createBuffer(1, Math.round(totalSeconds * sampleRate), sampleRate);
    const channel = buffer.getChannelData(0);
    const rampSamples = Math.max(1, Math.round(0.004 * sampleRate));
    for (let beep = 0; beep < beeps; beep += 1) {
      const startSample = Math.round(
        (onsetSeconds + beep * (beepSeconds + gapSeconds)) * sampleRate,
      );
      const beepSamples = Math.round(beepSeconds * sampleRate);
      for (let index = 0; index < beepSamples; index += 1) {
        // Ramp both ends of every beep: a hard-edged square burst clicks on cheap speakers.
        const edge = Math.min(index, beepSamples - index - 1);
        const envelope = Math.min(1, edge / rampSamples);
        channel[startSample + index] =
          envelope * 0.35 * Math.sin((2 * Math.PI * frequencyHertz * index) / sampleRate);
      }
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
   * Play a system cue (board-ready, wrong-answer, wager sting, time-up) through the same
   * exclusive slot as buzz-ins, on purpose: the room has ONE audible channel, and a cue that
   * talks over a team's buzz is the same confusion the drop-not-queue rule exists to prevent.
   */
  playCue(cueId: string): boolean {
    return this.playBuzz(cueId);
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

  /**
   * Start a looping music bed - the lobby track, or a think bed. Outside the exclusive slot
   * because music is a bed under the room, not an event in it; a buzz-in must be able to cut
   * through it. Fetches on first use (music is not in prime()'s eager set), so the first call
   * resolves once the track is decodable and playing.
   *
   * Which track fills the lobby slot is one manifest field (`lobbyTrack.id`), which in turn is
   * one row in tools/audio-bake/src/sources.mjs. Today's is a PLACEHOLDER: the owner has not
   * picked the signature track yet (docs/content/media-and-sounds.md section 9, round 4).
   */
  async playMusic(soundId: string): Promise<boolean> {
    const context = this.context;
    if (!this.enabled || context === null) return false;
    const entry = soundManifest.sounds.find((sound) => sound.id === soundId);
    if (entry === undefined || entry.kind !== "music") return false;
    if (!this.loaded.has(entry.id)) await this.loadOne(context, entry);
    const buffer = this.buffers.get(entry.id);
    if (buffer === undefined || !this.loaded.has(entry.id)) return false;
    this.stopMusic();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(context.destination as AudioNode);
    source.start();
    this.musicSource = source;
    return true;
  }

  /** Start the one signature lobby track (never rotated - owner directive). */
  playLobbyMusic(): Promise<boolean> {
    return this.playMusic(soundManifest.lobbyTrack.id);
  }

  stopMusic(): void {
    this.musicSource?.stop();
    this.musicSource = null;
  }
}
