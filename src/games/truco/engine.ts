import type {
  Card,
  GameActionResult,
  GameEvent,
  GameMode,
  HandState,
  HandValue,
  HandSlots,
  LobbySlot,
  LobbyState,
  MatchState,
  RaiseLevel,
  Rank,
  SeatPlayer,
  TeamId,
} from './types.js';
import { nextSeat, playerCountForMode, teamForSeat } from './types.js';
import { createDeck, dealCards, getManilhaRank, shuffleDeck } from './deck.js';
import {
  findBestSlotIndex,
  nextRaiseLevel,
  pointsOnRefuse,
  raiseLevelToValue,
  resolveHandWinner,
  resolveRoundWinner,
} from './compare.js';

export const MATCH_WIN_SCORE = 12;

function addTeamPoints(scores: [number, number], team: TeamId, points: number): [number, number] {
  const next: [number, number] = [...scores] as [number, number];
  next[team] = Math.min(MATCH_WIN_SCORE, next[team] + points);
  return next;
}

function seatsPlayedInJogada(table: readonly { seat: number }[]): Set<number> {
  return new Set(table.map((t) => t.seat));
}

function isJogadaComplete(table: readonly { seat: number }[], playerCount: number): boolean {
  return seatsPlayedInJogada(table).size >= playerCount;
}

function nextSeatToPlay(
  fromSeat: number,
  table: readonly { seat: number }[],
  playerCount: number,
): number {
  const played = seatsPlayedInJogada(table);
  let seat = fromSeat;
  for (let i = 0; i < playerCount; i++) {
    seat = nextSeat(seat, playerCount);
    if (!played.has(seat)) return seat;
  }
  return nextSeat(fromSeat, playerCount);
}

function turnSeatAfterRaiseResponse(hand: HandState, mode: GameMode): number {
  const count = playerCountForMode(mode);
  const preferred = hand.currentTurnSeat;
  const played = seatsPlayedInJogada(hand.table);
  if (!played.has(preferred)) return preferred;
  return nextSeatToPlay(preferred, hand.table, count);
}

function nowIso(): string {
  return new Date().toISOString();
}

function notYourSideToRaiseError(mode: GameMode): string {
  return mode === '1v1'
    ? '❌ Não é você quem pode aumentar agora.'
    : '❌ Não é sua dupla quem pode aumentar agora.';
}

function notYourSideToCounterError(mode: GameMode): string {
  return mode === '1v1' ? '❌ Não é você quem pode aumentar.' : '❌ Não é sua dupla quem pode aumentar.';
}

function maoOnzeDecisionError(mode: GameMode): string {
  return mode === '1v1'
    ? '❌ Apenas quem tem 11 pontos decide.'
    : '❌ Apenas a dupla com 11 pontos decide.';
}

export function createLobbySlots(mode: GameMode): LobbySlot[] {
  const count = playerCountForMode(mode);
  return Array.from({ length: count }, (_, seat) => ({
    seat,
    team: teamForSeat(seat, mode),
    userId: null,
    whatsappJid: null,
    dmJid: null,
    displayName: null,
    reservedForUserId: null,
  }));
}

export function firstPlayerSeat(dealerSeat: number, playerCount: number): number {
  return nextSeat(dealerSeat, playerCount);
}

export function nextDealerSeat(currentDealer: number, playerCount: number): number {
  return (currentDealer - 1 + playerCount) % playerCount;
}

/** Após uma rodada terminar: pé passa no sentido anti-horário; mão = à direita do novo pé. */
export function advanceDealerForNextRodada(
  finishingDealerSeat: number,
  playerCount: number,
): { dealerSeat: number; roundStarterSeat: number } {
  const dealerSeat = nextDealerSeat(finishingDealerSeat, playerCount);
  const roundStarterSeat = firstPlayerSeat(dealerSeat, playerCount);
  return { dealerSeat, roundStarterSeat };
}

