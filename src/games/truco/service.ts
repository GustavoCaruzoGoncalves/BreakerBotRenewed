import type { WASocket } from '@whiskeysockets/baileys';
import { getErrorMessage } from '../../lib/errors.js';
import { logError } from '../../lib/logger.js';
import * as repo from './repository.js';
import { MatchAlreadyOpenError } from './repository.js';
import { withMatchLock } from './lock.js';
import {
  acceptRaise,
  assignLobbySeat,
  autoPlayBest,
  autoTimeoutMaoOnze,
  confirmMaoOnze,
  counterRaise,
  createInitialMatchState,
  createLobbySlots,
  getPartnerCards,
  getPlayerCards,
  isLobbyFull,
  MATCH_WIN_SCORE,
  playCard,
  refuseRaise,
  requestRaise,
  startHand,
  voteMaoOnze,
} from './engine.js';
import {
  formatHandSlotsMessage,
  formatHandStartedMessage,
  formatHistory,
  formatJogadaResult,
  formatLobbyMessage,
  formatMaoOnzeRunMessage,
  formatMaoOnzeTimeoutMessage,
  formatMesa,
  formatPartnerCards,
  formatPlayerMention,
  formatRaiseAcceptedMessage,
  formatRaiseRequestMessage,
  formatRunRefusedMessage,
  formatTeamOutcome,
  formatTurnNoticeForSeat,
} from './format.js';
import type {
  Card,
  GameActionResult,
  GameEvent,
  GameMode,
  HandSlots,
  LobbyState,
  MatchState,
  SeatPlayer,
  Suit,
  TeamId,
} from './types.js';
import { playerCountForMode, seatDmJid, SUIT_SYMBOL } from './types.js';

export interface TrucoContext {
  groupJid: string;
  groupId: number;
  /** `users.user_id` de quem executou o comando. */
  userId: string;
  mentionJid: string;
  dmJid: string;
  displayName: string;
  /** `users.user_id` já resolvidos a partir das menções da mensagem. */
  mentionedUserIds: string[];
}

export interface TrucoResponse {
  groupMessages: { text: string; mentions?: string[] }[];
  privateMessages: { jid: string; text: string }[];
}

function emptyResponse(): TrucoResponse {
  return { groupMessages: [], privateMessages: [] };
}

function groupOnly(text: string): TrucoResponse {
  return { groupMessages: [{ text }], privateMessages: [] };
}

function suitSymbol(s: string): string {
  return SUIT_SYMBOL[s as Suit] ?? s;
}

function seatMentionJids(seats: readonly SeatPlayer[]): string[] {
  return seats.map((s) => s.whatsappJid);
}

// --- Socket e timers ---

let socket: WASocket | null = null;

export function registerTrucoSocket(sock: WASocket): void {
  socket = sock;
}

export function clearTrucoSocket(): void {
  socket = null;
}

const lobbyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearLobbyTimer(matchId: string): void {
  const t = lobbyTimers.get(matchId);
  if (t) clearTimeout(t);
  lobbyTimers.delete(matchId);
}

function clearTurnTimer(matchId: string): void {
  const t = turnTimers.get(matchId);
  if (t) clearTimeout(t);
  turnTimers.delete(matchId);
}

function clearAllTimers(matchId: string): void {
  clearLobbyTimer(matchId);
  clearTurnTimer(matchId);
}

async function scheduleLobbyTimeout(
  matchId: string,
  groupId: number,
  groupJid: string,
): Promise<void> {
  clearLobbyTimer(matchId);
  const { lobbyMs } = await repo.getGroupTimeouts(groupId);
  const timer = setTimeout(() => {
    void handleLobbyTimeout(matchId, groupJid).catch(reportError('lobby-timeout'));
  }, lobbyMs);
  lobbyTimers.set(matchId, timer);
}

async function scheduleTurnTimeout(
  matchId: string,
  groupId: number,
  groupJid: string,
): Promise<void> {
  clearTurnTimer(matchId);
  const { turnMs } = await repo.getGroupTimeouts(groupId);
  const timer = setTimeout(() => {
    void handleTurnTimeout(matchId, groupJid).catch(reportError('turn-timeout'));
  }, turnMs);
  turnTimers.set(matchId, timer);
}

function reportError(scope: string): (err: unknown) => void {
  return (err) => {
    console.error(`[TRUCO] Erro em ${scope}:`, getErrorMessage(err));
    logError(err);
  };
}

