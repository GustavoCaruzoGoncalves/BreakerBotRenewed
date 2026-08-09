import type {
  MatchState,
  RaiseLevel,
  SeatPlayer,
  TeamId,
  Card,
  HandSlots,
  CardSlotView,
  HandValue,
  GameMode,
  Suit,
} from './types.js';
import { cardToString, SUIT_SYMBOL, HAND_SLOT_COUNT } from './types.js';
import { nextRaiseLevel, pointsOnRefuse } from './compare.js';

export function formatModeLabel(mode: GameMode): string {
  return mode === '1v1' ? 'Solo' : '2×2';
}

export function formatSideLabel(
  mode: GameMode,
  team: TeamId,
  seats?: readonly SeatPlayer[],
  resolveJid?: (seat: SeatPlayer) => string,
): string {
  if (mode === '1v1') {
    const player = seats?.find((s) => s.team === team);
    if (player) return formatPlayerMention(player, resolveJid);
    return team === 0 ? 'Jogador A' : 'Jogador B';
  }
  return team === 0 ? 'Dupla A' : 'Dupla B';
}

export function formatOpponentRespondentLabel(mode: GameMode): string {
  return mode === '1v1' ? 'Adversário' : 'Dupla adversária';
}

export function formatTeamOutcome(
  mode: GameMode,
  team: TeamId,
  seats: readonly SeatPlayer[],
  outcome: string,
  resolveJid?: (seat: SeatPlayer) => string,
): string {
  return `${formatSideLabel(mode, team, seats, resolveJid)} ${outcome}`;
}

export function handSlotsToViews(slots: HandSlots): CardSlotView[] {
  const views: CardSlotView[] = [];
  for (let i = 0; i < HAND_SLOT_COUNT; i++) {
    const card = slots[i];
    if (card) views.push({ id: (i + 1) as 1 | 2 | 3, card });
  }
  return views;
}

export function formatHandSlotLines(slots: HandSlots): string[] {
  return handSlotsToViews(slots).map((s) => `${s.id}️⃣ ${cardToString(s.card)}`);
}

export function formatHandSlotLinesCovered(slots: HandSlots): string[] {
  return handSlotsToViews(slots).map((s) => `${s.id}️⃣ 🂠 (coberta)`);
}

export function formatHandSlotsMessage(
  slots: HandSlots,
  vira: Card,
  manilhaRank: string,
  title = '🃏 Suas cartas nesta rodada:',
  covered = false,
): string {
  const lines = covered ? formatHandSlotLinesCovered(slots) : formatHandSlotLines(slots);
  const cardsBlock = lines.length > 0 ? lines.join('\n') : '(nenhuma carta restante nesta rodada)';
  const footer = covered
    ? 'Mão de Ferro — cartas sempre cobertas. Use !jogar N no grupo.'
    : 'Os números (1, 2, 3) não mudam — use !jogar N ou !esconder N no grupo.';
  return (
    `${title}\n\n${cardsBlock}\n\n` +
    `Vira: ${cardToString(vira)}\n` +
    `Manilha: ${manilhaRank}\n\n` +
    footer
  );
}

export function formatMentionTag(jid: string): string {
  return `@${jid.split('@')[0]}`;
}

export function formatPlayerMention(
  player: SeatPlayer,
  resolveJid: (seat: SeatPlayer) => string = (s) => s.userId,
): string {
  return formatMentionTag(resolveJid(player));
}

export function formatTurnNotice(state: MatchState): string | null {
  if (state.phase !== 'playing' || !state.currentHand) return null;
  return formatTurnNoticeForSeat(state, state.currentHand.currentTurnSeat);
}

export function formatTurnNoticeForSeat(
  state: MatchState,
  seat: number,
  resolveJid?: (seat: SeatPlayer) => string,
): string | null {
  if (state.phase !== 'playing' || !state.currentHand) return null;
  const current = state.seats.find((s) => s.seat === seat);
  if (!current) return null;
  return `👉 Vez de ${formatPlayerMention(current, resolveJid)} — ${state.currentHand.isMaoFerro ? '!jogar N' : '!jogar N ou !esconder N'}`;
}

