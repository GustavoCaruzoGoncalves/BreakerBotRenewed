import { describe, it, expect } from 'vitest';
import { getManilhaRank, nextRank } from '../src/games/truco/deck.js';
import {
  compareCards,
  isZap,
  resolveRoundWinner,
  resolveHandWinner,
  pointsOnRefuse,
  findBestCardIndex,
} from '../src/games/truco/compare.js';
import type { Card, MatchState, SeatPlayer } from '../src/games/truco/types.js';
import {
  createInitialMatchState,
  startHand,
  playCard,
  requestRaise,
  acceptRaise,
  refuseRaise,
  voteMaoOnze,
  autoTimeoutMaoOnze,
  firstPlayerSeat,
  nextDealerSeat,
} from '../src/games/truco/engine.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

function seat(n: number, team: 0 | 1): SeatPlayer {
  const jid = `${n}@s.whatsapp.net`;
  return {
    seat: n,
    userId: jid,
    whatsappJid: jid,
    dmJid: jid,
    displayName: String.fromCharCode(65 + n),
    team,
  };
}

describe('manilha', () => {
  it('determina manilha pela vira', () => {
    expect(getManilhaRank(c('4', 'O'))).toBe('5');
    expect(getManilhaRank(c('7', 'E'))).toBe('Q');
    expect(getManilhaRank(c('Q', 'C'))).toBe('J');
    expect(getManilhaRank(c('3', 'P'))).toBe('4');
  });

  it('vira 2 → manilha 4 (única exceção)', () => {
    expect(getManilhaRank(c('2', 'O'))).toBe('4');
    expect(getManilhaRank(c('2', 'P'))).toBe('4');
  });

  it('sequência circular', () => {
    expect(nextRank('3')).toBe('4');
    expect(nextRank('K')).toBe('A');
  });
});

describe('compareCards', () => {
  const manilha = 'Q';

  it('3 vence A', () => {
    expect(compareCards(c('3', 'O'), c('A', 'P'), manilha)).toBeGreaterThan(0);
  });

  it('manilha vence carta normal', () => {
    expect(compareCards(c('Q', 'O'), c('3', 'P'), manilha)).toBeGreaterThan(0);
  });

  it('Zap (P) vence manilha de Ouros', () => {
    expect(compareCards(c('Q', 'P'), c('Q', 'O'), manilha)).toBeGreaterThan(0);
    expect(isZap(c('Q', 'P'), manilha)).toBe(true);
  });

  it('ordem manilhas: P > C > E > O', () => {
    expect(compareCards(c('Q', 'P'), c('Q', 'C'), manilha)).toBeGreaterThan(0);
    expect(compareCards(c('Q', 'C'), c('Q', 'E'), manilha)).toBeGreaterThan(0);
    expect(compareCards(c('Q', 'E'), c('Q', 'O'), manilha)).toBeGreaterThan(0);
  });
});

