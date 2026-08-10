import type { WAMessageKey } from '@whiskeysockets/baileys';
import { getClient, query } from './pool.js';
import type {
  AmigoSecretoGroup,
  AmigoSecretoMap,
  Aura,
  AuraBalanceLookup,
  AuraDeltaResult,
  AuraRankingEntry,
  AuraTransferResult,
  AuraUserBasic,
  AuraWithMissionsRow,
  AuthCode,
  AuthCodeInput,
  AuthSession,
  AuthSessionInput,
  DailyBonus,
  DeletedUserBackup,
  Feature,
  LevelHistoryEntry,
  LevelHistoryRow,
  LevelRankingEntry,
  MentionsPreferences,
  MentionsPreferences as MentionsPreferencesInput,
  PendingMessage,
  PendingMessageInput,
  User,
  UserInput,
  UserRow,
  UsersMap,
  WriteScope,
} from './types.js';

// --- Row mappers ---

function toIsoString(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function rowToUser(
  row: UserRow | undefined | null,
  auraRow?: AuraWithMissionsRow | null,
  dmRow?: AuraWithMissionsRow | null,
  badges: string[] = [],
  levelHistory: LevelHistoryEntry[] = [],
): User | null {
  if (!row) return null;

  const user: User = {
    xp: row.xp ?? 0,
    level: row.level ?? 1,
    prestige: row.prestige ?? 0,
    prestigeAvailable: row.prestige_available ?? 0,
    totalMessages: row.total_messages ?? 0,
    lastMessageTime: toIsoString(row.last_message_time),
    badges: Array.isArray(badges) ? badges : [],
    lastPrestigeLevel: row.last_prestige_level ?? 0,
    levelHistory: Array.isArray(levelHistory) ? levelHistory : [],
    dailyBonusMultiplier: row.daily_bonus_multiplier ?? 0,
    dailyBonusExpiry: toIsoString(row.daily_bonus_expiry),
    allowMentions: row.allow_mentions ?? false,
    pushName: row.push_name ?? null,
    customName: row.custom_name ?? null,
    customNameEnabled: row.custom_name_enabled ?? false,
    jid: row.jid ?? row.user_id,
    profilePicture: row.profile_picture ?? null,
    profilePictureUpdatedAt: toIsoString(row.profile_picture_updated_at),
    emoji: row.emoji ?? null,
    emojiReaction: row.emoji_reaction ?? false,
  };

  if (auraRow) {
    user.aura = {
      auraPoints: Number(auraRow.aura_points) || 0,
      stickerHash: auraRow.sticker_hash ?? null,
      stickerDataUrl: auraRow.sticker_data_url ?? null,
      character: auraRow.character ?? null,
      dailyMissions: dmRow
        ? {
            lastResetDate: dmRow.last_reset_date,
            drawnMissions: dmRow.drawn_missions ?? [],
            completedMissionIds: dmRow.completed_mission_ids ?? [],
            progress: {
              messages: dmRow.progress_messages ?? 0,
              reactions: dmRow.progress_reactions ?? 0,
              duelWin: dmRow.progress_duel_win ?? 0,
              surviveAttack: dmRow.progress_survive_attack ?? 0,
              media: dmRow.progress_media ?? 0,
              helpSomeone: dmRow.progress_help_someone ?? 0,
            },
          }
        : {
            lastResetDate: null,
            drawnMissions: [],
            completedMissionIds: [],
            progress: {
              messages: 0,
              reactions: 0,
              duelWin: 0,
              surviveAttack: 0,
              media: 0,
              helpSomeone: 0,
            },
          },
      lastRitualDate: auraRow.last_ritual_date ?? null,
      lastTreinarAt: auraRow.last_treinar_at ?? null,
      lastDominarAt: auraRow.last_dominar_at ?? null,
      negativeFarmPunished: auraRow.negative_farm_punished ?? false,
    };
  }

  return user;
}

const CAMEL_TO_DB: Record<string, string> = {
  pushName: 'push_name',
  customName: 'custom_name',
  customNameEnabled: 'custom_name_enabled',
  profilePicture: 'profile_picture',
  profilePictureUpdatedAt: 'profile_picture_updated_at',
  lastMessageTime: 'last_message_time',
  totalMessages: 'total_messages',
  prestigeAvailable: 'prestige_available',
  lastPrestigeLevel: 'last_prestige_level',
  dailyBonusMultiplier: 'daily_bonus_multiplier',
  dailyBonusExpiry: 'daily_bonus_expiry',
  allowMentions: 'allow_mentions',
  emoji: 'emoji',
  emojiReaction: 'emoji_reaction',
};

type DbFields = Record<string, unknown>;

function camelToDb(obj: Record<string, unknown>): DbFields {
  const out: DbFields = {};
  for (const [k, v] of Object.entries(obj)) {
    out[CAMEL_TO_DB[k] ?? k.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')] = v;
  }
  return out;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// --- Badges & Level History ---

export async function getBadgesByUserIds(userIds: string[]): Promise<Record<string, string[]>> {
  if (userIds.length === 0) return {};
  const r = await query<{ user_id: string; badge: string }>(
    'SELECT user_id, badge FROM user_badges WHERE user_id = ANY($1) ORDER BY created_at',
    [userIds],
  );
  const byUser: Record<string, string[]> = {};
  for (const row of r.rows) {
    (byUser[row.user_id] ??= []).push(row.badge);
  }
  return byUser;
}

export async function getLevelHistoryByUserIds(
  userIds: string[],
): Promise<Record<string, LevelHistoryEntry[]>> {
  if (userIds.length === 0) return {};
  const r = await query<LevelHistoryRow>(
    `SELECT user_id, action, old_level, old_xp, old_prestige_available, old_prestige, new_level, new_xp, created_at
     FROM user_level_history WHERE user_id = ANY($1) ORDER BY user_id, created_at`,
    [userIds],
  );
  const byUser: Record<string, LevelHistoryEntry[]> = {};
  for (const row of r.rows) {
    (byUser[row.user_id] ??= []).push({
      action: row.action,
      timestamp: toIsoString(row.created_at),
      oldLevel: row.old_level ?? 0,
      oldXP: row.old_xp ?? 0,
      oldPrestigeAvailable: row.old_prestige_available ?? 0,
      oldPrestige: row.old_prestige ?? 0,
      newLevel: row.new_level ?? 0,
      newXP: row.new_xp ?? 0,
    });
  }
  for (const uid of userIds) {
    byUser[uid]?.reverse();
  }
  return byUser;
}

export async function syncUserBadges(userId: string, badges: string[] | undefined): Promise<void> {
  await query('DELETE FROM user_badges WHERE user_id = $1', [userId]);
  if (!Array.isArray(badges)) return;
  for (const badge of badges) {
    if (badge && String(badge).trim()) {
      await query(
        'INSERT INTO user_badges (user_id, badge) VALUES ($1, $2) ON CONFLICT (user_id, badge) DO NOTHING',
        [userId, String(badge).trim()],
      );
    }
  }
}

export async function syncUserLevelHistory(
  userId: string,
  levelHistory: LevelHistoryEntry[] | undefined,
): Promise<void> {
  await query('DELETE FROM user_level_history WHERE user_id = $1', [userId]);
  const entries = Array.isArray(levelHistory) ? levelHistory.slice(-10) : [];
  for (const e of entries) {
    await query(
      `INSERT INTO user_level_history (user_id, action, old_level, old_xp, old_prestige_available, old_prestige, new_level, new_xp, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
      [
        userId,
        e.action || 'setlevel',
        e.oldLevel ?? 0,
        e.oldXP ?? 0,
        e.oldPrestigeAvailable ?? 0,
        e.oldPrestige ?? 0,
        e.newLevel ?? 0,
        e.newXP ?? 0,
        e.timestamp || new Date().toISOString(),
      ],
    );
  }
}

// --- Users CRUD ---

const AURA_WITH_MISSIONS_SELECT = `SELECT a.*, dm.last_reset_date, dm.drawn_missions, dm.completed_mission_ids,
              dm.progress_messages, dm.progress_reactions, dm.progress_duel_win,
              dm.progress_survive_attack, dm.progress_media, dm.progress_help_someone
       FROM aura a LEFT JOIN daily_missions dm ON dm.aura_id = a.id`;

export async function getAllUsers(): Promise<UsersMap> {
  const usersResult = await query<UserRow>('SELECT * FROM users ORDER BY user_id');
  const userIds = usersResult.rows.map((r) => r.user_id);
  if (userIds.length === 0) return {};

  const [auraResult, badgesByUser, levelHistoryByUser] = await Promise.all([
    query<AuraWithMissionsRow>(`${AURA_WITH_MISSIONS_SELECT} WHERE a.user_id = ANY($1)`, [userIds]),
    getBadgesByUserIds(userIds),
    getLevelHistoryByUserIds(userIds),
  ]);

  const auraByUser: Record<string, AuraWithMissionsRow> = {};
  for (const r of auraResult.rows) auraByUser[r.user_id] = r;

  const result: UsersMap = {};
  for (const row of usersResult.rows) {
    const ar = auraByUser[row.user_id];
    const user = rowToUser(
      row,
      ar,
      ar,
      badgesByUser[row.user_id] ?? [],
      levelHistoryByUser[row.user_id] ?? [],
    );
    if (user) result[row.user_id] = user;
  }
  return result;
}

export async function getUserById(userId: string): Promise<User | null> {
  const userResult = await query<UserRow>('SELECT * FROM users WHERE user_id = $1', [userId]);
  const row = userResult.rows[0];
  if (!row) return null;

  const [auraResult, badges, levelHistory] = await Promise.all([
    query<AuraWithMissionsRow>(`${AURA_WITH_MISSIONS_SELECT} WHERE a.user_id = $1`, [userId]),
    getBadgesByUserIds([userId]).then((m) => m[userId] ?? []),
    getLevelHistoryByUserIds([userId]).then((m) => m[userId] ?? []),
  ]);

  const auraRow = auraResult.rows[0];
  return rowToUser(row, auraRow, auraRow, badges, levelHistory);
}

function userInsertParams(userId: string, userData: UserInput): unknown[] {
  const d = camelToDb(userData as Record<string, unknown>);
  return [
    userId,
    d.xp ?? 0,
    d.level ?? 1,
    d.prestige ?? 0,
    d.prestige_available ?? 0,
    d.total_messages ?? 0,
    d.last_message_time ?? new Date().toISOString(),
    d.last_prestige_level ?? 0,
    d.daily_bonus_multiplier ?? 0,
    d.daily_bonus_expiry ?? null,
    d.allow_mentions ?? false,
    d.push_name ?? userData.pushName ?? null,
    d.custom_name ?? userData.customName ?? null,
    d.custom_name_enabled ?? userData.customNameEnabled ?? false,
    d.jid ?? userData.jid ?? null,
    d.profile_picture ?? null,
    d.profile_picture_updated_at ?? null,
    d.emoji ?? null,
    d.emoji_reaction ?? false,
  ];
}

const INSERT_USER_SQL = `INSERT INTO users (user_id, xp, level, prestige, prestige_available, total_messages, last_message_time,
     last_prestige_level, daily_bonus_multiplier, daily_bonus_expiry,
     allow_mentions, push_name, custom_name, custom_name_enabled, jid, profile_picture, profile_picture_updated_at,
     emoji, emoji_reaction)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10::timestamptz,
     $11, $12, $13, $14, $15, $16, $17::timestamptz, $18, $19)`;

export async function createUser(userId: string, userData: UserInput): Promise<User | null> {
  await query(INSERT_USER_SQL, userInsertParams(userId, userData));

  const auraIns = await query<{ id: number }>(
    'INSERT INTO aura (user_id) VALUES ($1) RETURNING id',
    [userId],
  );
  const auraId = auraIns.rows[0]?.id;
  if (auraId !== undefined) {
    await query('INSERT INTO daily_missions (aura_id, last_reset_date) VALUES ($1, $2)', [
      auraId,
      new Date().toISOString().slice(0, 10),
    ]);
  }
  await syncUserBadges(userId, userData.badges ?? []);
  await syncUserLevelHistory(userId, userData.levelHistory ?? []);
  return getUserById(userId);
}

const UPDATABLE_USER_COLUMNS = [
  'xp',
  'level',
  'prestige',
  'prestige_available',
  'total_messages',
  'last_message_time',
  'last_prestige_level',
  'daily_bonus_multiplier',
  'daily_bonus_expiry',
  'allow_mentions',
  'push_name',
  'custom_name',
  'custom_name_enabled',
  'jid',
  'profile_picture',
  'profile_picture_updated_at',
  'emoji',
  'emoji_reaction',
] as const;

export async function updateUser(userId: string, userData: UserInput): Promise<User | null> {
  const d = camelToDb(userData as Record<string, unknown>);
  const existing = await getUserById(userId);

  const incomingJid = asOptionalString(d.jid);
  if (existing && incomingJid) {
    // `user_id` já é o PN; a coluna `jid` guarda o LID do WhatsApp.
    if (incomingJid.endsWith('@s.whatsapp.net')) {
      if (existing.jid.endsWith('@lid')) {
        delete d.jid;
      } else if (incomingJid === userId) {
        delete d.jid;
      }
    }
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const k of UPDATABLE_USER_COLUMNS) {
    if (d[k] !== undefined) {
      sets.push(`${k} = $${i}`);
      vals.push(d[k]);
      i++;
    }
  }

  if (sets.length > 0) {
    vals.push(userId);
    await query(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE user_id = $${i}`, vals);
  }

  if (userData.badges !== undefined) await syncUserBadges(userId, userData.badges);
  if (userData.levelHistory !== undefined) await syncUserLevelHistory(userId, userData.levelHistory);
  return getUserById(userId);
}

export async function patchUser(userId: string, updates: UserInput | null): Promise<User | null> {
  const existing = await getUserById(userId);
  if (!existing) return null;
  if (!updates || Object.keys(updates).length === 0) return existing;
  return updateUser(userId, updates);
}

// --- Write scoping ---

const LEVEL_FIELDS = [
  'xp',
  'level',
  'prestige',
  'prestigeAvailable',
  'totalMessages',
  'lastMessageTime',
  'lastPrestigeLevel',
  'dailyBonusMultiplier',
  'dailyBonusExpiry',
  'badges',
  'levelHistory',
] as const satisfies readonly (keyof User)[];

const PREFERENCE_FIELDS = [
  'allowMentions',
  'pushName',
  'customName',
  'customNameEnabled',
  'jid',
  'profilePicture',
  'profilePictureUpdatedAt',
  'emoji',
  'emojiReaction',
] as const satisfies readonly (keyof User)[];

function copyDefinedField<K extends keyof User>(target: UserInput, source: UserInput, key: K): void {
  if (source[key] !== undefined) target[key] = source[key];
}

export interface SaveAllUsersOptions {
  writeScope?: WriteScope;
}

export async function saveAllUsers(
  usersData: UsersMap,
  options: SaveAllUsersOptions = {},
): Promise<void> {
  const scope = options.writeScope ?? 'all';

  for (const [userId, userData] of Object.entries(usersData)) {
    if (typeof userId !== 'string' || !userId.includes('@')) continue;
    const existing = await getUserById(userId);

    if (!existing) {
      await createUser(userId, userData);
      continue;
    }

    const fields: readonly (keyof User)[] | null =
      scope === 'level' ? LEVEL_FIELDS : scope === 'preferences' ? PREFERENCE_FIELDS : null;

    if (fields) {
      const merged: UserInput = { ...existing };
      for (const f of fields) copyDefinedField(merged, userData, f);
      await updateUser(userId, merged);
    } else if (scope === 'aura') {
      if (userData.aura) await updateAura(userId, userData.aura);
    } else {
      await updateUser(userId, userData);
      if (userData.aura) await updateAura(userId, userData.aura);
    }
  }
}

// --- Aura ---

export async function ensureAuraRow(userId: string): Promise<void> {
  await query(
    'INSERT INTO aura (user_id, aura_points, updated_at) VALUES ($1, 0, NOW()) ON CONFLICT (user_id) DO NOTHING',
    [userId],
  );
}

export async function updateAura(userId: string, auraData: Partial<Aura> | null): Promise<void> {
  const aura = auraData ?? {};
  const dm = aura.dailyMissions;
  const drawn = Array.isArray(dm?.drawnMissions) ? dm.drawnMissions : [];
  const completed = Array.isArray(dm?.completedMissionIds) ? dm.completedMissionIds : [];
  const prog = dm?.progress ?? {};

  await query(
    `UPDATE aura SET aura_points = COALESCE($2, aura_points), sticker_hash = COALESCE($3, sticker_hash),
     sticker_data_url = COALESCE($4, sticker_data_url), character = COALESCE($5, character),
     last_ritual_date = COALESCE($6::date, last_ritual_date), last_treinar_at = COALESCE($7, last_treinar_at),
     last_dominar_at = COALESCE($8, last_dominar_at), negative_farm_punished = COALESCE($9, negative_farm_punished),
     updated_at = NOW() WHERE user_id = $1`,
    [
      userId,
      aura.auraPoints ?? null,
      aura.stickerHash ?? null,
      aura.stickerDataUrl ?? null,
      aura.character ?? null,
      aura.lastRitualDate ?? null,
      aura.lastTreinarAt ?? null,
      aura.lastDominarAt ?? null,
      aura.negativeFarmPunished ?? null,
    ],
  );

  const auraRow = await query<{ id: number }>('SELECT id FROM aura WHERE user_id = $1', [userId]);
  const auraId = auraRow.rows[0]?.id;
  if (auraId !== undefined) {
    await query(
      `INSERT INTO daily_missions (aura_id, last_reset_date, drawn_missions, completed_mission_ids,
       progress_messages, progress_reactions, progress_duel_win, progress_survive_attack, progress_media, progress_help_someone)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (aura_id) DO UPDATE SET
       last_reset_date = EXCLUDED.last_reset_date, drawn_missions = EXCLUDED.drawn_missions,
       completed_mission_ids = EXCLUDED.completed_mission_ids, progress_messages = EXCLUDED.progress_messages,
       progress_reactions = EXCLUDED.progress_reactions, progress_duel_win = EXCLUDED.progress_duel_win,
       progress_survive_attack = EXCLUDED.progress_survive_attack, progress_media = EXCLUDED.progress_media,
       progress_help_someone = EXCLUDED.progress_help_someone, updated_at = NOW()`,
      [
        auraId,
        dm?.lastResetDate || new Date().toISOString().slice(0, 10),
        drawn,
        completed,
        prog.messages ?? 0,
        prog.reactions ?? 0,
        prog.duelWin ?? 0,
        prog.surviveAttack ?? 0,
        prog.media ?? 0,
        prog.helpSomeone ?? 0,
      ],
    );
  }
}

export async function incrementAuraPointsDirect(
  userId: string | null,
  amount: number,
): Promise<number | null> {
  if (!userId) return null;
  await ensureAuraRow(userId);
  const r = await query<{ aura_points: string | number }>(
    `UPDATE aura SET aura_points = COALESCE(aura_points, 0::bigint) + $2::bigint, updated_at = NOW()
     WHERE user_id = $1 RETURNING aura_points`,
    [userId, Number(amount) || 0],
  );
  const points = r.rows[0]?.aura_points;
  return points === undefined ? null : Number(points);
}

export async function getAuraPointsDirect(userId: string | null): Promise<number> {
  if (!userId) return 0;
  const r = await query<{ aura_points: string | number }>(
    'SELECT aura_points FROM aura WHERE user_id = $1',
    [userId],
  );
  const row = r.rows[0];
  return row ? Number(row.aura_points) : 0;
}

export async function getAuraUserBasicByIdOrJid(
  requestedId: string | null | undefined,
): Promise<AuraUserBasic> {
  if (!requestedId) return { userId: null, user: null, balance: 0 };

  const raw = String(requestedId).trim();

  async function loadByUserId(candidateId: string | null): Promise<AuraUserBasic | null> {
    if (!candidateId) return null;
    const u = await getUserById(candidateId);
    if (!u) return null;
    return { userId: candidateId, user: u, balance: Number(u.aura?.auraPoints ?? 0) };
  }

  if (raw.includes('@')) {
    const direct = await loadByUserId(raw);
    if (direct) return direct;

    const byJid = await findUserByJid(raw);
    if (byJid) {
      const resolved = await loadByUserId(byJid);
      if (resolved) return resolved;
    }

    const byLid = await findUserIdByJid(raw);
    if (byLid) {
      const resolved = await loadByUserId(byLid);
      if (resolved) return resolved;
    }
  } else {
    const directNumber = await loadByUserId(`${raw}@s.whatsapp.net`);
    if (directNumber) return directNumber;

    const byLid = await findUserIdByJid(`${raw}@lid`);
    if (byLid) {
      const resolved = await loadByUserId(byLid);
      if (resolved) return resolved;
    }
  }

  return { userId: null, user: null, balance: 0 };
}

export async function getAuraBalanceByUserIdOrJid(
  requestedId: string | null | undefined,
): Promise<AuraBalanceLookup> {
  if (!requestedId) return { userId: null, balance: 0, exists: false };

  const raw = String(requestedId).trim();
  const candidates = raw.includes('@') ? [raw] : [`${raw}@s.whatsapp.net`, `${raw}@lid`];

  const r = await query<{ user_id: string; aura_points: string | number }>(
    `SELECT u.user_id, COALESCE(a.aura_points, 0::bigint) AS aura_points
     FROM users u
     LEFT JOIN aura a ON a.user_id = u.user_id
     WHERE u.user_id = ANY($1) OR u.jid = ANY($1)
     LIMIT 1`,
    [candidates],
  );

  const row = r.rows[0];
  if (!row) return { userId: null, balance: 0, exists: false };

  return { userId: row.user_id, balance: Number(row.aura_points), exists: true };
}

export async function applyAuraDeltaReturningBalance(
  userId: string | null,
  delta: number,
  requiredMinimumBalance = 0,
): Promise<AuraDeltaResult> {
  if (!userId) return { ok: false, reason: 'invalid_user', balance: null };

  const amt = Math.floor(Number(delta) || 0);
  const minBal = Math.floor(Number(requiredMinimumBalance) || 0);
  await ensureAuraRow(userId);

  if (minBal === 0) {
    const r = await query<{ aura_points: string | number }>(
      `UPDATE aura
       SET aura_points = COALESCE(aura_points, 0::bigint) + $2::bigint,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING aura_points`,
      [userId, amt],
    );
    const row = r.rows[0];
    if (!row) return { ok: false, reason: 'update_failed', balance: null };
    return { ok: true, reason: 'ok', balance: Number(row.aura_points) };
  }

  const r = await query<{ aura_points: string | number }>(
    `UPDATE aura
     SET aura_points = COALESCE(aura_points, 0::bigint) + $2::bigint,
         updated_at = NOW()
     WHERE user_id = $1
       AND COALESCE(aura_points, 0::bigint) >= $3::bigint
     RETURNING aura_points`,
    [userId, amt, minBal],
  );

  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'insufficient_balance', balance: null };

  return { ok: true, reason: 'ok', balance: Number(row.aura_points) };
}

// --- User ID resolution ---

export async function findUserByJid(jid: string): Promise<string | null> {
  const r = await query<{ user_id: string }>(
    'SELECT user_id FROM users WHERE user_id = $1 OR jid = $1',
    [jid],
  );
  return r.rows[0]?.user_id ?? null;
}

export async function findUserIdByJid(jid: string | null | undefined): Promise<string | null> {
  if (!jid) return null;
  const toSearch = String(jid).trim();

  // Menção por PN bate direto em `user_id`; antes só olhávamos a coluna `jid`.
  const byUserIdOrJid = await findUserByJid(toSearch);
  if (byUserIdOrJid) return byUserIdOrJid;

  const searchJid = toSearch.includes('@') ? toSearch : `${toSearch}@lid`;
  const r = await query<{ user_id: string }>(
    `SELECT user_id FROM users
     WHERE jid = $1
        OR replace(replace(replace(replace(COALESCE(jid,''), chr(8203), ''), chr(8204), ''), chr(8205), ''), chr(65279), '') = $1
     ORDER BY CASE WHEN user_id LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END, user_id
     LIMIT 1`,
    [searchJid],
  );
  return r.rows[0]?.user_id ?? null;
}

/** Resolve o JID de uma menção do WhatsApp para o `users.user_id` canônico. */
export async function resolveMentionJid(mentionJid: string | null | undefined): Promise<string | null> {
  if (!mentionJid) return null;
  const raw = String(mentionJid).trim();

  const resolved = (await findUserByJid(raw)) ?? (await findUserIdByJid(raw));
  if (resolved) return resolved;

  if (raw.endsWith('@s.whatsapp.net')) {
    const user = await getUserById(raw);
    if (user) return raw;
  }

  const phone = raw.split('@')[0]?.split(':')[0];
  if (phone && /^\d+$/.test(phone)) {
    const pn = `${phone}@s.whatsapp.net`;
    const user = await getUserById(pn);
    if (user) return pn;
  }

  return null;
}

export async function resolveCanonicalUserId(
  key: WAMessageKey | null | undefined,
): Promise<string | null> {
  if (!key?.remoteJid) return null;
  const isGroup = key.remoteJid.endsWith('@g.us');

  if (!isGroup) {
    const rjid = key.remoteJid;
    const partAlt = key.participantAlt;
    if (partAlt?.endsWith('@s.whatsapp.net')) return partAlt;
    const rAlt = key.remoteJidAlt;
    if (rAlt?.endsWith('@s.whatsapp.net')) return rAlt;
    if (rjid.endsWith('@s.whatsapp.net')) return rjid;

    const byRemote = await findUserByJid(rjid);
    if (byRemote) return byRemote;
    if (rAlt) {
      const byAlt = await findUserByJid(rAlt);
      if (byAlt) return byAlt;
    }
    const byJidCol = await findUserIdByJid(rjid);
    if (byJidCol) return byJidCol;
    if (rAlt) {
      const byJidAlt = await findUserIdByJid(rAlt);
      if (byJidAlt) return byJidAlt;
    }
    return rjid;
  }

  const alt = key.participantAlt;
  if (alt?.endsWith('@s.whatsapp.net')) return alt;

  const part = key.participant;
  if (part?.endsWith('@s.whatsapp.net')) return part;

  if (part?.endsWith('@lid')) {
    return (await findUserIdByJid(part)) ?? part;
  }

  if (alt?.endsWith('@lid')) {
    return (await findUserIdByJid(alt)) ?? alt;
  }

  // Sem participante identificável: não usar remoteJid (é o @g.us do grupo).
  return null;
}

// --- Rankings ---

export async function getLevelRanking(limit = 10): Promise<LevelRankingEntry[]> {
  const r = await query<{
    userId: string;
    xp: number | null;
    level: number | null;
    prestige: number | null;
    jid: string | null;
    allowMentions: boolean | null;
  }>(
    `SELECT u.user_id AS "userId", u.xp, u.level, u.prestige, u.jid, u.allow_mentions AS "allowMentions"
     FROM users u
     WHERE u.user_id NOT LIKE '%@g.us'
       AND u.total_messages > 0
     ORDER BY u.prestige DESC, u.level DESC, u.xp DESC LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    userId: row.userId,
    xp: row.xp ?? 0,
    level: row.level ?? 1,
    prestige: row.prestige ?? 0,
    jid: row.jid ?? row.userId,
    allowMentions: row.allowMentions === true,
  }));
}

export interface AuraRankingOptions {
  onlyWithMessages?: boolean;
}

export async function getAuraRanking(
  limit = 10,
  options: AuraRankingOptions = {},
): Promise<AuraRankingEntry[]> {
  const { onlyWithMessages = true } = options;
  const r = await query<{
    userId: string;
    auraPoints: string | number | null;
    jid: string | null;
    allowMentions: boolean | null;
  }>(
    `SELECT u.user_id AS "userId", COALESCE(a.aura_points, 0) AS "auraPoints", u.jid, u.allow_mentions AS "allowMentions"
     FROM users u LEFT JOIN aura a ON a.user_id = u.user_id
     WHERE u.user_id NOT LIKE '%@g.us'
       ${onlyWithMessages ? 'AND u.total_messages > 0' : ''}
     ORDER BY COALESCE(a.aura_points, 0) DESC LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    userId: row.userId,
    auraPoints: Number(row.auraPoints) || 0,
    jid: row.jid ?? row.userId,
    allowMentions: row.allowMentions === true,
  }));
}