export function formatCardsMessage(cards: Card[], vira: Card, manilhaRank: string): string {
  const lines = cards.map((c, i) => `${i + 1}️⃣ ${cardToString(c)}`);
  return (
    `🃏 Suas cartas:\n\n${lines.join('\n')}\n\n` +
    `Vira: ${cardToString(vira)}\n` +
    `Manilha: ${manilhaRank}\n\n` +
    `Jogue no grupo com !jogar N ou !esconder N`
  );
}

export function formatPartnerCards(partnerName: string, slots: HandSlots): string {
  const lines = formatHandSlotLines(slots);
  return `👀 Cartas de ${partnerName}:\n\n${lines.join('\n')}`;
}

export function formatMesa(state: MatchState): string {
  const hand = state.currentHand;
  const teamA = state.seats.filter((s) => s.team === 0);
  const teamB = state.seats.filter((s) => s.team === 1);

  let msg = state.mode === '1v1' ? '🃏 TRUCO (Solo)\n\n' : '🃏 TRUCO\n\n';

  if (state.mode === '1v1') {
    for (const p of state.seats) {
      const emoji = p.team === 0 ? '🔴' : '🔵';
      msg += `${emoji} ${formatPlayerMention(p)} — ${state.scores[p.team]}\n`;
    }
  } else {
    msg += `🔴 Dupla A — ${state.scores[0]}\n`;
    for (const p of teamA) msg += `${formatPlayerMention(p)}\n`;
    msg += `\n🔵 Dupla B — ${state.scores[1]}\n`;
    for (const p of teamB) msg += `${formatPlayerMention(p)}\n`;
  }

  if (state.phase === 'mao_onze_decision') {
    if (state.mode === '1v1') {
      const player = state.seats.find((s) => state.scores[s.team] === 11);
      msg += `\n⚠️ Mão de Onze! ${player ? formatPlayerMention(player) : 'Quem tem 11'} deve decidir.\n`;
      msg += `Use !aceitar ou !correr`;
    } else {
      msg += `\n⚠️ Mão de Onze! Dupla com 11 pontos deve decidir.\n`;
      msg += `Use !aceitar ou !correr (ambos parceiros), depois !confirmar`;
    }
    return msg;
  }

  if (!hand) {
    msg += '\n⏳ Aguardando início da rodada...';
    return msg;
  }

  msg += `\nVira: ${cardToString(hand.vira)}\n`;
  msg += `Manilha: ${hand.manilhaRank}\n`;
  if (hand.isMaoFerro) msg += `🔥 Mão de Ferro!\n`;
  if (hand.isMaoOnze) msg += `1️⃣1️⃣ Mão de Onze (vale 3)\n`;

  msg += `\nJogada: ${hand.round}/3 (mesmas 3 cartas da rodada)\n`;
  msg += `Rodada valendo: ${formatPointsLabel(hand.handValue)}\n`;

  if (hand.roundResults.length > 0) {
    msg += '\nResultado das jogadas:\n';
    for (const r of hand.roundResults) {
      if (r.winnerSeat === 'tie') {
        msg += `  Jogada ${r.roundNumber}: empate\n`;
      } else {
        const p = state.seats.find((s) => s.seat === r.winnerSeat)!;
        msg += `  Jogada ${r.roundNumber}: ${formatPlayerMention(p)}\n`;
      }
    }
  }

  if (hand.table.length > 0) {
    msg += '\nMesa (jogada atual):\n';
    for (const t of hand.table) {
      const player = state.seats.find((s) => s.seat === t.seat)!;
      if (t.hidden || !t.card) {
        msg += `${formatPlayerMention(player)} → 🂠 (escondida)\n`;
      } else {
        msg += `${formatPlayerMention(player)} → ${cardToString(t.card)}\n`;
      }
    }
  }

  if (state.phase === 'raise_pending' && state.raise?.pendingLevel) {
    msg += `\n${formatRaiseRequestMessage(state, state.raise.pendingLevel, state.raise.requestedByTeam)}`;
  }

  const turn = formatTurnNotice(state);
  if (turn) msg += `\n${turn}`;

  return msg;
}

export function formatHistory(state: MatchState): string {
  if (!state.currentHand?.history.length) {
    return '📜 Nenhuma jogada registrada nesta partida ainda.';
  }
  let msg = '📜 Histórico da partida\n\n';
  for (const h of state.currentHand.history) {
    const cardStr = h.hidden || !h.card ? '🂠' : cardToString(h.card);
    const player = state.seats.find((s) => s.seat === h.seat);
    const name = player ? formatPlayerMention(player) : h.displayName;
    msg += `Jogada ${h.round} — ${name}: ${cardStr}\n`;
  }
  return msg;
}

