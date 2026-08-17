// Invariant gate for the bundled sound pack: the manifest, the files on disk, and the buzz
// catalog must agree, or a re-bake was botched/skipped. tools/audio-bake writes all three
// outputs together (files, manifest, LICENSES.md) and this gate is what makes "commit them
// together" enforced rather than hoped for.
//
// The onset and duration checks are the point of the file. They run against the manifest's
// RECORDED measurements rather than re-decoding MP3 here, and that is not a weaker check: the
// same test re-hashes every file, so a recorded number can only describe the exact bytes in
// git. Editing an asset without re-baking fails the hash; editing a number without re-baking
// fails against a re-measurement (`pnpm -F @jeopardy/audio-bake verify`, which decodes the
// committed files with ffmpeg - too heavy a dependency for CI, exactly right for the pipeline).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buzzSoundCatalog } from "#lib/room/buzz-sound-catalog.ts";
import {
  soundById,
  soundManifest,
  soundsOfKind,
  soundUrl,
  synthesizedCueById,
} from "#lib/room/sound-manifest.ts";

const soundsDirectory = fileURLToPath(new URL("../../../static/sounds/", import.meta.url));
const filesOnDisk = new Set(readdirSync(soundsDirectory));

function bytesOf(fileName: string): Buffer {
  return readFileSync(path.join(soundsDirectory, fileName));
}

describe("sound manifest integrity", () => {
  it("declares the served base path and one format at one sample rate", () => {
    expect(soundManifest.basePath).toBe("/sounds/");
    expect(soundManifest.format).toEqual({
      container: "mp3",
      mime: "audio/mpeg",
      sampleRate: 44100,
    });
    // "Exported to one format at one sample rate" is checklist section 7 of
    // docs/content/media-and-sounds.md, not a preference - a mixed pack decodes at mixed cost.
    for (const sound of soundManifest.sounds) {
      expect(sound.file, sound.id).toBe(`${sound.id}.mp3`);
      expect(soundUrl(sound)).toBe(`/sounds/${sound.id}.mp3`);
    }
  });

  it("has unique kebab-case ids, a label, and a known kind for every entry", () => {
    const ids = soundManifest.sounds.map((sound) => sound.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const sound of soundManifest.sounds) {
      expect(sound.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(sound.label.length).toBeGreaterThan(0);
      expect(["buzz", "cue", "music"]).toContain(sound.kind);
    }
  });

  it("resolves every entry to committed bytes whose sha256 and size still match", () => {
    for (const sound of soundManifest.sounds) {
      expect(filesOnDisk, sound.file).toContain(sound.file);
      const bytes = bytesOf(sound.file);
      expect(bytes.length, sound.id).toBe(sound.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), sound.id).toBe(sound.sha256);
    }
  });

  it("has no orphan files on disk - a dropped source cannot linger unlicensed in static/", () => {
    const referenced = new Set([
      ...soundManifest.sounds.map((sound) => sound.file),
      // The credits file is the only non-audio thing that belongs in this directory.
      "LICENSES.md",
    ]);
    for (const fileName of filesOnDisk) expect(referenced, fileName).toContain(fileName);
  });
});

describe("the uniform onset (the fairness invariant)", () => {
  it("starts audible energy inside the 8-15 ms window in EVERY file, no exceptions", () => {
    // File onset IS perceived buzz-in latency, so an outlier means one team's sound reacts
    // later than another's (docs/content/media-and-sounds.md 7b, owner directive 2026-08-13).
    const { minimum, maximum } = soundManifest.onset.windowSeconds;
    expect(minimum).toBe(0.008);
    expect(maximum).toBe(0.015);
    expect(soundManifest.onset.targetSeconds).toBe(0.01);
    for (const sound of soundManifest.sounds) {
      expect(sound.onsetSeconds, `${sound.id} onset`).toBeGreaterThanOrEqual(minimum);
      expect(sound.onsetSeconds, `${sound.id} onset`).toBeLessThanOrEqual(maximum);
    }
  });

  it("never lets the onset be zero - the micro fade-in needs somewhere to live", () => {
    for (const sound of soundManifest.sounds) {
      expect(sound.onsetSeconds, sound.id).toBeGreaterThan(0);
    }
  });
});