/** Reagenda os timers das partidas em aberto após um restart do bot. */
export async function restoreOpenMatches(): Promise<number> {
  const matches = await repo.findAllOpenMatches();
  for (const m of matches) {
    if (m.status === 'waiting') await scheduleLobbyTimeout(m.match_id, m.group_id, m.group_jid);
    else await scheduleTurnTimeout(m.match_id, m.group_id, m.group_jid);
  }
  return matches.length;
}

// --- Lobby ---

function reservationsFor(
  mode: GameMode,
  partnerUserId: string | null,
  opponentUserIds: string[],
): Map<number, string> {
  const reserved = new Map<number, string>();
  if (mode === '1v1') {
    if (opponentUserIds[0]) reserved.set(1, opponentUserIds[0]);
  } else {
    if (partnerUserId) reserved.set(2, partnerUserId);
    if (opponentUserIds[0]) reserved.set(1, opponentUserIds[0]);
    if (opponentUserIds[1]) reserved.set(3, opponentUserIds[1]);
  }
  return reserved;
}

export async function createLobby(
  ctx: TrucoContext,
  mode: GameMode,
  partnerUserId: string | null,
  opponentUserIds: string[],
): Promise<TrucoResponse> {
  const existing = await repo.findOpenMatchByGroupId(ctx.groupId);
  if (existing) return groupOnly('❌ Já existe uma partida neste grupo.');

  const reserved = reservationsFor(mode, partnerUserId, opponentUserIds);
  const { lobbyMs } = await repo.getGroupTimeouts(ctx.groupId);
  const now = new Date();

  const lobby: LobbyState = {
    mode,
    createdByUserId: ctx.userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + lobbyMs).toISOString(),
    slots: createLobbySlots(mode).map((s) =>
      s.seat === 0
        ? {
            ...s,
            userId: ctx.userId,
            whatsappJid: ctx.mentionJid,
            dmJid: ctx.dmJid,
            displayName: ctx.displayName,
            reservedForUserId: null,
          }
        : { ...s, reservedForUserId: reserved.get(s.seat) ?? null },
    ),
  };

  let match: repo.TrucoMatchRow;
  try {
    match = await repo.createMatch(ctx.groupId, mode, ctx.userId, lobby);
  } catch (err) {
    if (err instanceof MatchAlreadyOpenError) {
      return groupOnly('❌ Já existe uma partida neste grupo.');
    }
    throw err;
  }

  await scheduleLobbyTimeout(match.match_id, ctx.groupId, ctx.groupJid);

  return {
    groupMessages: [{ text: formatLobbyMessage(lobby), mentions: [ctx.mentionJid] }],
    privateMessages: [],
  };
}

export async function joinLobby(ctx: TrucoContext): Promise<TrucoResponse> {
  const match = await repo.findOpenMatchByGroupId(ctx.groupId);
  if (!match || match.status !== 'waiting') return groupOnly('❌ Não há sala aberta.');

  return withMatchLock(match.match_id, async () => {
    const fresh = await repo.findMatchById(match.match_id);
    const lobby = fresh?.lobby_json;
    if (!fresh || fresh.status !== 'waiting' || !lobby) {
      return groupOnly('❌ Não há sala aberta.');
    }

    const result = assignLobbySeat(lobby, ctx.userId, ctx.mentionJid, ctx.displayName, ctx.dmJid);
    if (!result.ok) return groupOnly(result.error);

    await repo.updateMatchLobby(match.match_id, result.lobby);
    return {
      groupMessages: [
        {
          text: `✅ ${ctx.displayName} entrou!\n\n${formatLobbyMessage(result.lobby)}`,
          mentions: [ctx.mentionJid],
        },
      ],
      privateMessages: [],
    };
  });
}

export async function leaveLobby(ctx: TrucoContext): Promise<TrucoResponse> {
  const match = await repo.findOpenMatchByGroupId(ctx.groupId);
  if (!match) return groupOnly('❌ Não há partida ativa.');

  if (match.status === 'waiting') {
    return withMatchLock(match.match_id, async () => {
      const fresh = await repo.findMatchById(match.match_id);
      const lobby = fresh?.lobby_json;
      if (!fresh || fresh.status !== 'waiting' || !lobby) return groupOnly('❌ Não há sala aberta.');

      const slots = lobby.slots.map((s) =>
        s.userId === ctx.userId
          ? { ...s, userId: null, whatsappJid: null, dmJid: null, displayName: null }
          : s,
      );
      await repo.updateMatchLobby(match.match_id, { ...lobby, slots });
      return {
        groupMessages: [
          { text: `👋 ${ctx.displayName} saiu da sala.`, mentions: [ctx.mentionJid] },
        ],
        privateMessages: [],
      };
    });
  }

  return forfeitMatch(ctx, match.match_id);
}

