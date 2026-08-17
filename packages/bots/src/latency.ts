// Simulated phone networks, so "this room is fair" can be measured instead of asserted (M6,
// docs/decisions/2026-08-17-buzz-latency-compensation.md). A wrapper around any BotSocket that
// delays frames in both directions from a seeded distribution: the bot above it and the room
// below it are both the real article, and only the wire between them is pretend.
//
// Why both directions, separately: buzz fairness lives or dies on the difference between the
// DOWNLINK (how late this phone saw the arm) and the UPLINK (how late the server heard the
// press). A simulator that only delayed one of them would flatter the algorithm exactly where
// it needs to be tested.
//
// Delivery is monotonic per direction even under heavy jitter, because a WebSocket does not
// reorder frames and a simulator that did would be testing a network nobody has.
import { SeededStream } from "./behavior.ts";
import type { BotSocket } from "./socket.ts";

export type LatencyProfile = {
  id: string;
  label: string;
  /** Round trip, split evenly between the two directions. */
  roundTripMs: number;
  /** Extra uniform [0, jitterMs) drawn per frame, per direction. */
  jitterMs: number;
};

// Four phones you can actually point at in a room. The numbers are venue-Wi-Fi shaped rather
// than datacenter shaped: the whole problem is that a hall full of phones is not a LAN.
export const latencyProfiles = {
  wired: { id: "wired", label: "wired display", roundTripMs: 10, jitterMs: 2 },
  fast: { id: "fast", label: "good signal", roundTripMs: 40, jitterMs: 10 },
  slow: { id: "slow", label: "far from the access point", roundTripMs: 240, jitterMs: 20 },
  jittery: { id: "jittery", label: "congested band", roundTripMs: 120, jitterMs: 220 },
} as const satisfies Record<string, LatencyProfile>;

export type LatencyProfileId = keyof typeof latencyProfiles;

/**
 * Wrap a socket so every frame crosses a simulated network. The returned object satisfies
 * BotSocket, so `new Bot(withSimulatedLatency(socket, ...), options)` is the only change a
 * caller makes.
 */
export function withSimulatedLatency(
  socket: BotSocket,
  options: { profile: LatencyProfile; seed: string },
): BotSocket {
  const random = new SeededStream(options.seed);
  const oneWayMs = options.profile.roundTripMs / 2;
  // Per-direction "no frame may land before the one ahead of it" clocks.
  let nextInboundAt = 0;
  let nextOutboundAt = 0;

  const schedule = (direction: "in" | "out", deliver: () => void): void => {
    const draw = oneWayMs + random.next() * options.profile.jitterMs;
    const now = Date.now();
    const earliest = direction === "in" ? nextInboundAt : nextOutboundAt;
    const at = Math.max(now + draw, earliest);
    if (direction === "in") nextInboundAt = at;
    else nextOutboundAt = at;
    setTimeout(deliver, Math.max(at - now, 0));
  };

  const handlers: ((event: { data: unknown }) => void)[] = [];
  socket.addEventListener("message", (event) => {
    schedule("in", () => {
      for (const handler of handlers) handler(event);
    });
  });

  return {
    send(data: string): void {
      schedule("out", () => {
        socket.send(data);
      });
    },
    close(code?: number, reason?: string): void {
      // Not delayed: a close is teardown, and holding it would leak timers into the next test.
      socket.close(code, reason);
    },
    addEventListener(_type: "message", handler: (event: { data: unknown }) => void): void {
      handlers.push(handler);
    },
  };
}