// --- Daily Bonus ---

export async function getDailyBonus(): Promise<DailyBonus> {
  const r = await query<{ last_bonus_date: Date | string; last_bonus_user_id: string }>(
    'SELECT last_bonus_date, last_bonus_user_id FROM daily_bonus ORDER BY updated_at DESC LIMIT 1',
  );
  const row = r.rows[0];
  return row
    ? { lastBonusDate: row.last_bonus_date, lastBonusUser: row.last_bonus_user_id }
    : { lastBonusDate: null, lastBonusUser: null };
}

export async function setDailyBonus(lastBonusDate: string, lastBonusUser: string): Promise<void> {
  await query('INSERT INTO daily_bonus (last_bonus_date, last_bonus_user_id) VALUES ($1, $2)', [
    lastBonusDate,
    lastBonusUser,
  ]);
}

// --- Mentions Preferences ---

export async function getMentionsPreferences(): Promise<MentionsPreferences> {
  const r = await query<{ global_enabled: boolean }>(
    'SELECT global_enabled FROM mentions_preferences ORDER BY id DESC LIMIT 1',
  );
  const row = r.rows[0];
  return { globalEnabled: row ? row.global_enabled : true };
}

export async function updateMentionsPreferences(
  data: Partial<MentionsPreferencesInput>,
): Promise<MentionsPreferences> {
  const enabled = data.globalEnabled !== false;
  const r = await query(
    'UPDATE mentions_preferences SET global_enabled = $1, updated_at = NOW() WHERE id = (SELECT id FROM mentions_preferences ORDER BY id DESC LIMIT 1) RETURNING id',
    [enabled],
  );
  if (r.rowCount === 0) {
    await query('INSERT INTO mentions_preferences (global_enabled) VALUES ($1)', [enabled]);
  }
  return getMentionsPreferences();
}

