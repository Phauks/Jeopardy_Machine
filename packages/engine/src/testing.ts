// Shared test scaffolding for the engine suite (imported only by *.test.ts files; not part
// of the package exports). Conventions: players p1/p2/p3..., time starts at 1000 and every
// helper action steps it forward, seeds are explicit so every test is a reproducible game.
import { resolvePreset } from "@jeopardy/protocol";
import type { SettingsOverrides, SettingsPresetId } from "@jeopardy/protocol";
import { plainRoundSetup } from "./setup.ts";
import { createInitialState } from "./state.ts";
import { transition } from "./transition.ts";
import type { GameAction } from "./actions.ts";
import type { GameEvent } from "./events.ts";
import type { GameSetup, PlainBoardSetup } from "./setup.ts";
import type { GameState } from "./state.ts";

export type TestSetupOptions = {
  preset?: SettingsPresetId;
  overrides?: SettingsOverrides;
  rounds?: PlainBoardSetup[];
  hasFinalClue?: boolean;
  seed?: string;
};

/** Default board: one 3x3 round, no auto wager cells (tests opt in explicitly). */
export function testSetup(options: TestSetupOptions = {}): GameSetup {
  const overrides: SettingsOverrides[] = [
    { wagers: { countRoundOne: 0, countRoundTwo: 0 } },
    options.overrides ?? {},
  ];
  return {
    settings: resolvePreset(options.preset ?? "casual-party", ...overrides),
    rounds: (options.rounds ?? [{ columns: 3, rows: 3 }]).map(plainRoundSetup),
    hasFinalClue: options.hasFinalClue ?? false,
    seed: options.seed ?? "engine-test-seed",
  };
}

export function joinActions(playerCount: number, at = 1000): GameAction[] {
  return Array.from({ length: playerCount }, (_, index) => ({
    type: "player-join" as const,
    at: at + index,
    playerId: `p${String(index + 1)}`,
    name: `Player ${String(index + 1)}`,
  }));
}

export type Run = {
  state: GameState;
  events: GameEvent[];
  setup: GameSetup;
};

/** Apply actions in order; throws if any is rejected (tests for rejects use applyExpecting). */
export function run(setup: GameSetup, actions: readonly GameAction[]): Run {
  let state = createInitialState(setup);
  const events: GameEvent[] = [];
  for (const action of actions) {
    const result = transition(state, action, setup);
    const rejected = result.events.find((event) => event.type === "action-rejected");
    if (rejected !== undefined && rejected.type === "action-rejected") {
      throw new Error(
        `unexpected rejection of ${action.type}: ${rejected.reason} (phase ${state.phase})`,
      );
    }
    state = result.state;
    events.push(...result.events);
  }
  return { state, events, setup };
}

/** Continue an existing run; same throw-on-rejection contract. */
export function runOn(previous: Run, actions: readonly GameAction[]): Run {
  const continued = { state: previous.state, events: [...previous.events], setup: previous.setup };
  for (const action of actions) {
    const result = transition(continued.state, action, previous.setup);
    const rejected = result.events.find((event) => event.type === "action-rejected");
    if (rejected !== undefined && rejected.type === "action-rejected") {
      throw new Error(
        `unexpected rejection of ${action.type}: ${rejected.reason} (phase ${continued.state.phase})`,
      );
    }
    continued.state = result.state;
    continued.events.push(...result.events);
  }
  return continued;
}

/** Apply one action expecting rejection; returns the reason (throws when accepted). */
export function applyExpectingRejection(previous: Run, action: GameAction): string {
  const result = transition(previous.state, action, previous.setup);
  const rejected = result.events.find((event) => event.type === "action-rejected");
  if (rejected === undefined || rejected.type !== "action-rejected") {
    throw new Error(`expected ${action.type} to be rejected, but it was accepted`);
  }
  return rejected.reason;
}

/** Join players and start the game - the common opening of most tests. */
export function startedGame(setup: GameSetup, playerCount = 3): Run {
  return run(setup, [...joinActions(playerCount), { type: "start-game", at: 2000 }]);
}

export function eventsOfType<Type extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: Type,
): Extract<GameEvent, { type: Type }>[] {
  return events.filter((event) => event.type === type) as Extract<GameEvent, { type: Type }>[];
}

/**
 * Play the current clue to a correct answer by the given player: arm, buzz, judge correct.
 * Assumes phase awaiting-selection is NOT required - callers select first.
 */
export function winClue(previous: Run, playerId: string, at: number): Run {
  return runOn(previous, [
    { type: "arm-buzzers", at },
    { type: "buzz", at: at + 100, playerId },
    { type: "judge", at: at + 200, verdict: "correct" },
  ]);
}
