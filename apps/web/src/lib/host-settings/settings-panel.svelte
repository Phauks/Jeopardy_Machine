<script lang="ts">
  // THE COG. One panel, opened in place on the console, holding everything a host adjusts
  // during a game - and split down the middle by the only distinction that matters here.
  //
  //   THIS DEVICE  local, instant, nobody else's business. Type scale, audio, mirror, manual
  //                mode, stage motion, density. Stored in localStorage on this laptop.
  //   THIS ROOM    server state, broadcast to everyone connected. Streamer mode, listing,
  //                password, caps, spectators. Changing one changes the room for the players.
  //
  // The split is not decoration: a host who thinks "text size" reaches the players, or that
  // "hide join code" is a local view option, will make exactly the wrong move at exactly the
  // wrong moment. So the two halves are separately headed, separately coloured, separately
  // badged, and the room half says out loud that it reaches everybody
  // (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md).
  //
  // In place, never a screen (the standing UI law of that same decision): this renders as a
  // rail beside the console, which keeps running, keeps updating, and keeps its keyboard
  // shortcuts while the panel is open.
  import {
    maximumTypeScale,
    minimumTypeScale,
    typeScaleLabel,
    typeScaleStep,
    typeScaleStyle,
  } from "#lib/host-settings/device-preferences.ts";
  import { roomSettingsRefusal, roomSettingsSummary } from "#lib/host-settings/room-settings-edit.ts";
  import type { DevicePreferencesStore } from "#lib/host-settings/device-preferences.svelte.ts";
  import type { RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    preferences: DevicePreferencesStore;
    onClose: () => void;
  };
  let { store, preferences, onClose }: Props = $props();

  const view = $derived(store.view);
  const device = $derived(preferences.current);

  // Room-settings fields that are typed rather than toggled are staged locally and applied
  // deliberately - a title being retyped must not publish the room letter by letter.
  // svelte-ignore state_referenced_locally
  let titleDraft = $state(view.settings.title);
  // svelte-ignore state_referenced_locally
  let hostLabelDraft = $state(view.settings.hostLabel);
  let passwordDraft = $state("");
  // svelte-ignore state_referenced_locally
  let maxPlayersDraft = $state(view.settings.maxPlayers);
  // svelte-ignore state_referenced_locally
  let maxSpectatorsDraft = $state(view.settings.maxSpectators);
  let refusal = $state<{ headline: string; advice: string } | null>(null);
  let codeRevealed = $state(false);

  /**
   * Send a room-settings edit, or explain why the room would refuse it. The console checks the
   * room's own two rules first (src/lib/host-settings/room-settings-edit.ts) so a host learns
   * "a public room needs a name" instead of pressing a button that quietly does nothing.
   */
  function applyRoomSettings(patch: RoomSettingsPatch): void {
    const blocked = roomSettingsRefusal(patch, view);
    refusal = blocked === null ? null : { headline: blocked.headline, advice: blocked.advice };
    if (blocked !== null) return;
    store.updateRoomSettings(patch);
  }
</script>

