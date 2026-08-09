/**
 * Tipos do PostgreSQL e das entidades de domínio do BreakerBot.
 *
 * As interfaces `*Row` espelham as colunas do `database/schema.sql` (snake_case),
 * enquanto as entidades (`User`, `Aura`, ...) representam o formato camelCase
 * usado pelo restante da aplicação.
 */

// --- Rows (formato exato retornado pelo driver `pg`) ---

export interface UserRow {
  user_id: string;
  xp: number | null;
  level: number | null;
  prestige: number | null;
  prestige_available: number | null;
  total_messages: number | null;
  last_message_time: Date | string | null;
  last_prestige_level: number | null;
  daily_bonus_multiplier: number | null;
  daily_bonus_expiry: Date | string | null;
  allow_mentions: boolean | null;
  push_name: string | null;
  custom_name: string | null;
  custom_name_enabled: boolean | null;
  jid: string | null;
  profile_picture: string | null;
  profile_picture_updated_at: Date | string | null;
  emoji: string | null;
  emoji_reaction: boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** `aura_points`, `last_treinar_at` e `last_dominar_at` são BIGINT: o `pg` os entrega como string. */
export interface AuraRow {
  id: number;
  user_id: string;
  aura_points: string | number | null;
  sticker_hash: string | null;
  sticker_data_url: string | null;
  character: string | null;
  last_ritual_date: Date | string | null;
  last_treinar_at: string | number | null;
  last_dominar_at: string | number | null;
  negative_farm_punished: boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface DailyMissionsRow {
  last_reset_date: Date | string | null;
  drawn_missions: string[] | null;
  completed_mission_ids: string[] | null;
  progress_messages: number | null;
  progress_reactions: number | null;
  progress_duel_win: number | null;
  progress_survive_attack: number | null;
  progress_media: number | null;
  progress_help_someone: number | null;
}

/** Resultado do JOIN entre `aura` e `daily_missions` usado em `getAllUsers`/`getUserById`. */
export type AuraWithMissionsRow = AuraRow & DailyMissionsRow;

export interface LevelHistoryRow {
  user_id: string;
  action: string;
  old_level: number | null;
  old_xp: number | null;
  old_prestige_available: number | null;
  old_prestige: number | null;
  new_level: number | null;
  new_xp: number | null;
  created_at: Date | string | null;
}

// --- Missões diárias ---

export const MISSION_IDS = [
  'messages_500',
  'reactions_500',
  'duel_win',
  'survive_attack',
  'send_media',
  'help_someone',
] as const;

export type MissionId = (typeof MISSION_IDS)[number];

export type MissionProgressKey =
  | 'messages'
  | 'reactions'
  | 'duelWin'
  | 'surviveAttack'
  | 'media'
  | 'helpSomeone';

/** Parcial porque o reset diário recria o progresso vazio; toda leitura usa `?? 0`. */
export type MissionProgress = Partial<Record<MissionProgressKey, number>>;

export interface DailyMissions {
  lastResetDate: string | Date | null;
  drawnMissions: string[];
  completedMissionIds: string[];
  progress: MissionProgress;
}

export interface MissionDefinition {
  target: number;
  reward: number;
  label: string;
  key: MissionProgressKey;
}

// --- Entidades ---

export interface Aura {
  auraPoints: number;
  stickerHash: string | null;
  stickerDataUrl: string | null;
  character: string | null;
  dailyMissions: DailyMissions;
  lastRitualDate: string | Date | null;
  lastTreinarAt: number | string | null;
  lastDominarAt: number | string | null;
  negativeFarmPunished: boolean;
}

/** Campos de `Aura` usados como cooldown (`getCooldown`/`setCooldown`). */
export type AuraCooldownKey = 'lastRitualDate' | 'lastTreinarAt' | 'lastDominarAt';

export interface LevelHistoryEntry {
  action: string;
  timestamp: string | null;
  oldLevel: number;
  oldXP: number;
  oldPrestigeAvailable: number;
  oldPrestige: number;
  newLevel: number;
  newXP: number;
}

export interface User {
  xp: number;
  level: number;
  prestige: number;
  prestigeAvailable: number;
  totalMessages: number;
  lastMessageTime: string | null;
  badges: string[];
  lastPrestigeLevel: number;
  levelHistory: LevelHistoryEntry[];
  dailyBonusMultiplier: number;
  dailyBonusExpiry: string | null;
  allowMentions: boolean;
  pushName: string | null;
  customName: string | null;
  customNameEnabled: boolean;
  jid: string;
  profilePicture: string | null;
  profilePictureUpdatedAt: string | null;
  emoji: string | null;
  emojiReaction: boolean;
  aura?: Aura;
}

export type UsersMap = Record<string, User>;

/** Payload aceito por `createUser`/`updateUser`/`restoreUser`. */
export type UserInput = Partial<User>;

export type WriteScope = 'all' | 'level' | 'preferences' | 'aura';

// --- Rankings ---

export interface LevelRankingEntry {
  userId: string;
  xp: number;
  level: number;
  prestige: number;
  jid: string;
  allowMentions: boolean;
}

export interface AuraRankingEntry {
  userId: string;
  auraPoints: number;
  jid: string;
  allowMentions: boolean;
}

// --- Aura: consultas e operações ---

export interface AuraUserBasic {
  userId: string | null;
  user: User | null;
  balance: number;
}

export interface AuraBalanceLookup {
  userId: string | null;
  balance: number;
  exists: boolean;
}

export type AuraDeltaFailureReason = 'invalid_user' | 'update_failed' | 'insufficient_balance';

export type AuraDeltaResult =
  | { ok: true; reason: 'ok'; balance: number }
  | { ok: false; reason: AuraDeltaFailureReason; balance: null };

export type AuraTransferResult =
  | { ok: true; fromRemaining: number | null; toNew: number | null }
  | { ok: false; reason: 'invalid_amount' | 'insufficient' | 'deduct_failed' | 'add_failed' };

// --- Bônus diário e preferências ---

export interface DailyBonus {
  lastBonusDate: string | Date | null;
  lastBonusUser: string | null;
}

export interface MentionsPreferences {
  globalEnabled: boolean;
}

// --- Amigo secreto ---

export interface AmigoSecretoGroup {
  groupName: string;
  participantes: string[];
  presentes: Record<string, string>;
  nomes: Record<string, string>;
  sorteio: Record<string, string> | null;
  sorteioData: string | null;
}

export type AmigoSecretoMap = Record<string, AmigoSecretoGroup>;

// --- Features ---

export type FeatureStatus = 'pending' | 'finished';

export interface Feature {
  id: number;
  description: string;
  status: FeatureStatus | string;
  createdAt: Date | string;
  createdBy: string;
}

// --- Autenticação (API web / SkullCards) ---

export interface AuthSession {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuthSessionInput {
  userId: string;
  expiresAt: string;
}

export interface AuthCode {
  code: string;
  expiresAt: string;
  attempts: number;
  createdAt: string;
}

export interface AuthCodeInput {
  code: string;
  expiresAt: string;
  attempts?: number;
}

export interface DeletedUserBackup {
  id: string;
  data: unknown;
  deletedAt: string;
  expiresAt: string;
}

// --- Fila de mensagens de autenticação ---

export interface PendingMessage {
  id: number;
  to: string;
  message: string;
  retries: number;
  lastError: string | null;
  lastAttempt: string | null;
  createdAt: string;
}

export type PendingMessageInput = Omit<PendingMessage, 'id' | 'createdAt'> &
  Partial<Pick<PendingMessage, 'id' | 'createdAt'>>;
