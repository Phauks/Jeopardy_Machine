<script lang="ts">
  // The test area: assertions, not controls. Each probe asks the room to say NO and checks
  // that it said no in the right way, so a PASS here means a guardrail holds. Separated from
  // the ordinary controls on purpose - a green failure-probe is not an error.
  //
  // Run all (owner request 2026-08-14) runs them SEQUENTIALLY: several of these share the one
  // socket, and a parallel burst would let one probe settle another's frame. Probes that
  // cannot run right now are SKIPPED with the reason on the chip - reporting "the socket is
  // not open" as a failure would train the reader to ignore red.
  import { probeBlocker, refusalProbes } from "#lib/dev/harness/refusal-probes.ts";
  import type { ProbeContext, ProbeId } from "#lib/dev/harness/refusal-probes.ts";

  export type ProbeState = {
    verdict: "pass" | "fail" | "skip" | null;
    actual: string | null;
    running: boolean;
  };

  type Props = {
    states: Record<string, ProbeState>;
    context: ProbeContext;
    runningAll: boolean;
    summary: string | null;
    onRun: (id: ProbeId) => void;
    onRunAll: () => void;
  };
  let { states, context, runningAll, summary, onRun, onRunAll }: Props = $props();

  function stateOf(id: ProbeId): ProbeState {
    return states[id] ?? { verdict: null, actual: null, running: false };
  }
</script>

<section class="flex flex-col gap-2 rounded-sm border-2 border-dashed p-3">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="font-bold">Test area - refusal probes</h2>
    <div class="flex flex-wrap items-center gap-2">
      <button class="border px-3 py-1 text-sm" disabled={runningAll} onclick={onRunAll}>
        {runningAll ? "Running all..." : "Run all"}
      </button>
      {#if summary !== null}
        <span class="border px-2 py-0.5 text-sm font-bold" data-run-summary>{summary}</span>
      {/if}
    </div>
  </div>
  <p class="text-xs opacity-70">
    These are assertions, not controls: each one asks the room to say NO and checks that it said
    no in the right way. A PASS here means the guardrail holds. Run all goes through them in
    order and skips the ones this tab cannot currently perform.
  </p>
  <ul class="grid gap-2 md:grid-cols-2">
    {#each refusalProbes as probe (probe.id)}
      {@const state = stateOf(probe.id)}
      {@const blocker = probeBlocker(probe.id, context)}
      <li class="flex flex-col gap-1 rounded-sm border p-2 text-sm">
        <div class="flex flex-wrap items-baseline gap-2">
          <strong>{probe.label}</strong>
          {#if state.running}
            <span class="text-xs">running...</span>
          {:else if state.verdict !== null}
            <span
              class="border px-2 text-xs font-bold"
              class:bg-green-100={state.verdict === "pass"}
              class:bg-red-100={state.verdict === "fail"}
              data-verdict={state.verdict}
            >
              {state.verdict.toUpperCase()}
            </span>
          {/if}
        </div>
        <span class="text-xs opacity-70">expected: {probe.expected}</span>
        <span class="text-xs opacity-70">actual: {state.actual ?? "not run"}</span>
        <span class="text-xs opacity-70">{probe.because}</span>
        <button
          class="w-fit border px-2 py-0.5 text-xs"
          disabled={blocker !== null || runningAll}
          onclick={() => onRun(probe.id)}
        >
          {blocker === null ? "Run" : `Run (${blocker})`}
        </button>
      </li>
    {/each}
  </ul>
</section>
