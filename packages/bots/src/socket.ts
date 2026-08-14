// The minimal socket surface a bot drives. Browser WebSocket, node's global WebSocket
// (stable since node 22), and workerd's accepted `response.webSocket` all satisfy it
// structurally, so one bot implementation runs in every environment the project tests in.
// Callers hand the bot an ALREADY-OPEN socket (workerd sockets never fire "open"; node/browser
// callers await it first) - keeping connection dialing out of the bot keeps the bot honest
// about speaking only the protocol.
export type BotSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
};

// node/browser convenience: dial a room URL and resolve once open. Not used by workerd
// tests (they get sockets from fetch upgrades).
export function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener(
      "close",
      (event) => reject(new Error(`socket closed before open (code ${String(event.code)})`)),
      { once: true },
    );
    socket.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)), {
      once: true,
    });
  });
}