export async function cancelLobby(ctx: TrucoContext): Promise<TrucoResponse> {
  const match = await repo.findOpenMatchByGroupId(ctx.groupId);
  if (!match) return groupOnly('❌ Não há partida para cancelar.');

  return withMatchLock(match.match_id, async () => {
    await repo.cancelMatch(match.match_id);
    clearAllTimers(match.match_id);
    return groupOnly('🚫 Partida cancelada.');
  });
}

export async function cancelActiveMatchInGroup(groupId: number): Promise<boolean> {
  const match = await repo.findOpenMatchByGroupId(groupId);
  if (!match) return false;
  await repo.cancelMatch(match.match_id);
  clearAllTimers(match.match_id);
  return true;
}

function buildSeatsFromLobby(lobby: LobbyState): SeatPlayer[] {
  return lobby.slots
    .filter((s) => s.userId !== null)
    .map((s) => ({
      seat: s.seat,
      userId: s.userId!,
      whatsappJid: s.whatsappJid ?? s.userId!,
      dmJid: s.dmJid ?? s.userId!,
      displayName: s.displayName ?? 'Jogador',
      team: s.team,
    }));
}

export async function startLobby(ctx: TrucoContext): Promise<TrucoResponse> {
  const match = await repo.findOpenMatchByGroupId(ctx.groupId);
  if (!match || match.status !== 'waiting') {
    return groupOnly('❌ Não há sala aguardando início.');
  }

  return withMatchLock(match.match_id, async () => {
    const fresh = await repo.findMatchById(match.match_id);
    const lobby = fresh?.lobby_json;
    if (!fresh || fresh.status !== 'waiting' || !lobby) {
      return groupOnly('❌ Não há sala aguardando início.');
    }

    if (!isLobbyFull(lobby)) {
      const needed = playerCountForMode(lobby.mode);
      const current = lobby.slots.filter((s) => s.userId).length;
      return groupOnly(`❌ Faltam jogadores (${current}/${needed}).`);
    }

    const seats = buildSeatsFromLobby(lobby);
    const handResult = startHand(createInitialMatchState(lobby.mode, seats, 0));
    if (!handResult.ok) return groupOnly(handResult.error);

    await repo.startMatch(match.match_id, handResult.state);
    await repo.saveMatchPlayers(
      match.match_id,
      seats.map((s) => ({ userId: s.userId, team: s.team, seat: s.seat })),
    );
    clearLobbyTimer(match.match_id);

    const response = await processGameEvents(handResult, match.match_id, ctx.groupId, ctx.groupJid);
    response.groupMessages.unshift({
      text: '🎮 Partida iniciada!',
      mentions: seatMentionJids(seats),
    });
    return response;
  });
}

export async function startDebugMatch(
  ctx: TrucoContext,
  mode: GameMode,
  seats: SeatPlayer[],
  scores: [number, number],
  label: string,
): Promise<TrucoResponse> {
  await cancelActiveMatchInGroup(ctx.groupId);

  const initial = { ...createInitialMatchState(mode, seats, 0), scores };
  const handResult = startHand(initial);
  if (!handResult.ok) return groupOnly(handResult.error);

  const match = await repo.createActiveMatch(ctx.groupId, mode, ctx.userId, handResult.state);
  await repo.saveMatchPlayers(
    match.match_id,
    seats.map((s) => ({ userId: s.userId, team: s.team, seat: s.seat })),
  );

  const response = await processGameEvents(handResult, match.match_id, ctx.groupId, ctx.groupJid);
  response.groupMessages.unshift({
    text: `🔧 Debug: ${label}`,
    mentions: seatMentionJids(seats),
  });
  return response;
}

