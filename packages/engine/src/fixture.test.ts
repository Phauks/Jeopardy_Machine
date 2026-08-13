// Replays every scenario file in fixtures/ (owner directive "Development simulation": the
// same JSON scenarios drive unit tests, the hotseat page, M3 bots, and the M4 sim panel).
// Each fixture is validated against the schema, replayed through simulate(), checked against
// its own expectations, and replayed AGAIN to prove determinism.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScenarioFixture, setupFromFixture } from "./fixture.ts";
import { simulate } from "./simulate.ts";

const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixtureFiles = readdirSync(fixturesDirectory).filter((file) => file.endsWith(".json"));

describe("scenario fixtures", () => {
  it("the catalog is present", () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of fixtureFiles) {
    describe(file, () => {
      const raw: unknown = JSON.parse(readFileSync(join(fixturesDirectory, file), "utf8"));
      const fixture = parseScenarioFixture(raw);
      const setup = setupFromFixture(fixture);

      it("replays to its expected outcome", () => {
        const result = simulate(fixture.actions, setup);
        if (fixture.expect.phase !== undefined) {
          expect(result.state.phase).toBe(fixture.expect.phase);
        }
        if (fixture.expect.scores !== undefined) {
          expect(result.state.scores).toEqual(fixture.expect.scores);
        }
        if (fixture.expect.winners !== undefined) {
          expect((result.state.winners ?? []).toSorted()).toEqual(
            fixture.expect.winners.toSorted(),
          );
        }
        if (fixture.expect.rejectedCount !== undefined) {
          const rejectedSteps = result.steps.filter((step) => step.rejected !== null);
          expect(rejectedSteps).toHaveLength(fixture.expect.rejectedCount);
        }
      });

      it("replays deterministically", () => {
        const first = simulate(fixture.actions, setup);
        const second = simulate(fixture.actions, setup);
        expect(second.state).toEqual(first.state);
        expect(second.events).toEqual(first.events);
      });

      it("names itself consistently", () => {
        expect(`${fixture.name}.json`).toBe(file);
      });
    });
  }
});
