// The cog: the two kinds of setting, and the promise that they behave differently.
//
// The load-bearing assertions here are the ones about SEPARATION - a device preference must
// never reach the room, a room setting must never be a local view option, and the two type
// scales must move independently. Everything else in the panel is a control; those two things
// are the design (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md).
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import HostConsole from "#lib/room/host-console.svelte";
import SettingsPanel from "#lib/host-settings/settings-panel.svelte";
import { DevicePreferencesStore } from "#lib/host-settings/device-preferences.svelte.ts";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import {
  defaultDevicePreferences,
  maximumTypeScale,
  minimumTypeScale,
  normalizeTypeScale,
  parseDevicePreferences,
  preferencesKey,
  serializeDevicePreferences,
  typeScaleLabel,
  typeScaleStyle,
} from "#lib/host-settings/device-preferences.ts";
import {
  pendingCapsSummary,
  pendingNameSummary,
  roomSettingsRefusal,
  roomSettingsSummary,
  settingsRejectionCopy,
} from "#lib/host-settings/room-settings-edit.ts";
import type { RoomStore } from "#lib/room/room-store.ts";

function hostStore(): LocalSimRoomStore {
  return new LocalSimRoomStore({ roomCode: "TESTA", role: "host", seed: "settings" });
}

/** A localStorage stand-in, so the store's persistence is testable without a browser. */
function fakeStorage(seed: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    length: data.size,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
  } as Storage & { data: Map<string, string> };
}

describe("per-surface type scale", () => {
  it("moves the display and the console independently - the whole point of the pair", () => {
    const preferences = new DevicePreferencesStore();
    preferences.attach(fakeStorage());
    preferences.update({ displayTypeScale: 1.5 });
    expect(preferences.current.displayTypeScale).toBe(1.5);
    expect(preferences.current.consoleTypeScale).toBe(1);
    preferences.update({ consoleTypeScale: 0.9 });
    expect(preferences.current.displayTypeScale).toBe(1.5);
    expect(preferences.current.consoleTypeScale).toBe(0.9);
    // ...and each becomes its own scoped token, which is how one surface grows and the other
    // does not (src/lib/theme/tokens.css multiplies its type by --type-scale).
    expect(typeScaleStyle(preferences.current.displayTypeScale)).toBe("--type-scale: 1.5");
    expect(typeScaleStyle(preferences.current.consoleTypeScale)).toBe("--type-scale: 0.9");
  });

  it("clamps to a range a host cannot make the console unusable with", () => {
    expect(normalizeTypeScale(9)).toBe(maximumTypeScale);
    expect(normalizeTypeScale(0.01)).toBe(minimumTypeScale);
    expect(normalizeTypeScale(Number.NaN)).toBe(1);
    // Stepped, so a stored float never comes back as a jittering slider.
    expect(normalizeTypeScale(1.234)).toBe(1.25);
    expect(typeScaleLabel(1.25)).toBe("125%");
  });

  it("survives a reload, because it is a property of the laptop and not of the game", () => {
    const storage = fakeStorage();
    const first = new DevicePreferencesStore();
    first.attach(storage);
    first.update({ displayTypeScale: 1.4, consoleAudio: true, stageMotion: "off" });

    const second = new DevicePreferencesStore();
    second.attach(storage);
    expect(second.current.displayTypeScale).toBe(1.4);
    expect(second.current.consoleAudio).toBe(true);
    expect(second.current.stageMotion).toBe("off");
  });

  it("writes ONE document under one key - which is what lets the display window read it", () => {
    // The C1 setup is two tabs of one browser: console on the laptop, display on the
    // projector. The display route re-reads this key on the `storage` event, so the host's
    // "display text size" reaches the projector with nothing going near the room.
    const storage = fakeStorage();
    const preferences = new DevicePreferencesStore();
    preferences.attach(storage);
    preferences.update({ displayTypeScale: 1.6 });
    expect([...storage.data.keys()]).toEqual([preferencesKey]);
    expect(parseDevicePreferences(storage.data.get(preferencesKey) ?? null).displayTypeScale).toBe(
      1.6,
    );
  });
});

