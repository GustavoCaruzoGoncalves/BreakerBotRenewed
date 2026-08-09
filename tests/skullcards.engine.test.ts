import { describe, expect, it } from 'vitest';
import {
  applyDraw,
  applyPass,
  applyPlay,
  canPlayCard,
  nextPlayer,
  parseCard,
} from '../src/games/skullcards/engine.js';
import type { Card, MatchState } from '../src/games/skullcards/types.js';

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'm1',
    roomId: 'r1',
    status: 'active',
    currentTurnUserId: 'a',
    direction: 1,
    currentColor: 'red',
    pendingDraw: 0,
    discardTop: 'R-5',
    winnerUserId: null,
    hands: { a: [], b: [], c: [] },
    drawPile: [],
    discardPile: ['R-5'],
    ...overrides,
  };
}

describe('parseCard', () => {
  it('reconhece os tipos de carta', () => {
    expect(parseCard('R-5')).toEqual({ type: 'NUMBER', value: 5, color: 'red' });
    expect(parseCard('B-SKIP')).toEqual({ type: 'SKIP', value: null, color: 'blue' });
    expect(parseCard('G-REVERSE')).toEqual({ type: 'REVERSE', value: null, color: 'green' });
    expect(parseCard('Y-+2')).toEqual({ type: 'DRAW_TWO', value: null, color: 'yellow' });
    expect(parseCard('W')).toEqual({ type: 'WILD', value: null, color: 'wild' });
    expect(parseCard('W+4')).toEqual({ type: 'WILD_DRAW_FOUR', value: null, color: 'wild' });
  });
});

describe('canPlayCard', () => {
  it('recusa jogada fora do turno', () => {
    const state = makeState({ currentTurnUserId: 'b' });
    expect(canPlayCard('R-5', state, 'a')).toEqual({ ok: false, reason: 'not_player_turn' });
  });

  it('aceita mesma cor e mesmo valor, recusa o resto', () => {
    const state = makeState();
    expect(canPlayCard('R-9', state, 'a').ok).toBe(true);
    expect(canPlayCard('B-5', state, 'a').ok).toBe(true);
    expect(canPlayCard('B-9', state, 'a')).toEqual({ ok: false, reason: 'card_not_match' });
  });

  it('com pilha de compra pendente só aceita cartas de compra', () => {
    const state = makeState({ pendingDraw: 2 });
    expect(canPlayCard('R-9', state, 'a')).toEqual({
      ok: false,
      reason: 'must_resolve_draw_stack',
    });
    expect(canPlayCard('R-+2', state, 'a').ok).toBe(true);
    expect(canPlayCard('W+4', state, 'a').ok).toBe(true);
  });
});

describe('nextPlayer', () => {
  const players = ['a', 'b', 'c'];

  it('avança e retrocede circularmente', () => {
    expect(nextPlayer(players, 'a', 1)).toBe('b');
    expect(nextPlayer(players, 'c', 1)).toBe('a');
    expect(nextPlayer(players, 'a', -1)).toBe('c');
  });
});

describe('applyPlay', () => {
  const players = ['a', 'b', 'c'];

  it('rejeita carta que não está na mão', () => {
    const state = makeState();
    expect(applyPlay(state, players, 'a', 'R-5', null)).toEqual({
      ok: false,
      reason: 'card_not_in_hand',
    });
  });

  it('exige cor válida no coringa', () => {
    const state = makeState({ hands: { a: ['W'], b: [], c: [] } });
    expect(applyPlay(state, players, 'a', 'W', null)).toEqual({
      ok: false,
      reason: 'invalid_color_choice',
    });
  });

  it('SKIP pula o próximo jogador', () => {
    const state = makeState({ hands: { a: ['R-SKIP', 'R-1'], b: [], c: [] } });
    const result = applyPlay(state, players, 'a', 'R-SKIP', null);
    expect(result).toEqual({ ok: true, winnerUserId: null, nextPlayerId: 'c' });
  });

  it('REVERSE inverte a direção com 3+ jogadores', () => {
    const state = makeState({ hands: { a: ['R-REVERSE', 'R-1'], b: [], c: [] } });
    applyPlay(state, players, 'a', 'R-REVERSE', null);
    expect(state.direction).toBe(-1);
    expect(state.currentTurnUserId).toBe('b');
  });

  it('+2 acumula a compra pendente', () => {
    const state = makeState({ hands: { a: ['R-+2', 'R-1'], b: [], c: [] } });
    applyPlay(state, players, 'a', 'R-+2', null);
    expect(state.pendingDraw).toBe(2);
  });

  it('encerra a partida quando a mão zera', () => {
    const state = makeState({ hands: { a: ['R-1'], b: [], c: [] } });
    const result = applyPlay(state, players, 'a', 'R-1', null);
    expect(result).toEqual({ ok: true, winnerUserId: 'a', nextPlayerId: 'b' });
    expect(state.status).toBe('finished');
  });
});

describe('applyDraw', () => {
  const players = ['a', 'b'];

  it('compra a pilha pendente e zera o acumulado', () => {
    const drawPile: Card[] = ['R-1', 'R-2', 'R-3'];
    const state = makeState({ pendingDraw: 2, drawPile, hands: { a: [], b: [] } });
    const result = applyDraw(state, players, 'a');
    expect(result).toEqual({ ok: true, drawn: ['R-1', 'R-2'], nextPlayerId: 'b' });
    expect(state.pendingDraw).toBe(0);
    expect(state.hands.a).toEqual(['R-1', 'R-2']);
  });

  it('recicla o descarte quando a pilha de compra acaba', () => {
    const state = makeState({
      drawPile: [],
      discardPile: ['R-1', 'R-2', 'R-5'],
      hands: { a: [], b: [] },
    });
    const result = applyDraw(state, players, 'a');
    expect(result.ok).toBe(true);
    expect(state.discardPile).toEqual(['R-5']);
  });
});

describe('applyPass', () => {
  const players = ['a', 'b'];

  it('recusa passar quando há carta jogável', () => {
    const state = makeState({ hands: { a: ['R-9'], b: [] } });
    expect(applyPass(state, players, 'a')).toEqual({ ok: false, reason: 'has_playable_cards' });
  });

  it('recusa passar com compra pendente', () => {
    const state = makeState({ pendingDraw: 2, hands: { a: ['B-9'], b: [] } });
    expect(applyPass(state, players, 'a')).toEqual({ ok: false, reason: 'must_draw' });
  });

  it('passa a vez quando não há jogada possível', () => {
    const state = makeState({ hands: { a: ['B-9'], b: [] } });
    expect(applyPass(state, players, 'a')).toEqual({ ok: true, nextPlayerId: 'b' });
  });
});