// --- Amigo Secreto ---

export async function getAmigoSecretoAll(): Promise<AmigoSecretoMap> {
  const groups = await query<{
    group_id: string;
    group_name: string;
    sorteio_data: Date | string | null;
  }>('SELECT group_id, group_name, sorteio_data FROM amigo_secreto_groups ORDER BY group_id');

  const result: AmigoSecretoMap = {};
  for (const g of groups.rows) {
    result[g.group_id] = {
      groupName: g.group_name,
      participantes: [],
      presentes: {},
      nomes: {},
      sorteio: null,
      sorteioData: toIsoString(g.sorteio_data),
    };
  }
  if (groups.rows.length === 0) return result;

  const ids = groups.rows.map((r) => r.group_id);

  const parts = await query<{ group_id: string; user_id: string; nome: string | null }>(
    'SELECT group_id, user_id, nome FROM amigo_secreto_participantes WHERE group_id = ANY($1)',
    [ids],
  );
  for (const p of parts.rows) {
    const group = result[p.group_id];
    if (!group) continue;
    group.participantes.push(p.user_id);
    if (p.nome) group.nomes[p.user_id] = p.nome;
  }

  const pres = await query<{ group_id: string; user_id: string; presente: string }>(
    'SELECT group_id, user_id, presente FROM amigo_secreto_presentes WHERE group_id = ANY($1)',
    [ids],
  );
  for (const p of pres.rows) {
    const group = result[p.group_id];
    if (group) group.presentes[p.user_id] = p.presente;
  }

  const sorts = await query<{
    group_id: string;
    giver_user_id: string;
    receiver_user_id: string;
  }>(
    'SELECT group_id, giver_user_id, receiver_user_id FROM amigo_secreto_sorteio WHERE group_id = ANY($1)',
    [ids],
  );
  for (const s of sorts.rows) {
    const group = result[s.group_id];
    if (!group) continue;
    group.sorteio ??= {};
    group.sorteio[s.giver_user_id] = s.receiver_user_id;
  }

  return result;
}