function prepareStateForNextRodada(state: MatchState, finishingDealerSeat: number): MatchState {
  const count = playerCountForMode(state.mode);
  const { dealerSeat } = advanceDealerForNextRodada(finishingDealerSeat, count);
  return {
    ...state,
    phase: 'playing',
    dealerSeat,
    currentHand: null,
    raise: null,
    lastActionAt: nowIso(),
    turnStartedAt: null,
  };
}

export function createInitialMatchState(
  mode: GameMode,
  seats: SeatPlayer[],
  creatorSeat: number,
): MatchState {
  return {
    phase: 'playing',
    mode,
    scores: [0, 0],
    seats,
    dealerSeat: creatorSeat,
    currentHand: null,
    raise: null,
    maoOnze: null,
    lastActionAt: nowIso(),
    turnStartedAt: null,
  };
}

function buildHandsRecord(hands: Card[][], seats: SeatPlayer[]): Record<number, HandSlots> {
  const record: Record<number, HandSlots> = {};
  for (const s of seats) {
    const dealt = hands[s.seat];
    record[s.seat] = [dealt[0] ?? null, dealt[1] ?? null, dealt[2] ?? null];
  }
  return record;
}

export function startHand(state: MatchState, random = Math.random): GameActionResult {
  const count = playerCountForMode(state.mode);
  const deck = shuffleDeck(createDeck(), random);
  const { hands, vira } = dealCards(deck, count);
  const manilhaRank = getManilhaRank(vira);

  const team0Score = state.scores[0];
  const team1Score = state.scores[1];
  const isMaoFerro = team0Score === 11 && team1Score === 11;
  const isMaoOnze =
    !isMaoFerro &&
    ((team0Score === 11 && team1Score < 11) || (team1Score === 11 && team0Score < 11));

  if (isMaoOnze) {
    const team: TeamId = team0Score === 11 ? 0 : 1;
    const roundStarter = firstPlayerSeat(state.dealerSeat, count);
    const hand: HandState = {
      vira,
      manilhaRank,
      handValue: 3,
      isMaoOnze: true,
      isMaoFerro: false,
      round: 1,
      dealerSeat: state.dealerSeat,
      roundStarterSeat: roundStarter,
      currentTurnSeat: roundStarter,
      roundResults: [],
      hands: buildHandsRecord(hands, state.seats),
      table: [],
      history: [],
    };
    const newState: MatchState = {
      ...state,
      phase: 'mao_onze_decision',
      currentHand: hand,
      raise: null,
      maoOnze: {
        team,
        votes: {},
        confirmed: false,
      },
      lastActionAt: nowIso(),
      turnStartedAt: nowIso(),
    };
    return {
      ok: true,
      state: newState,
      events: [{ type: 'mao_onze_started', team }],
    };
  }

  const roundStarter = firstPlayerSeat(state.dealerSeat, count);
  const handValue: HandValue = isMaoFerro ? 3 : 1;

  const hand: HandState = {
    vira,
    manilhaRank,
    handValue,
    isMaoOnze: false,
    isMaoFerro,
    round: 1,
    dealerSeat: state.dealerSeat,
    roundStarterSeat: roundStarter,
    currentTurnSeat: roundStarter,
    roundResults: [],
    hands: buildHandsRecord(hands, state.seats),
    table: [],
    history: [],
  };

  const newState: MatchState = {
    ...state,
    phase: 'playing',
    currentHand: hand,
    raise: null,
    maoOnze: null,
    lastActionAt: nowIso(),
    turnStartedAt: nowIso(),
  };

  const events: GameEvent[] = [{ type: 'hand_started', state: newState }];
  if (isMaoFerro) events.unshift({ type: 'mao_ferro_started' });
  events.push({ type: 'turn_changed', seat: roundStarter });

  return { ok: true, state: newState, events };
}

export function getSeatByUserId(state: MatchState, userId: string): SeatPlayer | undefined {
  return state.seats.find((s) => s.userId === userId);
}