describe("stored preferences are read tolerantly", () => {
  it("falls back per field, so one bad value costs one setting rather than all of them", () => {
    const parsed = parseDevicePreferences(
      JSON.stringify({ displayTypeScale: "huge", consoleTypeScale: 1.2, rosterDensity: "wat" }),
    );
    expect(parsed.displayTypeScale).toBe(1);
    expect(parsed.consoleTypeScale).toBe(1.2);
    expect(parsed.rosterDensity).toBe("comfortable");
  });

  it("never throws on nonsense - a host mid-game must not meet a crash from a read", () => {
    expect(parseDevicePreferences("not json")).toEqual(defaultDevicePreferences);
    expect(parseDevicePreferences(null)).toEqual(defaultDevicePreferences);
    expect(parseDevicePreferences("[]")).toEqual(defaultDevicePreferences);
    expect(parseDevicePreferences(serializeDevicePreferences(defaultDevicePreferences))).toEqual(
      defaultDevicePreferences,
    );
  });

  it("keeps working when the browser refuses storage entirely", () => {
    const preferences = new DevicePreferencesStore();
    preferences.attach(null);
    preferences.update({ consoleTypeScale: 1.3 });
    expect(preferences.current.consoleTypeScale).toBe(1.3);
  });

  it("resets to the shipped defaults", () => {
    const preferences = new DevicePreferencesStore();
    preferences.attach(fakeStorage());
    preferences.update({ screenSetup: "mirror", displayTypeScale: 1.8, manualMode: true });
    preferences.reset();
    expect(preferences.current).toEqual(defaultDevicePreferences);
  });
});

describe("device preferences never touch the room", () => {
  it("changes nothing about the room's own settings", () => {
    const store = hostStore();
    const before = { ...store.view.settings };
    const preferences = new DevicePreferencesStore();
    preferences.attach(fakeStorage());
    preferences.update({
      displayTypeScale: 1.7,
      consoleTypeScale: 1.3,
      screenSetup: "mirror",
      manualMode: true,
      displayAudio: false,
      stageMotion: "off",
      rosterDensity: "compact",
    });
    expect(store.view.settings).toEqual(before);
  });

  it("and a room setting changes the room for everybody, not this device", () => {
    const store = hostStore();
    expect(store.view.settings.hideJoinCode).toBe(false);
    store.updateRoomSettings({ hideJoinCode: true });
    expect(store.view.settings.hideJoinCode).toBe(true);
    // The display is a different connection to the same room; streamer mode reaches it, and
    // the code is not in its markup at all (the template branch, not a CSS rule).
    const display = new LocalSimRoomStore({
      roomCode: "TESTA",
      role: "display",
      seed: "settings",
      settings: { hideJoinCode: true },
    });
    expect(display.view.settings.hideJoinCode).toBe(true);
  });
});

describe("room settings the console edits", () => {
  it("applies a sparse patch and leaves everything else alone", () => {
    const store = hostStore();
    store.updateRoomSettings({ maxPlayers: 40, spectatorsAllowed: false });
    expect(store.view.settings.maxPlayers).toBe(40);
    expect(store.view.settings.spectatorsAllowed).toBe(false);
    expect(store.view.settings.listing).toBe("private");
  });

  it("has no password to set: the code is what admits people (2026-08-20)", () => {
    // The settings a room broadcasts are all public now - there is no field in them that could
    // be a secret, which is why the whole object travels to every phone and the projector.
    const store = hostStore();
    expect(Object.keys(store.view.settings)).not.toContain("entry");
    expect(Object.keys(store.view.settings)).not.toContain("password");
  });

  it("refuses a public room with no name, in the room's own vocabulary", () => {
    const store = hostStore();
    const refusal = roomSettingsRefusal({ listing: "public" }, store.view);
    expect(refusal?.reason).toBe("title-required");
    // ...and the store refuses the same edit, so the console's check is a courtesy and not
    // the only thing standing between a host and a nameless public room.
    store.updateRoomSettings({ listing: "public" });
    expect(store.view.settings.listing).toBe("private");
    store.updateRoomSettings({ listing: "public", title: "Compost Quiz" });
    expect(store.view.settings.listing).toBe("public");
    expect(roomSettingsRefusal({ listing: "public" }, store.view)).toBeNull();
  });

  it("refuses a cap below the people already in the room - nobody is ejected by a setting", () => {
    const store = hostStore();
    const count = store.view.roster.players.length;
    expect(roomSettingsRefusal({ maxPlayers: count - 1 }, store.view)?.reason).toBe(
      "below-current",
    );
    store.updateRoomSettings({ maxPlayers: count - 1 });
    expect(store.view.settings.maxPlayers).not.toBe(count - 1);
    expect(roomSettingsRefusal({ maxPlayers: count + 5 }, store.view)).toBeNull();
  });

  it("says both refusals in English, exhaustively", () => {
    for (const reason of ["title-required", "below-current"] as const) {
      const copy = settingsRejectionCopy(reason);
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.advice.length).toBeGreaterThan(0);
    }
  });

  it("summarises the room in one line of chrome", () => {
    const store = hostStore();
    store.updateRoomSettings({ hideJoinCode: true });
    const summary = roomSettingsSummary(store.view);
    expect(summary).toContain("Private");
    expect(summary).toContain("code hidden");
    expect(summary).toContain(`${String(store.view.roster.players.length)}/`);
  });
});