async function forfeitMatch(ctx: TrucoContext, matchId: string): Promise<TrucoResponse> {
  return withMatchLock(matchId, async () => {
    const match = await repo.findMatchById(matchId);
    const state = match?.state_json;
    if (!match || match.status !== 'active' || !state) {
      return groupOnly('❌ Não há partida em andamento.');
    }

    const leaver = state.seats.find((s) => s.userId === ctx.userId);
    if (!leaver) return groupOnly('❌ Você não está na partida.');

    const winnerTeam = (1 - leaver.team) as TeamId;
    const finalState: MatchState = { ...state, phase: 'match_finished' };

    await repo.finishMatchWithResult(matchId, winnerTeam, finalState, {
      winnerUserIds: state.seats.filter((s) => s.team === winnerTeam).map((s) => s.userId),
      loserUserIds: state.seats.filter((s) => s.team !== winnerTeam).map((s) => s.userId),
      groupId: match.group_id,
      mode: state.mode,
      lastHandValue: 1,
    });
    clearAllTimers(matchId);

    return {
      groupMessages: [
        {
          text: `🏳️ ${ctx.displayName} abandonou. ${formatTeamOutcome(state.mode, winnerTeam, state.seats, 'vence!')}`,
          mentions: seatMentionJids(state.seats.filter((s) => s.team === winnerTeam)),
        },
      ],
      privateMessages: [],
    };
  });
}

// --- Processamento de eventos ---

function pushPrivateHandUpdate(
  state: MatchState,
  seat: SeatPlayer,
  response: TrucoResponse,
  title?: string,
  slotsOverride?: HandSlots,
  viraOverride?: Card,
  manilhaOverride?: string,
): void {
  const cards = getPlayerCards(state, seat.userId);
  if (!cards && !slotsOverride) return;
  if (
    !slotsOverride &&
    state.phase !== 'playing' &&
    state.phase !== 'raise_pending' &&
    state.phase !== 'mao_onze_decision'
  ) {
    return;
  }

  const slots = slotsOverride ?? cards!.slots;
  const vira = viraOverride ?? cards!.vira;
  const manilha = manilhaOverride ?? cards!.manilhaRank;
  const covered = state.currentHand?.isMaoFerro ?? false;

  response.privateMessages.push({
    jid: seatDmJid(seat),
    text: formatHandSlotsMessage(slots, vira, manilha, title, covered),
  });
}

async function processGameEvents(
  result: GameActionResult,
  matchId: string,
  groupId: number,
  groupJid: string,
): Promise<TrucoResponse> {
  if (!result.ok) return groupOnly(result.error);

  const { state, events } = result;
  const response = emptyResponse();

  if (state.phase === 'match_finished') {
    const winnerTeam = (state.scores[0] >= MATCH_WIN_SCORE ? 0 : 1) as TeamId;
    await repo.finishMatchWithResult(matchId, winnerTeam, state, {
      winnerUserIds: state.seats.filter((s) => s.team === winnerTeam).map((s) => s.userId),
      loserUserIds: state.seats.filter((s) => s.team !== winnerTeam).map((s) => s.userId),
      groupId,
      mode: state.mode,
      lastHandValue: state.currentHand?.handValue ?? 1,
    });
    clearAllTimers(matchId);
  } else {
    await repo.updateMatchState(matchId, state);
    await scheduleTurnTimeout(matchId, groupId, groupJid);
  }

  for (const ev of events) appendEventMessages(ev, state, response, events);

  // Cartas restantes após jogada (inclui última jogada da rodada anterior)
  for (const ev of events) {
    if (ev.type !== 'card_played') continue;

    if (state.currentHand?.isMaoFerro) {
      const pvTitle = '🔥 Mão de Ferro — suas cartas restantes (cobertas):';
      for (const seat of state.seats) pushPrivateHandUpdate(state, seat, response, pvTitle);
      continue;
    }

    const player = state.seats.find((s) => s.seat === ev.seat);
    if (!player) continue;

    pushPrivateHandUpdate(
      state,
      player,
      response,
      '🃏 Suas cartas restantes:',
      ev.remainingSlots,
      ev.vira,
      ev.manilhaRank,
    );
  }

  // Nova rodada: PV com 3 cartas novas para todos (sempre depois das restantes)
  const handStartedEv = events.find((e) => e.type === 'hand_started');
  if (handStartedEv?.type === 'hand_started') {
    const handState = handStartedEv.state;
    const skipMaoOnzeRepeat = handState.currentHand?.isMaoOnze && handState.maoOnze?.confirmed;
    if (handState.currentHand && handState.phase === 'playing' && !skipMaoOnzeRepeat) {
      const pvTitle = handState.currentHand.isMaoFerro
        ? '🔥 Mão de Ferro — suas cartas (cobertas):'
        : '🃏 Nova rodada — suas cartas:';
      for (const seat of handState.seats) {
        pushPrivateHandUpdate(handState, seat, response, pvTitle);
      }
    }
  }

  // Mão de Onze: cartas no PV antes de !aceitar / !correr
  const maoOnzeAfterTimeout = events.some((e) => e.type === 'mao_onze_timeout');
  if (events.some((e) => e.type === 'mao_onze_started') && state.currentHand) {
    const pvTitle = maoOnzeAfterTimeout
      ? '1️⃣1️⃣ Mão de Onze — novo baralho (vale 3 pts):'
      : '1️⃣1️⃣ Mão de Onze — suas cartas (vale 3 pts):';
    for (const seat of state.seats) pushPrivateHandUpdate(state, seat, response, pvTitle);
  }

  return response;
}