export async function saveAmigoSecretoGroup(
  groupId: string,
  data: Partial<AmigoSecretoGroup>,
): Promise<void> {
  const client = await getClient();
  try {
    await client.query(
      `INSERT INTO amigo_secreto_groups (group_id, group_name, sorteio_data)
       VALUES ($1, $2, $3::timestamptz)
       ON CONFLICT (group_id) DO UPDATE SET group_name = $2, sorteio_data = $3::timestamptz, updated_at = NOW()`,
      [groupId, data.groupName || 'Grupo', data.sorteioData || null],
    );

    await client.query('DELETE FROM amigo_secreto_participantes WHERE group_id = $1', [groupId]);
    for (const uid of data.participantes ?? []) {
      await client.query(
        'INSERT INTO amigo_secreto_participantes (group_id, user_id, nome) VALUES ($1, $2, $3)',
        [groupId, uid, data.nomes?.[uid] ?? null],
      );
    }

    await client.query('DELETE FROM amigo_secreto_presentes WHERE group_id = $1', [groupId]);
    for (const [uid, presente] of Object.entries(data.presentes ?? {})) {
      if (presente) {
        await client.query(
          'INSERT INTO amigo_secreto_presentes (group_id, user_id, presente) VALUES ($1, $2, $3)',
          [groupId, uid, presente],
        );
      }
    }

    await client.query('DELETE FROM amigo_secreto_sorteio WHERE group_id = $1', [groupId]);
    for (const [giver, receiver] of Object.entries(data.sorteio ?? {})) {
      await client.query(
        'INSERT INTO amigo_secreto_sorteio (group_id, giver_user_id, receiver_user_id) VALUES ($1, $2, $3)',
        [groupId, giver, receiver],
      );
    }
  } finally {
    client.release();
  }
}

