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
        headline: "A public room needs a name",
        advice: "Give the game a title first - an unnamed row in the browser is not an invitation.",
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
 * The room's settings as one line of chrome for the panel header - what a host glances at to
 * know what they have got before they change anything.
 */
export function roomSettingsSummary(view: RoomView): string {
  const settings = view.settings;
  const parts = [
    settings.listing === "public" ? "Public" : "Private",
    settings.entry === "password" ? "password" : "open",
    `${String(view.roster.players.length)}/${String(settings.maxPlayers)} players`,
    settings.spectatorsAllowed ? `up to ${String(settings.maxSpectators)} watching` : "no audience",
  ];
  if (settings.hideJoinCode) parts.push("code hidden");
  return parts.join(" · ");
}
