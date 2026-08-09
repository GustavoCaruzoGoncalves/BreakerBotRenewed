import { getClient, query } from '../../database/pool.js';
import { config } from '../../config.js';
import { getPostgresErrorCode } from '../../lib/errors.js';
import { calcAuraGain } from './compare.js';
import type { GameMode, HandValue, LobbyState, MatchState, TeamId } from './types.js';

export type MatchStatus = 'waiting' | 'active' | 'finished' | 'cancelled';

export interface TrucoGroupRow {
  id: number;
  whatsapp_jid: string;
  name: string;
}

export interface TrucoMatchRow {
  match_id: string;
  group_id: number;
  mode: GameMode;
  status: MatchStatus;
  created_by: string;
  lobby_json: LobbyState | null;
  state_json: MatchState | null;
  winner_team: number | null;
}

export interface TrucoGroupSettingsRow {
  group_id: number;
  turn_timeout_seconds: number | null;
  lobby_timeout_seconds: number | null;
}

export interface TrucoUserStatsRow {
  user_id: string;
  matches_played: number;
  wins: number;
  losses: number;
  matches_1v1: number;
  matches_2v2: number;
  wins_1v1: number;
  wins_2v2: number;
  win_streak: number;
  best_win_streak: number;
}

export interface TrucoGroupStatsRow {
  user_id: string;
  group_id: number;
  matches_played: number;
  wins: number;
  losses: number;
  win_streak: number;
  best_win_streak: number;
}

export interface RankingEntry {
  user_id: string;
  display_name: string;
  aura_points: number;
  wins: number;
  losses: number;
  matches_played: number;
  win_streak: number;
  best_win_streak: number;
}

/** Erro lançado quando o índice parcial de "uma partida aberta por grupo" é violado. */
export class MatchAlreadyOpenError extends Error {
  constructor() {
    super('match_already_open');
    this.name = 'MatchAlreadyOpenError';
  }
}

const EMPTY_USER_STATS = {
  matches_played: 0,
  wins: 0,
  losses: 0,
  matches_1v1: 0,
  matches_2v2: 0,
  wins_1v1: 0,
  wins_2v2: 0,
  win_streak: 0,
  best_win_streak: 0,
} as const;

// --- Grupos ---

export async function upsertGroup(jid: string, name: string): Promise<TrucoGroupRow> {
  const r = await query<TrucoGroupRow>(
    `INSERT INTO truco_groups (whatsapp_jid, name)
     VALUES ($1, $2)
     ON CONFLICT (whatsapp_jid) DO UPDATE
       SET name = COALESCE(NULLIF(EXCLUDED.name, ''), truco_groups.name),
           last_seen_at = NOW()
     RETURNING id, whatsapp_jid, name`,
    [jid, name],
  );
  return r.rows[0]!;
}

export async function findGroupByJid(jid: string): Promise<TrucoGroupRow | null> {
  const r = await query<TrucoGroupRow>(
    'SELECT id, whatsapp_jid, name FROM truco_groups WHERE whatsapp_jid = $1',
    [jid],
  );
  return r.rows[0] ?? null;
}

export async function findGroupById(id: number): Promise<TrucoGroupRow | null> {
  const r = await query<TrucoGroupRow>(
    'SELECT id, whatsapp_jid, name FROM truco_groups WHERE id = $1',
    [id],
  );
  return r.rows[0] ?? null;
}

export async function listGroups(): Promise<TrucoGroupRow[]> {
  const r = await query<TrucoGroupRow>(
    'SELECT id, whatsapp_jid, name FROM truco_groups ORDER BY last_seen_at DESC',
  );
  return r.rows;
}

export async function getGroupSettings(groupId: number): Promise<TrucoGroupSettingsRow | null> {
  const r = await query<TrucoGroupSettingsRow>(
    'SELECT * FROM truco_group_settings WHERE group_id = $1',
    [groupId],
  );
  return r.rows[0] ?? null;
}

