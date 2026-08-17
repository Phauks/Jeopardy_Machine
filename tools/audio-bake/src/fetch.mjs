// Step 1 of the bake: fetch every source, re-verifying its license ON THE SOURCE PAGE at
// fetch time (checklist section 5.2 of docs/content/media-and-sounds.md: never trust the
// worklist or a search filter as final). A page that no longer says Creative Commons 0, or
// whose author changed (= the uploader replaced the file), fails the whole run - loudly, with
// nothing written - rather than quietly bundling something we have no right to ship.
//
// What gets fetched is the HQ preview MP3, not the full-quality original: Freesound gates
// originals behind an account, and this pipeline runs without credentials. See README.md
// "Preview quality, honestly" for why that is genuinely fine for one-second buzzers and what
// the upgrade path is.
//
// The fetch loop is SEQUENTIAL on purpose - freesound.org is a volunteer-funded site and this
// is a rare, manual pipeline run, so one request at a time is simple politeness. Hence the
// file-level exemption below rather than a Promise.all.
/* oxlint-disable no-await-in-loop */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { sources } from "./sources.mjs";

const downloadsDirectory = new URL("../downloads/", import.meta.url);
const pagesDirectory = new URL("../downloads/pages/", import.meta.url);

const requiredLicenseUrl = "creativecommons.org/publicdomain/zero/1.0/";
const requiredLicenseText = "Creative Commons 0";

/** The page's license block, read from the page itself - not from any local record. */
function readLicense(html) {
  const hasUrl = html.includes(requiredLicenseUrl);
  const hasText = html.includes(requiredLicenseText);
  const otherLicenses = [...html.matchAll(/creativecommons\.org\/licenses\/([^/"]+)\//g)].map(
    (match) => match[1],
  );
  return { hasUrl, hasText, otherLicenses: [...new Set(otherLicenses)] };
}

/** Freesound renders the uploader as `by <author>` in the page title. */
function readAuthor(html) {
  return html.match(/<title>\s*Freesound\s*-\s*.*\sby\s([^<]+?)\s*<\/title>/)?.[1];
}

function readPreviewUrl(html) {
  return html.match(/https:\/\/cdn\.freesound\.org\/previews\/\d+\/[\d_]+-hq\.mp3/)?.[0];
}

export async function fetchAllSources({ log = console.log } = {}) {
  mkdirSync(downloadsDirectory, { recursive: true });
  mkdirSync(pagesDirectory, { recursive: true });

  const failures = [];
  const records = [];

  for (const source of sources) {
    const pageUrl = `https://freesound.org/s/${source.freesoundId}/`;
    const pageResponse = await fetch(pageUrl);
    if (!pageResponse.ok) {
      failures.push(`${source.id}: sound page ${pageUrl} returned HTTP ${pageResponse.status}`);
      continue;
    }
    const html = await pageResponse.text();
    writeFileSync(new URL(`${source.freesoundId}.html`, pagesDirectory), html);

    const license = readLicense(html);
    if (!license.hasUrl || !license.hasText) {
      failures.push(
        `${source.id}: ${pageUrl} no longer states CC0 (found: ${
          license.otherLicenses.join(", ") || "no license link at all"
        })`,
      );
      continue;
    }

    const author = readAuthor(html);
    if (author !== source.author) {
      failures.push(
        `${source.id}: author is now "${author}", table says "${source.author}" - the upload was replaced, re-audition before bundling`,
      );
      continue;
    }

    const previewUrl = readPreviewUrl(html);
    if (!previewUrl) {
      failures.push(`${source.id}: no HQ preview URL on ${pageUrl}`);
      continue;
    }

    const audioResponse = await fetch(previewUrl);
    if (!audioResponse.ok) {
      failures.push(`${source.id}: preview ${previewUrl} returned HTTP ${audioResponse.status}`);
      continue;
    }
    const bytes = Buffer.from(await audioResponse.arrayBuffer());
    writeFileSync(new URL(`${source.id}.source.mp3`, downloadsDirectory), bytes);

    records.push({
      id: source.id,
      pageUrl,
      previewUrl,
      author,
      license: "CC0 1.0",
      sourceBytes: bytes.length,
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      verifiedAt: new Date().toISOString().slice(0, 10),
    });
    log(`  ok  ${source.id.padEnd(18)} CC0 verified on page, ${bytes.length} bytes`);
  }

  if (failures.length > 0) {
    throw new Error(`license/fetch verification failed:\n  - ${failures.join("\n  - ")}`);
  }
  writeFileSync(
    new URL("fetch-record.json", downloadsDirectory),
    `${JSON.stringify(records, null, 2)}\n`,
  );
  return records;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fetchAllSources();
  console.log(`fetched ${sources.length} sources, every license line re-read on its own page`);
}