export function getPartnerSeat(state: MatchState, seat: number): number | null {
  if (state.mode === '1v1') return null;
  const team = state.seats.find((s) => s.seat === seat)?.team;
  if (team === undefined) return null;
  const partner = state.seats.find((s) => s.team === team && s.seat !== seat);
  return partner?.seat ?? null;
}

function finishHand(
  state: MatchState,
  winnerTeam: TeamId | 'tie',
  pointsOverride?: number,
): GameActionResult {
  const hand = state.currentHand!;
  const events: GameEvent[] = [];

  if (winnerTeam === 'tie') {
    const newState = prepareStateForNextRodada(state, hand.dealerSeat);
    events.push({ type: 'hand_tied', message: 'Rodada empatada — ninguém pontua.' });
    const next = startHand(newState);
    if (next.ok) {
      return { ok: true, state: next.state, events: [...events, ...next.events] };
    }
    return next;
  }

  const points = pointsOverride ?? hand.handValue;
  const newScores = addTeamPoints(state.scores, winnerTeam, points);
  events.push({ type: 'hand_won', team: winnerTeam, points });

  if (newScores[winnerTeam] >= MATCH_WIN_SCORE) {
    return {
      ok: true,
      state: {
        ...state,
        phase: 'match_finished',
        scores: newScores,
        currentHand: null,
        raise: null,
        lastActionAt: nowIso(),
        turnStartedAt: null,
      },
      events: [...events, { type: 'match_finished', winnerTeam }],
    };
  }

  const newState: MatchState = {
    ...prepareStateForNextRodada(state, hand.dealerSeat),
    scores: newScores,
  };

  const next = startHand(newState);
  if (!next.ok) return next;
  return { ok: true, state: next.state, events: [...events, ...next.events] };
}

function advanceAfterRound(state: MatchState): GameActionResult {
  const hand = state.currentHand!;
  const count = playerCountForMode(state.mode);

  if (!isJogadaComplete(hand.table, count)) {
    const nextTurn = nextSeatToPlay(hand.currentTurnSeat, hand.table, count);
    return {
      ok: true,
      state: {
        ...state,
        currentHand: { ...hand, currentTurnSeat: nextTurn },
        turnStartedAt: nowIso(),
      },
      events: [{ type: 'turn_changed', seat: nextTurn }],
    };
  }

  const winner = resolveRoundWinner(hand.table, hand.manilhaRank, state.seats, hand.isMaoFerro);
  const roundResult = { winnerSeat: winner, roundNumber: hand.round } as const;
  const roundResults = [...hand.roundResults, roundResult];

  const jogadaPlays = hand.table
    .filter((p): p is { seat: number; card: Card; hidden: boolean } => p.card !== null)
    .map((p) => ({ seat: p.seat, card: p.card, hidden: p.hidden }));

  const events: GameEvent[] = [
    {
      type: 'jogada_finished',
      winnerSeat: winner,
      jogada: hand.round,
      plays: jogadaPlays,
      isMaoFerro: hand.isMaoFerro,
    },
    { type: 'round_won', seat: winner, round: hand.round },
  ];

  const handWinner = resolveHandWinner(roundResults, state.seats);

  if (handWinner === 0 || handWinner === 1) {
    const updated: MatchState = {
      ...state,
      currentHand: { ...hand, roundResults },
    };
    const finished = finishHand(updated, handWinner);
    if (!finished.ok) return finished;
    return { ok: true, state: finished.state, events: [...events, ...finished.events] };
  }

  if (handWinner === 'tie') {
    const updated: MatchState = {
      ...state,
      currentHand: { ...hand, roundResults },
    };
    const finished = finishHand(updated, 'tie');
    if (!finished.ok) return finished;
    return { ok: true, state: finished.state, events: [...events, ...finished.events] };
  }

  // Rodada ainda não decidida — próxima jogada (mesmas cartas restantes)
  // Vencedor da jogada abre a próxima; se empate, mantém quem abriu
  const nextStarter = winner === 'tie' ? hand.roundStarterSeat : winner;
  const nextJogada = (hand.round + 1) as 1 | 2 | 3;

  const newHand: HandState = {
    ...hand,
    round: nextJogada,
    roundResults,
    roundStarterSeat: nextStarter,
    currentTurnSeat: nextStarter,
    table: [],
  };

  events.push({ type: 'turn_changed', seat: nextStarter });

  return {
    ok: true,
    state: {
      ...state,
      currentHand: newHand,
      lastActionAt: nowIso(),
      turnStartedAt: nowIso(),
    },
    events,
  };
}

