import { describe, it, expect } from 'vitest';
import type { Card, MatchState, SeatPlayer, TeamId } from '../src/games/truco/types.js';
import {
  advanceDealerForNextRodada,
  createInitialMatchState,
  playCard,
  refuseRaise,
  requestRaise,
  startHand,
} from '../src/games/truco/engine.js';

function seat(n: number, team: TeamId): SeatPlayer {
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

const seats1v1: SeatPlayer[] = [seat(0, 0), seat(1, 1)];
const seats2v2: SeatPlayer[] = [seat(0, 0), seat(1, 1), seat(2, 0), seat(3, 1)];

function firstAvailableSlot(slots: readonly (Card | null)[]): number {
  const idx = slots.findIndex((c) => c !== null);
  return idx >= 0 ? idx + 1 : 0;
}

function playNextCard(state: MatchState, seats: SeatPlayer[]): MatchState | null {
  if (!state.currentHand) return null;
  const turn = state.currentHand.currentTurnSeat;
  const uid = seats.find((p) => p.seat === turn)!.userId;
  const slot = firstAvailableSlot(state.currentHand.hands[turn]);
  if (!slot) return null;
  const result = playCard(state, uid, slot, false);
  return result.ok ? result.state : null;
}

function playUntilScored(state: MatchState, seats: SeatPlayer[]): MatchState | null {
  let s = state;
  let guard = 0;
  const startScore = s.scores[0] + s.scores[1];
  while (s.currentHand && s.scores[0] + s.scores[1] === startScore && guard++ < 40) {
    const next = playNextCard(s, seats);
    if (!next) return null;
    s = next;
  }
  return s.currentHand ? s : null;
}

describe('rotação entre rodadas', () => {
  it('advanceDealerForNextRodada alterna pé e mão no sentido anti-horário', () => {
    expect(advanceDealerForNextRodada(0, 4)).toEqual({ dealerSeat: 3, roundStarterSeat: 0 });
    expect(advanceDealerForNextRodada(3, 4)).toEqual({ dealerSeat: 2, roundStarterSeat: 3 });
    expect(advanceDealerForNextRodada(0, 2)).toEqual({ dealerSeat: 1, roundStarterSeat: 0 });
  });

  it('2v2: correr do truco alterna quem abre a próxima rodada', () => {
    const started = startHand(createInitialMatchState('2v2', seats2v2, 0), () => 0.42);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const opener1 = started.state.currentHand!.currentTurnSeat;
    const requester = seats2v2.find((s) => s.seat === opener1)!.userId;
    const responder = seats2v2.find((s) => s.seat !== opener1)!.userId;

    const raised = requestRaise(started.state, requester, 3);
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const refused = refuseRaise(raised.state, responder);
    expect(refused.ok).toBe(true);
    if (!refused.ok) return;

    expect(refused.state.currentHand!.currentTurnSeat).not.toBe(opener1);
    expect(refused.state.dealerSeat).toBe(3);
  });

  it('1v1: quem abriu a rodada anterior não abre a próxima', () => {
    let found = false;
    for (let seed = 0; seed < 500; seed++) {
      const started = startHand(createInitialMatchState('1v1', seats1v1, 0), () => (seed * 0.017) % 1);
      if (!started.ok) continue;

      const opener1 = started.state.currentHand!.currentTurnSeat;
      const after = playUntilScored(started.state, seats1v1);
      if (!after?.currentHand) continue;

      expect(after.currentHand.currentTurnSeat).not.toBe(opener1);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('dentro da rodada: vencedor da jogada abre a próxima jogada', () => {
    const started = startHand(createInitialMatchState('1v1', seats1v1, 0), () => 0.33);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    let state = started.state;

    for (let i = 0; i < 2; i++) {
      const next = playNextCard(state, seats1v1);
      expect(next).not.toBeNull();
      if (!next) return;
      state = next;
    }

    expect(state.currentHand!.round).toBe(2);
    const j1Winner = state.currentHand!.roundResults[0]!.winnerSeat;
    if (j1Winner !== 'tie') {
      expect(state.currentHand!.currentTurnSeat).toBe(j1Winner);
    }
  });

  it('2v2: ordem de jogada segue a roda (pé joga por último)', () => {
    const started = startHand(createInitialMatchState('2v2', seats2v2, 0), () => 0.33);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    let state = started.state;

    expect(state.dealerSeat).toBe(0);
    expect(state.currentHand!.currentTurnSeat).toBe(1);

    const playOrder: number[] = [];
    for (let i = 0; i < 4; i++) {
      playOrder.push(state.currentHand!.currentTurnSeat);
      const next = playNextCard(state, seats2v2);
      expect(next).not.toBeNull();
      if (!next) return;
      state = next;
    }

    expect(playOrder).toEqual([1, 2, 3, 0]);
  });
});
