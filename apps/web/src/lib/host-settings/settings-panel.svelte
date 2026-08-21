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
  //
  // NOT THEMED, and that is a rule rather than a taste (owner, 2026-08-17: "Display text size
  // and other settings show the theme assets, which makes them difficult to read"). A control
  // panel must never be painted by the thing it controls: this panel steers the type scale a
  // theme renders at, so it wore the theme's display faces and the theme's contrast, and a
  // slider label ended up in a condensed poster face on a color the theme chose for a board.
  // Everything here paints from the fixed --control-* tokens (src/lib/theme/tokens.css). The
  // one exception is the PREVIEW below, which is explicitly a picture of the display and is
  // supposed to look like one; console-chrome.gate.test.ts holds that line.
  import {
    maximumTypeScale,
    minimumTypeScale,
    typeScaleLabel,
    typeScaleStep,
    typeScaleStyle,
  } from "#lib/host-settings/device-preferences.ts";
  import {
    pendingCapsSummary,
    pendingNameSummary,
    roomSettingsRefusal,
    roomSettingsSummary,
  } from "#lib/host-settings/room-settings-edit.ts";
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

  // What each typed group WOULD change, stated beside its button. The button is dead until
  // there is something to apply, which is what turns "Save caps" from a name into an action a
  // host can predict (room-settings-edit.ts explains the reasoning).
  const pendingCaps = $derived(
    pendingCapsSummary(view, { maxPlayers: maxPlayersDraft, maxSpectators: maxSpectatorsDraft }),
  );
  const pendingName = $derived(
    pendingNameSummary(view, { title: titleDraft, hostLabel: hostLabelDraft }),
  );

  function revertCaps(): void {
    maxPlayersDraft = view.settings.maxPlayers;
    maxSpectatorsDraft = view.settings.maxSpectators;
  }

  function revertName(): void {
    titleDraft = view.settings.title;
    hostLabelDraft = view.settings.hostLabel;
  }

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
      <strong>Switches take effect the moment you flip them.</strong> Anything you TYPE - the name,
      the password, the caps - waits for its Apply button, so a half-typed name never reaches the
      room.
    </p>
    <p class="summary">{roomSettingsSummary(view)}</p>

    {#if !view.settingsKnown}
      <!-- HONEST BLANK. Until the room has sent its settings, everything below would be the
           protocol's defaults wearing this room's name - which is how a host ends up sure their
           room is set to something it never was (owner, 2026-08-17). So the controls do not
           render at all, and the panel says why. -->
      <p class="not-loaded">
        This console has not heard the room's settings yet. Nothing is shown here rather than
        showing defaults that are not yours - the controls appear as soon as the room reports.
      </p>
    {:else}
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
          The code and QR stop rendering on the game screen and every shared surface. They stay
          on this console, which is yours - the join panel says so while it is on.
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
        {#if pendingName !== null}
          <p class="pending" role="status">Not applied yet: {pendingName}</p>
        {/if}
        <div class="row">
          <button
            type="button"
            class="chip"
            disabled={pendingName === null}
            onclick={() => {
              applyRoomSettings({ title: titleDraft, hostLabel: hostLabelDraft });
            }}
          >
            Apply name to the room
          </button>
          {#if pendingName !== null}
            <button type="button" class="chip subtle" onclick={revertName}>Discard</button>
          {/if}
        </div>
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

      <!-- HOW MANY PEOPLE FIT. Was a pair of number boxes under a button reading "Save caps",
           which told a host the button's name and not its scope (owner, 2026-08-17: "I don't
           understand SAVE CAPS"). Now the group says what it governs, the room's current numbers
           are stated in words above the boxes, the pending edit is spelled out, and the button
           names its own effect. -->
      <div class="control">
        <span class="control-label">How many people fit</span>
        <p class="current">
          Right now: <strong>{view.roster.players.length}</strong> of
          <strong>{view.settings.maxPlayers}</strong> player seats taken;
          {view.settings.spectatorsAllowed
            ? `up to ${String(view.settings.maxSpectators)} spectators may watch`
            : "spectators are not allowed in"}.
        </p>
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
        {#if pendingCaps !== null}
          <p class="pending" role="status">Not applied yet: {pendingCaps}</p>
        {/if}
        <div class="row">
          <button
            type="button"
            class="chip"
            disabled={pendingCaps === null}
            onclick={() => {
              applyRoomSettings({
                maxPlayers: Math.round(maxPlayersDraft),
                maxSpectators: Math.round(maxSpectatorsDraft),
              });
            }}
          >
            Apply caps to the room
          </button>
          {#if pendingCaps !== null}
            <button type="button" class="chip subtle" onclick={revertCaps}>Discard</button>
          {/if}
        </div>
        <p class="hint">
          Caps only stop the NEXT arrival. Nobody already in the room is ever removed by one, and
          the room refuses a cap set below the people already here.
        </p>
      </div>
    {/if}
  </section>
</aside>

<style>
  /* THE PANEL IS CONTROL CHROME, NOT A THEMED SURFACE.
     Every color and face below is a fixed --control-* token (src/lib/theme/tokens.css). It was
     the theme's own tokens - --font-chrome for the labels, --surface-* for the ground, --accent
     for the values - which meant the panel that SETS the display type scale was rendered in the
     display's poster faces at whatever contrast the room's theme happened to give it (owner,
     2026-08-17: "settings show the theme assets, which makes them difficult to read"). The rule
     that replaces it: a control panel is never painted by the thing it controls. The single
     exception is .preview below, which is a picture OF the theme and says so.

     Type sizes stay in em so the host's console type scale still grows the panel with the rest
     of the console - that is a legibility preference, not a theme. */
  .settings-panel {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    width: 20rem;
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    padding: 0.8rem 0.9rem 1.2rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-page);
    color: var(--control-text);
    font-family: var(--control-font);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .panel-head h2 {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1em;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.7rem 0.75rem 0.9rem;
    border-radius: var(--control-radius);
    border: 1px solid var(--control-border);
    background: var(--control-raised);
  }

  /* The two halves are visibly different objects. A host must never have to remember which
     column they are in. */
  .group.device {
    border-left: 4px solid var(--control-text-muted);
  }

  .group.room {
    border-left: 4px solid var(--control-accent);
  }

  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .group-head h3 {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.92em;
  }

  .badge {
    font-size: 0.62em;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    border: 1px solid currentColor;
  }

  .badge.local {
    color: var(--control-text-muted);
  }

  .badge.shared {
    color: var(--control-accent);
  }

  .group-note,
  .hint,
  .current {
    margin: 0;
    font-size: 0.72em;
    line-height: 1.35;
    color: var(--control-text-muted);
  }

  .current strong {
    color: var(--control-text);
  }

  .summary {
    margin: 0;
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--control-text);
  }

  /* "Nothing has arrived yet" is a sentence, not an empty box: the honest state has to be as
     visible as the controls it stands in for (room-view.ts, settingsKnown). */
  .not-loaded {
    margin: 0;
    font-size: 0.78em;
    line-height: 1.4;
    padding: 0.5rem 0.6rem;
    border: 1px dashed var(--control-border);
    border-radius: var(--control-radius);
    color: var(--control-text-muted);
  }

  .refusal {
    margin: 0;
    font-size: 0.78em;
    line-height: 1.35;
    color: var(--control-danger);
  }

  /* The pending line is the whole answer to "I don't understand SAVE CAPS": it states the edit
     the button would send, in the room's units, before it is sent. */
  .pending {
    margin: 0;
    font-size: 0.76em;
    line-height: 1.35;
    color: var(--control-accent);
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
    color: var(--control-text-muted);
  }

  .value {
    color: var(--control-accent);
    font-variant-numeric: tabular-nums;
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
    align-items: center;
  }

  /* THE ONE THEMED THING HERE, deliberately: a preview borrows the display's own type tokens,
     so what the host judges is what the room will see - same calc, same faces, same scale. It
     is a picture of the board, framed by chrome that is not. */
  .preview {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    overflow: hidden;
    padding: 0.4rem 0.5rem;
    border-radius: var(--control-radius);
    border: 1px solid var(--control-border);
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
    font-size: 1.6em;
    letter-spacing: 0.12em;
    font-variant-numeric: tabular-nums;
    color: var(--control-accent);
  }

  input[type="text"],
  input[type="number"],
  select {
    font: inherit;
    font-size: 0.85em;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-page);
    color: var(--control-text);
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--control-accent);
  }

  input[type="checkbox"] {
    accent-color: var(--control-accent);
  }

  .chip {
    align-self: flex-start;
    font: inherit;
    font-size: 0.74em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.3rem 0.65rem;
    border-radius: var(--control-radius);
    border: 1px solid var(--control-border);
    background: var(--control-raised);
    color: var(--control-text);
    cursor: pointer;
  }

  /* A dead Apply button is the panel saying "there is nothing to apply" - which is half of why
     the control is now predictable. */
  .chip:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .chip.subtle {
    color: var(--control-text-muted);
  }

  .chip:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 3px solid var(--control-accent);
    outline-offset: 2px;
  }

  @media (max-width: 64rem) {
    .settings-panel {
      width: auto;
      max-height: none;
    }
  }
</style>