export function playCard(
  state: MatchState,
  userId: string,
  cardIndex: number,
  hidden = false,
): GameActionResult {
  if (state.phase !== 'playing' || !state.currentHand) {
    return { ok: false, error: '❌ Não há mão em andamento.' };
  }
  if (state.raise?.pendingLevel != null && !state.raise.responded) {
    return { ok: false, error: '❌ Há um pedido de Truco pendente.' };
  }

  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return { ok: false, error: '❌ Você não está nesta partida.' };
  if (seatPlayer.seat !== state.currentHand.currentTurnSeat) {
    return { ok: false, error: '❌ Não é sua vez.' };
  }

  const hand = state.currentHand;
  if (hand.table.some((t) => t.seat === seatPlayer.seat)) {
    return { ok: false, error: '❌ Você já jogou nesta jogada.' };
  }

  const slots = hand.hands[seatPlayer.seat];
  if (cardIndex < 1 || cardIndex > 3) {
    return { ok: false, error: '❌ Carta inválida. Use 1, 2 ou 3.' };
  }

  const card = slots[cardIndex - 1];
  if (card === null) {
    return { ok: false, error: '❌ Essa carta já foi jogada. Confira seus slots no PV (1, 2 ou 3).' };
  }

  if (hidden && hand.round === 1) {
    return { ok: false, error: '❌ Não é permitido esconder carta na primeira jogada.' };
  }

  const newSlots: HandSlots = [...slots] as HandSlots;
  newSlots[cardIndex - 1] = null;

  const playHidden = hidden || hand.isMaoFerro;

  const tableEntry = {
    seat: seatPlayer.seat,
    card,
    hidden: playHidden,
  };

  const historyEntry = {
    round: hand.round,
    seat: seatPlayer.seat,
    displayName: seatPlayer.displayName,
    card,
    hidden: playHidden,
    cardSlot: cardIndex as 1 | 2 | 3,
  };

  const newTable = [...hand.table, tableEntry];
  const count = playerCountForMode(state.mode);
  const events: GameEvent[] = [
    {
      type: 'card_played',
      seat: seatPlayer.seat,
      card: playHidden ? null : card,
      hidden: playHidden,
      cardSlot: cardIndex as 1 | 2 | 3,
      remainingSlots: newSlots,
      vira: hand.vira,
      manilhaRank: hand.manilhaRank,
    },
  ];

  const updatedHand: HandState = {
    ...hand,
    hands: { ...hand.hands, [seatPlayer.seat]: newSlots },
    table: newTable,
    history: [...hand.history, historyEntry],
  };

  let newState: MatchState = {
    ...state,
    currentHand: updatedHand,
    lastActionAt: nowIso(),
  };

  if (!isJogadaComplete(newTable, count)) {
    const nextTurn = nextSeatToPlay(seatPlayer.seat, newTable, count);
    newState = {
      ...newState,
      currentHand: {
        ...updatedHand,
        currentTurnSeat: nextTurn,
      },
      turnStartedAt: nowIso(),
    };
    events.push({ type: 'turn_changed', seat: nextTurn });
    return { ok: true, state: newState, events };
  }

  const advanced = advanceAfterRound(newState);
  if (!advanced.ok) return advanced;
  return { ok: true, state: advanced.state, events: [...events, ...advanced.events] };
}

