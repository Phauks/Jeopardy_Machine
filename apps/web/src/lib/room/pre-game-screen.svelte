<script lang="ts">
  // THE pre-game surface. One screen, three regions, all of them present from the first paint.
  //
  // This is the shape the 2026-08-16 decision requires
  // (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md):
  //
  //   "state changes in place; it does not swap screens ... No wizard chains. The pre-game is
  //    ONE surface whose regions fill in, not character -> team -> lobby as three separate
  //    pages ... Nothing that has been shown gets hidden by a later step."
  //
  // What that costs, concretely, and what it buys:
  //   - Choosing your look does not navigate away from the teams. The teams are beside it.
  //   - Joining a team does not hide your character. It is still there, still editable.
  //   - Taking a seat changes what the controls MEAN (character-panel's draft -> live), not
  //     what is on screen; the action bar's label changes and nothing unmounts.
  //   - Every region reserves its space, so a roster arriving or a refusal appearing changes
  //     no other region's position (each panel's stylesheet says where it does that).
  //
  // The only thing that replaces this surface is the buzzer, and that is the exception the law
  // names: the game itself changing state, chosen by playerSurfaceFor in #lib/room/pre-game.ts.
  //
  // LAPTOPS ARE FIRST-CLASS. The layout below is not a phone column with a media query bolted
  // on: at >= 64rem the three regions become three real columns, because "phone as buzzer" is
  // the headline and not the constraint (the decision's "Laptops and desktops are first-class
  // play devices"). The breakpoints are on the CONTAINER, so a narrow window on a big screen
  // gets the phone layout rather than a stretched one.
  import CharacterPanel from "#lib/room/character-panel.svelte";
  import AppBar from "#lib/chrome/app-bar.svelte";
  import RosterPanel from "#lib/room/roster-panel.svelte";
  import TeamsPanel from "#lib/room/teams-panel.svelte";
  import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import { joinBlock } from "#lib/room/room-refusal.ts";
  import { myPlayer, preGameRegionsFor, uniqueNickname } from "#lib/room/pre-game.ts";
  import type { CharacterDraft } from "#lib/room/character-panel.svelte";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    roomCode: string;
    stagingThemeId?: string | null;
    onPreviewSound?: ((soundId: string) => void) | null;
    /** Called just before the join so the route can prime audio from the user gesture. */
    onBeforeJoin?: (() => void) | null;
  };
  let {
    store,
    roomCode,
    stagingThemeId = null,
    onPreviewSound = null,
    onBeforeJoin = null,
  }: Props = $props();

  const view = $derived(store.view);
  const regions = $derived(preGameRegionsFor(view));
  // WHICH ROOM IS THIS, REALLY. A simulated room looks exactly like a real one - that is the
  // point of the seam - so the one screen where somebody is about to invite their friends says
  // out loud which one they are standing in, and a real room says when it has lost the thread.
  // `store.mode` is the programmatic answer any surface can ask for (#lib/room/room-store.ts).
  const roomNote = $derived.by(() => {
    if (store.mode === "local-sim") return "Demo room - this tab only";
    if (view.connection === "reconnecting") return "Reconnecting...";
    if (view.connection === "closed") return "Disconnected";
    return null;
  });
  const me = $derived(myPlayer(view));
  // A courtesy check, never the gate: the room refuses on join regardless. It exists so nobody
  // fills in a name and picks a creature only to be turned away by a fact that was true all
  // along (#lib/room/room-refusal.ts).
  const blocked = $derived(joinBlock(view));

  // The draft is the ONLY screen state here, and it is not a position - it is the answer to
  // "what would I join as", kept until there is a seat to attach it to. Once seated the panel
  // reads the roster instead and every edit goes straight to the room.
  let draft = $state<CharacterDraft>({
    nickname: "",
    avatarId: avatarManifest.avatars[0]?.id ?? null,
    accentId: avatarManifest.accents[0]?.id ?? "gold",
    buzzSoundId: null,
    skinToneId: null,
  });
  let attempted = $state(false);

  // The seated name needs a buffer of its own, and the reason is a real bug without one: a
  // nickname below the minimum length is not sent to the room, so if the field showed the
  // ROOM's copy it would snap back to the old name the moment you cleared it to retype. This
  // adopts whatever the room says whenever the room's answer actually changes - on join, on
  // resume, and when the host renames you - and otherwise holds what is being typed.
  let seatedNickname = $state("");
  $effect(() => {
    const roomName = me?.nickname;
    if (roomName !== undefined) seatedNickname = roomName;
  });

  const character = $derived<CharacterDraft>(
    me === null
      ? draft
      : {
          nickname: seatedNickname,
          avatarId: me.avatarId,
          accentId: me.accentId ?? avatarManifest.accents[0]?.id ?? "gold",
          buzzSoundId: me.buzzSoundId,
          skinToneId: me.skinToneId,
        },
  );

  const nameReady = $derived(character.nickname.trim().length >= limits.player.nicknameMinLength);
  const nameProblem = $derived(
    attempted && !nameReady && !regions.seated ? "Tell us what to call you first" : null,
  );

  function changeCharacter(patch: Partial<CharacterDraft>): void {
    if (regions.seated) {
      // Live: forward straight to the room. The nickname is held back until it is long enough
      // to be legal, so clearing the field to retype it never sends an empty name to the
      // roster - the buffer above is what keeps the field showing the half-typed one meanwhile.
      const { nickname, ...rest } = patch;
      if (nickname !== undefined) seatedNickname = nickname;
      const sendable =
        nickname !== undefined && nickname.trim().length >= limits.player.nicknameMinLength
          ? { ...rest, nickname: nickname.trim() }
          : rest;
      if (Object.keys(sendable).length > 0) store.updateIdentity(sendable);
      return;
    }
    draft = { ...draft, ...patch };
  }

  function join(): void {
    attempted = true;
    if (blocked !== null || regions.seated || !nameReady) return;
    onBeforeJoin?.();
    store.join({
      nickname: uniqueNickname(
        draft.nickname.trim(),
        view.roster.players.map((player) => player.nickname),
      ),
      avatarId: draft.avatarId,
      accentId: draft.accentId,
      buzzSoundId: draft.buzzSoundId,
      skinToneId: draft.skinToneId,
      // Deliberately joined WITHOUT a team, even in teams mode: the teams region is right
      // there and boarding one is a visible move across the staged lobby that the whole room
      // sees. Bundling a team into the join would make people appear already aboard.
    });
  }