export function getMentionJids(seats: SeatPlayer[]): string[] {
  return seats.map((s) => s.userId);
}

function lobbySlotLabel(slot: {
  userId: string | null;
  reservedForUserId: string | null;
}): string {
  if (slot.userId) return `@${slot.userId.split('@')[0]}`;
  if (slot.reservedForUserId) return `(reservado @${slot.reservedForUserId.split('@')[0]})`;
  return '(vago)';
}

export function getLobbyMentionJids(lobby: {
  slots: { userId: string | null }[];
}): string[] {
  return lobby.slots.flatMap((s) => (s.userId ? [s.userId] : []));
}

export function formatPointsLabel(points: number): string {
  return `${points} ${points === 1 ? 'ponto' : 'pontos'}`;
}

export function formatRunRefusedMessage(
  state: MatchState,
  winnerTeam: TeamId,
  points: number,
  resolveJid: (seat: SeatPlayer) => string = (s) => s.userId,
): string {
  const outcome = formatTeamOutcome(
    state.mode,
    winnerTeam,
    state.seats,
    `ganha ${formatPointsLabel(points)}.`,
    resolveJid,
  );
  return state.mode === '1v1' ? `🏃 Correu! ${outcome}` : `🏃 Correram! ${outcome}`;
}

export function formatHandStartedMessage(
  state: MatchState,
  resolveJid: (seat: SeatPlayer) => string = (s) => s.userId,
  suitSymbol: (s: string) => string = (s) => s,
): string {
  const hand = state.currentHand!;
  const dealer = state.seats.find((s) => s.seat === state.dealerSeat)!;
  const starter = state.seats.find((s) => s.seat === hand.currentTurnSeat)!;
  return (
    `🃏 Nova rodada! (3 cartas por jogador)\n` +
    `Rodada valendo: ${formatPointsLabel(hand.handValue)}\n` +
    `Vira: ${hand.vira.rank}${suitSymbol(hand.vira.suit)} | Manilha: ${hand.manilhaRank}\n` +
    `Pé (embaralha): ${formatPlayerMention(dealer, resolveJid)}\n` +
    `Começa: ${formatPlayerMention(starter, resolveJid)}`
  );
}

export function formatMaoOnzeRunMessage(
  state: MatchState,
  decidingTeam: TeamId,
  opponentTeam: TeamId,
  points: number,
  scores: [number, number],
  resolveJid: (seat: SeatPlayer) => string = (s) => s.userId,
): string {
  const runner = formatTeamOutcome(
    state.mode,
    decidingTeam,
    state.seats,
    state.mode === '1v1' ? 'correu na Mão de Onze' : 'correram na Mão de Onze',
    resolveJid,
  );
  const opponent = formatTeamOutcome(
    state.mode,
    opponentTeam,
    state.seats,
    `ganha ${formatPointsLabel(points)}`,
    resolveJid,
  );
  return `🏃 ${runner}. ${opponent} Placar: ${scores[0]} x ${scores[1]}.`;
}

export function formatMaoOnzeTimeoutMessage(
  state: MatchState,
  decidingTeam: TeamId,
  opponentTeam: TeamId,
  points: number,
  redelMaoOnze: boolean,
  resolveJid: (seat: SeatPlayer) => string = (s) => s.userId,
): string {
  const deciders = formatTeamOutcome(
    state.mode,
    decidingTeam,
    state.seats,
    state.mode === '1v1' ? 'correu automaticamente' : 'correram automaticamente',
    resolveJid,
  );
  const opponent = formatTeamOutcome(
    state.mode,
    opponentTeam,
    state.seats,
    `ganha ${formatPointsLabel(points)}`,
    resolveJid,
  );

  let msg = `⏱️ Tempo esgotado na Mão de Onze!\n${deciders}.\n${opponent}. Placar: ${state.scores[0]} x ${state.scores[1]}.`;

  if (redelMaoOnze) {
    msg +=
      state.mode === '1v1'
        ? `\n\n🃏 Novo baralho — cartas no privado. !aceitar ou !correr.`
        : `\n\n🃏 Novo baralho — cartas no privado para a dupla com 11. !aceitar/!correr, depois !confirmar.`;
  }

  return msg;
}

