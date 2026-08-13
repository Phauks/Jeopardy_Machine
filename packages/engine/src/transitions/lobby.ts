// Joining, leaving, and start-game. Late joins (#43) run through the same player-join
// action - the phase decides which policy applies.
import { firstSelectorRoundOne } from "../control.ts";
import { startRound } from "../flow.ts";
import { placeWagerCells, wagerCountForRound } from "../placement.ts";
import { playedRoundCount } from "../setup.ts";
import { cellKey } from "../state.ts";
import type { GameAction } from "../actions.ts";
import type { GameEvent } from "../events.ts";
import type { GameSetup } from "../setup.ts";
import type { GameState } from "../state.ts";

type JoinAction = Extract<GameAction, { type: "player-join" }>;

export function handlePlayerJoin(
  draft: GameState,
  action: JoinAction,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  const teamsMode = setup.settings.teams.playerMode === "teams";
  if (!teamsMode && action.teamId !== undefined) {
    return "team-join-in-individuals-mode";
  }
  if (teamsMode && action.teamId === undefined) {
    return "teams-mode-needs-team";
  }

  const existing = draft.players[action.playerId];
  if (existing !== undefined) {
    if (existing.connected) return "duplicate-player";
    // Reconnection: the seat, score, and team survive; only presence and name refresh.
    existing.connected = true;
    existing.name = action.name;
    const entityId = existing.teamId ?? existing.id;
    events.push({
      type: "player-joined",
      playerId: existing.id,
      entityId,
      lateJoin: false,
      score: draft.scores[entityId] ?? 0,
    });
    return null;
  }

  const lateJoin = draft.phase !== "lobby";
  if (lateJoin && !setup.settings.join.lateJoinAllowed) return "late-join-disabled";

  const teamId = teamsMode ? (action.teamId ?? null) : null;
  draft.players[action.playerId] = {
    id: action.playerId,
    name: action.name,
    teamId,
    connected: true,
  };

  let entityId = action.playerId;
  let newEntity = true;
  if (teamId !== null) {
    entityId = teamId;
    const team = draft.teams[teamId];
    if (team !== undefined) {
      team.memberIds.push(action.playerId);
      newEntity = false;
    } else {
      draft.teams[teamId] = {
        id: teamId,
        name: action.teamName ?? teamId,
        memberIds: [action.playerId],
        captainRotation: 0,
      };
    }
  }

  if (newEntity) {
    let score = 0;
    if (lateJoin) {
      // #43 lateJoinScore. match-lowest is literal (a negative lowest matches negative - the
      // host override is the documented escape hatch); host-prompt seats at 0 and asks.
      const policy = setup.settings.join.lateJoinScore;
      if (policy === "match-lowest") {
        const scores = draft.entityOrder.map((id) => draft.scores[id] ?? 0);
        score = scores.length > 0 ? Math.min(...scores) : 0;
      }
      if (policy === "host-prompt") {
        events.push({ type: "late-join-score-needed", playerId: action.playerId, entityId });
      }
    }
    draft.scores[entityId] = score;
    draft.entityOrder.push(entityId);
  }

  events.push({
    type: "player-joined",
    playerId: action.playerId,
    entityId,
    lateJoin,
    score: draft.scores[entityId] ?? 0,
  });
  return null;
}

export function handlePlayerLeave(
  draft: GameState,
  action: Extract<GameAction, { type: "player-leave" }>,
  events: GameEvent[],
): string | null {
  const player = draft.players[action.playerId];
  if (player === undefined || !player.connected) return "unknown-player";
  // Presence-only: scores and seats survive so a phone that died can come back (#43 rejoin
  // path in handlePlayerJoin). Removing an entity would corrupt rotation and standings.
  player.connected = false;
  events.push({ type: "player-left", playerId: action.playerId });
  return null;
}

export function handleStartGame(
  draft: GameState,
  action: Extract<GameAction, { type: "start-game" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "lobby") return "already-started";
  if (draft.entityOrder.length === 0) return "nobody-joined";

  // Materialize per-round board state; wager cells place NOW so the whole game's hidden
  // layout is fixed by the seed (settings rows #23/#24; authored cells win on manual rounds).
  draft.boards = [];
  for (let roundIndex = 0; roundIndex < playedRoundCount(setup); roundIndex += 1) {
    const round = setup.rounds[roundIndex];
    if (round === undefined) continue;
    const status = round.cells.map((column) => column.map(() => "hidden" as const));
    let wagerCells: string[] = [];
    if (round.wagerPlacement === "manual") {
      round.cells.forEach((column, categoryIndex) => {
        column.forEach((cell, rowIndex) => {
          if (cell.authoredWager) wagerCells.push(cellKey(categoryIndex, rowIndex));
        });
      });
    } else {
      const count = Math.min(
        wagerCountForRound(roundIndex, setup.settings),
        round.cells.length * Math.max((round.cells[0]?.length ?? 1) - 1, 0),
      );
      if (count > 0) {
        const placed = placeWagerCells(
          round,
          count,
          setup.settings.wagers.autoPlacement,
          draft.rngState,
        );
        wagerCells = placed.wagerCells;
        draft.rngState = placed.nextRngState;
      }
    }
    draft.boards.push({ status, wagerCells, timeExpired: false });
  }

  events.push({ type: "game-started", entityCount: draft.entityOrder.length });
  draft.roundIndex = 0;
  startRound(draft, setup, events, action.at, firstSelectorRoundOne(draft, setup.settings));
  return null;
}
