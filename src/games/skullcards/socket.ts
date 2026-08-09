import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { getSession } from '../../database/repository.js';
import * as skullService from './service.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { Card, CardColor, MatchState } from './types.js';

/** Payloads chegam de clientes externos: validados antes do uso. */
interface JoinRoomPayload {
  roomId?: unknown;
  token?: unknown;
}

interface PlayCardPayload {
  matchId?: unknown;
  card?: unknown;
  chosenColor?: unknown;
  token?: unknown;
}

interface MatchActionPayload {
  matchId?: unknown;
  token?: unknown;
}

const PLAYABLE_COLORS: readonly CardColor[] = ['red', 'yellow', 'green', 'blue'];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asColor(value: unknown): CardColor | null {
  return typeof value === 'string' && PLAYABLE_COLORS.includes(value as CardColor)
    ? (value as CardColor)
    : null;
}

function channelRoom(roomId: string): string {
  return `skullcards_room_${roomId}`;
}

function channelMatch(matchId: string): string {
  return `skullcards_match_${matchId}`;
}

async function userIdFromToken(token: unknown): Promise<string | null> {
  const value = asString(token);
  if (!value) return null;
  const session = await getSession(value);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session.userId;
}

function emitToMatchAndRoom(
  io: Server,
  state: MatchState,
  matchId: string,
): (event: string, payload: unknown) => void {
  const m = channelMatch(matchId);
  const r = channelRoom(state.roomId);
  return (event, payload) => {
    io.to(m).emit(event, payload);
    io.to(r).emit(event, payload);
  };
}

export function setupSkullcardsSockets(
  httpServer: HttpServer,
  corsOrigins: string[] | undefined,
): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins?.length ? corsOrigins : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket: Socket) => {
    socket.on('join_room', async (payload: JoinRoomPayload | undefined) => {
      try {
        const roomId = asString(payload?.roomId);
        const userId = await userIdFromToken(payload?.token);
        if (!userId) {
          socket.emit('error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        const room = roomId ? await skullService.getRoom(roomId) : null;
        if (!room || !roomId) {
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
        console.error('[SkullCards][join_room]', getErrorMessage(err));
        socket.emit('error', { type: 'internal', message: 'Erro interno ao entrar na sala' });
      }
    });

    socket.on('play_card', async (payload: PlayCardPayload | undefined) => {
      try {
        const matchId = asString(payload?.matchId);
        const card = asString(payload?.card) as Card | null;
        const chosenColor = asColor(payload?.chosenColor);
        const userId = await userIdFromToken(payload?.token);
        if (!userId) {
          socket.emit('error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        if (!matchId || !card) {
          socket.emit('error', { type: 'play', reason: 'invalid_play' });
          return;
        }
        const result = await skullService.handlePlayCard(matchId, userId, card, chosenColor);
        if (!result.ok) {
          socket.emit('error', { type: 'play', reason: result.reason });
          return;
        }
        const { state } = result;
        const emit = emitToMatchAndRoom(io, state, matchId);
        emit('card_played', { playerId: userId, card, chosenColor, state });
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
        console.error('[SkullCards][play_card]', getErrorMessage(err));
        socket.emit('error', { type: 'internal', message: 'Erro interno ao jogar carta' });
      }
    });

    socket.on('draw_card', async (payload: MatchActionPayload | undefined) => {
      try {
        const matchId = asString(payload?.matchId);
        const userId = await userIdFromToken(payload?.token);
        if (!userId) {
          socket.emit('error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        if (!matchId) {
          socket.emit('error', { type: 'draw', reason: 'match_not_found' });
          return;
        }
        const result = await skullService.handleDrawCard(matchId, userId);
        if (!result.ok) {
          socket.emit('error', { type: 'draw', reason: result.reason });
          return;
        }
        const { state, event } = result;
        const emit = emitToMatchAndRoom(io, state, matchId);
        emit('card_drawn', { playerId: userId, drawn: event.drawn, state });
        emit('game_state_update', { state });
        emit('turn_changed', {
          currentTurnUserId: state.currentTurnUserId,
          direction: state.direction,
        });
      } catch (err) {
        console.error('[SkullCards][draw_card]', getErrorMessage(err));
        socket.emit('error', { type: 'internal', message: 'Erro interno ao comprar carta' });
      }
    });

    socket.on('pass_turn', async (payload: MatchActionPayload | undefined) => {
      try {
        const matchId = asString(payload?.matchId);
        const userId = await userIdFromToken(payload?.token);
        if (!userId) {
          socket.emit('error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        if (!matchId) {
          socket.emit('error', { type: 'pass', reason: 'match_not_found' });
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
        console.error('[SkullCards][pass_turn]', getErrorMessage(err));
        socket.emit('error', { type: 'internal', message: 'Erro interno ao passar a vez' });
      }
    });
  });

  return io;
}
