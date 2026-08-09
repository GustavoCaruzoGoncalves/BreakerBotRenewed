import { getCardColor, shuffle } from '../../database/skullcardsRepository.js';
import type {
  ApplyDrawResult,
  ApplyPassResult,
  ApplyPlayResult,
  CanPlayResult,
  Card,
  CardColor,
  Direction,
  MatchState,
  ParsedCard,
} from './types.js';

const PLAYABLE_COLORS: readonly CardColor[] = ['red', 'yellow', 'green', 'blue'];

function isPlayableColor(color: unknown): color is Exclude<CardColor, 'wild'> {
  return typeof color === 'string' && PLAYABLE_COLORS.includes(color as CardColor);
}

export function parseCard(card: Card): ParsedCard {
  if (card === 'W') return { type: 'WILD', value: null, color: 'wild' };
  if (card === 'W+4') return { type: 'WILD_DRAW_FOUR', value: null, color: 'wild' };

  const [, suffix] = card.split('-');
  const color = getCardColor(card);
  if (!suffix) return { type: 'UNKNOWN', value: null, color };
  if (suffix === 'SKIP') return { type: 'SKIP', value: null, color };
  if (suffix === 'REVERSE') return { type: 'REVERSE', value: null, color };
  if (suffix === '+2') return { type: 'DRAW_TWO', value: null, color };

  const num = parseInt(suffix, 10);
  if (!Number.isNaN(num)) return { type: 'NUMBER', value: num, color };
  return { type: 'UNKNOWN', value: null, color };
}

export function canPlayCard(card: Card, state: MatchState, playerId: string): CanPlayResult {
  if (state.currentTurnUserId !== playerId) {
    return { ok: false, reason: 'not_player_turn' };
  }
  const parsed = parseCard(card);
  const topParsed = parseCard(state.discardTop);

  if (state.pendingDraw > 0) {
    const isDrawStack = parsed.type === 'DRAW_TWO' || parsed.type === 'WILD_DRAW_FOUR';
    if (!isDrawStack) return { ok: false, reason: 'must_resolve_draw_stack' };
  }

  if (parsed.type === 'WILD' || parsed.type === 'WILD_DRAW_FOUR') {
    return { ok: true };
  }

  const sameColor = parsed.color === state.currentColor;
  const sameValue =
    parsed.type === topParsed.type &&
    ((parsed.type === 'NUMBER' && parsed.value === topParsed.value) || parsed.type !== 'NUMBER');

  if (sameColor || sameValue) return { ok: true };
  return { ok: false, reason: 'card_not_match' };
}

export function nextPlayer(players: string[], currentId: string, direction: Direction): string {
  const fallback = players[0] ?? currentId;
  const idx = players.indexOf(currentId);
  if (idx === -1) return fallback;
  const len = players.length;
  return players[(idx + direction + len) % len] ?? fallback;
}

export function drawFromPile(state: MatchState, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length <= 1) break;
      const top = state.discardPile[state.discardPile.length - 1];
      const rest = state.discardPile.slice(0, -1);
      state.drawPile = shuffle(rest);
      state.discardPile = top ? [top] : [];
    }
    const card = state.drawPile.shift();
    if (card) drawn.push(card);
  }
  return drawn;
}

export function applyPlay(
  state: MatchState,
  players: string[],
  playerId: string,
  card: Card,
  chosenColor: CardColor | null | undefined,
): ApplyPlayResult {
  const parsed = parseCard(card);
  const hand = state.hands[playerId] ?? [];
  const idx = hand.indexOf(card);
  if (idx === -1) return { ok: false, reason: 'card_not_in_hand' };

  hand.splice(idx, 1);
  state.hands[playerId] = hand;
  state.discardPile.push(card);
  state.discardTop = card;

  if (parsed.type === 'WILD' || parsed.type === 'WILD_DRAW_FOUR') {
    if (!isPlayableColor(chosenColor)) {
      return { ok: false, reason: 'invalid_color_choice' };
    }
    state.currentColor = chosenColor;
  } else {
    state.currentColor = parsed.color;
  }

  const victimId = nextPlayer(players, playerId, state.direction);

  if (parsed.type === 'SKIP') {
    state.currentTurnUserId = nextPlayer(players, victimId, state.direction);
  } else if (parsed.type === 'REVERSE') {
    if (players.length === 2) {
      state.currentTurnUserId = playerId;
    } else {
      state.direction = state.direction === 1 ? -1 : 1;
      state.currentTurnUserId = victimId;
    }
  } else if (parsed.type === 'DRAW_TWO') {
    state.pendingDraw += 2;
    state.currentTurnUserId = victimId;
  } else if (parsed.type === 'WILD_DRAW_FOUR') {
    state.pendingDraw += 4;
    state.currentTurnUserId = victimId;
  } else {
    state.currentTurnUserId = victimId;
  }

  let winnerUserId: string | null = null;
  if (hand.length === 0) {
    winnerUserId = playerId;
    state.status = 'finished';
    state.winnerUserId = winnerUserId;
  }

  return { ok: true, winnerUserId, nextPlayerId: state.currentTurnUserId };
}

export function applyDraw(
  state: MatchState,
  players: string[],
  playerId: string,
): ApplyDrawResult {
  if (state.currentTurnUserId !== playerId) {
    return { ok: false, reason: 'not_player_turn' };
  }
  const drawCount = state.pendingDraw > 0 ? state.pendingDraw : 1;
  const drawnCards = drawFromPile(state, drawCount);
  (state.hands[playerId] ??= []).push(...drawnCards);
  state.pendingDraw = 0;
  const nextId = nextPlayer(players, playerId, state.direction);
  state.currentTurnUserId = nextId;
  return { ok: true, drawn: drawnCards, nextPlayerId: nextId };
}

export function applyPass(
  state: MatchState,
  players: string[],
  playerId: string,
): ApplyPassResult {
  if (state.currentTurnUserId !== playerId) {
    return { ok: false, reason: 'not_player_turn' };
  }
  if (state.pendingDraw > 0) return { ok: false, reason: 'must_draw' };
  const hand = state.hands[playerId] ?? [];
  const canPlay = hand.some((c) => canPlayCard(c, state, playerId).ok);
  if (canPlay) return { ok: false, reason: 'has_playable_cards' };
  const nextId = nextPlayer(players, playerId, state.direction);
  state.currentTurnUserId = nextId;
  return { ok: true, nextPlayerId: nextId };
}
