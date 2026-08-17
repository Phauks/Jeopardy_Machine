// The bake: verified sources in, the shipped pack out.
//
// Writes three things together, and they are only ever correct together:
//   apps/web/static/sounds/*.mp3                     - the pack
//   apps/web/src/lib/room/sound-manifest.json        - the index shipped code reads
//   apps/web/static/sounds/LICENSES.md               - the credits row per file (checklist 5.5)
// A stale sweep removes any .mp3 the manifest no longer names, so a dropped source cannot
// linger in static/ as an unlicensed orphan.
//
// Run: pnpm -F @jeopardy/audio-bake bake   (add --offline to reuse downloads/ as-is)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fetchAllSources } from "./fetch.mjs";
import { processSource } from "./process.mjs";
import {
  durationWindows,
  loudnessTargets,
  onsetFadeSeconds,
  onsetTargetSeconds,
  onsetWindowSeconds,
  sampleRate,
  sources,
} from "./sources.mjs";

const downloadsDirectory = new URL("../downloads/", import.meta.url);
const soundsDirectory = new URL("../../../apps/web/static/sounds/", import.meta.url);
const manifestFile = new URL("../../../apps/web/src/lib/room/sound-manifest.json", import.meta.url);

// The one cue with no source file. No CC0 double-beep exists (media-and-sounds.md section 3
// logged the dead-end search), and the owner's approved answer was to synthesize it - which is
// also the cheapest possible asset and needs no license row at all. The parameters live here
// rather than in room-audio.ts so the manifest stays the single index of the whole pack.
const synthesizedCues = [
  {
    id: "time-up",
    label: "Time Up",
    kind: "cue",
    synthesis: {
      shape: "double-beep",
      frequencyHertz: 880,
      beepSeconds: 0.15,
      gapSeconds: 0.12,
      beeps: 2,
    },
    note: "No CC0 double-beep exists (docs/content/media-and-sounds.md section 3); the owner approved synthesizing it.",
  },
];

// The lobby track is ONE track forever (media-and-sounds.md section 7, "the signature track").
// This names which manifest row fills that slot - swapping the lobby music is this line plus
// the matching row in sources.mjs, and nothing else in the app moves.
const lobbyTrackId = "lobby-theme";
const lobbyTrackStatus = "placeholder";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Run the repo formatter over the two generated text files. The formatter is law here as
 * everywhere (CI runs `vp fmt --check`), and a generator that emits almost-formatted output
 * would make every bake produce a diff that the next `pnpm fmt` silently reverses. Cheaper to
 * hand the files to the real formatter than to imitate it.
 */
function formatGenerated(paths, log) {
  const formatter = new URL("../../../node_modules/.bin/vp", import.meta.url).pathname;
  if (!existsSync(formatter)) {
    log("  (formatter not installed - run `pnpm fmt` before committing)");
    return;
  }
  const result = spawnSync(formatter, ["fmt", ...paths], {
    cwd: new URL("../../../", import.meta.url).pathname,
  });
  if (result.status !== 0) {
    throw new Error(`vp fmt failed on the generated files:\n${result.stderr?.toString() ?? ""}`);
  }
}

function creditsRow(entry) {
  return `| \`${entry.file}\` | ${entry.kind} | ${entry.label} | [${entry.source.title}](${entry.source.pageUrl}) | ${entry.source.author} | ${entry.source.license} | ${entry.source.verifiedAt} |`;
}

