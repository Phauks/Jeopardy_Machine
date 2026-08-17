// The deep check on the COMMITTED pack: re-decode every shipped MP3 and re-measure the onset
// and duration the manifest claims, from the bytes in git rather than from anything the bake
// remembered.
//
// This is deliberately separate from apps/web/src/lib/room/sound-manifest.gate.test.ts, which
// runs in CI. That gate re-hashes every file and enforces the windows against the manifest's
// recorded numbers - which is airtight for "did anyone edit an asset or a number", because the
// sha256 binds the measurement to exact bytes, and needs no ffmpeg. This script answers the
// other half - "were those numbers ever true" - and needs ffmpeg, so it belongs with the
// pipeline and runs when the pack changes.
//
// Run: pnpm -F @jeopardy/audio-bake verify
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { onsetWindowSeconds, sampleRate } from "./sources.mjs";

const soundsDirectory = new URL("../../../apps/web/static/sounds/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("../../../apps/web/src/lib/room/sound-manifest.json", import.meta.url)),
);

const onsetThreshold = 10 ** (-40 / 20);
const failures = [];

for (const entry of manifest.sounds) {
  const bytes = readFileSync(new URL(entry.file, soundsDirectory));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256) failures.push(`${entry.id}: sha256 does not match the manifest`);
  if (bytes.length !== entry.bytes) failures.push(`${entry.id}: byte count does not match`);

  const decoded = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-f",
      "mp3",
      "-i",
      "-",
      "-ac",
      String(entry.channels),
      "-ar",
      String(sampleRate),
      "-f",
      "f32le",
      "-",
    ],
    { input: bytes, maxBuffer: 512 * 1024 * 1024 },
  ).stdout;
  const samples = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 4);

  let onsetFrame = -1;
  for (let frame = 0; frame * entry.channels < samples.length && onsetFrame < 0; frame += 1) {
    for (let channel = 0; channel < entry.channels; channel += 1) {
      if (Math.abs(samples[frame * entry.channels + channel]) >= onsetThreshold) {
        onsetFrame = frame;
        break;
      }
    }
  }
  const onsetSeconds = onsetFrame / sampleRate;
  const durationSeconds = samples.length / entry.channels / sampleRate;

  if (onsetSeconds < onsetWindowSeconds.minimum || onsetSeconds > onsetWindowSeconds.maximum) {
    failures.push(
      `${entry.id}: onset ${(onsetSeconds * 1000).toFixed(1)} ms is outside the window`,
    );
  }
  if (Math.abs(onsetSeconds - entry.onsetSeconds) > 0.0005) {
    failures.push(`${entry.id}: onset differs from the manifest's recorded value`);
  }
  if (Math.abs(durationSeconds - entry.durationSeconds) > 0.002) {
    failures.push(`${entry.id}: duration differs from the manifest's recorded value`);
  }
  console.log(
    `  ${entry.id.padEnd(18)} onset ${(onsetSeconds * 1000).toFixed(1).padStart(4)} ms  ` +
      `${durationSeconds.toFixed(3).padStart(8)} s  sha256 ok`,
  );
}

if (failures.length > 0) {
  console.error(`\nFAILED:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(
  `\n${manifest.sounds.length} committed files re-measured from their bytes: every onset inside ` +
    `${onsetWindowSeconds.minimum * 1000}-${onsetWindowSeconds.maximum * 1000} ms`,
);
