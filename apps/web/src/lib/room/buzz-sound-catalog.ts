// The curated buzzer pack: the 14 approved sounds of docs/content/media-and-sounds.md
// section 9 (finalized 2026-08-13; the pack grows by PR, never by upload - owner directive).
// Slugs match fixtures/dummy-roster.json's buzzSoundCatalog and are the curatedAssetIds the
// M3 protocol carries in buzzSoundId fields. Audio FILES are not bundled yet: the sourcing
// pipeline (trim, uniform ~10 ms onset, -16 LUFS) runs in the M5 bundling pass, so
// lib/room/room-audio.ts plays placeholder tones until then (documented there).
export type BuzzSound = {
  id: string;
  label: string;
};

export const buzzSoundCatalog: readonly BuzzSound[] = [
  { id: "correct-bell", label: "Correct Bell" },
  { id: "ding", label: "Ding" },
  { id: "clown-horn", label: "Clown Horn" },
  { id: "squeaky-toy", label: "Squeaky Toy" },
  { id: "laser-zap", label: "Laser Zap" },
  { id: "klaxon", label: "Klaxon" },
  { id: "kookaburra", label: "Kookaburra" },
  { id: "loon", label: "Loon" },
  { id: "owl-hoot", label: "Owl Hoot" },
  { id: "airhorn", label: "Airhorn" },
  { id: "gong", label: "Gong" },
  { id: "game-powerup", label: "Game Powerup" },
  { id: "elephant-trumpet", label: "Elephant Trumpet" },
  { id: "swanee-whistle", label: "Swanee Whistle" },
];

export function buzzSoundLabel(soundId: string | null): string {
  if (soundId === null) return "Default";
  return buzzSoundCatalog.find((entry) => entry.id === soundId)?.label ?? soundId;
}