function renderLicenses(entries, totals) {
  return `# Bundled sound pack

Every file here came through the repo-committed pipeline in \`tools/audio-bake/\` (how to re-bake, and the honest notes on source quality: its README). The curation history - what was auditioned, what the owner approved, and why - is \`docs/content/media-and-sounds.md\`.

**All ${entries.length} files are CC0 1.0** (Creative Commons Zero: public domain dedication, no attribution required). The bundle policy is CC0-only, so no credits slide is legally required for anything in this directory. The rows below exist anyway, because checklist section 5.5 of the worklist asks for a credits row per file even when the license does not - it is the audit trail that lets anyone re-verify what we shipped.

License verification is not a one-time claim recorded here: \`tools/audio-bake/src/fetch.mjs\` re-opens each sound page on every fetch run and fails the whole bake unless the page still states "Creative Commons 0" and still names the same author. A relicensed or replaced upload stops the pipeline instead of slipping into a release.

| File | Kind | In-app label | Source (Freesound) | Author | License | Verified |
| ---- | ---- | ------------ | ------------------ | ------ | ------- | -------- |
${entries.map(creditsRow).join("\n")}

## What is committed, and how it differs from the source

The downloads are **not** committed (\`tools/audio-bake/downloads/\` is gitignored). What ships is each source's curated window, processed identically:

1. **Trimmed** to a hand-picked window (\`tools/audio-bake/src/sources.mjs\`) - for multi-take sources this is the one take the owner approved, not a detected "best hit".
2. **Loudness-normalized** toward ${loudnessTargets.buzz} LUFS (buzz-ins and cues) or ${loudnessTargets.music} LUFS (music beds), by linear gain only - never past a -1.5 dBFS peak ceiling, so nothing clips in a room.
3. **Onset-standardized**: leading silence removed and audible energy re-seated at ~${onsetTargetSeconds * 1000} ms with a ${onsetFadeSeconds * 1000} ms micro fade-in, uniform across the whole pack. This is a fairness rule, not a polish one - file onset is perceived buzz-in latency, so one team's sound must not "react" later than another's (docs/content/media-and-sounds.md 7b).
4. **Encoded** to one format at one sample rate: MP3, ${sampleRate} Hz, mono for buzz-ins and cues, stereo for music.

Sources are Freesound's HQ previews (128 kbps MP3), not the full-quality originals, because originals are behind a Freesound account and this pipeline runs without credentials. For one-second buzz-ins that is genuinely inaudible; for \`lobby-theme.mp3\` it is a real (if mild) quality ceiling. \`tools/audio-bake/README.md\` explains the upgrade path.

\`lobby-theme.mp3\` is a **placeholder**, not the owner's pick: the signature-lobby-track review (media-and-sounds.md section 9, round 4) is still open. It is that round's only CC0 candidate clearing the owner's 2-3 minute lap floor. Replacing it is one row in \`tools/audio-bake/src/sources.mjs\` and a re-bake.

Buzz-ins land in the ${durationWindows.buzz.minimum}-${durationWindows.buzz.maximum} s window the owner set; cues stay under ${durationWindows.cue.maximum} s. Both are asserted by the bake and re-checked by \`apps/web/src/lib/room/sound-manifest.gate.test.ts\` against the committed bytes.

One cue has no file and no row above: **time-up** is synthesized in \`apps/web/src/lib/room/room-audio.ts\` (two ${synthesizedCues[0].synthesis.beepSeconds * 1000} ms beeps at ${synthesizedCues[0].synthesis.frequencyHertz} Hz, ${synthesizedCues[0].synthesis.gapSeconds * 1000} ms apart). ${synthesizedCues[0].note}

Total committed: **${(totals.bytes / 1024).toFixed(0)} KiB** across ${entries.length} files (${totals.buzzBytes / 1024 < 1 ? "0" : (totals.buzzBytes / 1024).toFixed(0)} KiB of buzz-ins, ${(totals.cueBytes / 1024).toFixed(0)} KiB of cues, ${(totals.musicBytes / 1024).toFixed(0)} KiB of music).
`;
}