export async function getGroupTimeouts(
  groupId: number,
): Promise<{ turnMs: number; lobbyMs: number }> {
  const settings = await getGroupSettings(groupId);
  return {
    turnMs: (settings?.turn_timeout_seconds ?? config.truco.turnTimeoutSeconds) * 1000,
    lobbyMs: (settings?.lobby_timeout_seconds ?? config.truco.lobbyTimeoutSeconds) * 1000,
  };
}

// --- Partidas ---

const MATCH_COLUMNS =
  'match_id, group_id, mode, status, created_by, lobby_json, state_json, winner_team';

export async function findOpenMatchByGroupId(groupId: number): Promise<TrucoMatchRow | null> {
  const r = await query<TrucoMatchRow>(
    `SELECT ${MATCH_COLUMNS} FROM truco_matches
     WHERE group_id = $1 AND status IN ('waiting', 'active')
     LIMIT 1`,
    [groupId],
  );
  return r.rows[0] ?? null;
}

export async function findMatchById(matchId: string): Promise<TrucoMatchRow | null> {
  const r = await query<TrucoMatchRow>(
    `SELECT ${MATCH_COLUMNS} FROM truco_matches WHERE match_id = $1`,
    [matchId],
  );
  return r.rows[0] ?? null;
}

export async function findAllOpenMatches(): Promise<(TrucoMatchRow & { group_jid: string })[]> {
  const r = await query<TrucoMatchRow & { group_jid: string }>(
    `SELECT m.match_id, m.group_id, m.mode, m.status, m.created_by, m.lobby_json, m.state_json,
            m.winner_team, g.whatsapp_jid AS group_jid
     FROM truco_matches m
     JOIN truco_groups g ON g.id = m.group_id
     WHERE m.status IN ('waiting', 'active')`,
  );
  return r.rows;
}

function rethrowIfMatchOpen(err: unknown): never {
  if (getPostgresErrorCode(err) === '23505') throw new MatchAlreadyOpenError();
  throw err;
}

export async function createMatch(
  groupId: number,
  mode: GameMode,
  createdBy: string,
  lobby: LobbyState,
): Promise<TrucoMatchRow> {
  try {
    const r = await query<TrucoMatchRow>(
      `INSERT INTO truco_matches (group_id, mode, status, created_by, lobby_json)
       VALUES ($1, $2, 'waiting', $3, $4::jsonb)
       RETURNING ${MATCH_COLUMNS}`,
      [groupId, mode, createdBy, JSON.stringify(lobby)],
    );
    return r.rows[0]!;
  } catch (err) {
    rethrowIfMatchOpen(err);
  }
}

export async function createActiveMatch(
  groupId: number,
  mode: GameMode,
  createdBy: string,
  state: MatchState,
): Promise<TrucoMatchRow> {
  try {
    const r = await query<TrucoMatchRow>(
      `INSERT INTO truco_matches (group_id, mode, status, created_by, state_json, started_at)
       VALUES ($1, $2, 'active', $3, $4::jsonb, NOW())
       RETURNING ${MATCH_COLUMNS}`,
      [groupId, mode, createdBy, JSON.stringify(state)],
    );
    return r.rows[0]!;
  } catch (err) {
    rethrowIfMatchOpen(err);
  }
}

export async function updateMatchLobby(matchId: string, lobby: LobbyState): Promise<void> {
  await query('UPDATE truco_matches SET lobby_json = $2::jsonb WHERE match_id = $1', [
    matchId,
    JSON.stringify(lobby),
  ]);
}

export async function startMatch(matchId: string, state: MatchState): Promise<void> {
  await query(
    `UPDATE truco_matches
     SET status = 'active', state_json = $2::jsonb, lobby_json = NULL, started_at = NOW()
     WHERE match_id = $1`,
    [matchId, JSON.stringify(state)],
  );
}

export async function updateMatchState(matchId: string, state: MatchState): Promise<void> {
  await query('UPDATE truco_matches SET state_json = $2::jsonb WHERE match_id = $1', [
    matchId,
    JSON.stringify(state),
  ]);
}

export async function cancelMatch(matchId: string): Promise<void> {
  await query(
    `UPDATE truco_matches SET status = 'cancelled', finished_at = NOW() WHERE match_id = $1`,
    [matchId],
  );
}

