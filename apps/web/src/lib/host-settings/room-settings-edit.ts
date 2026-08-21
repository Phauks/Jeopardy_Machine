// ROOM SETTINGS, as the host's cog edits them - the other half of the panel, and the half that
// is not this laptop's business at all.
//
// Everything here ends up as a `RoomSettingsPatch` (packages/protocol/src/room/room-settings.ts)
// travelling to the DO, which broadcasts the whole settings object back to every connection.
// That round trip is the point of the distinction the panel draws: turning streamer mode on
// makes the join code vanish from the projector in the room, from a spectator's phone, and from
// anyone's screenshot - it is not a thing the host's laptop decides for itself.
//
// The DO is the authority and refuses with its own reasons (`settingsRejectionSchema`). This
// module is the console's courtesy check, in the same spirit as room-refusal.ts's `joinBlock`:
// it stops a host from sending an edit that is going to bounce, and says why in English, rather
// than letting them press the button and watch nothing happen mid-game.
import type { RoomSettingsPatch, SettingsRejection } from "@jeopardy/protocol/room/room-settings";
import type { RoomView } from "#lib/room/room-view.ts";

/**
 * An empty value is a real state (an unnamed room), and it needs a word: without one the
 * pending line reads "title  -> Compost Quiz" and a host has to guess what the gap meant.
 */
function spokenValue(value: string): string {
  return value.trim().length === 0 ? "(none)" : value;
}

export type SettingsRefusalCopy = {
  reason: SettingsRejection;
  headline: string;
  advice: string;
};

/** Exhaustive: a reason added to the protocol enum fails to compile rather than going silent. */
export function settingsRejectionCopy(reason: SettingsRejection): SettingsRefusalCopy {
  switch (reason) {
    case "title-required":
      return {
        reason,
        headline: "Room name required",
        advice: "Add a room name before making this room public.",
      };
    case "below-current":
      return {
        reason,
        headline: "That cap is below the people already here",
        advice: "Nobody is ever removed by a settings change. Lower it once they have left.",
      };
  }
}

/**
 * Would the room refuse this edit? Null means send it.
 *
 * Deliberately the same two rules the room enforces, and no others: a console that invented a
 * third would be a second rulebook to keep in step. `maxSpectators` is not checked because only
 * the DO can count spectators - they hold no roster seat - so that one is left to bounce.
 */
export function roomSettingsRefusal(
  patch: RoomSettingsPatch,
  view: RoomView,
): SettingsRefusalCopy | null {
  const title = patch.title ?? view.settings.title;
  if ((patch.listing ?? view.settings.listing) === "public" && title.trim().length === 0) {
    return settingsRejectionCopy("title-required");
  }
  if (patch.maxPlayers !== undefined && patch.maxPlayers < view.roster.players.length) {
    return settingsRejectionCopy("below-current");
  }
  return null;
}

/**
 * What a typed room setting would CHANGE, in words, or null when it would change nothing.
 *
 * This exists because of one piece of owner feedback (2026-08-17): "I don't understand SAVE
 * CAPS". A button labelled with a verb and a noun tells a host what it is called, not what it
 * would do to their room - and the room half of the panel is the half where a mistaken press
 * reaches every phone. So the panel states the pending edit ("player cap 30 -> 24") beside the
 * button, and the button is dead until there is one. Same shape for both typed groups, because
 * both have the same problem: a value being typed must not reach the room letter by letter, so
 * they are the only controls in the panel that need a deliberate press at all.
 */
export function pendingChangeSummary(
  changes: { label: string; from: string; to: string }[],
): string | null {
  const real = changes.filter((change) => change.from !== change.to);
  if (real.length === 0) return null;
  return real
    .map((change) => `${change.label} ${spokenValue(change.from)} -> ${spokenValue(change.to)}`)
    .join(", ");
}

/** The caps a host has typed, against the caps the room is running - null when identical. */
export function pendingCapsSummary(
  view: RoomView,
  draft: { maxPlayers: number; maxSpectators: number },
): string | null {
  return pendingChangeSummary([
    {
      label: "player cap",
      from: String(view.settings.maxPlayers),
      to: String(Math.round(draft.maxPlayers)),
    },
    {
      label: "spectator cap",
      from: String(view.settings.maxSpectators),
      to: String(Math.round(draft.maxSpectators)),
    },
  ]);
}

/** The room's name/host label a host has typed, against the room's - null when identical. */
export function pendingNameSummary(
  view: RoomView,
  draft: { title: string; hostLabel: string },
): string | null {
  return pendingChangeSummary([
    { label: "title", from: view.settings.title, to: draft.title },
    { label: "hosted by", from: view.settings.hostLabel, to: draft.hostLabel },
  ]);
}

/**
 * The room's settings as one line of chrome for the panel header - what a host glances at to
 * know what they have got before they change anything.
 */
export function roomSettingsSummary(view: RoomView): string {
  // Never a plausible-looking line about a room nobody has heard from yet (room-view.ts,
  // `settingsKnown`): the console would be reporting the protocol's defaults as this room's.
  if (!view.settingsKnown) return "Waiting for the room to report its settings";
  const settings = view.settings;
  const parts = [
    settings.listing === "public" ? "Public" : "Private",
    `${String(view.roster.players.length)}/${String(settings.maxPlayers)} players`,
    settings.spectatorsAllowed ? `up to ${String(settings.maxSpectators)} watching` : "no audience",
  ];
  if (settings.hideJoinCode) parts.push("code hidden");
  return parts.join(" · ");
}