describe('resolveRoundWinner', () => {
  const seats1v1 = [
    { seat: 0, team: 0 as const },
    { seat: 1, team: 1 as const },
  ];
  const seats2v2 = [
    { seat: 0, team: 0 as const },
    { seat: 1, team: 1 as const },
    { seat: 2, team: 0 as const },
    { seat: 3, team: 1 as const },
  ];

  it('identifica vencedor da rodada', () => {
    const winner = resolveRoundWinner(
      [
        { seat: 0, card: c('4', 'O'), hidden: false },
        { seat: 1, card: c('3', 'E'), hidden: false },
      ],
      'Q',
      seats1v1,
    );
    expect(winner).toBe(1);
  });

  it('empate quando cartas iguais em força de times diferentes', () => {
    const winner = resolveRoundWinner(
      [
        { seat: 0, card: c('7', 'O'), hidden: false },
        { seat: 1, card: c('7', 'E'), hidden: false },
      ],
      'Q',
      seats1v1,
    );
    expect(winner).toBe('tie');
  });

  it('parceiros com mesma carta mais forte vencem a jogada', () => {
    const winner = resolveRoundWinner(
      [
        { seat: 0, card: c('7', 'O'), hidden: false },
        { seat: 1, card: c('4', 'E'), hidden: false },
        { seat: 2, card: c('7', 'E'), hidden: false },
        { seat: 3, card: c('5', 'C'), hidden: false },
      ],
      'Q',
      seats2v2,
    );
    expect(winner).toBe(0);
  });

  it('carta escondida perde para qualquer carta visível', () => {
    const winner = resolveRoundWinner(
      [
        { seat: 0, card: c('4', 'O'), hidden: true },
        { seat: 1, card: c('4', 'E'), hidden: false },
      ],
      'Q',
      seats1v1,
      false,
    );
    expect(winner).toBe(1);
  });

  it('na mão de ferro compara cartas escondidas pelo valor real', () => {
    const winner = resolveRoundWinner(
      [
        { seat: 0, card: c('4', 'O'), hidden: true },
        { seat: 1, card: c('3', 'E'), hidden: true },
      ],
      'Q',
      seats1v1,
      true,
    );
    expect(winner).toBe(1);
  });
});

describe('resolveHandWinner - empates', () => {
  const seats = [
    { seat: 0, team: 0 as const },
    { seat: 1, team: 1 as const },
  ];

  it('dupla com 2 rodadas vence', () => {
    expect(
      resolveHandWinner(
        [
          { winnerSeat: 0, roundNumber: 1 },
          { winnerSeat: 0, roundNumber: 2 },
        ],
        seats,
      ),
    ).toBe(0);
  });

  it('empate R1, vitória R2 → vence quem ganhou R2', () => {
    expect(
      resolveHandWinner(
        [
          { winnerSeat: 'tie', roundNumber: 1 },
          { winnerSeat: 1, roundNumber: 2 },
        ],
        seats,
      ),
    ).toBe(1);
  });

  it('empate R2, vitória R1 → vence quem ganhou R1', () => {
    expect(
      resolveHandWinner(
        [
          { winnerSeat: 0, roundNumber: 1 },
          { winnerSeat: 'tie', roundNumber: 2 },
        ],
        seats,
      ),
    ).toBe(0);
  });

  it('três empates → rodada empatada', () => {
    expect(
      resolveHandWinner(
        [
          { winnerSeat: 'tie', roundNumber: 1 },
          { winnerSeat: 'tie', roundNumber: 2 },
          { winnerSeat: 'tie', roundNumber: 3 },
        ],
        seats,
      ),
    ).toBe('tie');
  });

  it('1×1 após 2 jogadas → rodada ainda não decidida (null)', () => {
    expect(
      resolveHandWinner(
        [
          { winnerSeat: 0, roundNumber: 1 },
          { winnerSeat: 1, roundNumber: 2 },
        ],
        seats,
      ),
    ).toBeNull();
  });

  it('ganhou 1ª + perdeu 2ª + empate 3ª → vence quem ganhou 1ª', () => {
    expect(
      resolveHandWinner(
        [
          { winnerSeat: 0, roundNumber: 1 },
          { winnerSeat: 1, roundNumber: 2 },
          { winnerSeat: 'tie', roundNumber: 3 },
        ],
        seats,
      ),
    ).toBe(0);
  });
});

describe('truco', () => {
  it('pontos ao correr', () => {
    expect(pointsOnRefuse(3)).toBe(1);
    expect(pointsOnRefuse(6)).toBe(3);
    expect(pointsOnRefuse(9)).toBe(6);
    expect(pointsOnRefuse(12)).toBe(9);
  });
});

describe('ordem de jogada', () => {
  it('primeiro jogador é à direita do pé (CCW)', () => {
    expect(firstPlayerSeat(0, 4)).toBe(1);
    expect(firstPlayerSeat(3, 4)).toBe(0);
  });

  it('próximo dealer é CCW', () => {
    expect(nextDealerSeat(0, 4)).toBe(3);
    expect(nextDealerSeat(3, 4)).toBe(2);
  });
});