function appendEventMessages(
  ev: GameEvent,
  state: MatchState,
  response: TrucoResponse,
  allEvents: GameEvent[] = [],
): void {
  switch (ev.type) {
    case 'hand_started':
      if (state.phase === 'mao_onze_decision') break;
      response.groupMessages.push({
        text: formatHandStartedMessage(state, undefined, suitSymbol),
        mentions: seatMentionJids([
          state.seats.find((s) => s.seat === state.dealerSeat)!,
          state.seats.find((s) => s.seat === state.currentHand!.currentTurnSeat)!,
        ]),
      });
      break;
    case 'mao_onze_started': {
      if (allEvents.some((e) => e.type === 'mao_onze_timeout')) break;
      if (state.mode === '1v1') {
        const player = state.seats.find((s) => state.scores[s.team] === 11);
        response.groupMessages.push({
          text: `1️⃣1️⃣ Mão de Onze! ${player ? formatPlayerMention(player) : 'Quem tem 11'}: !aceitar ou !correr.`,
          mentions: player ? [player.whatsappJid] : seatMentionJids(state.seats),
        });
      } else {
        response.groupMessages.push({
          text: '1️⃣1️⃣ Mão de Onze! Dupla com 11: !cartas parceiro, !aceitar/!correr, depois !confirmar.',
          mentions: seatMentionJids(state.seats),
        });
      }
      break;
    }
    case 'mao_onze_timeout': {
      const redelMaoOnze = allEvents.some((e) => e.type === 'mao_onze_started');
      const decidingSeats = state.seats.filter((s) => s.team === ev.team);
      const opponentSeats = state.seats.filter((s) => s.team === ev.opponentTeam);
      response.groupMessages.push({
        text: formatMaoOnzeTimeoutMessage(
          state,
          ev.team,
          ev.opponentTeam,
          ev.points,
          redelMaoOnze,
        ),
        mentions: seatMentionJids([...decidingSeats, ...opponentSeats]),
      });
      break;
    }
    case 'mao_onze_run': {
      if (allEvents.some((e) => e.type === 'mao_onze_timeout')) break;
      const decidingSeats = state.seats.filter((s) => s.team === ev.team);
      const opponentSeats = state.seats.filter((s) => s.team === ev.opponentTeam);
      response.groupMessages.push({
        text: formatMaoOnzeRunMessage(state, ev.team, ev.opponentTeam, ev.points, ev.scores),
        mentions: seatMentionJids([...decidingSeats, ...opponentSeats]),
      });
      break;
    }
    case 'mao_ferro_started':
      response.groupMessages.push({
        text: '🔥 Mão de Ferro! Cartas cobertas. Vencedor leva a partida!',
      });
      break;
    case 'jogada_finished': {
      const msg = formatJogadaResult(
        ev.winnerSeat,
        state,
        ev.jogada,
        ev.plays,
        undefined,
        undefined,
        ev.isMaoFerro,
      );
      const seatsToMention = new Set<number>();
      for (const p of ev.plays) seatsToMention.add(p.seat);
      if (ev.winnerSeat !== 'tie') seatsToMention.add(ev.winnerSeat);
      const players = state.seats.filter((s) => seatsToMention.has(s.seat));
      response.groupMessages.push({ text: msg, mentions: seatMentionJids(players) });
      break;
    }
    case 'turn_changed': {
      const player = state.seats.find((s) => s.seat === ev.seat);
      if (player && state.phase === 'playing') {
        const notice = formatTurnNoticeForSeat(state, ev.seat);
        if (notice) {
          response.groupMessages.push({ text: notice, mentions: [player.whatsappJid] });
        }
      }
      break;
    }
    case 'card_played': {
      const player = state.seats.find((s) => s.seat === ev.seat)!;
      const cardStr =
        ev.hidden || !ev.card ? 'carta escondida 🂠' : `${ev.card.rank}${suitSymbol(ev.card.suit)}`;
      response.groupMessages.push({
        text: `${formatPlayerMention(player)} jogou ${cardStr}`,
        mentions: [player.whatsappJid],
      });
      break;
    }
    case 'raise_requested': {
      const opponentTeam = (1 - ev.team) as TeamId;
      const mentionSeats =
        state.mode === '1v1'
          ? state.seats.filter((s) => s.team === ev.team || s.team === opponentTeam)
          : state.seats.filter((s) => s.team === opponentTeam);
      response.groupMessages.push({
        text: formatRaiseRequestMessage(state, ev.level, ev.team),
        mentions: seatMentionJids(mentionSeats),
      });
      break;
    }
    case 'raise_accepted': {
      const canRaiseTeam = state.raise?.canRaiseTeam;
      const mentions =
        canRaiseTeam != null
          ? seatMentionJids(state.seats.filter((s) => s.team === canRaiseTeam))
          : undefined;
      response.groupMessages.push({
        text: formatRaiseAcceptedMessage(state, ev.newValue),
        mentions,
      });
      break;
    }
    case 'raise_refused': {
      const winnerSeats = state.seats.filter((s) => s.team === ev.team);
      response.groupMessages.push({
        text: formatRunRefusedMessage(state, ev.team, ev.points),
        mentions: seatMentionJids(winnerSeats),
      });
      break;
    }
    case 'hand_won': {
      const winnerSeats = state.seats.filter((s) => s.team === ev.team);
      response.groupMessages.push({
        text: `✨ ${formatTeamOutcome(state.mode, ev.team, state.seats, `vence a rodada (+${ev.points})! Placar: ${state.scores[0]} x ${state.scores[1]}`)}`,
        mentions: seatMentionJids(winnerSeats),
      });
      break;
    }
    case 'match_finished': {
      response.groupMessages.push({
        text: `🏆 FIM DE PARTIDA! ${formatTeamOutcome(state.mode, ev.winnerTeam, state.seats, `vence com ${state.scores[ev.winnerTeam]} pontos!`)}`,
        mentions: seatMentionJids(state.seats.filter((s) => s.team === ev.winnerTeam)),
      });
      break;
    }
    case 'hand_tied':
      response.groupMessages.push({ text: ev.message });
      break;
    case 'auto_play': {
      const player = state.seats.find((s) => s.seat === ev.seat)!;
      response.groupMessages.push({
        text: `⏱️ Tempo esgotado! ${formatPlayerMention(player)} jogou automaticamente.`,
        mentions: [player.whatsappJid],
      });
      break;
    }
  }
}

