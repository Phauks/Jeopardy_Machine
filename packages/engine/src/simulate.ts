// The public simulation API (owner directive "Development simulation", engine level):
// fold an action array through the engine and get the final state plus everything that
// happened. Unit tests, the hotseat page, M3 bot scripts, and the M4 sim panel all drive
// games through this one function.
import { createInitialState } from "./state.ts";
import { transition } from "./transition.ts";
import type { GameAction } from "./actions.ts";
import type { GameEvent } from "./events.ts";
import type { GameSetup } from "./setup.ts";
import type { GameState } from "./state.ts";

export type SimulationStep = {
  action: GameAction;
  events: GameEvent[];
  /** Rejection reason when the action was refused (its events then include action-rejected). */
  rejected: string | null;
};

export type SimulationResult = {
  state: GameState;
  steps: SimulationStep[];
  /** All events in order - the flattened steps, for quick assertions. */
  events: GameEvent[];
};

export function simulate(actions: readonly GameAction[], setup: GameSetup): SimulationResult {
  let state = createInitialState(setup);
  const steps: SimulationStep[] = [];
  const events: GameEvent[] = [];
  for (const action of actions) {
    const result = transition(state, action, setup);
    const rejectedEvent = result.events.find((event) => event.type === "action-rejected");
    steps.push({
      action,
      events: result.events,
      rejected: rejectedEvent?.type === "action-rejected" ? rejectedEvent.reason : null,
    });
    events.push(...result.events);
    state = result.state;
  }
  return { state, steps, events };
}