<aside class="settings-panel" aria-label="Host settings">
  <header class="panel-head">
    <h2>Settings</h2>
    <button type="button" class="chip" onclick={onClose}>Close</button>
  </header>

  <!-- ---------------------------------------------------------------- device preferences -->
  <section class="group device">
    <header class="group-head">
      <h3>This device</h3>
      <span class="badge local">local</span>
    </header>
    <p class="group-note">
      Only this laptop. Instant, stored here, invisible to the room and to the players.
    </p>

    <!-- The owner's headline ask: the projector is read from across a room and the console at
         arm's length, so the two type scales are independent and both preview live. -->
    <div class="control">
      <label for="display-type-scale">
        Display text size
        <span class="value">{typeScaleLabel(device.displayTypeScale)}</span>
      </label>
      <input
        id="display-type-scale"
        type="range"
        min={minimumTypeScale}
        max={maximumTypeScale}
        step={typeScaleStep}
        value={device.displayTypeScale}
        oninput={(event) => {
          preferences.update({ displayTypeScale: event.currentTarget.valueAsNumber });
        }}
      />
      <!-- A real preview, at the real scale, in the real type: the projector is usually a
           window on another screen, and a host must not have to look up to judge a change. -->
      <div class="preview display-preview" style={typeScaleStyle(device.displayTypeScale)}>
        <span class="preview-category">Potent potables</span>
        <span class="preview-value">$800</span>
      </div>
      <p class="hint">
        Display windows opened from this browser, and mirror mode. A projector driven by another
        machine has its own.
      </p>
    </div>

    <div class="control">
      <label for="console-type-scale">
        Console text size
        <span class="value">{typeScaleLabel(device.consoleTypeScale)}</span>
      </label>
      <input
        id="console-type-scale"
        type="range"
        min={minimumTypeScale}
        max={maximumTypeScale}
        step={typeScaleStep}
        value={device.consoleTypeScale}
        oninput={(event) => {
          preferences.update({ consoleTypeScale: event.currentTarget.valueAsNumber });
        }}
      />
      <p class="hint">This console only - the answers, the judge row, the minimap.</p>
    </div>

    <div class="control">
      <span class="control-label">Room audio on this device</span>
      <label class="toggle">
        <input
          type="checkbox"
          checked={device.displayAudio}
          onchange={(event) => {
            preferences.update({ displayAudio: event.currentTarget.checked });
          }}
        />
        Display window
      </label>
      <label class="toggle">
        <input
          type="checkbox"
          checked={device.consoleAudio}
          onchange={(event) => {
            preferences.update({ consoleAudio: event.currentTarget.checked });
          }}
        />
        This console
      </label>
      <label for="audio-volume" class="sub-label">
        Volume <span class="value">{Math.round(device.audioVolume * 100)}%</span>
      </label>
      <input
        id="audio-volume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={device.audioVolume}
        oninput={(event) => {
          preferences.update({ audioVolume: event.currentTarget.valueAsNumber });
        }}
      />
    </div>

    <div class="control">
      <!-- ONE CHOICE, not two features. Mirror mode used to be a lone checkbox here, which left
           the far more common setup - projector as a second output - with no home and no action
           at all (owner, 2026-08-19). Both answers live in one control, and the console's own
           game-screen panel is where the chosen one is acted on. -->
      <label for="screen-setup">How the room sees this game</label>
      <select
        id="screen-setup"
        value={device.screenSetup}
        onchange={(event) => {
          preferences.update({
            screenSetup: event.currentTarget.value === "mirror" ? "mirror" : "second-screen",
          });
        }}
      >
        <option value="second-screen">Second screen (projector or TV)</option>
        <option value="mirror">Mirror this screen</option>
      </select>
      <p class="hint">
        Second screen: the console opens the game screen as its own window and stays private.
        Mirror: this laptop IS the projector, so answers stop rendering entirely.
      </p>
      <label class="toggle">
        <input
          type="checkbox"
          checked={device.manualMode}
          onchange={(event) => {
            preferences.update({ manualMode: event.currentTarget.checked });
          }}
        />
        Manual mode
      </label>
      <p class="hint">No buzzers - award each clue from the console. The Wi-Fi-died fallback.</p>
      <label class="toggle">
        <input
          type="checkbox"
          checked={device.showTimers}
          onchange={(event) => {
            preferences.update({ showTimers: event.currentTarget.checked });
          }}
        />
        Show timers
      </label>
    </div>

    <div class="control">
      <label for="roster-density">Roster density</label>
      <select
        id="roster-density"
        value={device.rosterDensity}
        onchange={(event) => {
          preferences.update({
            rosterDensity: event.currentTarget.value === "compact" ? "compact" : "comfortable",
          });
        }}
      >
        <option value="comfortable">Comfortable</option>
        <option value="compact">Compact (many teams)</option>
      </select>
    </div>

    <div class="control">
      <label for="stage-motion">Stage</label>
      <select
        id="stage-motion"
        value={device.stageMotion}
        onchange={(event) => {
          const next = event.currentTarget.value;
          preferences.update({
            stageMotion: next === "off" ? "off" : next === "still" ? "still" : "full",
          });
        }}
      >
        <option value="full">Avatars moving</option>
        <option value="still">Avatars still</option>
        <option value="off">No 3D stage</option>
      </select>
      <p class="hint">Turn it down if this machine is driving the projector and struggling.</p>
    </div>

    <button
      type="button"
      class="chip"
      onclick={() => {
        preferences.reset();
      }}
    >
      Reset device settings
    </button>
  </section>

  <!-- --------------------------------------------------------------------- room settings -->
  <section class="group room">
    <header class="group-head">
      <h3>This room</h3>
      <span class="badge shared">everyone</span>
    </header>
    <p class="group-note">
      Server settings. Every change reaches every phone and every display in the room at once.
    </p>
    <p class="summary">{roomSettingsSummary(view)}</p>

    {#if refusal !== null}
      <p class="refusal" role="alert">
        <strong>{refusal.headline}</strong>
        {refusal.advice}
      </p>
    {/if}

    <div class="control">
      <label class="toggle">
        <input
          type="checkbox"
          checked={view.settings.hideJoinCode}
          onchange={(event) => {
            applyRoomSettings({ hideJoinCode: event.currentTarget.checked });
          }}
        />
        Streamer mode (hide the join code)
      </label>
      <p class="hint">
        The code and QR stop rendering on the game screen and every shared surface. They stay on
        this console, which is yours - the join panel says so while it is on.
      </p>
      <!-- The reveal lives HERE and nowhere else: a reveal button on the streamed screen would
           defeat the setting (docs/decisions/2026-08-14-room-controls-and-staging.md). -->
      {#if view.settings.hideJoinCode}
        {#if codeRevealed}
          <p class="revealed-code">{view.roomCode}</p>
        {:else}
          <button
            type="button"
            class="chip"
            onclick={() => {
              codeRevealed = true;
            }}
          >
            Show me the code
          </button>
        {/if}
      {/if}
    </div>

    <div class="control">
      <label for="room-listing">Listing</label>
      <select
        id="room-listing"
        value={view.settings.listing}
        onchange={(event) => {
          applyRoomSettings({ listing: event.currentTarget.value === "public" ? "public" : "private" });
        }}
      >
        <option value="private">Private - never in the lobby</option>
        <option value="public">Public - anyone can find it</option>
      </select>
      <label for="room-title">Game title</label>
      <input id="room-title" type="text" bind:value={titleDraft} />
      <label for="room-host-label">Hosted by</label>
      <input id="room-host-label" type="text" bind:value={hostLabelDraft} />
      <button
        type="button"
        class="chip"
        onclick={() => {
          applyRoomSettings({ title: titleDraft, hostLabel: hostLabelDraft });
        }}
      >
        Save name
      </button>
    </div>

    <div class="control">
      <label for="room-password">Password</label>
      <input
        id="room-password"
        type="text"
        autocomplete="off"
        placeholder={view.settings.entry === "password" ? "set - type to replace" : "no password"}
        bind:value={passwordDraft}
      />
      <div class="row">
        <button
          type="button"
          class="chip"
          onclick={() => {
            applyRoomSettings({ password: passwordDraft });
            passwordDraft = "";
          }}
        >
          Set password
        </button>
        <button
          type="button"
          class="chip"
          onclick={() => {
            applyRoomSettings({ password: null });
            passwordDraft = "";
          }}
        >
          Remove password
        </button>
      </div>
      <p class="hint">Changing it never disconnects anyone already in the room.</p>
    </div>

    <div class="control">
      <label for="max-players">Player cap</label>
      <input id="max-players" type="number" min="1" bind:value={maxPlayersDraft} />
      <label for="max-spectators">Spectator cap</label>
      <input id="max-spectators" type="number" min="0" bind:value={maxSpectatorsDraft} />
      <label class="toggle">
        <input
          type="checkbox"
          checked={view.settings.spectatorsAllowed}
          onchange={(event) => {
            applyRoomSettings({ spectatorsAllowed: event.currentTarget.checked });
          }}
        />
        Allow spectators
      </label>
      <button
        type="button"
        class="chip"
        onclick={() => {
          applyRoomSettings({
            maxPlayers: Math.round(maxPlayersDraft),
            maxSpectators: Math.round(maxSpectatorsDraft),
          });
        }}
      >
        Save caps
      </button>
      <p class="hint">Nobody is ever removed by a cap - it only stops the next arrival.</p>
    </div>
  </section>
</aside>

<style>
  /* A rail beside the console, not over it: the board, the clue and the judge row all stay
     visible and live while the panel is open (the persistent-layout law). */
  .settings-panel {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    width: 20rem;
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    padding: 0.8rem 0.9rem 1.2rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    color: var(--surface-text);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .panel-head h2 {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1em;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.7rem 0.75rem 0.9rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--surface-border);
  }

  /* The two halves are visibly different objects. A host must never have to remember which
     column they are in. */
  .group.device {
    border-left: 4px solid var(--surface-text-muted);
  }

  .group.room {
    border-left: 4px solid var(--accent);
  }

  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .group-head h3 {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.92em;
  }

  .badge {
    font-family: var(--font-chrome);
    font-size: 0.62em;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    border: 1px solid currentColor;
  }

  .badge.local {
    color: var(--surface-text-muted);
  }

  .badge.shared {
    color: var(--accent);
  }

  .group-note,
  .hint {
    margin: 0;
    font-size: 0.72em;
    line-height: 1.35;
    color: var(--surface-text-muted);
  }

  .summary {
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--surface-text);
  }

  .refusal {
    margin: 0;
    font-size: 0.78em;
    line-height: 1.35;
    color: var(--score-negative);
  }

  .control {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .control label,
  .control-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
    font-size: 0.82em;
  }

  .sub-label {
    color: var(--surface-text-muted);
  }

  .value {
    font-family: var(--font-values);
    color: var(--accent);
  }

  .toggle {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.4rem;
  }

  .row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  /* The live preview borrows the display's own type tokens, so what the host judges here is
     what the room will see - it is the same calc, at the same scale. */
  .preview {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    overflow: hidden;
    padding: 0.4rem 0.5rem;
    border-radius: var(--board-radius);
    background: var(--board-cell-bg);
  }

  .preview-category {
    font-family: var(--font-chrome);
    font-size: var(--board-category-size);
    text-transform: uppercase;
    color: var(--clue-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-value {
    font-family: var(--font-values);
    font-size: var(--board-value-size);
    line-height: 1;
    color: var(--board-value-color);
  }

  .revealed-code {
    margin: 0;
    font-family: var(--font-values);
    font-size: 1.6em;
    letter-spacing: 0.12em;
    color: var(--board-value-color);
  }

  input[type="text"],
  input[type="number"],
  select {
    font: inherit;
    font-size: 0.85em;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-page);
    color: var(--surface-text);
  }

  input[type="range"] {
    width: 100%;
  }

  .chip {
    align-self: flex-start;
    font-family: var(--font-chrome);
    font-size: 0.74em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.3rem 0.65rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--surface-border);
    background: var(--surface-page);
    color: var(--surface-text);
    cursor: pointer;
  }

  .chip:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  @media (max-width: 64rem) {
    .settings-panel {
      width: auto;
      max-height: none;
    }
  }
</style>
