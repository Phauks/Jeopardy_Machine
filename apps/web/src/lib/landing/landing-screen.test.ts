// The front door, server-rendered. What is asserted here is the ORDER OF PRIORITY the landing
// page exists to express: the code box is the primary control, the browse affordance is
// secondary, and the dev-surface index - which used to be the whole page - is present but
// closed. If a future change reverses that, this test is what says so.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import LandingScreen from "#lib/landing/landing-screen.svelte";
import type { SurfaceCard } from "#lib/landing/landing-screen.svelte";
import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";

const fetchedAt = 1_760_000_600_000;

const surfaces: SurfaceCard[] = [
  { href: "/dev/theme", title: "Theme gallery", note: "Four presets on the token contract." },
  { href: "/api/version", title: "/api/version", note: "Deployment identity as JSON." },
];

const room: RoomSummary = {
  code: "BQKX7",
  title: "Pub quiz night",
  hostLabel: "Board Game Club",
  listing: "public",
  hasPassword: false,
  phase: "lobby",
  playerCount: 7,
  playerCap: 100,
  createdAt: fetchedAt - 60_000,
  lastSeenAt: fetchedAt,
};

function listingOf(rooms: RoomSummary[]): LobbyListing {
  return { rooms, fetchedAt, registry: { status: "ok" } };
}

function renderLanding(listing: LobbyListing, listingError: string | null = null): string {
  return render(LandingScreen, {
    props: { listing, listingError, surfaces, onJoin: () => undefined },
  }).body;
}

describe("landing screen", () => {
  const body = renderLanding(listingOf([room]));

  it("leads with what this is and the code box", () => {
    expect(body).toContain("Jeopardy Machine");
    expect(body).toContain("Join a game");
    expect(body).toContain("Room code");
    // The code box comes before the developer drawer in document order, not just visually.
    expect(body.indexOf("Room code")).toBeLessThan(body.indexOf("Developer surfaces"));
  });

  it("keeps the no-accounts promise on the page a stranger reads first", () => {
    expect(body).toContain("Players never log in");
    expect(body).toContain("a room code is the whole join flow");
  });

  it("offers the browse path with a live count, pointing at /lobby", () => {
    expect(body).toContain('href="/lobby"');
    expect(body).toContain("1 live room");
  });

  it("says 'none listed' rather than hiding the browse path on a quiet night", () => {
    expect(renderLanding(listingOf([]))).toContain("none listed right now");
  });

  it("never claims a room count when the registry could not answer", () => {
    const broken = renderLanding({
      rooms: [],
      fetchedAt,
      registry: { status: "unavailable", reason: "no-table" },
    });
    expect(broken).not.toContain("none listed right now");
    expect(broken).toContain("Registry table missing");
  });

  it("reports a failed listing fetch and still keeps the code box working", () => {
    const failed = renderLanding(listingOf([]), "lobby responded 500");
    expect(failed).toContain("lobby responded 500");
    expect(failed).toContain("A room code still works");
    expect(failed).toContain("Room code");
  });

  it("hides the password field until someone says their room has one", () => {
    expect(body).toContain("This room has a password");
    expect(body).not.toContain('type="password"');
  });

  it("keeps the dev-surface index complete but collapsed (the owner's freshness rule)", () => {
    expect(body).toContain("<details");
    expect(body).not.toContain("<details open");
    expect(body).toContain("Developer surfaces");
    for (const surface of surfaces) {
      expect(body).toContain(surface.href);
      expect(body).toContain(surface.title);
      expect(body).toContain(surface.note);
    }
  });
});
