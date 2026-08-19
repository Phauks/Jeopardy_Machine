// The curated buzzer pack: the 14 approved sounds of docs/content/media-and-sounds.md
// section 9 (finalized 2026-08-13; the pack grows by PR, never by upload - owner directive).
// Slugs match fixtures/dummy-roster.json's buzzSoundCatalog and are the curatedAssetIds the
// M3 protocol carries in buzzSoundId fields.
//
// The audio FILES are bundled (M5): apps/web/static/sounds/, indexed by sound-manifest.json.
// This list stays separate from that manifest on purpose - it is the protocol-facing id
// vocabulary, importable by surfaces that must not pull in bake metadata - and
// sound-manifest.gate.test.ts holds the two to the same 14 ids, order and labels included.
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
