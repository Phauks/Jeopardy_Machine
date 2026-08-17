// Invariants that live in CSS and in the route tree rather than in rendered markup, so they
// are gated against the source itself.
//
// 1. NO REFLOW. The standing layout law (docs/decisions/2026-08-16-persistent-layout-and-
//    pregame-rework.md): "reserve the space up front so nothing reflows when content arrives",
//    and prose gets a hard measure so it breaks where the design decided rather than where the
//    window happens to end. A rendered DOM cannot prove this - there is no layout engine in
//    these tests - but the declarations that produce it can be required to exist.
//
//    The 2026-08-17 rewrite made this GENERAL rather than a list of the blocks that had gone
//    wrong. The owner quoted two sentences that reflowed; naming those two in a test would
//    only ever catch those two. So the gate now derives its subjects from the source: every
//    component under lib/landing and lib/lobby is parsed, and three rules are applied to
//    whatever it finds.
//
//      MEASURE   A rule that sets a wrapping line-height (> 1.25) is prose, and prose declares
//                `max-inline-size` in `ch`. Single-line chrome (line-height 1, 1.15) is exempt
//                because it cannot wrap into a ragged block in the first place.
//      BALANCE   Every heading declares `text-wrap: balance`, so a two-word heading never
//                drops its last word onto a line of its own. Headings are found in the MARKUP
//                (h1/h2/h3 and the classes on them), not from a list kept here.
//      RESERVE   Every element that SWAPS content in place - anything carrying role="status" -
//                declares a `min-height`, so the answer arriving changes words, not positions.
//
// 2. NO /lobby. It folded back into the front door and was DELETED, with no redirect kept
//    (docs/research/00-user-directives.md, "No legacy code"). A route that quietly reappears,
//    or a link that outlives it, is the failure this half of the gate catches.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
}

function routeNames(): string[] {
  return readdirSync(fileURLToPath(new URL("../../routes", import.meta.url)));
}

/** Every Svelte component that makes up the front door, by path relative to src/. */
function frontDoorComponents(): string[] {
  return ["lib/landing", "lib/lobby"].flatMap((directory) =>
    readdirSync(fileURLToPath(new URL(`../../${directory}`, import.meta.url)))
      .filter((name) => name.endsWith(".svelte"))
      .map((name) => `${directory}/${name}`),
  );
}

type StyleRule = { selector: string; body: string };

/**
 * The component's <style> block as flat rules. Nested at-rules (@media) are unwrapped rather
 * than parsed - a declaration inside a breakpoint is still a declaration this gate is looking
 * for, and the selector is all it needs to attribute it.
 */
function styleRules(source: string): StyleRule[] {
  const style = /<style>([\S\s]*)<\/style>/.exec(source)?.[1] ?? "";
  const withoutComments = style.replaceAll(/\/\*[\S\s]*?\*\//g, "");
  const withoutAtRuleWrappers = withoutComments.replaceAll(/@media[^{]*\{/g, "");
  const rules: StyleRule[] = [];
  for (const match of withoutAtRuleWrappers.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    if (selector === "" || selector.startsWith("@")) continue;
    rules.push({ selector, body: match[2] ?? "" });
  }
  return rules;
}

/** Classes on every element in the markup whose tag matches - `<h2 class="a b">` -> a, b. */
function classesOnTags(source: string, tags: readonly string[]): Set<string> {
  const markup = source.replace(/<style>[\S\s]*<\/style>/, "");
  const found = new Set<string>();
  for (const tag of tags) {
    for (const match of markup.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))) {
      const classAttribute = /class="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? "";
      for (const name of classAttribute.split(/\s+/u)) if (name !== "") found.add(name);
    }
  }
  return found;
}

/**
 * Every element carrying an attribute, as its own list of classes - used for role="status"
 * blocks. Grouped PER ELEMENT rather than flattened, because a reserved height only has to
 * come from one of an element's classes (`class="state-note waiting"`).
 */
function elementsWithAttribute(source: string, attribute: string): string[][] {
  const markup = source.replace(/<style>[\S\s]*<\/style>/, "");
  const elements: string[][] = [];
  for (const match of markup.matchAll(/<[a-z][^>]*>/g)) {
    const element = match[0];
    if (!element.includes(attribute)) continue;
    const classAttribute = /class="([^"]*)"/.exec(element)?.[1] ?? "";
    elements.push(classAttribute.split(/\s+/u).filter((name) => name !== ""));
  }
  return elements;
}