describe("the panel itself", () => {
  const preferences = new DevicePreferencesStore();

  function panel(store: LocalSimRoomStore): string {
    return render(SettingsPanel, {
      props: { store, preferences, onClose: () => undefined },
    }).body;
  }

  it("labels the two halves so a host can never confuse local with everybody", () => {
    const body = panel(hostStore());
    expect(body).toContain("This device");
    expect(body).toContain("This room");
    expect(body).toContain(">local<");
    expect(body).toContain(">everyone<");
    expect(body).toContain("Only this laptop");
    expect(body).toContain("Every change reaches every phone");
  });

  it("carries both type scales, each with a live readout", () => {
    const body = panel(hostStore());
    expect(body).toContain("Display text size");
    expect(body).toContain("Console text size");
    // The display control previews at the display's own scale, on the console.
    expect(body).toContain("display-preview");
  });

  it("holds the mid-game device controls the host loop actually calls for", () => {
    const body = panel(hostStore());
    for (const control of [
      "Room audio on this device",
      "Volume",
      // ONE control for the two setups, not a lone mirror checkbox (2026-08-19): the panel asks
      // how the room sees the game, and the console's game-screen panel acts on the answer.
      "How the room sees this game",
      "Second screen (projector or TV)",
      "Mirror this screen",
      "Manual mode",
      "Show timers",
      "Roster density",
      "Stage",
    ]) {
      expect(body, control).toContain(control);
    }
  });

  it("holds the room controls that already exist server-side", () => {
    const body = panel(hostStore());
    for (const control of [
      "Streamer mode",
      "Listing",
      "Game title",
      "Player cap",
      "Spectator cap",
      "Allow spectators",
    ]) {
      expect(body, control).toContain(control);
    }
  });

  it("puts the code REVEAL here and nowhere else while streamer mode is on", () => {
    const open = hostStore();
    expect(panel(open)).not.toContain("Show me the code");
    const streaming = hostStore();
    streaming.updateRoomSettings({ hideJoinCode: true });
    // A reveal button on the streamed display would defeat the setting; it belongs on the
    // host's own screen (docs/decisions/2026-08-14-room-controls-and-staging.md).
    expect(panel(streaming)).toContain("Show me the code");
  });
});

