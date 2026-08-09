import type { Card, HandValue, Rank, RoundResult, Suit, TeamId } from './types.js';
import { SUIT_ORDER } from './types.js';
import { isManilha, rankIndex } from './deck.js';

export function compareCards(a: Card, b: Card, manilhaRank: Rank): number {
  const aManilha = isManilha(a, manilhaRank);
  const bManilha = isManilha(b, manilhaRank);

  if (aManilha && bManilha) {
    return suitStrength(a.suit) - suitStrength(b.suit);
  }
  if (aManilha) return 1;
  if (bManilha) return -1;
  return rankIndex(a.rank) - rankIndex(b.rank);
}

export function suitStrength(suit: Suit): number {
  return SUIT_ORDER.indexOf(suit);
}

export function isZap(card: Card, manilhaRank: Rank): boolean {
  return isManilha(card, manilhaRank) && card.suit === 'P';
}

export function findBestSlotIndex(slots: readonly (Card | null)[], manilhaRank: Rank): number {
  let bestIdx = -1;
  for (let i = 0; i < slots.length; i++) {
    const card = slots[i];
    if (card === null) continue;
    if (bestIdx === -1 || compareCards(card, slots[bestIdx]!, manilhaRank) > 0) {
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** @deprecated Use findBestSlotIndex — mantido para testes legados */
export function findBestCardIndex(cards: Card[], manilhaRank: Rank): number {
  return findBestSlotIndex(cards, manilhaRank);
}

function teamOfSeat(seat: number, seats: { seat: number; team: TeamId }[]): TeamId | null {
  return seats.find((s) => s.seat === seat)?.team ?? null;
}

export function resolveRoundWinner(
  plays: { seat: number; card: Card | null; hidden: boolean }[],
  manilhaRank: Rank,
  seats: { seat: number; team: TeamId }[],
  isMaoFerro = false,
): number | 'tie' {
  const competing = plays.filter((p) => {
    if (p.card === null) return false;
    if (!isMaoFerro && p.hidden) return false;
    return true;
  });
  if (competing.length === 0) return 'tie';

  let bestPlays = [competing[0]];
  for (let i = 1; i < competing.length; i++) {
    const cmp = compareCards(competing[i].card!, bestPlays[0].card!, manilhaRank);
    if (cmp > 0) {
      bestPlays = [competing[i]];
    } else if (cmp === 0) {
      bestPlays.push(competing[i]);
    }
  }

  if (bestPlays.length === 1) return bestPlays[0].seat;

  const teams = bestPlays.map((p) => teamOfSeat(p.seat, seats));
  if (teams.every((t) => t !== null && t === teams[0])) {
    return bestPlays[0].seat;
  }

  return 'tie';
}

export type HandWinner = TeamId | 'tie' | null;

function teamOfResultSeat(
  seat: number | 'tie',
  seats: { seat: number; team: TeamId }[],
): TeamId | null {
  if (seat === 'tie') return null;
  return teamOfSeat(seat, seats);
}

/**
 * Decide se a rodada (unidade de pontuação) já foi vencida.
 * Retorna null enquanto ainda precisar de mais jogadas (ex.: 1×1 após 2 jogadas).
 */
export function resolveHandWinner(
  roundResults: RoundResult[],
  seats: { seat: number; team: TeamId }[],
): HandWinner {
  if (roundResults.length === 0) return null;

  const jogadas = roundResults.map((r) => r.winnerSeat);
  const [j1, j2, j3] = jogadas;

  const winsByTeam: Record<TeamId, number> = { 0: 0, 1: 0 };
  for (const w of jogadas) {
    const team = teamOfResultSeat(w, seats);
    if (team !== null) winsByTeam[team]++;
  }

  // Duas jogadas ganhas pela mesma dupla → rodada decidida
  if (winsByTeam[0] >= 2) return 0;
  if (winsByTeam[1] >= 2) return 1;

  // Regras de empate do Truco Paulista (podem decidir com 2 jogadas)
  if (roundResults.length === 2) {
    // Empate na 1ª → quem ganhar a 2ª vence a rodada
    if (j1 === 'tie' && j2 !== 'tie') {
      return teamOfResultSeat(j2, seats);
    }
    // Empate na 2ª → quem ganhou a 1ª vence a rodada
    if (j2 === 'tie' && j1 !== 'tie') {
      return teamOfResultSeat(j1, seats);
    }
    // 1×1 (cada dupla ganhou uma jogada) → ainda não decidido, vai para 3ª jogada
    if (
      j1 !== 'tie' &&
      j2 !== 'tie' &&
      teamOfResultSeat(j1, seats) !== teamOfResultSeat(j2, seats)
    ) {
      return null;
    }
  }

  if (roundResults.length < 3) return null;

  // Após 3 jogadas
  if (j1 === 'tie' && j2 === 'tie' && j3 !== 'tie') {
    return teamOfResultSeat(j3, seats);
  }
  if (j3 === 'tie' && j1 !== 'tie') {
    return teamOfResultSeat(j1, seats);
  }
  if (j1 === 'tie' && j2 === 'tie' && j3 === 'tie') {
    return 'tie';
  }

  if (winsByTeam[0] > winsByTeam[1]) return 0;
  if (winsByTeam[1] > winsByTeam[0]) return 1;
  return 'tie';
}

export function pointsOnRefuse(currentValue: HandValue): number {
  switch (currentValue) {
    case 1:
      return 1;
    case 3:
      return 1;
    case 6:
      return 3;
    case 9:
      return 6;
    case 12:
      return 9;
    default:
      return 1;
  }
}

export function nextRaiseLevel(current: HandValue): 6 | 9 | 12 | null {
  if (current === 1 || current === 3) return 6;
  if (current === 6) return 9;
  if (current === 9) return 12;
  return null;
}

export function raiseLevelToValue(level: 3 | 6 | 9 | 12): HandValue {
  return level;
}

export function calcAuraGain(handValue: HandValue, baseWin: number, perPoint: number): number {
  return baseWin + handValue * perPoint;
}
