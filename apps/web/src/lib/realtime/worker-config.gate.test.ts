// THE TWO WORKERS HAVE TO AGREE, and nothing else checks that they do.
//
// The single-origin architecture (docs/decisions/2026-08-13-single-origin-binding.md) is two
// deployments sharing one set of Durable Objects: the web Worker reaches the realtime Worker's
// `GameRoomDO` through a cross-script binding, and both write the same D1 database so the
// public lobby has something to list. Every fact that makes that work is written down twice, in
// two wrangler configs, by hand.
//
// A mismatch is invisible until it is expensive. `wrangler deploy --dry-run` bundles each
// Worker alone and is perfectly happy; the build gate passes; CI is green. The failure arrives
// on the deployed site, as rooms that create but never connect, or a lobby that is empty
// because two databases each hold half the rows. This gate is the cheapest possible insurance
// against a first deploy (M0's exit criteria) failing for a reason nobody can see locally.
//
// It reads the configs as TEXT rather than importing them: they are JSONC, they carry the
// comments that explain every binding, and stripping those to satisfy JSON.parse would throw
// away the thing that makes them readable.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function configText(path: string): string {
  return readFileSync(new URL(path, import.meta.url)).toString("utf8");
}

const web = configText("../../../wrangler.jsonc");
const realtime = configText("../../../../realtime/wrangler.jsonc");

/** Pull one `"key": "value"` string out of a JSONC file without parsing the whole thing. */
function stringField(source: string, key: string): string | null {
  return new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(source)?.[1] ?? null;
}

/** Every value a key takes in the file - a binding named twice must agree with itself. */
function allStringFields(source: string, key: string): string[] {
  return Array.from(source.matchAll(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "g"))).map(
    (match) => match[1] ?? "",
  );
}

describe("the two Worker configs describe one system", () => {
  it("binds the SAME D1 database by id - the lobby is one table or it is nothing", () => {
    // The id is authoritative, not the name: a database can be renamed in the dashboard and
    // two Workers pointed at two different databases would each see half the rooms.
    const webId = stringField(web, "database_id");
    expect(webId).not.toBeNull();
    expect(stringField(realtime, "database_id")).toBe(webId);
  });

  it("names the same database, so the runbook's apply command reaches both", () => {
    const name = stringField(web, "database_name");
    expect(name).not.toBeNull();
    expect(stringField(realtime, "database_name")).toBe(name);
    // The migrations live with the web Worker - one owner for the schema, one apply command.
    expect(web).toContain('"migrations_dir"');
    expect(realtime).not.toContain('"migrations_dir"');
  });

  it("agrees on the Durable Object class the cross-script binding reaches", () => {
    const classNames = new Set([
      ...allStringFields(web, "class_name"),
      ...allStringFields(realtime, "class_name"),
    ]);
    expect([...classNames]).toEqual(["GameRoomDO"]);
  });

  it("points the web Worker's DO binding at the realtime Worker BY NAME", () => {
    // `script_name` is what makes it cross-script. Without it the web Worker would silently
    // address its own (non-existent) class and every room would create and never connect.
    const scriptName = stringField(web, "script_name");
    expect(scriptName).toBe(stringField(realtime, "name"));
    // ...and the realtime Worker owns the class, so it must NOT declare a script_name.
    expect(realtime).not.toContain('"script_name"');
  });

  it("gives both Workers the same binding name, because one codebase reads both", () => {
    expect(web).toContain('"name": "GAME_ROOM"');
    expect(realtime).toContain('"name": "GAME_ROOM"');
  });

  it("declares the DO migration exactly once, on the Worker that owns the class", () => {
    // Two Workers both claiming `new_sqlite_classes` for one class is a deploy-time conflict.
    expect(realtime).toContain("new_sqlite_classes");
    expect(web).not.toContain("new_sqlite_classes");
  });

  it("keeps both Workers on one compatibility date", () => {
    const date = stringField(web, "compatibility_date");
    expect(date).not.toBeNull();
    expect(stringField(realtime, "compatibility_date")).toBe(date);
  });
});

describe("the web Worker can actually serve what it ships", () => {
  it("serves its build output as static assets, which is where the games live", () => {
    // The club night's documents and its picture round are static assets under
    // static/games/ (src/lib/landing/game-catalog.ts). No assets binding, no picture round.
    expect(web).toContain('"assets"');
    expect(web).toContain('"directory": ".svelte-kit/cloudflare"');
    expect(stringField(web, "main")).toBe(".svelte-kit/cloudflare/_worker.js");
  });

  it("keeps nodejs_als, which SvelteKit's Cloudflare runtime needs to boot at all", () => {
    expect(web).toContain("nodejs_als");
  });
});
