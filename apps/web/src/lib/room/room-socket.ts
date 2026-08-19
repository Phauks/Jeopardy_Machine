// The one place the play surfaces touch a WebSocket.
//
// It exists so the ws room store can be tested without a browser, a server, or a clock: the
// store takes a factory, the app passes the browser one, and the suite passes a fake that
// records frames and replays scripted ones. Keeping the dial here also keeps the store honest
// about speaking only the protocol (the same split @jeopardy/bots makes with its BotSocket).
//
// There is exactly ONE url shape - wss://<page origin>/room/<CODE>/ws through the single
// origin (docs/decisions/2026-08-13-single-origin-binding.md) - and it is built by
// #lib/realtime/room-url.ts, not here.

/** What the store needs from an open connection. */
export type RoomSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

/**
 * What the store needs to hear back. `code` on close is the application close code the room
 * protocol defines (roomCloseCodes): any 44xx means "do not reconnect".
 */
export type RoomSocketHandlers = {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onClose: (code: number) => void;
};

export type RoomSocketFactory = (url: string, handlers: RoomSocketHandlers) => RoomSocket;

/**
 * The real dial. An `error` event is deliberately NOT surfaced as its own callback: browsers
 * fire it before a close for every failure worth reacting to, and reacting twice would double
 * the reconnect ladder.
 */
export const browserRoomSocket: RoomSocketFactory = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    handlers.onOpen();
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") handlers.onMessage(event.data);
  });
  socket.addEventListener("close", (event) => {
    handlers.onClose(event.code);
  });
  return {
    send: (data) => {
      socket.send(data);
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
  };
};