export function handValueLabel(value: number): string {
  const labels: Record<number, string> = { 1: '1', 3: 'Truco', 6: 'Seis', 9: 'Nove', 12: 'Doze' };
  return labels[value] ?? String(value);
}

const COUNTER_CMD: Record<6 | 9 | 12, string> = {
  6: '!seis',
  9: '!nove',
  12: '!doze',
};

export function formatRaiseRequestMessage(
  state: MatchState,
  level: RaiseLevel,
  requestingTeam: TeamId,
  resolveJid: (seat: SeatPlayer) => string = (s) => s.userId,
): string {
  const requester = formatSideLabel(state.mode, requestingTeam, state.seats, resolveJid);
  const name = handValueLabel(level);
  const refusePoints = pointsOnRefuse(level);
  const counter = nextRaiseLevel(level);

  let msg = `📢 ${requester} pediu ${name} (${level} pts)!\n\n`;
  msg += `${formatOpponentRespondentLabel(state.mode)}:\n`;
  msg += `• !aceitar (ou !descer) — aceitar (rodada valendo ${level} pts)\n`;
  msg += `• !correr — desistir (${requester} ganha ${refusePoints} pt${refusePoints === 1 ? '' : 's'})\n`;
  if (counter) {
    msg += `• ${COUNTER_CMD[counter]} — aumentar para ${counter} pts`;
  }
  return msg;
}

export function formatRaiseAcceptedMessage(
  state: MatchState,
  newValue: HandValue,
  resolveJid: (seat: SeatPlayer) => string = (s) => s.userId,
): string {
  let msg = `✅ Aceito! Rodada valendo ${formatPointsLabel(newValue)}.`;

  const counter = nextRaiseLevel(newValue);
  const canRaiseTeam = state.raise?.canRaiseTeam;
  if (counter == null || canRaiseTeam == null) return msg;

  const cmd = COUNTER_CMD[counter];
  const name = handValueLabel(counter);

  if (state.mode === '1v1') {
    msg += `\n\nNa sua vez, antes de jogar: ${cmd} (${name}, ${counter} pts).`;
  } else {
    msg += `\n\n${formatSideLabel(state.mode, canRaiseTeam, state.seats, resolveJid)} pode pedir ${cmd} (${name}, ${counter} pts) na vez, antes de jogar.`;
  }

  return msg;
}

export function formatJogadaResult(
  winnerSeat: number | 'tie',
  state: MatchState,
  jogada: number,
  plays: { seat: number; card: Card; hidden: boolean }[] = [],
  suitSymbolFn: (s: Suit) => string = (s) => SUIT_SYMBOL[s],
  resolveJid?: (seat: SeatPlayer) => string,
  isMaoFerro = false,
): string {
  const mention = (player: SeatPlayer) => formatPlayerMention(player, resolveJid);

  let msg = '';

  if (isMaoFerro && plays.some((p) => p.hidden)) {
    msg += `🃏 Jogada ${jogada} — cartas reveladas:\n`;
    for (const p of plays) {
      const player = state.seats.find((s) => s.seat === p.seat)!;
      msg += `${mention(player)}: ${p.card.rank}${suitSymbolFn(p.card.suit)}\n`;
    }
    msg += '\n';
  }

  if (winnerSeat === 'tie') {
    return `${msg}🤝 Jogada ${jogada} empatada.`;
  }
  const player = state.seats.find((s) => s.seat === winnerSeat)!;
  return `${msg}✅ Jogada ${jogada} vencida por ${mention(player)}.`;
}

export function formatLobbyMessage(lobby: {
  mode: GameMode;
  slots: {
    seat: number;
    team: TeamId;
    userId: string | null;
    displayName: string | null;
    reservedForUserId: string | null;
  }[];
}): string {
  const lines = lobby.slots.map((s) => {
    const team = s.team === 0 ? 'A' : 'B';
    const name = lobbySlotLabel(s);
    if (lobby.mode === '1v1') {
      return `  Assento ${s.seat + 1}: ${name}`;
    }
    return `  [Dupla ${team}] Assento ${s.seat + 1}: ${name}`;
  });
  return (
    `🃏 Nova partida de Truco!\nModo: ${formatModeLabel(lobby.mode)}\n\n${lines.join('\n')}\n\n` +
    `!entrar — participar\n!sair — sair\n!iniciar — iniciar\n!cancelar — cancelar`
  );
}
