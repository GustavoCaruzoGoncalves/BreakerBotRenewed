import type { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { getSession } from '../../database/repository.js';
import { getErrorMessage } from '../../lib/errors.js';
import * as repo from './repository.js';
import { applyWebAction, redactStateForUser } from './service.js';
import type { WebAction } from './service.js';

interface JoinPayload {
  matchId?: unknown;
  token?: unknown;
}

interface ActionPayload extends JoinPayload {
  action?: unknown;
  cardSlot?: unknown;
  hidden?: unknown;
  level?: unknown;
}

const RAISE_LEVELS = [3, 6, 9, 12] as const;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function channelMatch(matchId: string): string {
  return `truco_match_${matchId}`;
}

async function userIdFromToken(token: unknown): Promise<string | null> {
  const value = asString(token);
  if (!value) return null;
  const session = await getSession(value);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session.userId;
}

export function parseWebAction(payload: ActionPayload): WebAction | null {
  const action = asString(payload.action);

  if (action === 'play' || action === 'hide') {
    const slot = Number(payload.cardSlot);
    if (!Number.isInteger(slot) || slot < 1 || slot > 3) return null;
    return { type: 'play', cardSlot: slot, hidden: action === 'hide' };
  }

  if (action === 'raise') {
    const level = Number(payload.level);
    if (!RAISE_LEVELS.includes(level as (typeof RAISE_LEVELS)[number])) return null;
    return { type: 'raise', level: level as 3 | 6 | 9 | 12 };
  }

  if (action === 'accept') return { type: 'accept' };
  if (action === 'refuse') return { type: 'refuse' };
  if (action === 'confirm') return { type: 'confirm' };

  return null;
}

/**
 * Emite o estado individualmente por socket: cada jogador só pode receber a
 * própria mão, então não dá para fazer um broadcast único para a sala.
 */
async function broadcastState(io: Server, matchId: string): Promise<void> {
  const match = await repo.findMatchById(matchId);
  const state = match?.state_json;
  if (!state) return;

  const sockets = await io.in(channelMatch(matchId)).fetchSockets();
  for (const s of sockets) {
    const viewerId = typeof s.data.userId === 'string' ? s.data.userId : null;
    s.emit('truco_state_update', { matchId, state: redactStateForUser(state, viewerId) });
  }
}

export function setupTrucoSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    socket.on('truco_join', async (payload: JoinPayload | undefined) => {
      try {
        const matchId = asString(payload?.matchId);
        const userId = await userIdFromToken(payload?.token);
        if (!userId) {
          socket.emit('truco_error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        if (!matchId) {
          socket.emit('truco_error', { type: 'match', message: 'Partida não encontrada' });
          return;
        }

        const match = await repo.findMatchById(matchId);
        if (!match) {
          socket.emit('truco_error', { type: 'match', message: 'Partida não encontrada' });
          return;
        }

        socket.data.userId = userId;
        socket.join(channelMatch(matchId));

        socket.emit('truco_state_update', {
          matchId,
          state: match.state_json ? redactStateForUser(match.state_json, userId) : null,
          lobby: match.lobby_json,
          status: match.status,
        });
      } catch (err) {
        console.error('[Truco][truco_join]', getErrorMessage(err));
        socket.emit('truco_error', { type: 'internal', message: 'Erro interno ao entrar' });
      }
    });

    socket.on('truco_action', async (payload: ActionPayload | undefined) => {
      try {
        const matchId = asString(payload?.matchId);
        const userId = await userIdFromToken(payload?.token);
        if (!userId) {
          socket.emit('truco_error', { type: 'auth', message: 'Sessão inválida' });
          return;
        }
        if (!matchId) {
          socket.emit('truco_error', { type: 'match', message: 'Partida não encontrada' });
          return;
        }

        const action = payload ? parseWebAction(payload) : null;
        if (!action) {
          socket.emit('truco_error', { type: 'action', message: 'Ação inválida' });
          return;
        }

        const result = await applyWebAction(matchId, userId, action);
        if (!result.ok) {
          socket.emit('truco_error', { type: 'action', message: result.error });
          return;
        }

        await broadcastState(io, matchId);
      } catch (err) {
        console.error('[Truco][truco_action]', getErrorMessage(err));
        socket.emit('truco_error', { type: 'internal', message: 'Erro interno ao executar ação' });
      }
    });

    socket.on('truco_leave', (payload: JoinPayload | undefined) => {
      const matchId = asString(payload?.matchId);
      if (matchId) socket.leave(channelMatch(matchId));
    });
  });
}
