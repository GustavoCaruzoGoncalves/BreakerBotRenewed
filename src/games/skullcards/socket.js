const { Server } = require('socket.io');
const repo = require('../../database/repository');
const skullService = require('./service');

function channelRoom(roomId) {
  return `skullcards_room_${roomId}`;
}

function channelMatch(matchId) {
  return `skullcards_match_${matchId}`;
}

async function userIdFromToken(token) {
  if (!token) return null;
  const session = await repo.getSession(token);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session.userId;
}

function emitToMatchAndRoom(io, state, matchId) {
  const m = channelMatch(matchId);
  const r = channelRoom(state.roomId);
  return (event, payload) => {
    io.to(m).emit(event, payload);
    io.to(r).emit(event, payload);
  };
}

function setupSkullcardsSockets(httpServer, corsOrigins) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins?.length ? corsOrigins : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', socket => {
    socket.on('join_room', async payload => {
      try {
        const { roomId, token } = payload || {};
        const userId = await userIdFromToken(token);
        if (!userId) {
          socket.emit('error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        const room = await skullService.getRoom(roomId);
        if (!room) {
          socket.emit('error', { type: 'room', message: 'Sala não encontrada' });
          return;
        }
        socket.data.userId = userId;
        socket.data.roomId = roomId;
        const ch = channelRoom(roomId);
        socket.join(ch);
        io.to(ch).emit('room_update', { room });

        const latest = await skullService.getLatestActiveMatchForRoom(roomId);
        if (latest) {
          socket.join(channelMatch(latest.matchId));
          socket.emit('game_state_update', { state: latest });
        }
      } catch (err) {
        console.error('[SkullCards][join_room]', err.message);
        socket.emit('error', { type: 'internal', message: 'Erro interno ao entrar na sala' });
      }
    });

    socket.on('play_card', async payload => {
      try {
        const { matchId, card, chosenColor, token } = payload || {};
        const userId = await userIdFromToken(token);
        if (!userId) {
          socket.emit('error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        const result = await skullService.handlePlayCard(matchId, userId, card, chosenColor);
        if (!result.ok) {
          socket.emit('error', { type: 'play', reason: result.reason });
          return;
        }
        const { state } = result;
        const emit = emitToMatchAndRoom(io, state, matchId);
        emit('card_played', {
          playerId: userId,
          card,
          chosenColor: chosenColor || null,
          state,
        });
        emit('game_state_update', { state });
        if (state.winnerUserId) {
          emit('player_won', { winnerUserId: state.winnerUserId, state });
        } else {
          emit('turn_changed', {
            currentTurnUserId: state.currentTurnUserId,
            direction: state.direction,
          });
        }
      } catch (err) {
        console.error('[SkullCards][play_card]', err.message);
        socket.emit('error', { type: 'internal', message: 'Erro interno ao jogar carta' });
      }
    });

    socket.on('draw_card', async payload => {
      try {
        const { matchId, token } = payload || {};
        const userId = await userIdFromToken(token);
        if (!userId) {
          socket.emit('error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        const result = await skullService.handleDrawCard(matchId, userId);
        if (!result.ok) {
          socket.emit('error', { type: 'draw', reason: result.reason });
          return;
        }
        const { state, event } = result;
        const emit = emitToMatchAndRoom(io, state, matchId);
        emit('card_drawn', {
          playerId: userId,
          drawn: event.drawn || [],
          state,
        });
        emit('game_state_update', { state });
        emit('turn_changed', {
          currentTurnUserId: state.currentTurnUserId,
          direction: state.direction,
        });
      } catch (err) {
        console.error('[SkullCards][draw_card]', err.message);
        socket.emit('error', { type: 'internal', message: 'Erro interno ao comprar carta' });
      }
    });

    socket.on('pass_turn', async payload => {
      try {
        const { matchId, token } = payload || {};
        const userId = await userIdFromToken(token);
        if (!userId) {
          socket.emit('error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        const result = await skullService.handlePassTurn(matchId, userId);
        if (!result.ok) {
          socket.emit('error', { type: 'pass', reason: result.reason });
          return;
        }
        const { state } = result;
        const emit = emitToMatchAndRoom(io, state, matchId);
        emit('turn_changed', {
          currentTurnUserId: state.currentTurnUserId,
          direction: state.direction,
        });
        emit('game_state_update', { state });
      } catch (err) {
        console.error('[SkullCards][pass_turn]', err.message);
        socket.emit('error', { type: 'internal', message: 'Erro interno ao passar a vez' });
      }
    });
  });

  return io;
}

module.exports = { setupSkullcardsSockets };
