const repo = require('../../database/skullcardsRepository');
const engine = require('./engine');

async function persistState(matchId, state) {
  await repo.saveMatchState(matchId, state);
  return repo.getMatchState(matchId);
}

async function createRoomForUser(userId, isPublic = false) {
  return repo.createRoom(userId, isPublic);
}

async function joinRoom(roomId, userId) {
  return repo.joinRoom(roomId, userId);
}

async function getRoom(roomId) {
  return repo.getRoom(roomId);
}

async function startMatch(roomId) {
  const info = await repo.createMatchForRoom(roomId);
  const state = await repo.getMatchState(info.match.match_id);
  return { info, state };
}

async function getMatchState(matchId) {
  return repo.getMatchState(matchId);
}

async function listPublicRooms() {
  return repo.listPublicRooms();
}

async function resolveRoomIdFromCodeOrId(roomKey) {
  if (!roomKey) return null;
  const trimmed = String(roomKey).trim();
  if (trimmed.includes('-') && !trimmed.startsWith('#')) return trimmed;
  return repo.findRoomIdByCode(trimmed);
}

async function getLatestActiveMatchForRoom(roomId) {
  const matchId = await repo.getLatestActiveMatchForRoom(roomId);
  if (!matchId) return null;
  return repo.getMatchState(matchId);
}

async function handlePlayCard(matchId, playerId, card, chosenColor) {
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
    event: {
      type: 'card_played',
      playerId,
      card,
      chosenColor: chosenColor || null,
    },
  };
}

async function handleDrawCard(matchId, playerId) {
  const state = await repo.getMatchState(matchId);
  if (!state) return { ok: false, reason: 'match_not_found' };
  const players = await repo.listRoomPlayers(state.roomId);

  const applied = engine.applyDraw(state, players, playerId);
  if (!applied.ok) return { ok: false, reason: applied.reason || 'draw_failed', state };

  const newState = await persistState(matchId, state);
  return {
    ok: true,
    state: newState,
    event: { type: 'card_drawn', playerId, drawn: applied.drawn || [] },
  };
}

async function handlePassTurn(matchId, playerId) {
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

module.exports = {
  createRoomForUser,
  joinRoom,
  getRoom,
  startMatch,
  getMatchState,
  listPublicRooms,
  resolveRoomIdFromCodeOrId,
  getLatestActiveMatchForRoom,
  handlePlayCard,
  handleDrawCard,
  handlePassTurn,
};
