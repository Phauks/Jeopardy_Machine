// Step 2 of the bake: turn one verified source into one shipped file.
//
// The order of operations is the whole trick. Loudness normalization CHANGES which sample is
// the first one above -40 dBFS, so it has to happen BEFORE the onset trim, or the uniform
// onset would drift by however much gain each file needed. Likewise the onset is verified on
// the ENCODED file, decoded back: MP3 spreads a transient slightly backwards in time
// (pre-echo), so measuring the pre-encode PCM would certify a number the shipped file does
// not have. When the encoded onset misses the window, the pad is corrected and the file is
// re-encoded - a fixed-point loop, not a fudge factor.
//
// ffmpeg does the codec work (decode, loudness measurement, MP3 encode); every sample-level
// edit - gain, onset cut, pad, fades - happens here on a Float32Array, so it is exact and
// does not depend on how a filter chain rounds.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import {
  durationWindows,
  encoding,
  loudnessTargets,
  onsetFadeSeconds,
  onsetTargetSeconds,
  onsetWindowSeconds,
  sampleRate,
} from "./sources.mjs";

/** -40 dBFS as a linear amplitude: the threshold the onset assertion is written against. */
const onsetThreshold = 10 ** (-40 / 20);
/** Ceiling for the normalized file. Leaves room for MP3 encoding overshoot without clipping. */
const peakCeilingDecibels = -1.5;
/** How far the correction loop will chase the window before giving up and failing the bake. */
const maximumOnsetCorrections = 8;