describe("duration windows", () => {
  it("keeps every buzz-in inside the owner's 0.5-1.5 s window", () => {
    // Round 1 rejected several candidates as "too short" and the window came out of that
    // review (docs/content/media-and-sounds.md section 7).
    expect(soundManifest.durationWindows.buzz).toEqual({ minimum: 0.5, maximum: 1.5 });
    for (const sound of soundsOfKind("buzz")) {
      expect(sound.durationSeconds, `${sound.id} duration`).toBeGreaterThanOrEqual(0.5);
      expect(sound.durationSeconds, `${sound.id} duration`).toBeLessThanOrEqual(1.5);
    }
  });

  it("keeps every cue at or under 3 s", () => {
    for (const sound of soundsOfKind("cue")) {
      expect(sound.durationSeconds, `${sound.id} duration`).toBeLessThanOrEqual(3);
      expect(sound.durationSeconds, `${sound.id} duration`).toBeGreaterThan(0.15);
    }
  });

  it("gives the lobby track a lap of at least two minutes (owner's round-4 floor)", () => {
    const lobby = soundById(soundManifest.lobbyTrack.id);
    expect(lobby, soundManifest.lobbyTrack.id).not.toBeNull();
    expect(lobby?.kind).toBe("music");
    expect(lobby?.durationSeconds ?? 0).toBeGreaterThanOrEqual(120);
  });
});

describe("loudness", () => {
  it("lands every file on its target, or records why the peak ceiling stopped it", () => {
    for (const sound of soundManifest.sounds) {
      expect(sound.loudnessLufs, sound.id).not.toBeNull();
      const distance = Math.abs((sound.loudnessLufs ?? 0) - sound.loudnessTargetLufs);
      if (!sound.peakLimited) expect(distance, `${sound.id} loudness`).toBeLessThanOrEqual(1);
      // Nothing, peak-limited or not, may sit at or above digital full scale.
      expect(sound.peakDecibels, `${sound.id} peak`).toBeLessThan(0);
    }
  });
});

describe("the buzz pack and the protocol catalog agree", () => {
  it("bundles exactly the 14 approved buzz sounds, in catalog order, with matching labels", () => {
    // The pack is finalized at 14 (docs/content/media-and-sounds.md section 9) and grows by PR,
    // never by upload - so a mismatch here means someone edited one list and not the other.
    const buzz = soundsOfKind("buzz");
    expect(buzz).toHaveLength(14);
    expect(buzz.map((sound) => sound.id)).toEqual(buzzSoundCatalog.map((entry) => entry.id));
    for (const [index, entry] of buzzSoundCatalog.entries()) {
      expect(buzz[index]?.label, entry.id).toBe(entry.label);
    }
  });

  it("is mono for buzz-ins and cues, stereo for music", () => {
    for (const sound of soundManifest.sounds) {
      expect(sound.channels, sound.id).toBe(sound.kind === "music" ? 2 : 1);
    }
  });
});

describe("the synthesized time-up cue", () => {
  it("carries the approved double-beep parameters and ships no file", () => {
    // No CC0 double-beep exists (media-and-sounds.md section 3 logged the dead-end search);
    // the owner approved synthesizing two 150 ms beeps at 880 Hz, 120 ms apart.
    const cue = synthesizedCueById("time-up");
    expect(cue).not.toBeNull();
    expect(cue?.synthesis).toEqual({
      shape: "double-beep",
      frequencyHertz: 880,
      beepSeconds: 0.15,
      gapSeconds: 0.12,
      beeps: 2,
    });
    expect(soundById("time-up")).toBeNull();
    expect(filesOnDisk).not.toContain("time-up.mp3");
  });
});

describe("licensing and budget", () => {
  it("records a CC0 credits row per file in the manifest and in LICENSES.md", () => {
    // Checklist section 5.5: every bundled file gets a credits row, CC0 included. The bundle
    // policy is CC0-only, so anything else here means the license gate was bypassed.
    const licenses = readFileSync(path.join(soundsDirectory, "LICENSES.md"), "utf8");
    for (const sound of soundManifest.sounds) {
      expect(sound.source.license, sound.id).toBe("CC0 1.0");
      expect(sound.source.pageUrl, sound.id).toMatch(/^https:\/\/freesound\.org\/s\/\d+\/$/);
      expect(sound.source.author.length, sound.id).toBeGreaterThan(0);
      expect(sound.source.verifiedAt, sound.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(licenses, sound.file).toContain(`\`${sound.file}\``);
      expect(licenses, sound.id).toContain(sound.source.pageUrl);
    }
  });

  it("keeps the room-audible pack tiny and the whole pack inside its committed budget", () => {
    const total = soundManifest.sounds.reduce((sum, sound) => sum + sound.bytes, 0);
    const eager = soundManifest.sounds
      .filter((sound) => sound.kind !== "music")
      .reduce((sum, sound) => sum + sound.bytes, 0);
    // The eager half is what prime() fetches on every device in the room, so it is the number
    // that matters on venue Wi-Fi; music loads on demand and is allowed to be large.
    expect(eager).toBeLessThan(512 * 1024);
    expect(total).toBeLessThan(6 * 1024 * 1024);
  });
});
