export type Suit = 'O' | 'E' | 'C' | 'P';
export type Rank = '4' | '5' | '6' | '7' | 'Q' | 'J' | 'K' | 'A' | '2' | '3';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type GameMode = '1v1' | '2v2';
export type TeamId = 0 | 1;
export type HandValue = 1 | 3 | 6 | 9 | 12;
export type RaiseLevel = 3 | 6 | 9 | 12;

export type MatchPhase =
  | 'waiting'
  | 'mao_onze_decision'
  | 'playing'
  | 'raise_pending'
  | 'hand_finished'
  | 'match_finished';

export interface SeatPlayer {
  seat: number;
  /** `users.user_id` do BreakerBot (JID canônico). */
  userId: string;
  /** JID usado para menções no grupo. */
  whatsappJid: string;
  /** JID usado para mensagens privadas; ausente em estados antigos. */
  dmJid?: string;
  displayName: string;
  team: TeamId;
}

export interface TablePlay {
  seat: number;
  card: Card | null;
  hidden: boolean;
}

export interface RoundResult {
  winnerSeat: number | 'tie';
  roundNumber: 1 | 2 | 3;
}

export interface HandState {
  vira: Card;
  manilhaRank: Rank;
  handValue: HandValue;
  isMaoOnze: boolean;
  isMaoFerro: boolean;
  round: 1 | 2 | 3;
  dealerSeat: number;
  roundStarterSeat: number;
  currentTurnSeat: number;
  roundResults: RoundResult[];
  hands: Record<number, HandSlots>;
  table: TablePlay[];
  history: HandHistoryEntry[];
}

export interface HandHistoryEntry {
  round: number;
  seat: number;
  displayName: string;
  card: Card | null;
  hidden: boolean;
  cardSlot?: 1 | 2 | 3;
}

/** Três posições fixas (1, 2, 3) — carta jogada vira null, mas o slot mantém o id. */
export type HandSlots = [Card | null, Card | null, Card | null];

export const HAND_SLOT_COUNT = 3;

export interface CardSlotView {
  id: 1 | 2 | 3;
  card: Card;
}

export interface RaiseState {
  currentValue: HandValue;
  pendingLevel: RaiseLevel | null;
  requestedByTeam: TeamId;
  canRaiseTeam: TeamId | null;
  waitingResponseFromTeam: TeamId;
  responded: boolean;
}

export interface MaoOnzeDecision {
  team: TeamId;
  votes: Record<string, 'accept' | 'run' | null>;
  confirmed: boolean;
}

export interface MatchState {
  phase: MatchPhase;
  mode: GameMode;
  scores: [number, number];
  seats: SeatPlayer[];
  dealerSeat: number;
  currentHand: HandState | null;
  raise: RaiseState | null;
  maoOnze: MaoOnzeDecision | null;
  lastActionAt: string;
  turnStartedAt: string | null;
}

export interface LobbySlot {
  seat: number;
  team: TeamId;
  userId: string | null;
  whatsappJid: string | null;
  dmJid?: string | null;
  displayName: string | null;
  /** `users.user_id` para quem o assento foi reservado via menção. */
  reservedForUserId: string | null;
}

export interface LobbyState {
  mode: GameMode;
  createdByUserId: string;
  slots: LobbySlot[];
  createdAt: string;
  expiresAt: string;
}

export type GameActionResult =
  | { ok: true; state: MatchState; events: GameEvent[] }
  | { ok: false; error: string };

export type GameEvent =
  | { type: 'hand_started'; state: MatchState }
  | { type: 'card_played'; seat: number; card: Card | null; hidden: boolean; cardSlot: 1 | 2 | 3; remainingSlots: HandSlots; vira: Card; manilhaRank: Rank }
  | { type: 'round_won'; seat: number | 'tie'; round: number }
  | { type: 'hand_won'; team: TeamId; points: number }
  | { type: 'hand_tied'; message: string }
  | { type: 'raise_requested'; level: RaiseLevel; team: TeamId }
  | { type: 'raise_accepted'; newValue: HandValue }
  | { type: 'raise_refused'; team: TeamId; points: number }
  | { type: 'match_finished'; winnerTeam: TeamId }
  | { type: 'mao_onze_started'; team: TeamId }
  | { type: 'mao_onze_timeout'; team: TeamId; opponentTeam: TeamId; points: number }
  | { type: 'mao_onze_run'; team: TeamId; opponentTeam: TeamId; points: number; scores: [number, number] }
  | { type: 'mao_ferro_started' }
  | { type: 'auto_play'; seat: number; cardIndex: number }
  | { type: 'turn_changed'; seat: number }
  | { type: 'jogada_finished'; winnerSeat: number | 'tie'; jogada: number; plays: { seat: number; card: Card; hidden: boolean }[]; isMaoFerro: boolean };

export const RANK_ORDER: Rank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
export const SUIT_ORDER: Suit[] = ['O', 'E', 'C', 'P'];
export const SUIT_SYMBOL: Record<Suit, string> = {
  O: '♦',
  E: '♠',
  C: '♥',
  P: '♣',
};

export const HAND_VALUE_ESCALATION: HandValue[] = [1, 3, 6, 9, 12];

export function cardToString(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function nextSeat(seat: number, playerCount: number): number {
  return (seat + 1) % playerCount;
}

export function previousSeat(seat: number, playerCount: number): number {
  return (seat - 1 + playerCount) % playerCount;
}

export function playerCountForMode(mode: GameMode): number {
  return mode === '1v1' ? 2 : 4;
}

export function teamForSeat(seat: number, mode: GameMode): TeamId {
  if (mode === '1v1') return (seat % 2) as TeamId;
  // seats 0,2 = team 0; seats 1,3 = team 1
  return (seat % 2) as TeamId;
}

/** JID usado para enviar o privado de um assento. */
export function seatDmJid(seat: SeatPlayer): string {
  return seat.dmJid ?? seat.userId;
}
