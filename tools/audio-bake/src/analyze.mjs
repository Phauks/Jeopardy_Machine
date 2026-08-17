// Curation aid, not part of the bake: dump each SOURCE file's duration and its non-silent
// regions, which is the data the startSeconds/lengthSeconds columns in sources.mjs are picked
// from. Re-run it when a source is added or an uploader replaces a file.
//   node tools/audio-bake/src/analyze.mjs [id ...]
// AUDIO_BAKE_NOISE / AUDIO_BAKE_MIN_SILENCE tune the detector for a closer look at a
// multi-take source (finding where one laugh burst ends inside a six-second sequence).
import { execFileSync, spawnSync } from "node:child_process";
import { sources } from "./sources.mjs";

const downloadsDirectory = new URL("../downloads/", import.meta.url);
const wanted = new Set(process.argv.slice(2));

for (const source of sources) {
  if (wanted.size > 0 && !wanted.has(source.id)) continue;
  const file = new URL(`${source.id}.source.mp3`, downloadsDirectory).pathname;
  const duration = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ])
    .toString()
    .trim();
  // silencedetect reports on stderr, so this one goes through spawnSync for the captured pipe.
  const detected = spawnSync("ffmpeg", [
    "-hide_banner",
    "-i",
    file,
    "-af",
    `silencedetect=noise=${process.env.AUDIO_BAKE_NOISE ?? "-40"}dB:d=${
      process.env.AUDIO_BAKE_MIN_SILENCE ?? "0.08"
    }`,
    "-f",
    "null",
    "-",
  ]).stderr.toString();
  const marks = [...detected.matchAll(/silence_(start|end): ([\d.]+)/g)].map(
    (match) => `${match[1] === "start" ? "quiet@" : "loud@"}${Number(match[2]).toFixed(2)}`,
  );
  console.log(`${source.id.padEnd(18)} ${Number(duration).toFixed(2)}s  ${marks.join(" ")}`);
}
