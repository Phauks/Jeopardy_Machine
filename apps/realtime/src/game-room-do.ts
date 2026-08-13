// GameRoomDO - the authoritative per-room state machine. One instance per game room,
// addressed by idFromName(roomCode); every client (host console, board display, player
// phones) holds a WebSocket to it.
//
// M0 status: a deliberate stub. It proves the transport end to end (upgrade, hibernation
// wiring, envelope parsing, echo) and nothing else. The real room protocol (join, roles,
// snapshot + patch, buzz ordering) arrives with M3 on top of exactly this surface.
//
// Transport is partyserver (decision: docs/decisions/2026-08-13-partyserver.md). The
// boundary set there: partyserver owns connection lifecycle, hibernation bookkeeping,
// routing, and broadcast; ALL game semantics stay in our code. Game logic modules must
// never import partyserver types - only this DO class touches them.
import { parseEnvelope, protocolVersion } from "@jeopardy/protocol/envelope";
import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";

export class GameRoomDO extends Server {
  // Hibernation is non-negotiable (architecture doc §3): between clues the DO must be
  // evictable while sockets stay connected, or we pay wall-clock duration for whole games.
  static override options = { hibernate: true };

  override onStart(): void {
    // partyserver does not wire heartbeat auto-responses itself, so we do: phones ping to
    // keep venue Wi-Fi NAT mappings alive, and this answers them WITHOUT waking the DO
    // (auto-response pairs are handled by the runtime and are unbilled).
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override onConnect(connection: Connection, _ctx: ConnectionContext): void {
    // Server-initiated hello so a client immediately learns the protocol version this room
    // speaks. This is the version-skew refusal point promised in
    // docs/decisions/2026-08-13-pwa.md: a stale cached client compares versions and prompts
    // a reload instead of misbehaving mid-game.
    connection.send(JSON.stringify({ version: protocolVersion, type: "welcome", room: this.name }));
  }

  override onMessage(connection: Connection, message: WSMessage): void {
    if (typeof message !== "string") {
      // Binary frames are not part of the protocol at any version; refuse loudly.
      connection.send(
        JSON.stringify({
          version: protocolVersion,
          type: "error",
          reason: "malformed",
          detail: "binary frames are not supported",
        }),
      );
      return;
    }
    const result = parseEnvelope(message);
    if (!result.ok) {
      connection.send(
        JSON.stringify({
          version: protocolVersion,
          type: "error",
          reason: result.reason,
          detail: result.detail,
        }),
      );
      return;
    }
    // The M0 echo: proves parse -> respond through a hibernation-capable DO. Anything that
    // parses but is not yet implemented gets echoed back wrapped, so the dev page can see
    // its own message make the round trip.
    connection.send(
      JSON.stringify({
        version: protocolVersion,
        type: "echo",
        room: this.name,
        received: result.envelope,
      }),
    );
  }
}