export function autoPlayBest(state: MatchState, userId: string): GameActionResult {
  if (!state.currentHand) return { ok: false, error: '❌ Não há mão em andamento.' };
  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return { ok: false, error: '❌ Você não está nesta partida.' };

  const slots = state.currentHand.hands[seatPlayer.seat];
  const bestSlot = findBestSlotIndex(slots, state.currentHand.manilhaRank);
  if (bestSlot < 0) return { ok: false, error: '❌ Você não tem cartas.' };
  const bestIdx = bestSlot + 1;
  const result = playCard(state, userId, bestIdx, false);
  if (result.ok) {
    result.events.unshift({ type: 'auto_play', seat: seatPlayer.seat, cardIndex: bestIdx });
  }
  return result;
}

export function requestRaise(
  state: MatchState,
  userId: string,
  level: RaiseLevel,
): GameActionResult {
  if (state.phase !== 'playing' || !state.currentHand) {
    return { ok: false, error: '❌ Não há mão em andamento.' };
  }
  if (state.currentHand.isMaoOnze || state.currentHand.isMaoFerro) {
    return { ok: false, error: '❌ Não é permitido pedir Truco nesta mão.' };
  }
  if (state.raise?.pendingLevel != null && !state.raise.responded) {
    return { ok: false, error: '❌ Já existe um pedido pendente.' };
  }

  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return { ok: false, error: '❌ Você não está nesta partida.' };
  if (seatPlayer.seat !== state.currentHand.currentTurnSeat) {
    return { ok: false, error: '❌ Só pode pedir Truco na sua vez, antes de jogar.' };
  }
  if (state.currentHand.table.some((t) => t.seat === seatPlayer.seat)) {
    return { ok: false, error: '❌ Você já jogou nesta jogada.' };
  }

  const currentValue = state.currentHand.handValue;

  if (state.scores[seatPlayer.team] === 11) {
    return { ok: false, error: '❌ Na Mão de Onze você não pode pedir Truco.' };
  }

  if (level === 3 && currentValue !== 1) {
    return { ok: false, error: '❌ Truco só pode ser pedido quando a mão vale 1.' };
  }
  if (level === 6 && currentValue !== 3) {
    return { ok: false, error: '❌ Seis só pode ser pedido quando a mão vale 3.' };
  }
  if (level === 9 && currentValue !== 6) {
    return { ok: false, error: '❌ Nove só pode ser pedido quando a mão vale 6.' };
  }
  if (level === 12 && currentValue !== 9) {
    return { ok: false, error: '❌ Doze só pode ser pedido quando a mão vale 9.' };
  }

  if (state.raise?.canRaiseTeam != null) {
    if (state.raise.canRaiseTeam !== seatPlayer.team) {
      return { ok: false, error: notYourSideToRaiseError(state.mode) };
    }
  } else if (level !== 3) {
    return { ok: false, error: '❌ Você não pode pedir esse aumento agora.' };
  }

  const opponentTeam = (1 - seatPlayer.team) as TeamId;

  const newState: MatchState = {
    ...state,
    phase: 'raise_pending',
    raise: {
      currentValue,
      pendingLevel: level,
      requestedByTeam: seatPlayer.team,
      canRaiseTeam: null,
      waitingResponseFromTeam: opponentTeam,
      responded: false,
    },
    lastActionAt: nowIso(),
  };

  return {
    ok: true,
    state: newState,
    events: [{ type: 'raise_requested', level, team: seatPlayer.team }],
  };
}