export async function bake({ offline = false, log = console.log } = {}) {
  mkdirSync(soundsDirectory, { recursive: true });

  if (offline) {
    const missing = sources.filter(
      (source) => !existsSync(new URL(`${source.id}.source.mp3`, downloadsDirectory)),
    );
    if (missing.length > 0) {
      throw new Error(
        `--offline but these sources were never fetched: ${missing.map((s) => s.id).join(", ")}`,
      );
    }
    log("offline: reusing downloads/, license lines NOT re-verified this run");
  } else {
    log("fetching sources and re-verifying every license line on its own page");
    await fetchAllSources({ log });
  }

  const fetchRecords = new Map(
    JSON.parse(readFileSync(new URL("fetch-record.json", downloadsDirectory), "utf8")).map(
      (record) => [record.id, record],
    ),
  );

  const entries = [];
  for (const source of sources) {
    const record = fetchRecords.get(source.id);
    if (!record) throw new Error(`${source.id}: no fetch record - run without --offline`);
    const sourceFile = new URL(`${source.id}.source.mp3`, downloadsDirectory).pathname;
    const result = processSource(sourceFile, source);
    const file = `${source.id}.mp3`;
    writeFileSync(new URL(file, soundsDirectory), result.bytes);
    entries.push({
      id: source.id,
      label: source.label,
      kind: source.kind,
      file,
      bytes: result.bytes.length,
      sha256: sha256(result.bytes),
      durationSeconds: Number(result.durationSeconds.toFixed(4)),
      onsetSeconds: Number(result.onsetSeconds.toFixed(5)),
      channels: result.channels,
      bitrateKilobits: result.bitrateKilobits,
      loudnessLufs: result.loudnessLufs === null ? null : Number(result.loudnessLufs.toFixed(1)),
      loudnessMetric: result.loudnessMetric,
      loudnessTargetLufs: loudnessTargets[source.kind],
      peakLimited: result.peakLimited,
      appliedGainDecibels: Number(result.appliedGainDecibels.toFixed(2)),
      peakDecibels: Number(result.peakDecibels.toFixed(2)),
      source: {
        pageUrl: record.pageUrl,
        previewUrl: record.previewUrl,
        author: record.author,
        title: source.title,
        license: record.license,
        verifiedAt: record.verifiedAt,
      },
    });
    log(
      `  ${source.id.padEnd(18)} ${result.durationSeconds.toFixed(3)}s  onset ${(
        result.onsetSeconds * 1000
      )
        .toFixed(1)
        .padStart(4)} ms  ${String(result.bytes.length).padStart(7)} B`,
    );
  }

  const totals = {
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    buzzBytes: entries
      .filter((entry) => entry.kind === "buzz")
      .reduce((sum, entry) => sum + entry.bytes, 0),
    cueBytes: entries
      .filter((entry) => entry.kind === "cue")
      .reduce((sum, entry) => sum + entry.bytes, 0),
    musicBytes: entries
      .filter((entry) => entry.kind === "music")
      .reduce((sum, entry) => sum + entry.bytes, 0),
  };

  const manifest = {
    // Bumped when the manifest SHAPE changes; apps/web/src/lib/room/sound-manifest.ts
    // refuses to load a version it was not written against.
    version: 1,
    basePath: "/sounds/",
    format: { container: "mp3", mime: "audio/mpeg", sampleRate },
    onset: {
      targetSeconds: onsetTargetSeconds,
      windowSeconds: onsetWindowSeconds,
    },
    durationWindows,
    loudnessTargets,
    lobbyTrack: { id: lobbyTrackId, status: lobbyTrackStatus },
    thinkTrackIds: entries
      .filter((entry) => entry.kind === "music" && entry.id !== lobbyTrackId)
      .map((entry) => entry.id),
    sounds: entries,
    synthesizedCues,
  };
  const licensesFile = new URL("LICENSES.md", soundsDirectory);
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(licensesFile, renderLicenses(entries, totals));
  formatGenerated([manifestFile.pathname, licensesFile.pathname], log);

  const kept = new Set([...entries.map((entry) => entry.file), "LICENSES.md"]);
  for (const name of readdirSync(soundsDirectory)) {
    if (kept.has(name)) continue;
    rmSync(new URL(name, soundsDirectory));
    log(`  swept stale ${name}`);
  }

  log(
    `\n${entries.length} files, ${(totals.bytes / 1024).toFixed(0)} KiB total ` +
      `(buzz ${(totals.buzzBytes / 1024).toFixed(0)} KiB, cue ${(totals.cueBytes / 1024).toFixed(
        0,
      )} KiB, music ${(totals.musicBytes / 1024).toFixed(0)} KiB)`,
  );
  return { entries, totals };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await bake({ offline: process.argv.includes("--offline") });
}