describe('engine integração', () => {
  const seats: SeatPlayer[] = [seat(0, 0), seat(1, 1)];

  it('inicia mão com cartas', () => {
    const result = startHand(createInitialMatchState('1v1', seats, 0), () => 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.currentHand?.hands[0]).toEqual([
      expect.anything(),
      expect.anything(),
      expect.anything(),
    ]);
    expect(result.state.currentHand?.vira).toBeDefined();
  });

  it('anuncia carta ao fechar a jogada (inclui última carta da rodada)', () => {
    const started = startHand(createInitialMatchState('1v1', seats, 0), () => 0.5);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    let state = started.state;

    for (let i = 0; i < 2; i++) {
      const turn = state.currentHand!.currentTurnSeat;
      const uid = state.seats.find((s) => s.seat === turn)!.userId;
      const slot = state.currentHand!.hands[turn].findIndex((card) => card !== null) + 1;
      const played = playCard(state, uid, slot, false);
      expect(played.ok).toBe(true);
      if (!played.ok) return;
      state = played.state;
      if (i === 1) {
        expect(played.events.some((e) => e.type === 'card_played')).toBe(true);
        expect(played.events.some((e) => e.type === 'jogada_finished')).toBe(true);
      }
    }
  });

  it('mantém ids 1/2/3 fixos após jogar carta do meio', () => {
    const started = startHand(createInitialMatchState('1v1', seats, 0), () => 0.5);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const turnSeat = started.state.currentHand!.currentTurnSeat;
    const playerId = started.state.seats.find((s) => s.seat === turnSeat)!.userId;

    const played = playCard(started.state, playerId, 2, false);
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    const remaining = played.state.currentHand!.hands[turnSeat];
    expect(remaining[0]).not.toBeNull();
    expect(remaining[1]).toBeNull();
    expect(remaining[2]).not.toBeNull();
  });

  it('rejeita jogada fora da vez', () => {
    const started = startHand(createInitialMatchState('1v1', seats, 0), () => 0.1);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const wrongSeat = started.state.currentHand!.currentTurnSeat === 0 ? 1 : 0;
    const wrongPlayer = seats.find((s) => s.seat === wrongSeat)!.userId;
    expect(playCard(started.state, wrongPlayer, 1).ok).toBe(false);
  });

  it('mão de onze bloqueia truco', () => {
    const state: MatchState = {
      ...createInitialMatchState('1v1', seats, 0),
      scores: [11, 5],
    };
    const hand = startHand(state, () => 0.2);
    expect(hand.ok).toBe(true);
    if (!hand.ok) return;
    expect(hand.state.phase).toBe('mao_onze_decision');
    expect(hand.state.currentHand?.isMaoOnze).toBe(true);
    expect(hand.state.currentHand?.handValue).toBe(3);
    expect(hand.state.currentHand?.hands[0].filter((card) => card !== null)).toHaveLength(3);
  });

  it('mão de onze em solo confirma com !aceitar sem !confirmar', () => {
    const started = startHand(
      { ...createInitialMatchState('1v1', seats, 0), scores: [11, 5] },
      () => 0.2,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const slotsBefore = [...started.state.currentHand!.hands[0]];

    const voted = voteMaoOnze(started.state, seats[0].userId, 'accept');
    expect(voted.ok).toBe(true);
    if (!voted.ok) return;
    expect(voted.state.currentHand?.hands[0]).toEqual(slotsBefore);
    expect(voted.state.phase).toBe('playing');
  });

  it('mão de onze em solo !correr atualiza placar', () => {
    const started = startHand(
      { ...createInitialMatchState('1v1', seats, 0), scores: [11, 0] },
      () => 0.2,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const ran = voteMaoOnze(started.state, seats[0].userId, 'run');
    expect(ran.ok).toBe(true);
    if (!ran.ok) return;
    expect(ran.state.scores).toEqual([11, 1]);
    const runEv = ran.events.find((e) => e.type === 'mao_onze_run');
    expect(runEv).toBeDefined();
    if (runEv?.type === 'mao_onze_run') expect(runEv.scores).toEqual([11, 1]);
  });

  it('timeout na mão de onze corre automaticamente e redistribui se ainda em 11', () => {
    const started = startHand(
      { ...createInitialMatchState('1v1', seats, 0), scores: [11, 5] },
      () => 0.2,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const slotsBefore = started.state.currentHand!.hands[0];

    const timedOut = autoTimeoutMaoOnze(started.state);
    expect(timedOut.ok).toBe(true);
    if (!timedOut.ok) return;

    expect(timedOut.events.some((e) => e.type === 'mao_onze_timeout')).toBe(true);
    expect(timedOut.events.some((e) => e.type === 'mao_onze_started')).toBe(true);
    expect(timedOut.state.scores).toEqual([11, 6]);
    expect(timedOut.state.phase).toBe('mao_onze_decision');
    expect(timedOut.state.currentHand?.hands[0]).not.toEqual(slotsBefore);
    expect(timedOut.state.turnStartedAt).not.toBeNull();
  });

  it('auto play escolhe melhor carta', () => {
    expect(findBestCardIndex([c('4', 'O'), c('3', 'E'), c('7', 'C')], 'Q')).toBe(1);
  });
});

describe('raise flow', () => {
  const seats: SeatPlayer[] = [seat(0, 0), seat(1, 1)];

  it('aceitar truco dá direito de seis ao aceitador', () => {
    const started = startHand(createInitialMatchState('1v1', seats, 0), () => 0.3);
    if (!started.ok) return;
    const state = started.state;

    const turnSeat = state.currentHand!.currentTurnSeat;
    const requester = state.seats.find((s) => s.seat === turnSeat)!.userId;
    const raised = requestRaise(state, requester, 3);
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const responder = state.seats.find((s) => s.userId !== requester)!.userId;
    const accepted = acceptRaise(raised.state, responder);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    const acceptingTeam = state.seats.find((s) => s.userId === responder)!.team;
    expect(accepted.state.raise?.canRaiseTeam).toBe(acceptingTeam);
    expect(accepted.state.currentHand?.handValue).toBe(3);
    expect(accepted.events.some((e) => e.type === 'turn_changed' && e.seat === turnSeat)).toBe(true);
  });

  it('truco após adversário jogar: pedinte joga depois e rodada só fecha com 2 cartas', () => {
    const started = startHand(createInitialMatchState('1v1', seats, 0), () => 0.55);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    let state = started.state;

    const openerSeat = state.currentHand!.currentTurnSeat;
    const openerId = state.seats.find((s) => s.seat === openerSeat)!.userId;
    const responderSeat = openerSeat === 0 ? 1 : 0;
    const responderId = state.seats.find((s) => s.seat === responderSeat)!.userId;

    const openerSlot = state.currentHand!.hands[openerSeat].findIndex((card) => card !== null) + 1;
    const opened = playCard(state, openerId, openerSlot, false);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    state = opened.state;
    expect(state.currentHand?.table).toHaveLength(1);

    const raised = requestRaise(state, responderId, 3);
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const accepted = acceptRaise(raised.state, openerId);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    state = accepted.state;
    expect(state.currentHand?.table).toHaveLength(1);

    const responderSlot =
      state.currentHand!.hands[responderSeat].findIndex((card) => card !== null) + 1;
    const responded = playCard(state, responderId, responderSlot, false);
    expect(responded.ok).toBe(true);
    if (!responded.ok) return;

    expect(responded.events.some((e) => e.type === 'jogada_finished')).toBe(true);
    expect(responded.events.some((e) => e.type === 'card_played')).toBe(true);
  });

  it('correr do truco dá 1 ponto', () => {
    const started = startHand(createInitialMatchState('1v1', seats, 0), () => 0.4);
    if (!started.ok) return;
    const state = started.state;

    const turnSeat = state.currentHand!.currentTurnSeat;
    const requester = state.seats.find((s) => s.seat === turnSeat)!.userId;
    const raised = requestRaise(state, requester, 3);
    if (!raised.ok) return;

    const responder = state.seats.find((s) => s.userId !== requester)!.userId;
    const refused = refuseRaise(raised.state, responder);
    expect(refused.ok).toBe(true);
    if (!refused.ok) return;

    const refusedEvent = refused.events.find((e) => e.type === 'raise_refused');
    expect(refusedEvent).toBeDefined();
    if (refusedEvent?.type === 'raise_refused') expect(refusedEvent.points).toBe(1);
  });
});

describe('mão de ferro', () => {
  const seats: SeatPlayer[] = [seat(0, 0), seat(1, 1)];

  it('11x11 inicia mão de ferro', () => {
    const hand = startHand(
      { ...createInitialMatchState('1v1', seats, 0), scores: [11, 11] },
      () => 0.5,
    );
    expect(hand.ok).toBe(true);
    if (!hand.ok) return;
    expect(hand.events.some((e) => e.type === 'mao_ferro_started')).toBe(true);
    expect(hand.state.currentHand?.isMaoFerro).toBe(true);
    expect(hand.state.currentHand?.handValue).toBe(3);
  });

  it('mão de ferro resolve jogada pelas cartas reais', () => {
    const started = startHand(
      { ...createInitialMatchState('1v1', seats, 0), scores: [11, 11] },
      () => 0.5,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const turn0 = started.state.currentHand!.currentTurnSeat;
    const turn1 = turn0 === 0 ? 1 : 0;
    const uid0 = seats.find((s) => s.seat === turn0)!.userId;
    const uid1 = seats.find((s) => s.seat === turn1)!.userId;

    const withHands: MatchState = {
      ...started.state,
      currentHand: {
        ...started.state.currentHand!,
        hands: {
          [turn0]: [c('4', 'O'), c('5', 'O'), c('6', 'O')],
          [turn1]: [c('3', 'E'), c('7', 'E'), c('2', 'E')],
        },
      },
    };

    const first = playCard(withHands, uid0, 1, false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = playCard(first.state, uid1, 1, false);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const jogadaEv = second.events.find((e) => e.type === 'jogada_finished');
    expect(jogadaEv?.type).toBe('jogada_finished');
    if (jogadaEv?.type !== 'jogada_finished') return;

    expect(jogadaEv.winnerSeat).toBe(turn1);
    expect(jogadaEv.plays).toHaveLength(2);
    expect(jogadaEv.plays.every((p) => p.hidden)).toBe(true);
  });

  it('mão de ferro encerra partida com placar no máximo 12', () => {
    const started = startHand(
      { ...createInitialMatchState('1v1', seats, 0), scores: [11, 11] },
      () => 0.5,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const turn0 = started.state.currentHand!.currentTurnSeat;
    const turn1 = turn0 === 0 ? 1 : 0;
    const uid0 = seats.find((s) => s.seat === turn0)!.userId;
    const uid1 = seats.find((s) => s.seat === turn1)!.userId;

    const state: MatchState = {
      ...started.state,
      currentHand: {
        ...started.state.currentHand!,
        round: 3,
        roundResults: [
          { winnerSeat: turn0, roundNumber: 1 },
          { winnerSeat: turn1, roundNumber: 2 },
        ],
        hands: {
          [turn0]: [null, c('3', 'E'), null],
          [turn1]: [null, c('4', 'O'), null],
        },
        table: [],
        currentTurnSeat: turn0,
        roundStarterSeat: turn0,
      },
    };

    const first = playCard(state, uid0, 2, false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = playCard(first.state, uid1, 2, false);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const winnerTeam = seats.find((s) => s.seat === turn0)!.team;
    expect(second.state.phase).toBe('match_finished');
    expect(second.state.scores[winnerTeam]).toBe(12);
    expect(second.state.scores[1 - winnerTeam]).toBe(11);
    expect(second.events.some((e) => e.type === 'match_finished')).toBe(true);
  });
});
