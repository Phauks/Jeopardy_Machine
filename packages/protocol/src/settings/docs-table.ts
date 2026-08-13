// Derivation (d) of resolution R2: the generated settings reference. The markdown is CHECKED
// IN at docs/reference/settings.md and a gate test (docs-table.gate.test.ts) regenerates and
// diffs it, so the docs cannot drift from the registry. Regenerate with:
//   pnpm -F @jeopardy/protocol generate:settings-docs
import { describeSettingsRegistry } from "./describe.ts";

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `\`"${value}"\``;
  if (typeof value === "object") return `\`${JSON.stringify(value)}\``;
  return `\`${String(value)}\``;
}

// Human-readable type/range column from the setting's JSON Schema. Handles exactly the shapes
// the registry uses (boolean, bounded integer, nullable bounded integer, enum, short string,
// discriminated union); anything new falls back to the raw type so the gate still passes and
// the odd row is legible, if plain.
function formatType(schema: Record<string, unknown>): string {
  if (Array.isArray(schema["enum"])) {
    return (schema["enum"] as unknown[]).map((option) => `\`${String(option)}\``).join(" / ");
  }
  if (schema["type"] === "boolean") return "on / off";
  if (schema["type"] === "integer" || schema["type"] === "number") {
    const minimum = schema["minimum"] ?? schema["exclusiveMinimum"];
    const maximum = schema["maximum"];
    return `integer ${String(minimum)} to ${String(maximum)}`;
  }
  if (schema["type"] === "string") {
    return `text (max ${String(schema["maxLength"] ?? "-")} chars)`;
  }
  const variants = (schema["anyOf"] ?? schema["oneOf"]) as Record<string, unknown>[] | undefined;
  if (variants !== undefined) {
    // Nullable numbers render as "x or null"; discriminated unions as their variant names.
    if (variants.length === 2 && variants[1]?.["type"] === "null" && variants[0] !== undefined) {
      return `${formatType(variants[0])}, or null`;
    }
    return variants
      .map((variant) => {
        const properties = variant["properties"] as Record<string, unknown> | undefined;
        const kind = (properties?.["kind"] as Record<string, unknown> | undefined)?.["const"];
        return kind === undefined ? formatType(variant) : `\`${String(kind)}\``;
      })
      .join(" / ");
  }
  return String(schema["type"] ?? "value");
}

export function renderSettingsMarkdown(): string {
  const lines: string[] = [
    "# Settings reference",
    "",
    "> GENERATED FILE - do not edit. Source of truth: `packages/protocol/src/settings/`",
    "> (the settings registry, resolution R2 of docs/proposals/m1-protocol.md). Regenerate with",
    "> `pnpm -F @jeopardy/protocol generate:settings-docs`; the gate test",
    "> `settings/docs-table.gate.test.ts` fails CI when this file is stale.",
    ">",
    '> "Matrix" is the row in the 43-setting rules matrix (docs/research/01-game-anatomy.md);',
    "> a dash marks named additions from the user-flows review. Matrix row 20 (host score",
    "> override and undo) is deliberately absent: it is always on, so it is not a setting.",
    "",
  ];
  for (const group of describeSettingsRegistry()) {
    lines.push(`## ${group.label} (\`${group.id}\`)`, "", group.description, "");
    lines.push("| Matrix | Setting | Values | Default | Description |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const setting of group.settings) {
      const matrix = setting.matrixRow === null ? "-" : `#${setting.matrixRow}`;
      const description =
        setting.constraints === null
          ? setting.description
          : `${setting.description} _${setting.constraints}_`;
      lines.push(
        `| ${matrix} | \`${setting.key}\` (${setting.label}) | ${formatType(setting.schema)} | ${formatValue(setting.defaultValue)} | ${description} |`,
      );
    }
    lines.push("");
    if (group.refinements.length > 0) {
      lines.push(
        `Cross-field rules: ${group.refinements.map((refinement) => refinement.description).join(" ")}`,
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// Path of the checked-in copy, relative to the repo root - shared by the generator script
// and the gate test so they can never disagree about where the file lives.
export const settingsDocsRepoPath = "docs/reference/settings.md";