export async function updateAmigoSecretoPresente(
  groupId: string,
  userId: string,
  presente: string | null | undefined,
): Promise<void> {
  if (presente === '' || presente === null || presente === undefined) {
    await query('DELETE FROM amigo_secreto_presentes WHERE group_id = $1 AND user_id = $2', [
      groupId,
      userId,
    ]);
  } else {
    await query(
      `INSERT INTO amigo_secreto_presentes (group_id, user_id, presente)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET presente = $3`,
      [groupId, userId, presente],
    );
  }
}

export async function deleteUser(userId: string): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const aura = await client.query<{ id: number }>('SELECT id FROM aura WHERE user_id = $1', [
      userId,
    ]);
    const auraId = aura.rows[0]?.id;
    if (auraId !== undefined) {
      await client.query('DELETE FROM daily_missions WHERE aura_id = $1', [auraId]);
    }
    await client.query('DELETE FROM aura WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_badges WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_level_history WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function restoreUser(userId: string, userData: UserInput): Promise<User | null> {
  await query(INSERT_USER_SQL, userInsertParams(userId, userData));
  await syncUserBadges(userId, userData.badges ?? []);
  await syncUserLevelHistory(userId, userData.levelHistory ?? []);

  const aura = userData.aura;
  const auraIns = await query<{ id: number }>(
    `INSERT INTO aura (user_id, aura_points, sticker_hash, sticker_data_url, character, last_ritual_date,
     last_treinar_at, last_dominar_at, negative_farm_punished)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9) RETURNING id`,
    [
      userId,
      aura?.auraPoints ?? 0,
      aura?.stickerHash ?? null,
      aura?.stickerDataUrl ?? null,
      aura?.character ?? null,
      aura?.lastRitualDate ?? null,
      aura?.lastTreinarAt ?? null,
      aura?.lastDominarAt ?? null,
      aura?.negativeFarmPunished ?? false,
    ],
  );

  const auraId = auraIns.rows[0]?.id;
  if (auraId !== undefined) {
    const dm = aura?.dailyMissions;
    const prog = dm?.progress ?? {};
    await query(
      `INSERT INTO daily_missions (aura_id, last_reset_date, drawn_missions, completed_mission_ids,
       progress_messages, progress_reactions, progress_duel_win, progress_survive_attack, progress_media, progress_help_someone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        auraId,
        dm?.lastResetDate || new Date().toISOString().slice(0, 10),
        Array.isArray(dm?.drawnMissions) ? dm.drawnMissions : [],
        Array.isArray(dm?.completedMissionIds) ? dm.completedMissionIds : [],
        prog.messages ?? 0,
        prog.reactions ?? 0,
        prog.duelWin ?? 0,
        prog.surviveAttack ?? 0,
        prog.media ?? 0,
        prog.helpSomeone ?? 0,
      ],
    );
  }

  return getUserById(userId);
}

export async function migrateUserId(
  oldId: string,
  newId: string,
  updates: UserInput = {},
): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const realExists =
      (await client.query('SELECT 1 FROM users WHERE user_id = $1', [newId])).rows.length > 0;

    if (realExists) {
      // Ambos existem: absorver os dados do fantasma no usuário real e remover o fantasma.

      const phantomAura = await client.query<{ id: number }>(
        'SELECT id FROM aura WHERE user_id = $1',
        [oldId],
      );
      const phantomAuraId = phantomAura.rows[0]?.id;
      if (phantomAuraId !== undefined) {
        const realAura = await client.query('SELECT id FROM aura WHERE user_id = $1', [newId]);
        if (realAura.rows.length > 0) {
          await client.query('DELETE FROM daily_missions WHERE aura_id = $1', [phantomAuraId]);
          await client.query('DELETE FROM aura WHERE user_id = $1', [oldId]);
        } else {
          await client.query('UPDATE aura SET user_id = $1 WHERE user_id = $2', [newId, oldId]);
        }
      }

      await client.query(
        `DELETE FROM user_badges b WHERE b.user_id = $1
         AND EXISTS (SELECT 1 FROM user_badges b2 WHERE b2.user_id = $2 AND b2.badge = b.badge)`,
        [oldId, newId],
      );
      await client.query('UPDATE user_badges SET user_id = $1 WHERE user_id = $2', [newId, oldId]);

      await client.query('UPDATE user_level_history SET user_id = $1 WHERE user_id = $2', [
        newId,
        oldId,
      ]);

      await client.query(
        `DELETE FROM amigo_secreto_participantes p WHERE p.user_id = $1
         AND EXISTS (SELECT 1 FROM amigo_secreto_participantes p2 WHERE p2.user_id = $2 AND p2.group_id = p.group_id)`,
        [oldId, newId],
      );
      await client.query('UPDATE amigo_secreto_participantes SET user_id = $1 WHERE user_id = $2', [
        newId,
        oldId,
      ]);

      await client.query(
        `DELETE FROM amigo_secreto_presentes p WHERE p.user_id = $1
         AND EXISTS (SELECT 1 FROM amigo_secreto_presentes p2 WHERE p2.user_id = $2 AND p2.group_id = p.group_id)`,
        [oldId, newId],
      );
      await client.query('UPDATE amigo_secreto_presentes SET user_id = $1 WHERE user_id = $2', [
        newId,
        oldId,
      ]);

      await client.query(
        'UPDATE amigo_secreto_sorteio SET giver_user_id = $1 WHERE giver_user_id = $2',
        [newId, oldId],
      );
      await client.query(
        'UPDATE amigo_secreto_sorteio SET receiver_user_id = $1 WHERE receiver_user_id = $2',
        [newId, oldId],
      );

      await client.query('UPDATE daily_bonus SET last_bonus_user_id = $1 WHERE last_bonus_user_id = $2', [
        newId,
        oldId,
      ]);

      await client.query('DELETE FROM users WHERE user_id = $1', [oldId]);
    } else {
      // Só o fantasma existe: renomear o user_id e atualizar os campos informados.
      const d = camelToDb(updates as Record<string, unknown>);
      const sets = ['user_id = $1'];
      const vals: unknown[] = [newId];
      let idx = 2;
      for (const [k, v] of Object.entries(d)) {
        sets.push(`${k} = $${idx}`);
        vals.push(v);
        idx++;
      }
      vals.push(oldId);
      await client.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE user_id = $${idx}`,
        vals,
      );

      await client.query('UPDATE aura SET user_id = $1 WHERE user_id = $2', [newId, oldId]);
      await client.query('UPDATE user_badges SET user_id = $1 WHERE user_id = $2', [newId, oldId]);
      await client.query('UPDATE user_level_history SET user_id = $1 WHERE user_id = $2', [
        newId,
        oldId,
      ]);
      await client.query('UPDATE amigo_secreto_participantes SET user_id = $1 WHERE user_id = $2', [
        newId,
        oldId,
      ]);
      await client.query('UPDATE amigo_secreto_presentes SET user_id = $1 WHERE user_id = $2', [
        newId,
        oldId,
      ]);
      await client.query(
        'UPDATE amigo_secreto_sorteio SET giver_user_id = $1 WHERE giver_user_id = $2',
        [newId, oldId],
      );
      await client.query(
        'UPDATE amigo_secreto_sorteio SET receiver_user_id = $1 WHERE receiver_user_id = $2',
        [newId, oldId],
      );
      await client.query('UPDATE daily_bonus SET last_bonus_user_id = $1 WHERE last_bonus_user_id = $2', [
        newId,
        oldId,
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Aura transfer ---

export async function transferAura(
  fromId: string,
  toId: string,
  amount: number,
): Promise<AuraTransferResult> {
  const amt = Math.floor(Number(amount) || 0);
  if (amt < 1) return { ok: false, reason: 'invalid_amount' };

  const fromBalance = await getAuraPointsDirect(fromId);
  if (fromBalance < amt) return { ok: false, reason: 'insufficient' };

  const deducted = await incrementAuraPointsDirect(fromId, -amt);
  if (deducted === null) return { ok: false, reason: 'deduct_failed' };

  const added = await incrementAuraPointsDirect(toId, amt);
  if (added === null) {
    await incrementAuraPointsDirect(fromId, amt);
    return { ok: false, reason: 'add_failed' };
  }

  return { ok: true, fromRemaining: deducted, toNew: added };
}

// --- Praised ---

export async function addPraise(fromUserId: string, toUserId: string): Promise<void> {
  await query(
    `INSERT INTO praised (praised_user_id, praised_by_user_id) VALUES ($1, $2)
     ON CONFLICT (praised_user_id, praised_by_user_id) DO NOTHING`,
    [toUserId, fromUserId],
  );
}

export async function getWhoPraised(userId: string): Promise<string[]> {
  const r = await query<{ praised_by_user_id: string }>(
    'SELECT praised_by_user_id FROM praised WHERE praised_user_id = $1',
    [userId],
  );
  return r.rows.map((row) => row.praised_by_user_id);
}

export async function getAllPraised(): Promise<Record<string, string[]>> {
  const r = await query<{ praised_user_id: string; praised_by_user_id: string }>(
    'SELECT praised_user_id, praised_by_user_id FROM praised',
  );
  const result: Record<string, string[]> = {};
  for (const row of r.rows) {
    (result[row.praised_user_id] ??= []).push(row.praised_by_user_id);
  }
  return result;
}

export interface AuraGlobalState {
  pendingMogByChat: Record<string, unknown>;
}

export async function getAuraGlobal(): Promise<AuraGlobalState> {
  const r = await query('SELECT user_id FROM users WHERE user_id = $1 LIMIT 1', ['__auraGlobal']);
  if (r.rows.length === 0) return { pendingMogByChat: {} };
  await query('SELECT * FROM aura WHERE user_id = $1 LIMIT 1', ['__auraGlobal']);
  return { pendingMogByChat: {} };
}

// --- Features ---

interface FeatureRow {
  id: number;
  description: string;
  status: string;
  created_at: Date | string;
  created_by: string;
}

function rowToFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function getFeatures(): Promise<Feature[]> {
  const r = await query<FeatureRow>(
    'SELECT id, description, status, created_at, created_by FROM features ORDER BY id ASC',
  );
  return r.rows.map(rowToFeature);
}

export async function addFeature(description: string, createdBy: string): Promise<Feature> {
  const r = await query<FeatureRow>(
    `INSERT INTO features (description, status, created_by) VALUES ($1, 'pending', $2)
     RETURNING id, description, status, created_at, created_by`,
    [description, createdBy],
  );
  const row = r.rows[0];
  if (!row) throw new Error('Falha ao inserir feature');
  return rowToFeature(row);
}

export async function updateFeatureStatus(id: number, status: string): Promise<void> {
  await query('UPDATE features SET status = $1 WHERE id = $2', [status, id]);
}

export async function removeFeature(id: number): Promise<void> {
  await query('DELETE FROM features WHERE id = $1', [id]);
}

// --- Auth sessions (web / SkullCards API) ---

export async function getSession(token: string | null | undefined): Promise<AuthSession | null> {
  if (!token) return null;
  const r = await query<{ user_id: string; created_at: Date | string; expires_at: Date | string }>(
    'SELECT user_id, created_at, expires_at FROM auth_sessions WHERE token = $1',
    [token],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function setSession(token: string, data: AuthSessionInput): Promise<void> {
  await query(
    `INSERT INTO auth_sessions (token, user_id, expires_at)
     VALUES ($1, $2, $3::timestamptz)
     ON CONFLICT (token) DO UPDATE SET user_id = $2, expires_at = $3::timestamptz`,
    [token, data.userId, data.expiresAt],
  );
}

export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM auth_sessions WHERE token = $1', [token]);
}

export async function getAuthCode(userId: string): Promise<AuthCode | null> {
  const r = await query<{
    code: string;
    expires_at: Date | string;
    attempts: number;
    created_at: Date | string;
  }>('SELECT code, expires_at, attempts, created_at FROM auth_codes WHERE user_id = $1', [userId]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    code: row.code,
    expiresAt: new Date(row.expires_at).toISOString(),
    attempts: row.attempts,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function setAuthCode(userId: string, data: AuthCodeInput): Promise<void> {
  await query(
    `INSERT INTO auth_codes (user_id, code, expires_at, attempts)
     VALUES ($1, $2, $3::timestamptz, $4)
     ON CONFLICT (user_id) DO UPDATE SET code = $2, expires_at = $3::timestamptz, attempts = $4, created_at = NOW()`,
    [userId, data.code, data.expiresAt, data.attempts ?? 0],
  );
}

export async function deleteAuthCode(userId: string): Promise<void> {
  await query('DELETE FROM auth_codes WHERE user_id = $1', [userId]);
}

export async function incrementAuthCodeAttempts(userId: string): Promise<AuthCode | null> {
  await query('UPDATE auth_codes SET attempts = attempts + 1 WHERE user_id = $1', [userId]);
  return getAuthCode(userId);
}

export async function cleanExpiredAuthCodes(): Promise<number> {
  const r = await query('DELETE FROM auth_codes WHERE expires_at < NOW() RETURNING user_id');
  return r.rowCount ?? 0;
}

// --- Deleted users backup ---

interface DeletedUserRow {
  user_id: string;
  deleted_at: Date | string;
  metadata: { data?: unknown; expiresAt?: string } | null;
}

export async function getDeletedUsers(): Promise<DeletedUserBackup[]> {
  const r = await query<DeletedUserRow>(
    'SELECT user_id, deleted_at, metadata FROM deleted_users ORDER BY deleted_at DESC',
  );
  return r.rows.map((row) => ({
    id: row.user_id,
    data: row.metadata?.data ?? row.metadata,
    deletedAt: new Date(row.deleted_at).toISOString(),
    expiresAt:
      row.metadata?.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }));
}

export async function addDeletedUser(
  userId: string,
  userData: unknown,
): Promise<DeletedUserBackup> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const deletedAt = new Date().toISOString();
  await query('INSERT INTO deleted_users (user_id, metadata) VALUES ($1, $2::jsonb)', [
    userId,
    JSON.stringify({ data: userData, expiresAt }),
  ]);
  return { id: userId, data: userData, deletedAt, expiresAt };
}

export async function removeDeletedUser(userId: string): Promise<void> {
  await query('DELETE FROM deleted_users WHERE user_id = $1', [userId]);
}

export async function cleanOldDeletedUsers(daysToKeep = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const r = await query('DELETE FROM deleted_users WHERE deleted_at < $1 RETURNING id', [cutoff]);
  return r.rowCount ?? 0;
}

// --- Pending auth messages (WhatsApp fallback queue) ---

export async function getPendingMessages(): Promise<PendingMessage[]> {
  const r = await query<{
    id: number;
    to: string;
    message: string;
    retries: number | null;
    last_error: string | null;
    last_attempt: Date | string | null;
    created_at: Date | string;
  }>(
    `SELECT id, "to", message, retries, last_error, last_attempt, created_at
     FROM pending_messages ORDER BY id ASC`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    to: row.to,
    message: row.message,
    retries: row.retries ?? 0,
    lastError: row.last_error ?? null,
    lastAttempt: toIsoString(row.last_attempt),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function addPendingMessage(to: string, message: string): Promise<number | undefined> {
  const r = await query<{ id: number }>(
    'INSERT INTO pending_messages ("to", message) VALUES ($1, $2) RETURNING id',
    [to, message],
  );
  return r.rows[0]?.id;
}

export async function setPendingMessages(messages: PendingMessageInput[]): Promise<void> {
  const client = await getClient();
  try {
    await client.query('DELETE FROM pending_messages');
    for (const m of messages) {
      await client.query(
        `INSERT INTO pending_messages ("to", message, retries, last_error, last_attempt)
         VALUES ($1, $2, $3, $4, $5::timestamptz)`,
        [m.to, m.message, m.retries ?? 0, m.lastError ?? null, m.lastAttempt ?? null],
      );
    }
  } finally {
    client.release();
  }
}
