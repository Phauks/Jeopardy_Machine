// A bot player: a headless client speaking the REAL room protocol - the same join/resume
// messages, the same action relay, the same server catalog phones use - so every bot game
// exercises exactly the code paths of a room full of phones (owner directive "Development
// simulation", realtime level). Behavior is seeded (behavior.ts); a scripted test can also
// drive a bot by hand via sendAction()/sendMessage() and assert on waitFor().
//
// Bots never act as host: arming, judging, and selection stay host-driven (a test or the
// CLI holds its own host connection), which keeps the authority matrix honestly exercised.
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { parseRoomServerMessage } from "@jeopardy/protocol/room/server-messages";
import type { RoomServerMessage } from "@jeopardy/protocol/room/server-messages";
import type { JoinTeamIntent } from "@jeopardy/protocol/room/client-messages";
import type { GameEvent } from "@jeopardy/engine/events";
import { defaultBehavior, SeededStream } from "./behavior.ts";
import type { BotBehavior } from "./behavior.ts";
import type { BotSocket } from "./socket.ts";

export type BotOptions = {
  nickname: string;
  seed: string;
  avatarId?: string;
  buzzSoundId?: string;
  team?: JoinTeamIntent;
  behavior?: Partial<BotBehavior>;
  // Present = resume an existing session instead of joining fresh.
  sessionToken?: string;
};

export class Bot {
  readonly nickname: string;
  playerId: string | null = null;
  sessionToken: string | null = null;
  entityId: string | null = null;
  stateVersion = 0;
  /** Every parsed server message, in arrival order - the test-assertion surface. */
  readonly received: RoomServerMessage[] = [];
  /** The open arming as THIS client saw it: its id and the local moment it arrived (t0). */
  arm: { armId: number; receivedAt: number } | null = null;

  private readonly socket: BotSocket;
  private readonly behavior: BotBehavior;
  private readonly random: SeededStream;
  private readonly options: BotOptions;
  private readonly waiters: {
    predicate: (message: RoomServerMessage) => boolean;
    resolve: (message: RoomServerMessage) => void;
  }[] = [];
  private closed = false;