export function acceptRaise(state: MatchState, userId: string): GameActionResult {
  if (state.phase !== 'raise_pending' || !state.raise || !state.currentHand) {
    return { ok: false, error: '❌ Não há pedido pendente.' };
  }
  if (state.raise.responded) {
    return { ok: false, error: '❌ Esse pedido já foi respondido.' };
  }

  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return { ok: false, error: '❌ Você não está nesta partida.' };
  if (seatPlayer.team === state.raise.requestedByTeam) {
    return { ok: false, error: '❌ Você não pode aceitar o próprio pedido.' };
  }

  const newValue = raiseLevelToValue(state.raise.pendingLevel!);
  const acceptingTeam = seatPlayer.team;

  const newState: MatchState = {
    ...state,
    phase: 'playing',
    currentHand: { ...state.currentHand, handValue: newValue },
    raise: {
      currentValue: newValue,
      pendingLevel: null,
      requestedByTeam: state.raise.requestedByTeam,
      canRaiseTeam: acceptingTeam,
      waitingResponseFromTeam: acceptingTeam,
      responded: true,
    },
    lastActionAt: nowIso(),
    turnStartedAt: nowIso(),
  };

  const updatedHand = newState.currentHand!;
  const turnSeat = turnSeatAfterRaiseResponse(updatedHand, state.mode);
  if (turnSeat !== updatedHand.currentTurnSeat) {
    newState.currentHand = { ...updatedHand, currentTurnSeat: turnSeat };
  }

  return {
    ok: true,
    state: newState,
    events: [
      { type: 'raise_accepted', newValue },
      { type: 'turn_changed', seat: turnSeat },
    ],
  };
}

export function refuseRaise(state: MatchState, userId: string): GameActionResult {
  if (state.phase !== 'raise_pending' || !state.raise || !state.currentHand) {
    return { ok: false, error: '❌ Não há pedido pendente.' };
  }
  if (state.raise.responded) {
    return { ok: false, error: '❌ Esse pedido já foi respondido.' };
  }

  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return { ok: false, error: '❌ Você não está nesta partida.' };
  if (seatPlayer.team === state.raise.requestedByTeam) {
    return { ok: false, error: '❌ Você não pode correr do próprio pedido.' };
  }

  const points = pointsOnRefuse(state.raise.pendingLevel ?? state.currentHand.handValue);
  const winnerTeam = state.raise.requestedByTeam;

  const events: GameEvent[] = [{ type: 'raise_refused', team: winnerTeam, points }];

  const newScores = addTeamPoints(state.scores, winnerTeam, points);

  if (newScores[winnerTeam] >= MATCH_WIN_SCORE) {
    return {
      ok: true,
      state: {
        ...state,
        phase: 'match_finished',
        scores: newScores,
        currentHand: null,
        raise: null,
        lastActionAt: nowIso(),
        turnStartedAt: null,
      },
      events: [...events, { type: 'match_finished', winnerTeam }],
    };
  }

  const finishingDealer = state.currentHand?.dealerSeat ?? state.dealerSeat;
  const interim: MatchState = {
    ...prepareStateForNextRodada(state, finishingDealer),
    scores: newScores,
  };

  const next = startHand(interim);
  if (!next.ok) return next;
  return { ok: true, state: next.state, events: [...events, ...next.events] };
}

export function counterRaise(
  state: MatchState,
  userId: string,
  level: 6 | 9 | 12,
): GameActionResult {
  if (state.phase !== 'raise_pending' || !state.raise) {
    return { ok: false, error: '❌ Não há pedido pendente para aumentar.' };
  }
  if (state.raise.responded) {
    return { ok: false, error: '❌ Esse pedido já foi respondido.' };
  }

  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return { ok: false, error: '❌ Você não está nesta partida.' };
  if (seatPlayer.team !== state.raise.waitingResponseFromTeam) {
    return { ok: false, error: notYourSideToCounterError(state.mode) };
  }

  const expected = nextRaiseLevel(state.raise.pendingLevel ?? state.raise.currentValue);
  if (expected !== level) {
    return { ok: false, error: `❌ Agora só é possível pedir ${expected ?? 'nada'}.` };
  }

  const opponentTeam = (1 - seatPlayer.team) as TeamId;
  const newState: MatchState = {
    ...state,
    raise: {
      ...state.raise,
      pendingLevel: level,
      requestedByTeam: seatPlayer.team,
      waitingResponseFromTeam: opponentTeam,
    },
    lastActionAt: nowIso(),
  };

  return {
    ok: true,
    state: newState,
    events: [{ type: 'raise_requested', level, team: seatPlayer.team }],
  };
}