// --- Ações de jogo ---

/**
 * Toda ação lê o estado e grava dentro do mesmo lock: sem isso, dois jogadores
 * agindo no mesmo instante gravariam estados calculados a partir da mesma leitura.
 */
async function handleGameAction(
  ctx: TrucoContext,
  action: (state: MatchState) => GameActionResult,
): Promise<TrucoResponse> {
  const match = await repo.findOpenMatchByGroupId(ctx.groupId);
  if (!match || match.status !== 'active') return groupOnly('❌ Não há partida em andamento.');

  return withMatchLock(match.match_id, async () => {
    const fresh = await repo.findMatchById(match.match_id);
    const state = fresh?.state_json;
    if (!fresh || fresh.status !== 'active' || !state) {
      return groupOnly('❌ Não há partida em andamento.');
    }

    const result = action(state);
    if (!result.ok) return groupOnly(result.error);

    return processGameEvents(result, match.match_id, ctx.groupId, ctx.groupJid);
  });
}

export function play(
  ctx: TrucoContext,
  cardIndex: number,
  hidden: boolean,
): Promise<TrucoResponse> {
  return handleGameAction(ctx, (state) => playCard(state, ctx.userId, cardIndex, hidden));
}

export function truco(ctx: TrucoContext): Promise<TrucoResponse> {
  return handleGameAction(ctx, (state) => requestRaise(state, ctx.userId, 3));
}

function raiseOrCounter(ctx: TrucoContext, level: 6 | 9 | 12): Promise<TrucoResponse> {
  return handleGameAction(ctx, (state) =>
    state.phase === 'raise_pending'
      ? counterRaise(state, ctx.userId, level)
      : requestRaise(state, ctx.userId, level),
  );
}

