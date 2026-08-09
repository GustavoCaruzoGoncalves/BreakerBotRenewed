import type { Card, Rank, Suit } from './types.js';
import { RANK_ORDER } from './types.js';

export function createDeck(): Card[] {
  const suits: Suit[] = ['O', 'E', 'C', 'P'];
  const deck: Card[] = [];
  for (const rank of RANK_ORDER) {
    for (const suit of suits) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[], random = Math.random): Card[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function dealCards(
  deck: Card[],
  playerCount: number,
): { hands: Card[][]; vira: Card; remaining: Card[] } {
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  let idx = 0;
  for (let round = 0; round < 3; round++) {
    for (let p = 0; p < playerCount; p++) {
      hands[p].push(deck[idx++]);
    }
  }
  const vira = deck[idx++];
  return { hands, vira, remaining: deck.slice(idx) };
}

export function rankIndex(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

export function nextRank(rank: Rank): Rank {
  const idx = rankIndex(rank);
  return RANK_ORDER[(idx + 1) % RANK_ORDER.length];
}

export function getManilhaRank(vira: Card): Rank {
  if (vira.rank === '2') return '4';
  return nextRank(vira.rank);
}

export function isManilha(card: Card, manilhaRank: Rank): boolean {
  return card.rank === manilhaRank;
}