export async function saveMatchPlayers(
  matchId: string,
  players: { userId: string; team: number; seat: number }[],
): Promise<void> {
  if (players.length === 0) return;
  const values: unknown[] = [matchId];
  const tuples = players.map((p, i) => {
    values.push(p.userId, p.team, p.seat);
    return `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`;
  });
  await query(
    `INSERT INTO truco_match_players (match_id, user_id, team, seat)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (match_id, user_id) DO UPDATE SET team = EXCLUDED.team, seat = EXCLUDED.seat`,
    values,
  );
}

// --- Estatísticas e aura ---

export interface MatchOutcome {
  winnerUserIds: string[];
  loserUserIds: string[];
  groupId: number;
  mode: GameMode;
  lastHandValue: HandValue;
}

/** Aura creditada a cada vencedor; a derrota debita `config.truco.auraLoss`. */
export function auraGainForWin(handValue: HandValue): number {
  return calcAuraGain(handValue, config.truco.auraBaseWin, config.truco.auraPerHandPoint);
}

/**
 * Encerra a partida, grava estatísticas e aplica a aura numa única transação —
 * um erro no meio do caminho não deixa placar e aura divergentes.
 */
export async function finishMatchWithResult(
  matchId: string,
  winnerTeam: TeamId,
  state: MatchState,
  outcome: MatchOutcome,
): Promise<void> {
  const client = await getClient();
  const auraGain = auraGainForWin(outcome.lastHandValue);
  const auraLoss = config.truco.auraLoss;
  const is1v1 = outcome.mode === '1v1';

  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE truco_matches
       SET status = 'finished', winner_team = $2, state_json = $3::jsonb, finished_at = NOW()
       WHERE match_id = $1`,
      [matchId, winnerTeam, JSON.stringify(state)],
    );

    for (const userId of outcome.winnerUserIds) {
      await client.query(
        `INSERT INTO truco_user_stats (
           user_id, matches_played, wins, matches_1v1, matches_2v2, wins_1v1, wins_2v2,
           win_streak, best_win_streak
         ) VALUES ($1, 1, 1, $2, $3, $2, $3, 1, 1)
         ON CONFLICT (user_id) DO UPDATE SET
           matches_played = truco_user_stats.matches_played + 1,
           wins = truco_user_stats.wins + 1,
           matches_1v1 = truco_user_stats.matches_1v1 + $2,
           matches_2v2 = truco_user_stats.matches_2v2 + $3,
           wins_1v1 = truco_user_stats.wins_1v1 + $2,
           wins_2v2 = truco_user_stats.wins_2v2 + $3,
           win_streak = truco_user_stats.win_streak + 1,
           best_win_streak = GREATEST(truco_user_stats.best_win_streak, truco_user_stats.win_streak + 1),
           updated_at = NOW()`,
        [userId, is1v1 ? 1 : 0, is1v1 ? 0 : 1],
      );

      await client.query(
        `INSERT INTO truco_group_stats (
           user_id, group_id, matches_played, wins, win_streak, best_win_streak
         ) VALUES ($1, $2, 1, 1, 1, 1)
         ON CONFLICT (user_id, group_id) DO UPDATE SET
           matches_played = truco_group_stats.matches_played + 1,
           wins = truco_group_stats.wins + 1,
           win_streak = truco_group_stats.win_streak + 1,
           best_win_streak = GREATEST(truco_group_stats.best_win_streak, truco_group_stats.win_streak + 1),
           updated_at = NOW()`,
        [userId, outcome.groupId],
      );

      await applyAura(client, userId, auraGain);
    }

    for (const userId of outcome.loserUserIds) {
      await client.query(
        `INSERT INTO truco_user_stats (
           user_id, matches_played, losses, matches_1v1, matches_2v2, win_streak
         ) VALUES ($1, 1, 1, $2, $3, 0)
         ON CONFLICT (user_id) DO UPDATE SET
           matches_played = truco_user_stats.matches_played + 1,
           losses = truco_user_stats.losses + 1,
           matches_1v1 = truco_user_stats.matches_1v1 + $2,
           matches_2v2 = truco_user_stats.matches_2v2 + $3,
           win_streak = 0,
           updated_at = NOW()`,
        [userId, is1v1 ? 1 : 0, is1v1 ? 0 : 1],
      );

      await client.query(
        `INSERT INTO truco_group_stats (user_id, group_id, matches_played, losses, win_streak)
         VALUES ($1, $2, 1, 1, 0)
         ON CONFLICT (user_id, group_id) DO UPDATE SET
           matches_played = truco_group_stats.matches_played + 1,
           losses = truco_group_stats.losses + 1,
           win_streak = 0,
           updated_at = NOW()`,
        [userId, outcome.groupId],
      );

      await applyAura(client, userId, -auraLoss);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<unknown> };

async function applyAura(client: Queryable, userId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  await client.query(
    `INSERT INTO aura (user_id, aura_points, updated_at)
     VALUES ($1, $2::bigint, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET aura_points = COALESCE(aura.aura_points, 0::bigint) + $2::bigint,
           updated_at = NOW()`,
    [userId, delta],
  );
}

export async function getUserStats(userId: string): Promise<TrucoUserStatsRow> {
  const r = await query<TrucoUserStatsRow>('SELECT * FROM truco_user_stats WHERE user_id = $1', [
    userId,
  ]);
  return r.rows[0] ?? { user_id: userId, ...EMPTY_USER_STATS };
}

export async function getGroupStats(
  userId: string,
  groupId: number,
): Promise<TrucoGroupStatsRow> {
  const r = await query<TrucoGroupStatsRow>(
    'SELECT * FROM truco_group_stats WHERE user_id = $1 AND group_id = $2',
    [userId, groupId],
  );
  return (
    r.rows[0] ?? {
      user_id: userId,
      group_id: groupId,
      matches_played: 0,
      wins: 0,
      losses: 0,
      win_streak: 0,
      best_win_streak: 0,
    }
  );
}

/** Nome exibido nos rankings: nome customizado, senão pushName, senão o número. */
const DISPLAY_NAME_SQL = `COALESCE(
  NULLIF(CASE WHEN u.custom_name_enabled THEN u.custom_name END, ''),
  NULLIF(u.push_name, ''),
  split_part(u.user_id, '@', 1)
)`;

export async function getGlobalRanking(limit = 10): Promise<RankingEntry[]> {
  const r = await query<RankingEntry>(
    `SELECT s.user_id,
            ${DISPLAY_NAME_SQL} AS display_name,
            COALESCE(a.aura_points, 0)::bigint AS aura_points,
            s.wins, s.losses, s.matches_played, s.win_streak, s.best_win_streak
     FROM truco_user_stats s
     JOIN users u ON u.user_id = s.user_id
     LEFT JOIN aura a ON a.user_id = s.user_id
     WHERE s.matches_played > 0
     ORDER BY s.wins DESC, s.losses ASC
     LIMIT $1`,
    [limit],
  );
  return r.rows.map(normalizeRankingEntry);
}

export async function getGroupRanking(groupId: number, limit = 10): Promise<RankingEntry[]> {
  const r = await query<RankingEntry>(
    `SELECT s.user_id,
            ${DISPLAY_NAME_SQL} AS display_name,
            COALESCE(a.aura_points, 0)::bigint AS aura_points,
            s.wins, s.losses, s.matches_played, s.win_streak, s.best_win_streak
     FROM truco_group_stats s
     JOIN users u ON u.user_id = s.user_id
     LEFT JOIN aura a ON a.user_id = s.user_id
     WHERE s.group_id = $1 AND s.matches_played > 0
     ORDER BY s.wins DESC, s.losses ASC
     LIMIT $2`,
    [groupId, limit],
  );
  return r.rows.map(normalizeRankingEntry);
}

/** `aura_points` é BIGINT e chega do `pg` como string. */
function normalizeRankingEntry(row: RankingEntry): RankingEntry {
  return { ...row, aura_points: Number(row.aura_points) };
}

export async function getAuraPoints(userId: string): Promise<number> {
  const r = await query<{ aura_points: string | number }>(
    'SELECT aura_points FROM aura WHERE user_id = $1',
    [userId],
  );
  const row = r.rows[0];
  return row ? Number(row.aura_points) : 0;
}
