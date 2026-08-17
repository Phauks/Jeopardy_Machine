<script lang="ts">
  // RIGHT COLUMN: the frame log, full height, filterable, compact or verbose bodies.
  import { filterLog, formatLogLine, logLimit } from "#lib/dev/harness/harness-log.ts";
  import type { LogEntry, LogFilter } from "#lib/dev/harness/harness-log.ts";

  // View state as a $state object owned by the page: the filter survives a panel being moved.
  export type LogView = { filter: LogFilter; compact: boolean };

  type Props = {
    log: LogEntry[];
    view: LogView;
    onClear: () => void;
    onCopy: () => void;
  };
  let { log, view, onClear, onCopy }: Props = $props();

  const visible = $derived(filterLog(log, view.filter));
</script>

<section class="flex max-h-[85vh] min-h-80 flex-col gap-2 rounded-sm border p-3 lg:sticky lg:top-4">
  <div class="flex flex-wrap items-center gap-2">
    <h2 class="font-bold">
      Log ({visible.length}/{log.length}{log.length >= logLimit ? ", capped" : ""})
    </h2>
    <select class="border px-2 py-0.5 text-sm" bind:value={view.filter}>
      <option value="all">all</option>
      <option value="sent">sent</option>
      <option value="received">received</option>
      <option value="errors">errors</option>
    </select>
    <label class="flex items-center gap-1 text-sm">
      <input type="checkbox" bind:checked={view.compact} />
      compact
    </label>
    <button class="border px-2 py-0.5 text-sm" disabled={log.length === 0} onclick={onClear}>
      Clear
    </button>
    <button class="border px-2 py-0.5 text-sm" disabled={log.length === 0} onclick={onCopy}>
      Copy
    </button>
  </div>
  <pre class="flex-1 overflow-auto border p-2 text-xs">{#each visible as entry, index (index)}{formatLogLine(entry, view.compact)}
{/each}</pre>
</section>