export function seis(ctx: TrucoContext): Promise<TrucoResponse> {
  return raiseOrCounter(ctx, 6);
}

export function nove(ctx: TrucoContext): Promise<TrucoResponse> {
  return raiseOrCounter(ctx, 9);
}

export function doze(ctx: TrucoContext): Promise<TrucoResponse> {
  return raiseOrCounter(ctx, 12);
}

export function aceitar(ctx: TrucoContext): Promise<TrucoResponse> {
  return handleGameAction(ctx, (state) =>
    state.phase === 'mao_onze_decision'
      ? voteMaoOnze(state, ctx.userId, 'accept')
      : acceptRaise(state, ctx.userId),
  );
}

export function correr(ctx: TrucoContext): Promise<TrucoResponse> {
  return handleGameAction(ctx, (state) =>
    state.phase === 'mao_onze_decision'
      ? voteMaoOnze(state, ctx.userId, 'run')
      : refuseRaise(state, ctx.userId),
  );
}

export function confirmar(ctx: TrucoContext): Promise<TrucoResponse> {
  return handleGameAction(ctx, (state) => confirmMaoOnze(state, ctx.userId));
}

export async function cartasParceiro(ctx: TrucoContext): Promise<TrucoResponse> {
  const match = await repo.findOpenMatchByGroupId(ctx.groupId);
  const state = match?.state_json;
  if (!match || match.status !== 'active' || !state) {
    return groupOnly('❌ Partida ativa necessária.');
  }

  const partnerCards = getPartnerCards(state, ctx.userId);
  if (!partnerCards) {
    return groupOnly('❌ Só na Mão de Onze (2×2, dupla com 11, adversário com menos).');
  }

  const me = state.seats.find((s) => s.userId === ctx.userId);
  const partner = state.seats.find((s) => s.team === me?.team && s.userId !== ctx.userId);

  return {
    groupMessages: [{ text: '👀 Cartas do parceiro enviadas no privado.' }],
    privateMessages: [
      {
        jid: ctx.dmJid,
        text: formatPartnerCards(partner?.displayName ?? 'parceiro', partnerCards),
      },
    ],
  };
}

// --- Consultas ---

export async function getMesa(ctx: TrucoContext): Promise<TrucoResponse> {
  const match = await repo.findOpenMatchByGroupId(ctx.groupId);
  if (!match) return groupOnly('❌ Não há partida.');

  if (match.status === 'waiting' && match.lobby_json) {
    return groupOnly(formatLobbyMessage(match.lobby_json));
  }

  const state = match.state_json;
  if (!state) return groupOnly('❌ Não há partida.');

  return {
    groupMessages: [{ text: formatMesa(state), mentions: seatMentionJids(state.seats) }],
    privateMessages: [],
  };
}

export async function getHistorico(ctx: TrucoContext): Promise<TrucoResponse> {
  const match = await repo.findOpenMatchByGroupId(ctx.groupId);
  const state = match?.state_json;
  if (!match || match.status !== 'active' || !state) {
    return groupOnly('❌ Não há partida em andamento.');
  }
  return groupOnly(formatHistory(state));
}

// --- Timeouts ---

export async function handleTurnTimeout(matchId: string, groupJid: string): Promise<void> {
  const response = await withMatchLock(matchId, async () => {
    const match = await repo.findMatchById(matchId);
    const state = match?.state_json;
    if (!match || match.status !== 'active' || !state) return null;

    if (state.phase === 'mao_onze_decision') {
      const result = autoTimeoutMaoOnze(state);
      if (!result.ok) return null;
      return processGameEvents(result, matchId, match.group_id, groupJid);
    }

    if (state.phase !== 'playing' || !state.currentHand) return null;

    const currentPlayer = state.seats.find((s) => s.seat === state.currentHand!.currentTurnSeat);
    if (!currentPlayer) return null;

    const result = autoPlayBest(state, currentPlayer.userId);
    if (!result.ok) return null;
    return processGameEvents(result, matchId, match.group_id, groupJid);
  });

  if (response) await deliverResponse(groupJid, response);
}

export async function handleLobbyTimeout(matchId: string, groupJid: string): Promise<void> {
  const cancelled = await withMatchLock(matchId, async () => {
    const match = await repo.findMatchById(matchId);
    if (!match || match.status !== 'waiting') return false;
    await repo.cancelMatch(matchId);
    clearAllTimers(matchId);
    return true;
  });

  if (!cancelled) return;
  await deliverResponse(groupJid, groupOnly('🕐 Tempo da sala esgotado. Partida cancelada.'));
}

