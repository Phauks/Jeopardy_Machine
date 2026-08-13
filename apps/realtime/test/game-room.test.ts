import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parseEnvelope, protocolVersion } from "@jeopardy/protocol/envelope";

// Opens a real WebSocket to the worker (which routes to the room's DO) and returns both
// the socket and a next() helper that resolves with the next text frame.
async function connectToRoom(roomCode: string) {
  const response = await SELF.fetch(`https://realtime.test/room/${roomCode}/ws`, {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error("upgrade did not yield a WebSocket");
  const received: string[] = [];
  const waiters: ((frame: string) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const frame = typeof event.data === "string" ? event.data : "";
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter(frame);
    else received.push(frame);
  });
  socket.accept();
  function next(): Promise<string> {
    const queued = received.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => waiters.push(resolve));
  }
  return { socket, next };
}

describe("GameRoomDO stub", () => {
  it("welcomes new connections with the protocol version, then echoes a hello envelope", async () => {
    const { socket, next } = await connectToRoom("BQKX7");

    const welcome = JSON.parse(await next());
    expect(welcome).toMatchObject({ version: protocolVersion, type: "welcome", room: "BQKX7" });

    socket.send(
      JSON.stringify({ version: protocolVersion, type: "hello", greeting: "hi from the test" }),
    );
    const echo = JSON.parse(await next());
    expect(echo).toMatchObject({
      version: protocolVersion,
      type: "echo",
      room: "BQKX7",
      received: { type: "hello", greeting: "hi from the test" },
    });
    // The DO's own reply must itself be a valid envelope - the contract cuts both ways.
    expect(parseEnvelope(echo).ok).toBe(true);
    socket.close();
  });

  it("refuses a stale protocol version with a distinct error (the PWA version-skew contract)", async () => {
    const { socket, next } = await connectToRoom("BQKX7");
    await next(); // discard welcome

    socket.send(JSON.stringify({ version: 999, type: "hello" }));
    const error = JSON.parse(await next());
    expect(error).toMatchObject({
      version: protocolVersion,
      type: "error",
      reason: "unsupported-version",
    });
    socket.close();
  });

  it("rejects non-websocket requests to room paths and unknown routes", async () => {
    const noUpgrade = await SELF.fetch("https://realtime.test/room/BQKX7/ws");
    expect(noUpgrade.status).toBe(426);
    const badCode = await SELF.fetch("https://realtime.test/room/toolongcode/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(badCode.status).toBe(404);
  });
});