/** Does any rule whose selector mentions this class (or bare tag) declare `property`? */
function declaresFor(rules: StyleRule[], target: string, property: RegExp): boolean {
  const selectorMatchesTarget = target.startsWith(".")
    ? new RegExp(`\\${target}(?![\\w-])`)
    : new RegExp(`(^|[\\s>+~,])${target}(?![\\w-])`);
  return rules.some(
    (rule) => selectorMatchesTarget.test(rule.selector) && property.test(rule.body),
  );
}

const components = frontDoorComponents();

describe("no reflow: prose keeps a hard measure", () => {
  it("covers every front-door component, so a new one cannot opt out by existing", () => {
    expect(components).toContain("lib/landing/front-door.svelte");
    expect(components).toContain("lib/landing/create-room-panel.svelte");
    expect(components).toContain("lib/lobby/room-browser.svelte");
    expect(components.length).toBeGreaterThanOrEqual(6);
  });

  it.each(components)("%s gives every wrapping block a max-inline-size in ch", (component) => {
    const offenders = styleRules(sourceOf(component))
      .filter((rule) => {
        const lineHeight = /line-height:\s*([\d.]+)\s*;/.exec(rule.body)?.[1];
        // Wrapping prose only: a unitless line-height above 1.25 is a paragraph, and a
        // paragraph without a measure breaks wherever the window happens to end.
        return lineHeight !== undefined && Number(lineHeight) > 1.25;
      })
      .filter((rule) => !/max-inline-size:\s*\d+ch/.test(rule.body))
      .map((rule) => rule.selector);
    expect(offenders).toEqual([]);
  });
});

describe("no reflow: headings are balanced", () => {
  it.each(components)("%s balances every heading it renders", (component) => {
    const source = sourceOf(component);
    const rules = styleRules(source);
    const headingClasses = [...classesOnTags(source, ["h1", "h2", "h3"])].map((name) => `.${name}`);
    // A heading with no class of its own is styled through its tag (`.state-block h3`).
    const bareTags = ["h1", "h2", "h3"].filter((tag) =>
      new RegExp(`<${tag}(\\s[^>]*)?>`).test(source.replace(/<style>[\S\s]*<\/style>/, "")),
    );
    const subjects =
      headingClasses.length > 0
        ? headingClasses
        : bareTags.filter((tag) => declaresFor(rules, tag, /./));
    const unbalanced = subjects.filter(
      (subject) =>
        declaresFor(rules, subject, /./) && !declaresFor(rules, subject, /text-wrap:\s*balance/),
    );
    expect(unbalanced).toEqual([]);
  });
});

describe("no reflow: swapping content reserves its space", () => {
  it.each(components)("%s reserves a height for every role=status block", (component) => {
    const source = sourceOf(component);
    const rules = styleRules(source);
    const unreserved = elementsWithAttribute(source, 'role="status"')
      .filter(
        (classes) =>
          !classes.some((name) => declaresFor(rules, `.${name}`, /min-height|flex:\s*1/)),
      )
      .map((classes) => classes.join(" "));
    expect(unreserved).toEqual([]);
  });

  it("still reserves the three blocks the owner watched jump", () => {
    // Kept as named cases alongside the general rules: these are the regressions, and a
    // general rule that stops matching them silently would be worse than no rule.
    expect(sourceOf("lib/landing/front-door.svelte")).toMatch(/\.join-note\s*{[^}]*min-height/);
    expect(sourceOf("lib/landing/create-room-panel.svelte")).toMatch(
      /\.verdict\s*{[^}]*min-height/,
    );
    expect(sourceOf("lib/lobby/room-browser.svelte")).toMatch(/\.room-browser\s*{[^}]*min-height/);
  });

  it("keeps the search box outside the list's swapping states", () => {
    // A control that appears only once rooms arrive would move everything under it - the
    // exact failure the reserved blocks above exist to prevent, in a new place.
    const source = sourceOf("lib/lobby/room-browser.svelte");
    const markup = source.replace(/<style>[\S\s]*<\/style>/, "");
    expect(markup.indexOf('type="search"')).toBeLessThan(markup.indexOf("{#if registryBroken"));
  });
});

describe("no reflow: the page keeps one type scale", () => {
  it("declares one type scale and one spacing rhythm instead of ad-hoc sizes", () => {
    const frontDoor = sourceOf("lib/landing/front-door.svelte");
    for (const token of ["--step-0", "--step-display", "--space-1", "--space-7", "--rule"]) {
      expect(frontDoor).toContain(`${token}:`);
    }
  });
});

describe("the front door is the only door", () => {
  it("has no /lobby route left to visit", () => {
    expect(routeNames()).not.toContain("lobby");
  });

  it("keeps no lobby screen behind it either", () => {
    expect(() => sourceOf("lib/lobby/lobby-screen.svelte")).toThrow();
    expect(() => sourceOf("lib/landing/landing-screen.svelte")).toThrow();
  });
});
