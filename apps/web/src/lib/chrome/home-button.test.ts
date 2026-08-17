// The shared way back. What is asserted here is the CONTRACT other surfaces adopt, not the
// pixels: a real anchor (never a history step), a default destination, and a floating variant
// that can be dropped onto a surface with no header of its own.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import HomeButton from "#lib/chrome/home-button.svelte";

describe("home button", () => {
  it("is a link to the front door by default, not a history step", () => {
    const { body } = render(HomeButton, { props: {} });
    expect(body).toContain("<a");
    expect(body).toContain('href="/"');
    expect(body).toContain("Home");
    // A back STEP is wrong for a surface people reach by QR code - there is nothing behind it.
    expect(body).not.toContain("history.back");
  });

  it("takes any destination and any label, so a surface can point one step up", () => {
    const { body } = render(HomeButton, {
      props: { href: "/room/BQKX7", label: "Back to the room" },
    });
    expect(body).toContain('href="/room/BQKX7"');
    expect(body).toContain("Back to the room");
  });

  it("marks the floating variant so a headerless surface can pin it", () => {
    const inline = render(HomeButton, { props: {} }).body;
    const floating = render(HomeButton, { props: { variant: "floating" } }).body;
    expect(inline).toContain('data-variant="inline"');
    expect(floating).toContain('data-variant="floating"');
  });

  it("carries a stable hook every surface's tests can find it by", () => {
    expect(render(HomeButton, { props: {} }).body).toContain('data-testid="home-button"');
  });
});
