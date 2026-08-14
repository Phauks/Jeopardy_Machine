<script lang="ts">
  // The registry's state, rendered wherever a room list is rendered (the landing page's Join
  // section, the harness's lobby panel). Presentational: the words live in registry-status.ts
  // so every surface says the same thing.
  //
  // `quiet` is for player-facing surfaces: a healthy registry there should be invisible - the
  // Join section is not a status board - while a broken one is always shown, because "no
  // rooms" without a reason is precisely the bug this replaces.
  import { describeRegistryStatus } from "#lib/lobby/registry-status.ts";
  import type { RegistryStatus } from "@jeopardy/protocol/room/registry";

  type Props = { status: RegistryStatus; quiet?: boolean };
  let { status, quiet = false }: Props = $props();

  const notice = $derived(describeRegistryStatus(status));
</script>

{#if !(quiet && notice.tone === "ok")}
  <div
    class="flex flex-col gap-1 rounded-sm border p-3 text-sm"
    class:border-dashed={notice.tone === "ok"}
    class:opacity-70={notice.tone === "ok"}
    data-tone={notice.tone}
  >
    <strong>{notice.headline}</strong>
    <span>{notice.hint}</span>
    {#if notice.fix !== null}
      <code class="overflow-x-auto rounded-sm border p-2 text-xs">{notice.fix}</code>
    {/if}
    {#if notice.detail !== null}
      <span class="text-xs opacity-70">{notice.detail}</span>
    {/if}
  </div>
{/if}
