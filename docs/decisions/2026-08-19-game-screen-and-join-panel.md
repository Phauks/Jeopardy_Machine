# 2026-08-19 - The game screen, and getting people into the room

## What the owner reported

> "mirror mode only works when it is the display, but when not in mirror mode, we need a way to generate the screen that will be used for the gameplay. host console should have better join ability. for example, a link that can be shared, the qr code, bigger version of the code."

And, on the lobby the first fix landed in:

> "pre-flight and roster look the exact same, what was the benefit? They should be combined or not exist separately."

## The diagnosis

Two of the three things a host does in the first five minutes had no home on the console.

**Putting the game on the projector.** Mirror mode (C1b) shipped as a checkbox in the cog, and it answers exactly one setup: the laptop screen IS the projector. The other setup - laptop on the podium, projector as a second output, which is the ordinary one - was a URL a host had to know, printed as a hint in a checklist: `open /room/BQKX7/display on the projector`. That is not a feature, it is documentation on a screen. Worse, nothing on the console knew whether a display existed, so the 2026-08-16 host-loop walk's footgun (start a game with nothing attached and the room stares at a desktop) had no instrument that could have caught it.

**Getting people in.** The code and the QR lived on the display alone. A host with no projector yet, a latecomer at the door, a group chat that needs a link - all of them needed the code to be on the host's own screen, and it was not.

## The decisions

**1. One question with two answers, asked once.** `DevicePreferences.mirror` (boolean) becomes `screenSetup: "second-screen" | "mirror"`, and the console asks it outright on a **Game screen** panel with the action for each answer attached: second screen gets **Open game screen**, mirror gets nothing to open because this laptop already is one. The cog carries the same control. The storage key bumps to `v2` rather than migrating, which is what that module has always said it would do for a shape change.

**2. The opened window is tracked, not assumed.** `window.open` with a per-room window name and popup features (a tab cannot be dragged to a second output; `noopener` would throw away the handle we need). Three states - `never-opened`, `open`, `closed` - and `closed` stays separate from `never-opened` on purpose: "you had a game screen and it is gone" is precisely the state a host cannot see, because the window that vanished was on the other screen. Detection is a slow poll of `window.closed`, since a closing popup fires nothing reliable at its opener. Closing the console never closes the display: the display is an independent client of the room, and outliving its opener is the point.

**3. The room's census outranks our own window.** `RoomView` gains `connections` - the protocol's `ConnectionCensus`, counts by role and never people - because a Chromecast, a co-host's laptop or a second projector is a real game screen this console never opened. It is `null` when the store cannot know, which is the honest answer in mock mode (one isolated room per tab), and the window handle is the fallback. The ws store's null is a documented wiring point, not a gap.

**4. Warn before starting, never block.** `startReadiness()` separates the two failures: an empty room is REFUSED (the engine has nobody to seat), and a room with no game screen is WARNED once and then started anyway on the next press. Running a small room off one laptop is legitimate, and so is a projector that is thirty seconds from being plugged in.

**5. The join panel, in place.** Room code at value-face size, QR big enough to scan from a few feet, join link with Share (Web Share API - the phone-to-phone path into a group chat, and the only one that reaches somebody who is not in the room) and Copy, plus a **Show fullscreen** state for holding the laptop up to a room. It is a rail beside the console and a state change of one element, never a page: the persistent-layout law, which also gets it the reserved-space treatment for the share outcome line.

**6. STREAMER MODE INVERTS ON THE CONSOLE, and this is stated in three places.** `hideJoinCode` means "stop broadcasting the code on SHARED surfaces" (docs/decisions/2026-08-14-room-controls-and-staging.md). The display is the shared surface: it drops the code, the QR and the URL from its markup entirely. The console is the host's own private screen - it already renders every clue's answer, so a room that can read this panel can read those - and a streaming host still has to admit latecomers. So the console KEEPS all three and labels them "hidden on the game screen and every shared surface". Hiding them there would protect nothing and would break the one thing streamer mode is not about.

**7. One place per fact - the Pre-flight panel is deleted.** It listed players in, teams, connected, and the display URL, next to the roster that already answered the first three. The persistent-layout law applies to information as much as to layout: the roster owns who is here (by name, with connection health), the game-screen panel owns what the room can see, and **Start game** moves into the console's chrome as an action with its readiness attached. No flag, no fallback - the panel and its styles are gone (no-legacy directive).

## What this does not do

- No host companion view yet (the mirrored setup's private layer still lives on paper or a second device - C1b's open item).
- No rename/kick/drag-to-rebalance on the console roster: that is roster-mutation UI and belongs to its own pass. The panel is informational.
- The census is only as live as the store: in mock mode the sim panel's "Plug in a display" is what produces one, and the real counts arrive with the M3 reconcile.
