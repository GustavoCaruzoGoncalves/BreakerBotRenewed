import * as repo from '../../database/skullcardsRepository.js';
import * as engine from './engine.js';
import type {
  ActionResult,
  Card,
  CardColor,
  CardDrawnEvent,
  CardPlayedEvent,
  CreatedMatch,
  MatchState,
  Room,
  RoomRow,
  TurnChangedEvent,
} from './types.js';

async function persistState(matchId: string, state: MatchState): Promise<MatchState> {
  await repo.saveMatchState(matchId, state);
  const saved = await repo.getMatchState(matchId);
  if (!saved) throw new Error('match_not_found_after_save');
  return saved;
}

export async function createRoomForUser(userId: string, isPublic = false): Promise<RoomRow> {
  return repo.createRoom(userId, isPublic);
}

export async function joinRoom(roomId: string, userId: string): Promise<Room | null> {
  return repo.joinRoom(roomId, userId);
}

export async function getRoom(roomId: string): Promise<Room | null> {
  return repo.getRoom(roomId);
}

export interface StartedMatch {
  info: CreatedMatch;
  state: MatchState | null;
}

export async function startMatch(roomId: string): Promise<StartedMatch> {
  const info = await repo.createMatchForRoom(roomId);
  const state = await repo.getMatchState(info.match.match_id);
  return { info, state };
}

export async function getMatchState(matchId: string): Promise<MatchState | null> {
  return repo.getMatchState(matchId);
}

export async function listPublicRooms(): Promise<Room[]> {
  return repo.listPublicRooms();
}

export async function resolveRoomIdFromCodeOrId(
  roomKey: string | null | undefined,
): Promise<string | null> {
  if (!roomKey) return null;
  const trimmed = String(roomKey).trim();
  if (trimmed.includes('-') && !trimmed.startsWith('#')) return trimmed;
  return repo.findRoomIdByCode(trimmed);
}

export async function getLatestActiveMatchForRoom(roomId: string): Promise<MatchState | null> {
  const matchId = await repo.getLatestActiveMatchForRoom(roomId);
  if (!matchId) return null;
  return repo.getMatchState(matchId);
}

export async function handlePlayCard(
  matchId: string,
  playerId: string,
  card: Card,
  chosenColor: CardColor | null,
): Promise<ActionResult<CardPlayedEvent>> {
  const state = await repo.getMatchState(matchId);
  if (!state) return { ok: false, reason: 'match_not_found' };
  const players = await repo.listRoomPlayers(state.roomId);

  const check = engine.canPlayCard(card, state, playerId);
  if (!check.ok) return { ok: false, reason: check.reason || 'invalid_play', state };

  const applied = engine.applyPlay(state, players, playerId, card, chosenColor);
  if (!applied.ok) return { ok: false, reason: applied.reason || 'apply_failed', state };

  const newState = await persistState(matchId, state);
  return {
    ok: true,
    state: newState,
    event: { type: 'card_played', playerId, card, chosenColor: chosenColor ?? null },
  };
}

export async function handleDrawCard(
  matchId: string,
  playerId: string,
): Promise<ActionResult<CardDrawnEvent>> {
  const state = await repo.getMatchState(matchId);
  if (!state) return { ok: false, reason: 'match_not_found' };
  const players = await repo.listRoomPlayers(state.roomId);

  const applied = engine.applyDraw(state, players, playerId);
  if (!applied.ok) return { ok: false, reason: applied.reason || 'draw_failed', state };

  const newState = await persistState(matchId, state);
  return {
    ok: true,
    state: newState,
    event: { type: 'card_drawn', playerId, drawn: applied.drawn },
  };
}

export async function handlePassTurn(
  matchId: string,
  playerId: string,
): Promise<ActionResult<TurnChangedEvent>> {
  const state = await repo.getMatchState(matchId);
  if (!state) return { ok: false, reason: 'match_not_found' };
  const players = await repo.listRoomPlayers(state.roomId);

  const applied = engine.applyPass(state, players, playerId);
  if (!applied.ok) return { ok: false, reason: applied.reason || 'pass_failed', state };

  const newState = await persistState(matchId, state);
  return {
    ok: true,
    state: newState,
    event: { type: 'turn_changed', playerId: newState.currentTurnUserId },
  };
}