export function voteMaoOnze(
  state: MatchState,
  userId: string,
  vote: 'accept' | 'run',
): GameActionResult {
  if (state.phase !== 'mao_onze_decision' || !state.maoOnze) {
    return { ok: false, error: '❌ Não há decisão de Mão de Onze pendente.' };
  }

  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return { ok: false, error: '❌ Você não está nesta partida.' };
  if (seatPlayer.team !== state.maoOnze.team) {
    return { ok: false, error: maoOnzeDecisionError(state.mode) };
  }

  const votes = { ...state.maoOnze.votes, [userId]: vote };

  const teamPlayers = state.seats.filter((s) => s.team === state.maoOnze!.team);
  const allVoted = teamPlayers.every((p) => votes[p.userId] != null);
  const allSame =
    allVoted && teamPlayers.every((p) => votes[p.userId] === votes[teamPlayers[0].userId]);

  if (allVoted && !allSame) {
    return {
      ok: false,
      error:
        state.mode === '1v1'
          ? '❌ Voto inválido.'
          : '❌ Votos divergentes. Combinem e votem igual (!aceitar ou !correr), depois !confirmar.',
    };
  }

  const newState: MatchState = {
    ...state,
    maoOnze: { ...state.maoOnze, votes },
    lastActionAt: nowIso(),
  };

  if (state.mode === '1v1') {
    return confirmMaoOnze(newState, userId);
  }

  return {
    ok: true,
    state: newState,
    events: [],
  };
}

export function confirmMaoOnze(state: MatchState, userId: string): GameActionResult {
  if (state.phase !== 'mao_onze_decision' || !state.maoOnze) {
    return { ok: false, error: '❌ Não há decisão de Mão de Onze pendente.' };
  }

  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return { ok: false, error: '❌ Você não está nesta partida.' };
  if (seatPlayer.team !== state.maoOnze.team) {
    return { ok: false, error: maoOnzeDecisionError(state.mode) };
  }

  const teamPlayers = state.seats.filter((s) => s.team === state.maoOnze!.team);
  const votes = state.maoOnze.votes;
  const allVoted = teamPlayers.every(
    (p) => votes[p.userId] === 'accept' || votes[p.userId] === 'run',
  );
  if (!allVoted) {
    return { ok: false, error: '❌ Todos os parceiros precisam votar antes de !confirmar.' };
  }

  const firstVote = votes[teamPlayers[0].userId];
  const consensus = teamPlayers.every((p) => votes[p.userId] === firstVote);
  if (!consensus) {
    return { ok: false, error: '❌ Votos divergentes. Combinem antes de !confirmar.' };
  }

  if (firstVote === 'run') {
    const opponentTeam = (1 - state.maoOnze.team) as TeamId;
    const newScores = addTeamPoints(state.scores, opponentTeam, 1);

    if (newScores[opponentTeam] >= MATCH_WIN_SCORE) {
      return {
        ok: true,
        state: {
          ...state,
          phase: 'match_finished',
          scores: newScores,
          maoOnze: null,
          lastActionAt: nowIso(),
        },
        events: [
          {
            type: 'mao_onze_run',
            team: state.maoOnze.team,
            opponentTeam,
            points: 1,
            scores: newScores,
          },
          { type: 'match_finished', winnerTeam: opponentTeam },
        ],
      };
    }

    const interim: MatchState = {
      ...prepareStateForNextRodada(state, state.dealerSeat),
      scores: newScores,
      maoOnze: null,
    };
    const next = startHand(interim);
    if (!next.ok) return next;
    return {
      ok: true,
      state: next.state,
      events: [
        {
          type: 'mao_onze_run',
          team: state.maoOnze.team,
          opponentTeam,
          points: 1,
          scores: newScores,
        },
        ...next.events,
      ],
    };
  }

  const hand = state.currentHand;
  if (!hand) {
    return { ok: false, error: '❌ Cartas da Mão de Onze não encontradas.' };
  }

  const count = playerCountForMode(state.mode);
  const roundStarter = firstPlayerSeat(state.dealerSeat, count);

  const newState: MatchState = {
    ...state,
    phase: 'playing',
    currentHand: {
      ...hand,
      roundStarterSeat: roundStarter,
      currentTurnSeat: roundStarter,
    },
    maoOnze: { ...state.maoOnze, confirmed: true },
    turnStartedAt: nowIso(),
    lastActionAt: nowIso(),
  };

  return {
    ok: true,
    state: newState,
    events: [{ type: 'hand_started', state: newState }, { type: 'turn_changed', seat: roundStarter }],
  };
}