describe("what SAVE CAPS became", () => {
  // Owner, 2026-08-17: "I don't understand SAVE CAPS". The button now names its effect, and the
  // panel states the pending edit in the room's own units before it is sent.
  it("states the pending edit rather than naming the button", () => {
    const store = hostStore();
    const current = store.view.settings;
    expect(
      pendingCapsSummary(store.view, {
        maxPlayers: current.maxPlayers,
        maxSpectators: current.maxSpectators,
      }),
      "nothing typed = nothing pending, and the button is dead",
    ).toBeNull();
    expect(
      pendingCapsSummary(store.view, { maxPlayers: 24, maxSpectators: current.maxSpectators }),
    ).toBe(`player cap ${String(current.maxPlayers)} -> 24`);
    expect(pendingCapsSummary(store.view, { maxPlayers: 24, maxSpectators: 5 })).toContain(
      "spectator cap",
    );
  });

  it("does the same for the room's name, which has the same wait-for-Apply reason", () => {
    const store = hostStore();
    expect(
      pendingNameSummary(store.view, { title: "", hostLabel: "" }),
      "the fixture room is unnamed, so an unedited draft is not a change",
    ).toBeNull();
    expect(pendingNameSummary(store.view, { title: "Compost Quiz", hostLabel: "" })).toBe(
      "title (none) -> Compost Quiz",
    );
  });

  it("renders as an action with a scope, beside the room's current numbers", () => {
    const store = hostStore();
    const preferences = new DevicePreferencesStore();
    const body = render(SettingsPanel, {
      props: { store, preferences, onClose: () => undefined },
    }).body;
    expect(body).not.toContain("Save caps");
    expect(body).toContain("Apply caps to the room");
    expect(body).toContain("How many people fit");
    expect(body).toContain("Right now:");
    // And the panel says out loud which controls wait for an Apply and which do not.
    expect(body).toContain("Switches take effect the moment you flip them");
    // Nothing is pending on first render, so the Apply is disabled rather than inviting.
    expect(body).toContain("disabled");
    expect(body).not.toContain("Not applied yet");
  });
});

describe("a room the console has not heard from", () => {
  it("says so instead of drawing the protocol's defaults as this room's settings", () => {
    // The ws store starts blind (settingsKnown: false) and the panel must not present its shell
    // values as the room's (owner, 2026-08-17: "I don't think the room I created shows the
    // correct settings").
    const store = hostStore();
    const blind = {
      mode: "ws",
      view: { ...store.view, settingsKnown: false },
    } as unknown as RoomStore;
    const preferences = new DevicePreferencesStore();
    const body = render(SettingsPanel, {
      props: { store: blind, preferences, onClose: () => undefined },
    }).body;
    expect(body).toContain("has not heard the room's settings yet");
    expect(roomSettingsSummary(blind.view)).toBe("Waiting for the room to report its settings");
    // No editable room controls at all while the room is unknown - and the DEVICE half, which
    // owes nothing to the room, keeps working.
    expect(body).not.toContain("Apply caps to the room");
    expect(body).not.toContain("Streamer mode");
    expect(body).toContain("Display text size");
  });
});

// REWRITTEN 2026-08-20, with the rails that these tests were about. Settings used to be a
// COG in the header opening a rail on the right, and "is it open" was a boolean this suite
// asserted through markup presence. It is a section of the left dock now
// (#lib/room/dock-section.svelte), which is a <details> - so the content is always in the
// markup, whether or not the section is expanded, and the state lives on the element.
//
// That is not a weaker test, it is a test of the right thing: the reason the rail existed was
// that opening settings must not take the board away, and a dock section makes that
// structural rather than something to remember.
describe("settings live in the dock, never on a screen of their own", () => {
  it("keeps the whole console rendered beside the panel", () => {
    const store = hostStore();
    store.startGame();
    store.selectCell(0, 0);
    const body = render(HostConsole, {
      props: { store, mirror: false, showSimPanel: false, settingsOpen: true },
    }).body;
    // The persistent-layout law: the board, the answer and the judge row are all still there.
    expect(body).toContain("Board minimap");
    expect(body).toContain("Topsy-Turvy National Park");
    expect(body).toContain("No penalty");
    expect(body).toContain("Host settings");
    expect(body).toContain("console-body");
  });

  it("is COLLAPSED by default once a game is running - the board is the job then", () => {
    const store = hostStore();
    store.startGame();
    const body = render(HostConsole, { props: { store } }).body;
    // The section exists and is shut. `open` is the disclosure's own state, so its absence on
    // this section is the assertion - not the absence of the content, which <details> always
    // renders so that find-in-page can reach it.
    const section = body.slice(body.indexOf("Room and this device") - 400);
    expect(section).toContain("Room and this device");
    expect(body).toContain('<details class="dock-section');
  });

  it("opens on request without the board going anywhere", () => {
    const store = hostStore();
    store.startGame();
    const body = render(HostConsole, { props: { store, settingsOpen: true } }).body;
    expect(body).toContain("open");
    expect(body).toContain("Board minimap");
  });
});