// --- Ações vindas da web ---

export type WebAction =
  | { type: 'play'; cardSlot: number; hidden: boolean }
  | { type: 'raise'; level: 3 | 6 | 9 | 12 }
  | { type: 'accept' }
  | { type: 'refuse' }
  | { type: 'confirm' };

export type WebActionResult =
  | { ok: true; state: MatchState }
  | { ok: false; error: string; status: number };

function engineActionFor(action: WebAction, userId: string) {
  return (state: MatchState): GameActionResult => {
    switch (action.type) {
      case 'play':
        return playCard(state, userId, action.cardSlot, action.hidden);
      case 'raise':
        if (action.level === 3) return requestRaise(state, userId, 3);
        return state.phase === 'raise_pending'
          ? counterRaise(state, userId, action.level)
          : requestRaise(state, userId, action.level);
      case 'accept':
        return state.phase === 'mao_onze_decision'
          ? voteMaoOnze(state, userId, 'accept')
          : acceptRaise(state, userId);
      case 'refuse':
        return state.phase === 'mao_onze_decision'
          ? voteMaoOnze(state, userId, 'run')
          : refuseRaise(state, userId);
      case 'confirm':
        return confirmMaoOnze(state, userId);
    }
  };
}

/**
 * A partida continua ancorada num grupo do WhatsApp, então uma jogada feita no
 * navegador precisa aparecer no grupo do mesmo jeito que uma jogada por comando.
 */
export async function applyWebAction(
  matchId: string,
  userId: string,
  action: WebAction,
): Promise<WebActionResult> {
  type Outcome =
    | { ok: false; error: string; status: number }
    | { ok: true; state: MatchState; groupJid: string; response: TrucoResponse };

  const outcome = await withMatchLock<Outcome>(matchId, async () => {
    const match = await repo.findMatchById(matchId);
    const state = match?.state_json;
    if (!match || match.status !== 'active' || !state) {
      return { ok: false, error: 'match_not_active', status: 404 };
    }

    const group = await repo.findGroupById(match.group_id);
    if (!group) return { ok: false, error: 'group_not_found', status: 404 };

    const result = engineActionFor(action, userId)(state);
    if (!result.ok) return { ok: false, error: result.error, status: 400 };

    const response = await processGameEvents(result, matchId, match.group_id, group.whatsapp_jid);
    return { ok: true, state: result.state, groupJid: group.whatsapp_jid, response };
  });

  if (!outcome.ok) return outcome;

  await deliverResponse(outcome.groupJid, outcome.response);
  return { ok: true, state: outcome.state };
}

/**
 * Estado seguro para o navegador. Além de esconder as cartas alheias, expõe
 * `cardsLeft` porque quantas cartas cada assento ainda tem é informação pública.
 */
export interface RedactedMatchState extends MatchState {
  cardsLeft: Record<number, number>;
}

export function redactStateForUser(
  state: MatchState,
  userId: string | null,
): RedactedMatchState {
  const hand = state.currentHand;
  if (!hand) return { ...state, cardsLeft: {} };

  const viewerSeat = state.seats.find((s) => s.userId === userId)?.seat;
  const cardsLeft: Record<number, number> = {};
  const hands: typeof hand.hands = {};

  for (const [key, slots] of Object.entries(hand.hands)) {
    const seat = Number(key);
    cardsLeft[seat] = slots.filter((c) => c !== null).length;
    hands[seat] = seat === viewerSeat ? slots : [null, null, null];
  }

  return {
    ...state,
    currentHand: {
      ...hand,
      hands,
      table: hand.table.map((t) => (t.hidden ? { ...t, card: null } : t)),
    },
    cardsLeft,
  };
}

// --- Entrega das mensagens ---

export async function deliverResponse(
  groupJid: string,
  response: TrucoResponse,
  sock: WASocket | null = socket,
): Promise<void> {
  if (!sock) {
    console.warn('[TRUCO] Socket indisponível; mensagens descartadas.');
    return;
  }

  for (const pm of response.privateMessages) {
    await sock.sendMessage(pm.jid, { text: pm.text }).catch(reportError('envio no privado'));
  }
  for (const gm of response.groupMessages) {
    await sock
      .sendMessage(groupJid, { text: gm.text, mentions: gm.mentions ?? [] })
      .catch(reportError('envio no grupo'));
  }
}