function runFfmpeg(args, input) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], {
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${args.join(" ")}):\n${result.stderr?.toString() ?? ""}`);
  }
  return { stdout: result.stdout, stderr: result.stderr.toString() };
}

/** Decode the curated window of a source into interleaved float samples. */
function decodeWindow(sourceFile, source, channels) {
  const { stdout } = runFfmpeg([
    "-accurate_seek",
    "-ss",
    String(source.startSeconds),
    "-t",
    String(source.lengthSeconds),
    "-i",
    sourceFile,
    "-ac",
    String(channels),
    "-ar",
    String(sampleRate),
    "-f",
    "f32le",
    "-",
  ]);
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
}

/**
 * Which R128 number a kind is normalized against, and why they differ.
 *
 * INTEGRATED loudness is the right metric for music: it is the average level of a whole piece.
 * For a one-shot it is the wrong metric and gets more wrong the shorter the sound - integrated
 * loudness of a 1.4 s gong is dominated by the decay tail and the file's own silence, so
 * matching two buzz-ins on it makes the short punchy one quieter in the room than the long
 * ringing one, which is exactly the fairness problem the pack exists to avoid. MOMENTARY
 * loudness (the loudest 400 ms window) is what a room hears from a one-shot, so buzz-ins and
 * cues are matched on that.
 */
const loudnessMetrics = { buzz: "momentary", cue: "momentary", music: "integrated" };

/** Right-pad with silence so R128's 400 ms window can close over a very short one-shot. */
function padTail(samples, channels, minimumSeconds) {
  const frames = samples.length / channels;
  const wanted = Math.ceil(minimumSeconds * sampleRate);
  if (frames >= wanted) return samples;
  const padded = new Float32Array(wanted * channels);
  padded.set(samples);
  return padded;
}

/**
 * Loudness (LUFS) of raw float audio, via ffmpeg's EBU R128 implementation. Returns null when
 * the material is too short or too quiet for the standard to say anything, and the caller then
 * leaves the level alone rather than applying a wild gain to a number that means nothing.
 */
function measureLoudness(samples, channels, metric) {
  const measured = metric === "momentary" ? padTail(samples, channels, 0.6) : samples;
  const { stderr } = runFfmpeg(
    [
      // ebur128's per-frame log is emitted at verbose level; the summary alone would not carry
      // momentary values.
      "-loglevel",
      "verbose",
      "-f",
      "f32le",
      "-ar",
      String(sampleRate),
      "-ac",
      String(channels),
      "-i",
      "-",
      "-af",
      "ebur128=framelog=verbose",
      "-f",
      "null",
      "-",
    ],
    Buffer.from(measured.buffer, measured.byteOffset, measured.byteLength),
  );
  if (metric === "integrated") {
    const value = stderr
      .match(/I:\s*(-?[\d.]+|-inf)\s*LUFS/g)
      ?.at(-1)
      ?.match(/(-?[\d.]+)/)?.[1];
    return value === undefined || Number(value) <= -70 ? null : Number(value);
  }
  // The first three frames report -120.7: ebur128 emits every 100 ms but the momentary window
  // is 400 ms wide, so those are the window filling up, not silence in the audio.
  const momentary = [...stderr.matchAll(/M:\s*(-?[\d.]+)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > -70);
  return momentary.length === 0 ? null : Math.max(...momentary);
}

function peakAmplitude(samples) {
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/** First frame (not sample) whose loudest channel clears the threshold. */
function firstAudibleFrame(samples, channels, threshold = onsetThreshold) {
  for (let frame = 0; frame * channels < samples.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      if (Math.abs(samples[frame * channels + channel] ?? 0) >= threshold) return frame;
    }
  }
  return -1;
}

/**
 * Cut everything before the first audible frame, then re-seat that frame `padFrames` in.
 * The pad is never zero: an instant hard start on a buffer that begins at full amplitude is a
 * click, so the micro fade-in needs somewhere to live (docs/content/media-and-sounds.md 7b).
 */
function reseatOnset(samples, channels, padFrames, fadeFrames) {
  const onsetFrame = firstAudibleFrame(samples, channels);
  if (onsetFrame < 0) throw new Error("window contains no audio above -40 dBFS");
  const kept = samples.subarray(onsetFrame * channels);
  const output = new Float32Array(padFrames * channels + kept.length);
  output.set(kept, padFrames * channels);
  // The fade rises across the pad and into the first audible frames, so the ramp is finished
  // by the time the sound has anything to say.
  for (let frame = 0; frame < fadeFrames; frame += 1) {
    const gain = frame / fadeFrames;
    for (let channel = 0; channel < channels; channel += 1) {
      const index = frame * channels + channel;
      output[index] = (output[index] ?? 0) * gain;
    }
  }
  return output;
}

function applyFadeOut(samples, channels, fadeSeconds) {
  if (!fadeSeconds) return samples;
  const fadeFrames = Math.min(Math.round(fadeSeconds * sampleRate), samples.length / channels);
  const totalFrames = samples.length / channels;
  for (let index = 0; index < fadeFrames; index += 1) {
    const gain = 1 - index / fadeFrames;
    const frame = totalFrames - fadeFrames + index;
    for (let channel = 0; channel < channels; channel += 1) {
      const position = frame * channels + channel;
      samples[position] = (samples[position] ?? 0) * gain;
    }
  }
  return samples;
}

// Encoding goes through a real file, not a pipe, ON PURPOSE: the Xing/LAME header carries the
// encoder delay and padding counts, and the muxer can only fill those in by seeking back to
// the top of the stream once it knows them. Piped output silently ships a header with the
// gapless fields zeroed, which is exactly the ~25 ms of phantom leading silence the uniform
// onset exists to eliminate.
function encodeMp3(samples, channels, bitrateKilobits, scratchFile) {
  runFfmpeg(
    [
      "-y",
      "-f",
      "f32le",
      "-ar",
      String(sampleRate),
      "-ac",
      String(channels),
      "-i",
      "-",
      "-c:a",
      "libmp3lame",
      "-b:a",
      `${bitrateKilobits}k`,
      // No container timestamps and no copied tags: two bakes of one input are byte-identical.
      "-write_xing",
      "1",
      "-id3v2_version",
      "0",
      "-map_metadata",
      "-1",
      "-f",
      "mp3",
      scratchFile,
    ],
    Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
  );
  return readFileSync(scratchFile);
}

/** Decode a finished MP3 back to floats - the only measurement that describes shipped bytes. */
function decodeMp3(bytes, channels) {
  const { stdout } = runFfmpeg(
    [
      "-f",
      "mp3",
      "-i",
      "-",
      "-ac",
      String(channels),
      "-ar",
      String(sampleRate),
      "-f",
      "f32le",
      "-",
    ],
    bytes,
  );
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
}

const scratchDirectory = new URL("../downloads/scratch/", import.meta.url);

export function processSource(sourceFile, source) {
  mkdirSync(scratchDirectory, { recursive: true });
  const scratchFile = new URL(`${source.id}.mp3`, scratchDirectory).pathname;
  const { channels, bitrateKilobits } = encoding[source.kind];
  const sourceWindow = decodeWindow(sourceFile, source, channels);

  // Normalize toward the kind's LUFS target, but never past the peak ceiling: a buzz-in that
  // clips is worse in a room than one sitting a decibel under the target.
  const metric = loudnessMetrics[source.kind];
  const measured = measureLoudness(sourceWindow, channels, metric);
  const requestedGain =
    (measured === null ? 0 : loudnessTargets[source.kind] - measured) + (source.gainDecibels ?? 0);
  const peak = peakAmplitude(sourceWindow);
  const headroomGain =
    peak > 0 ? peakCeilingDecibels - 20 * Math.log10(peak) : Number.POSITIVE_INFINITY;
  const appliedGain = Math.min(requestedGain, headroomGain);
  const linearGain = 10 ** (appliedGain / 20);
  const leveled = new Float32Array(sourceWindow.length);
  for (let index = 0; index < sourceWindow.length; index += 1) {
    leveled[index] = sourceWindow[index] * linearGain;
  }

  const fadeFrames = Math.max(1, Math.round(onsetFadeSeconds * sampleRate));
  let padFrames = Math.round(onsetTargetSeconds * sampleRate);
  let attempt = 0;
  for (;;) {
    const seated = reseatOnset(leveled, channels, padFrames, fadeFrames);
    applyFadeOut(seated, channels, source.fadeOutSeconds);
    const encoded = encodeMp3(seated, channels, bitrateKilobits, scratchFile);
    const decoded = decodeMp3(encoded, channels);
    const onsetFrame = firstAudibleFrame(decoded, channels);
    const onsetSeconds = onsetFrame / sampleRate;
    const durationSeconds = decoded.length / channels / sampleRate;

    const inWindow =
      onsetSeconds >= onsetWindowSeconds.minimum && onsetSeconds <= onsetWindowSeconds.maximum;
    if (inWindow) {
      const limits = durationWindows[source.kind];
      if (limits && (durationSeconds < limits.minimum || durationSeconds > limits.maximum)) {
        throw new Error(
          `${source.id}: ${durationSeconds.toFixed(3)}s is outside the ${source.kind} window ` +
            `${limits.minimum}-${limits.maximum}s - retrim it in sources.mjs`,
        );
      }
      return {
        bytes: encoded,
        onsetSeconds,
        durationSeconds,
        // Measured on the decoded output, not assumed from the target: a one-shot short enough
        // to sit near R128's gating floor lands where it lands, and the manifest should say so.
        loudnessLufs: measureLoudness(decoded, channels, metric),
        loudnessMetric: metric,
        // True when the peak ceiling, not the loudness target, decided the level - the file is
        // as loud as it can get without clipping. A transient-heavy one-shot (a rimshot, a
        // bare ding) lands here honestly rather than being squashed by a limiter.
        peakLimited: headroomGain < requestedGain - 0.05,
        appliedGainDecibels: appliedGain,
        peakDecibels: 20 * Math.log10(peakAmplitude(decoded)),
        channels,
        bitrateKilobits,
      };
    }

    attempt += 1;
    if (attempt > maximumOnsetCorrections) {
      throw new Error(
        `${source.id}: onset settled at ${(onsetSeconds * 1000).toFixed(1)} ms, outside the ` +
          `${onsetWindowSeconds.minimum * 1000}-${onsetWindowSeconds.maximum * 1000} ms window`,
      );
    }
    // Encoder pre-echo/delay moved the onset; shift the pad by exactly the error and retry.
    padFrames += Math.round((onsetTargetSeconds - onsetSeconds) * sampleRate);
    if (padFrames < 1) padFrames = 1;
  }
}