export function autoTimeoutMaoOnze(state: MatchState): GameActionResult {
  if (state.phase !== 'mao_onze_decision' || !state.maoOnze) {
    return { ok: false, error: '❌ Não há decisão de Mão de Onze pendente.' };
  }

  const team = state.maoOnze.team;
  const opponentTeam = (1 - team) as TeamId;
  const teamPlayers = state.seats.filter((s) => s.team === team);
  const votes: Record<string, 'accept' | 'run'> = {};
  for (const p of teamPlayers) {
    votes[p.userId] = 'run';
  }

  const withVotes: MatchState = {
    ...state,
    maoOnze: { ...state.maoOnze, votes },
  };

  const result = confirmMaoOnze(withVotes, teamPlayers[0]!.userId);
  if (!result.ok) return result;

  result.events.unshift({
    type: 'mao_onze_timeout',
    team,
    opponentTeam,
    points: 1,
  });

  return result;
}

export function getPartnerCards(state: MatchState, userId: string): HandSlots | null {
  if (!state.currentHand) return null;
  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return null;

  const teamScore = state.scores[seatPlayer.team];
  const otherScore = state.scores[1 - seatPlayer.team];
  if (!(teamScore === 11 && otherScore < 11)) return null;

  const partnerSeat = getPartnerSeat(state, seatPlayer.seat);
  if (partnerSeat === null) return null;
  return state.currentHand.hands[partnerSeat] ?? null;
}

export function getPlayerCards(
  state: MatchState,
  userId: string,
): {
  slots: HandSlots;
  vira: Card;
  manilhaRank: Rank;
} | null {
  if (!state.currentHand) return null;
  const seatPlayer = getSeatByUserId(state, userId);
  if (!seatPlayer) return null;
  return {
    slots: state.currentHand.hands[seatPlayer.seat],
    vira: state.currentHand.vira,
    manilhaRank: state.currentHand.manilhaRank,
  };
}

export function isLobbyFull(lobby: LobbyState): boolean {
  return lobby.slots.every((s) => s.userId !== null);
}

export function assignLobbySeat(
  lobby: LobbyState,
  userId: string,
  whatsappJid: string,
  displayName: string,
  dmJid?: string,
): { ok: true; lobby: LobbyState } | { ok: false; error: string } {
  if (lobby.slots.some((s) => s.userId === userId)) {
    return { ok: false, error: '❌ Você já está na partida.' };
  }

  const reserved = lobby.slots.find((s) => s.userId === null && s.reservedForUserId === userId);
  const free = reserved ?? lobby.slots.find((s) => s.userId === null && !s.reservedForUserId);

  if (!free) return { ok: false, error: '❌ Não há vagas disponíveis.' };

  const slots = lobby.slots.map((s) =>
    s.seat === free.seat
      ? { ...s, userId, whatsappJid, dmJid: dmJid ?? userId, displayName, reservedForUserId: null }
      : s,
  );

  return { ok: true, lobby: { ...lobby, slots } };
}