</script>

<div class="pre-game" data-seated={regions.seated} data-teams-mode={regions.teams.shown}>
  <!-- The same header bar the front door wears (#lib/chrome/app-bar.svelte). It used to be a
       room line with a lone "home" button floated to the far right, which read as a stray
       control rather than as chrome and made a room's top-of-page a different object from the
       front door's (owner, 2026-08-19). The wordmark IS the way home now, so the button is
       gone rather than moved - one control, one place, on every surface. -->
  <AppBar>
    {#snippet trailing()}
      <p class="room-line">
        Room <strong>{roomCode}</strong>
        {#if roomNote !== null}<span class="room-note" role="status">{roomNote}</span>{/if}
      </p>
    {/snippet}
  </AppBar>

  <div class="pre-game-body">
    <div class="regions">
    <div class="region region-character">
      <CharacterPanel
        value={character}
        mode={regions.identityMode}
        teamsMode={regions.teams.shown}
        {nameProblem}
        onChange={changeCharacter}
        onPreviewSound={onPreviewSound}
        onSubmit={join}
      />
    </div>

    <div class="region region-teams">
      {#if regions.teams.shown}
        <TeamsPanel {store} {regions} {stagingThemeId} />
      {:else}
        <!-- Individuals mode still gets the region, saying what it is instead of leaving a
             hole where the teams would be on a room that has them. -->
        <section class="solo-note" aria-label="Teams">
          <h2 class="region-heading">Teams</h2>
          <p>This room plays as individuals - everyone buzzes for themselves.</p>
        </section>
      {/if}
    </div>

    <div class="region region-roster">
      <RosterPanel
        {view}
        {regions}
        {stagingThemeId}
        onPractice={() => {
          onPreviewSound?.(me?.buzzSoundId ?? "");
        }}
      />
    </div>
  </div>

    <!-- Sticky on a phone because the regions are long and the way in should never be a scroll
         away; a static footer on a laptop, where it always is. It stays MOUNTED after joining
         and becomes the confirmation line - removing it would be a region disappearing. -->
    <div class="action-bar">
    {#if blocked !== null && !regions.seated}
      <p class="refusal" role="status">
        <strong>{blocked.headline}</strong>
        {#if blocked.advice !== null}<span>{blocked.advice}</span>{/if}
      </p>
    {/if}
    {#if regions.seated}
      <p class="seated-line" role="status">
        You are in as <strong>{me?.nickname}</strong>
        {#if regions.teams.hasTeam}
          on <strong
            >{view.roster.teams.find((team) => team.teamId === regions.teams.myTeamId)?.name}</strong
          >
        {/if}
        - change anything above whenever you like.
      </p>
    {:else}
      <button type="button" class="primary" disabled={blocked !== null} onclick={join}>
        {blocked === null ? (regions.lateJoin ? "Join the game" : "Join the room") : "Waiting for a seat"}
      </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .pre-game {
    /* A container so the columns answer to the SPACE THIS SURFACE HAS, not to the device.
       A phone-width window on a 27-inch monitor gets the phone layout, which is the honest
       answer and the one a media query gets wrong. */
    container-type: inline-size;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    color: var(--surface-text);
  }

  /* The bar is full-bleed - it is the page's own top edge, exactly as it is on the front door -
     so the surface's inset lives here rather than on .pre-game. */
  .pre-game-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 0.8rem 1rem max(0.8rem, env(safe-area-inset-bottom));
  }

  /* Pushed to the far end of the bar, where a room's identity belongs beside the wordmark. */
  .room-line {
    margin-left: auto;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.8rem;
    color: var(--surface-text-muted);
  }

  .room-line strong {
    color: var(--board-value-color);
  }

  .room-note {
    margin-left: 0.6rem;
    color: var(--surface-text-muted);
    letter-spacing: 0.08em;
  }

  /* PHONE: one column, character first (it is the thing you came to do), then teams, then who
     is here. Nothing is hidden - the page simply scrolls. */
  .regions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.4rem;
    max-width: 34rem;
    width: 100%;
    margin: 0 auto;
    flex: 1;
  }

  .region {
    min-width: 0;
  }

  .region-heading {
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 5vw, 1.9rem);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 0.4rem;
  }

  .solo-note p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--surface-text-muted);
  }

  .action-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 34rem;
    margin: 0.6rem auto 0;
    padding: 0.75rem 0 max(0.5rem, env(safe-area-inset-bottom));
    background: linear-gradient(transparent, var(--surface-page) 35%);
  }

  .primary {
    flex: 1;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1.15rem;
    padding: 0.9rem 1rem;
    border: none;
    border-radius: var(--board-radius);
    background: var(--accent);
    color: var(--surface-page);
    cursor: pointer;
  }

  .primary:disabled {
    background: var(--surface-border);
    color: var(--surface-text-muted);
    cursor: default;
  }

  .seated-line {
    margin: 0;
    font-size: 0.92rem;
    color: var(--surface-text-muted);
    text-align: center;
  }

  .seated-line strong {
    color: var(--surface-text);
  }

  .refusal {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0 0 0.6rem;
    font-family: var(--font-chrome);
    font-size: 0.9rem;
  }

  .refusal span {
    color: var(--surface-text-muted);
    font-size: 0.85em;
  }

  .primary:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  /* TABLET / SMALL LAPTOP: two columns. The teams region is the one that benefits most from
     width (a grid of cards plus the staged lobby), so it takes the wider track and the roster
     tucks under the character panel. */
  @container (min-width: 48rem) {
    .regions {
      max-width: 62rem;
      grid-template-columns: minmax(17rem, 22rem) minmax(0, 1fr);
      grid-template-areas:
        "character teams"
        "roster    teams";
      align-content: start;
      column-gap: 2rem;
    }

    .region-character {
      grid-area: character;
    }

    .region-teams {
      grid-area: teams;
    }

    .region-roster {
      grid-area: roster;
    }

    .action-bar {
      max-width: 62rem;
    }
  }

  /* LAPTOP AND UP: the three columns the decision asks for - character beside teams beside
     roster, all visible at once, no scrolling to see the room you are joining. */
  @container (min-width: 64rem) {
    .regions {
      max-width: 90rem;
      grid-template-columns: minmax(18rem, 23rem) minmax(0, 1fr) minmax(14rem, 20rem);
      grid-template-areas: "character teams roster";
      column-gap: 2.2rem;
    }

    .region-character {
      /* A laptop has the room for a preview you can actually see the walk cycle in. */
      --character-preview-size: 190px;
    }

    .region-roster {
      display: flex;
      flex-direction: column;
    }

    .action-bar {
      position: static;
      max-width: 90rem;
      flex-direction: row;
      justify-content: flex-end;
      align-items: center;
      gap: 1rem;
      background: none;
      border-top: 1px solid var(--surface-border);
      margin-top: 1.2rem;
    }

    .primary {
      flex: 0 0 auto;
      min-width: 16rem;
    }

    .seated-line {
      text-align: right;
    }
  }
</style>
