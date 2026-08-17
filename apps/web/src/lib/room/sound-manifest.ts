// Typed access to the generated sound manifest. sound-manifest.json is written by
// tools/audio-bake (never by hand - that package's README covers how and when to re-bake);
// this module is the only place shipped code should read it through, so the JSON shape is
// asserted once here and the gate test (sound-manifest.gate.test.ts) holds the file to it.
//
// The manifest is the pack's single index, including the one cue that has no file:
// `synthesizedCues` carries the time-up double-beep's parameters, because no CC0 double-beep
// exists and the owner approved synthesizing it (docs/content/media-and-sounds.md section 3).
// Keeping it here rather than as loose constants in room-audio.ts means "what is in the pack"
// has exactly one answer.
import manifestJson from "#lib/room/sound-manifest.json";

/** buzz = a team's room-audible identity; cue = a system event; music = beds and the lobby. */
export type SoundKind = "buzz" | "cue" | "music";

export type SoundSource = {
  pageUrl: string;
  previewUrl: string;
  author: string;
  title: string;
  /** Always "CC0 1.0" today - the bundle policy is CC0-only (tools/audio-bake/src/fetch.mjs). */
  license: string;
  verifiedAt: string;
};

export type SoundEntry = {
  /** Buzz ids are the curatedAssetIds the protocol carries in buzzSoundId fields. */
  id: string;
  label: string;
  kind: SoundKind;
  /** File name under `basePath`. */
  file: string;
  bytes: number;
  sha256: string;
  durationSeconds: number;
  /** Where audible energy starts - uniform across the pack, the fairness invariant. */
  onsetSeconds: number;
  channels: number;
  bitrateKilobits: number;
  loudnessLufs: number | null;
  loudnessMetric: "momentary" | "integrated";
  loudnessTargetLufs: number;
  /** The peak ceiling, not the target, set this file's level (see the bake's README). */
  peakLimited: boolean;
  peakDecibels: number;
  appliedGainDecibels: number;
  source: SoundSource;
};

export type SynthesizedCue = {
  id: string;
  label: string;
  kind: SoundKind;
  synthesis: {
    shape: string;
    frequencyHertz: number;
    beepSeconds: number;
    gapSeconds: number;
    beeps: number;
  };
  note: string;
};

export type SoundManifest = {
  version: number;
  basePath: string;
  format: { container: string; mime: string; sampleRate: number };
  onset: { targetSeconds: number; windowSeconds: { minimum: number; maximum: number } };
  durationWindows: Record<string, { minimum: number; maximum: number }>;
  loudnessTargets: Record<string, number>;
  /**
   * The signature lobby track slot - ONE track forever, never rotated (owner directive,
   * docs/content/media-and-sounds.md section 7). `status` is "placeholder" until the owner
   * finishes the round-4 review; swapping the winner in is one row in the bake's source table.
   */
  lobbyTrack: { id: string; status: "placeholder" | "chosen" };
  /** Think-music beds, rotated per round (unlike the lobby track). */
  thinkTrackIds: readonly string[];
  sounds: readonly SoundEntry[];
  synthesizedCues: readonly SynthesizedCue[];
};

export const soundManifest = manifestJson as SoundManifest;

if (soundManifest.version !== 1) {
  throw new Error(
    `sound-manifest.json version ${soundManifest.version} does not match this loader (1) - re-bake via tools/audio-bake`,
  );
}

/** Public URL of one sound file. */
export function soundUrl(entry: SoundEntry): string {
  return soundManifest.basePath + entry.file;
}

export function soundById(soundId: string | null): SoundEntry | null {
  if (soundId === null) return null;
  return soundManifest.sounds.find((entry) => entry.id === soundId) ?? null;
}

export function soundsOfKind(kind: SoundKind): readonly SoundEntry[] {
  return soundManifest.sounds.filter((entry) => entry.kind === kind);
}

export function synthesizedCueById(cueId: string): SynthesizedCue | null {
  return soundManifest.synthesizedCues.find((cue) => cue.id === cueId) ?? null;
}
