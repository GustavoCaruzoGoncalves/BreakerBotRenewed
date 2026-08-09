/** Tipos do SkullCards (jogo de cartas multiplayer no estilo UNO). */

export type ColorCode = 'R' | 'Y' | 'G' | 'B';

export type CardColor = 'red' | 'yellow' | 'green' | 'blue' | 'wild';

/**
 * Representação textual persistida em `VARCHAR(20)`: `"R-5"`, `"B-SKIP"`, `"W"`, `"W+4"`.
 * Interpretada por `engine.parseCard`, que devolve o `ParsedCard` tipado.
 */
export type Card = string;

export type CardType = 'NUMBER' | 'SKIP' | 'REVERSE' | 'DRAW_TWO' | 'WILD' | 'WILD_DRAW_FOUR' | 'UNKNOWN';

export interface ParsedCard {
  type: CardType;
  value: number | null;
  color: CardColor;
}

/** 1 = sentido horário, -1 = anti-horário. */
export type Direction = 1 | -1;

export type RoomStatus = 'lobby' | 'in_progress' | 'finished';

export type MatchStatus = 'active' | 'finished' | 'cancelled';

// --- Rows ---

export interface RoomRow {
  room_id: string;
  host_user_id: string;
  status: RoomStatus;
  is_public: boolean;
  created_at: Date | string;
}

export interface RoomPlayerRow {
  user_id: string;
  joined_at: Date | string;
}

export interface MatchRow {
  match_id: string;
  room_id: string;
  status: MatchStatus;
  current_turn_user_id: string;
  direction: Direction;
  current_color: CardColor;
  pending_draw: number;
  discard_top: Card;
  winner_user_id?: string | null;
}

// --- Entidades ---

export interface Room extends RoomRow {
  players: RoomPlayerRow[];
}

export interface MatchState {
  matchId: string;
  roomId: string;
  status: MatchStatus;
  currentTurnUserId: string;
  direction: Direction;
  currentColor: CardColor;
  pendingDraw: number;
  discardTop: Card;
  winnerUserId: string | null;
  hands: Record<string, Card[]>;
  drawPile: Card[];
  discardPile: Card[];
}

export interface CreatedMatch {
  match: MatchRow;
  players: string[];
  hands: Record<string, Card[]>;
  drawPileSize: number;
  discardTop: Card;
  currentColor: CardColor;
  direction: Direction;
  pendingDraw: number;
}

// --- Resultados do engine ---

export type PlayRejection =
  | 'not_player_turn'
  | 'must_resolve_draw_stack'
  | 'card_not_match'
  | 'card_not_in_hand'
  | 'invalid_color_choice'
  | 'must_draw'
  | 'has_playable_cards';

export type CanPlayResult = { ok: true } | { ok: false; reason: PlayRejection };

export type ApplyPlayResult =
  | { ok: true; winnerUserId: string | null; nextPlayerId: string }
  | { ok: false; reason: PlayRejection };

export type ApplyDrawResult =
  | { ok: true; drawn: Card[]; nextPlayerId: string }
  | { ok: false; reason: PlayRejection };

export type ApplyPassResult =
  | { ok: true; nextPlayerId: string }
  | { ok: false; reason: PlayRejection };

// --- Resultados do service ---

export type ActionFailureReason = PlayRejection | 'match_not_found' | 'invalid_play' | 'apply_failed' | 'draw_failed' | 'pass_failed';

export interface CardPlayedEvent {
  type: 'card_played';
  playerId: string;
  card: Card;
  chosenColor: CardColor | null;
}

export interface CardDrawnEvent {
  type: 'card_drawn';
  playerId: string;
  drawn: Card[];
}

export interface TurnChangedEvent {
  type: 'turn_changed';
  playerId: string;
}

export type GameEvent = CardPlayedEvent | CardDrawnEvent | TurnChangedEvent;

export type ActionResult<E extends GameEvent> =
  | { ok: true; state: MatchState; event: E }
  | { ok: false; reason: ActionFailureReason; state?: MatchState };
