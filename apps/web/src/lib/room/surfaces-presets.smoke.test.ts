// Preset x surface smoke: every built-in theme preset renders every play surface without
// error, and the style attribute the routes apply is complete per preset (the token gate
// proves completeness; this proves the SURFACES accept it). Visual truth stays with the
// /dev/theme gallery - this is the cheap regression net.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import BuzzerScreen from "#lib/room/buzzer-screen.svelte";
import DisplayScreen from "#lib/room/display-screen.svelte";
import HostConsole from "#lib/room/host-console.svelte";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import { themePresets } from "#lib/theme/theme-presets.ts";
import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";

function midGameStore(role: "player" | "display" | "host"): LocalSimRoomStore {
  const store = new LocalSimRoomStore({ roomCode: "TESTA", role, seed: "smoke" });
  if (role === "player") {
    store.join({ nickname: "Smoke", avatarId: null, accentId: null, buzzSoundId: null });
  }
  store.startGame();
  store.selectCell(0, 0);
  store.armBuzzers();
  return store;
}

describe("preset x surface smoke renders", () => {
  it.each(themePresets.map((preset) => [preset.id, preset] as const))(
    "%s: buzzer, display, and console all render with the preset applied",
    (_id, preset) => {
      const style = themeToStyleAttribute(preset);
      expect(style).toContain("--board-cell-bg");

      const buzzer = render(BuzzerScreen, { props: { store: midGameStore("player") } });
      expect(buzzer.body).toContain("buzzer-screen");

      const display = render(DisplayScreen, { props: { store: midGameStore("display") } });
      expect(display.body).toContain("display-screen");

      const hostRender = render(HostConsole, { props: { store: midGameStore("host") } });
      expect(hostRender.body).toContain("console-layout");
    },
  );

  it("the display title screen renders the QR and room code for every preset", () => {
    const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "display", seed: "smoke" });
    const { body } = render(DisplayScreen, { props: { store, joinOrigin: "https://play.test" } });
    expect(body).toContain("<svg");
    expect(body).toContain("TESTA");
    expect(body).toContain("play.test/room/TESTA");
  });
});