  constructor(socket: BotSocket, options: BotOptions) {
    this.socket = socket;
    this.options = options;
    this.nickname = options.nickname;
    this.behavior = { ...defaultBehavior, ...options.behavior };
    this.random = new SeededStream(options.seed);
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") this.handleFrame(event.data);
    });
  }

  /** Send join (or resume when a session token was provided). Call once, socket open. */
  start(): void {
    if (this.options.sessionToken !== undefined) {
      this.sendMessage({ type: "resume", sessionToken: this.options.sessionToken });
      return;
    }
    this.sendMessage({
      type: "join",
      role: "player",
      nickname: this.options.nickname,
      ...(this.options.avatarId !== undefined && { avatarId: this.options.avatarId }),
      ...(this.options.buzzSoundId !== undefined && { buzzSoundId: this.options.buzzSoundId }),
      ...(this.options.team !== undefined && { team: this.options.team }),
    });
  }

  close(): void {
    this.closed = true;
    this.socket.close(1000, "bot done");
  }

  /** Raw client-message escape hatch for scripted tests (version stamped automatically). */
  sendMessage(payload: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ version: protocolVersion, ...payload }));
  }

  /** Relay an engine action (identity/time stamped server-side per the authority matrix). */
  sendAction(action: Record<string, unknown>, timing?: { armId: number; elapsedMs: number }): void {
    this.sendMessage({ type: "action", action, ...(timing !== undefined && { timing }) });
  }

  /**
   * Buzz the way a phone does: with the arming id and the milliseconds since THIS client
   * rendered the arm (M6). Falls back to a bare buzz when no arming is open or the behavior
   * says to send no claim - the server treats a missing claim as "rank me by arrival minus my
   * measured round trip", never as an error.
   */
  buzz(): void {
    const arm = this.arm;
    if (arm === null || this.behavior.elapsedClaim === "none") {
      this.sendAction({ type: "buzz" });
      return;
    }
    const elapsedMs =
      this.behavior.elapsedClaim === "zero"
        ? 0
        : Math.max(Math.round(Date.now() - arm.receivedAt), 0);
    this.sendAction({ type: "buzz" }, { armId: arm.armId, elapsedMs });
  }

  /** Resolves with the first (already-received or future) message matching the predicate. */
  waitFor(
    predicate: (message: RoomServerMessage) => boolean,
    timeoutMs = 5000,
  ): Promise<RoomServerMessage> {
    const already = this.received.find(predicate);
    if (already !== undefined) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`bot ${this.nickname}: timed out waiting for a matching message`));
      }, timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  private handleFrame(frame: string): void {
    const parsed = parseRoomServerMessage(frame);
    if (!parsed.ok) return; // a broken server frame is the server suite's bug to catch
    const message = parsed.message;
    this.received.push(message);

    if (message.type === "welcome") {
      this.playerId = message.playerId;
      this.sessionToken = message.sessionToken;
    }
    if (message.type === "snapshot") {
      this.stateVersion = message.stateVersion;
      const mine = message.roster.players.find((entry) => entry.playerId === this.playerId);
      if (mine !== undefined) this.entityId = mine.teamId ?? mine.playerId;
    }
    if (message.type === "roster") {
      const mine = message.roster.players.find((entry) => entry.playerId === this.playerId);
      if (mine !== undefined) this.entityId = mine.teamId ?? mine.playerId;
    }
    // The arming: note t0 locally and ack IMMEDIATELY, before doing anything else with the
    // frame. The ack's return trip is how the server measures this connection, so any work
    // done first would be measured as network latency that is not there.
    if (message.type === "arm-window") {
      this.arm = { armId: message.arm.armId, receivedAt: Date.now() };
      if (this.behavior.acknowledgeArming && !this.closed) {
        this.sendMessage({ type: "arm-ack", armId: message.arm.armId });
      }
    }
    if (message.type === "event") {
      this.stateVersion = message.stateVersion;
      for (const event of message.events) this.reactTo(event as GameEvent);
    }
    if (message.type === "buzz-won") this.stateVersion = message.stateVersion;

    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter !== undefined && waiter.predicate(message)) {
        this.waiters.splice(index, 1);
        waiter.resolve(message);
      }
    }
  }

  // The seeded-random play loop: react to engine narration the way a phone-holder would.
  // Selection is deliberately absent - the host console selects (acting-player authority),
  // so a bot holding board control never deadlocks a game the host is driving.
  private reactTo(event: GameEvent): void {
    if (this.closed) return;
    switch (event.type) {
      case "player-joined": {
        if (event.playerId === this.playerId) this.entityId = event.entityId;
        return;
      }
      case "buzzers-armed": {
        if (this.random.next() >= this.behavior.buzzProbability) return;
        const latency = this.random.nextInRange(
          this.behavior.buzzLatencyMinMs,
          this.behavior.buzzLatencyMaxMs,
        );
        setTimeout(() => {
          if (!this.closed) this.buzz();
        }, latency);
        return;
      }
      case "wager-cell-hit": {
        if (event.entityId !== this.entityId) return;
        const amount = Math.max(
          event.minimum,
          Math.round(event.minimum + this.behavior.wagerFraction * (event.maximum - event.minimum)),
        );
        this.sendAction({ type: "commit-wager", amount });
        return;
      }
      case "answers-open": {
        this.sendAction({ type: "submit-typed-answer", text: this.behavior.answerText });
        return;
      }
      case "final-wagers-open": {
        const range = event.ranges.find((entry) => entry.entityId === this.entityId);
        if (range === undefined) return;
        const amount = Math.max(
          range.minimum,
          Math.round(range.minimum + this.behavior.wagerFraction * (range.maximum - range.minimum)),
        );
        this.sendAction({ type: "commit-final-wager", amount });
        return;
      }
      case "final-writing-open": {
        if (this.entityId !== null && event.eligible.includes(this.entityId)) {
          this.sendAction({ type: "submit-final-answer", text: this.behavior.answerText });
        }
        return;
      }
      default:
    }
  }
}
