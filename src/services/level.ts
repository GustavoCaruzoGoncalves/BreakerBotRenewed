import * as repo from '../database/repository.js';
import type { LevelHistoryEntry, LevelRankingEntry, User } from '../database/types.js';

export interface Rank {
  name: string;
  minLevel: number;
  maxLevel: number;
}

export const RANKS: readonly Rank[] = [
  { name: '🥉 Bronze', minLevel: 1, maxLevel: 5 },
  { name: '🥈 Prata', minLevel: 6, maxLevel: 10 },
  { name: '🥇 Ouro', minLevel: 11, maxLevel: 20 },
  { name: '💎 Diamante', minLevel: 21, maxLevel: 35 },
  { name: '👑 Mestre', minLevel: 36, maxLevel: 50 },
  { name: '🔥 Lendário', minLevel: 51, maxLevel: 70 },
  { name: '⚡ Épico', minLevel: 71, maxLevel: 100 },
  { name: '🌟 Mítico', minLevel: 101, maxLevel: 150 },
  { name: '💫 Celestial', minLevel: 151, maxLevel: 200 },
  { name: '👽 Transcendente', minLevel: 201, maxLevel: 999 },
];

const LAST_RANK = RANKS[RANKS.length - 1] as Rank;

// --- XP math ---

export function getRequiredXP(level: number): number {
  return level < 10 ? 100 + (level - 1) * 10 : 190 + (level - 10) * 100;
}

export function calculateLevel(xp: number): number {
  let level = 1;
  let total = 0;
  while (total + getRequiredXP(level) <= xp) {
    total += getRequiredXP(level);
    level++;
  }
  return level;
}

export function xpForLevel(targetLevel: number): number {
  let total = 0;
  for (let i = 1; i < targetLevel; i++) total += getRequiredXP(i);
  return total;
}

export function getUserRank(level: number): Rank {
  return RANKS.find((r) => level >= r.minLevel && level <= r.maxLevel) ?? LAST_RANK;
}

export function maxPrestiges(level: number): number {
  return Math.floor(level / 10);
}

export interface Multiplier {
  prestige: number;
  daily: number;
  total: number;
}

export interface LevelProgress {
  progressXP: number;
  neededXP: number;
  nextLevelXP: number;
}

/** Aceita qualquer objeto com os campos de XP para ser reutilizável na API. */
export type LevelSource = Pick<User, 'xp' | 'level' | 'prestige' | 'dailyBonusMultiplier'>;

export function computeMultiplier(user: Pick<User, 'prestige' | 'dailyBonusMultiplier'>): Multiplier {
  const prestige = 1 + (user.prestige || 0) * 0.5;
  const daily = user.dailyBonusMultiplier || 0;
  return { prestige, daily, total: prestige + daily };
}

export function computeProgress(user: Pick<User, 'xp' | 'level'>): LevelProgress {
  const totalXP = xpForLevel(user.level);
  const nextLevelXP = getRequiredXP(user.level);
  const progress = user.xp - totalXP;
  return {
    progressXP: Math.min(progress, nextLevelXP),
    neededXP: Math.max(0, nextLevelXP - progress),
    nextLevelXP,
  };
}

export type EnrichedUser<T extends LevelSource> = T &
  LevelProgress & {
    rank: Rank;
    prestigeMultiplier: number;
    dailyBonusMultiplier: number;
    totalMultiplier: number;
  };

export function enrichUserInfo<T extends LevelSource>(user: T): EnrichedUser<T> {
  const mult = computeMultiplier(user);
  return {
    ...user,
    rank: getUserRank(user.level),
    ...computeProgress(user),
    prestigeMultiplier: mult.prestige,
    dailyBonusMultiplier: mult.daily,
    totalMultiplier: mult.total,
  };
}

// --- Dedup ---

const processedIds = new Set<string>();
const MAX_IDS = 100000;
const sentLevelUps = new Map<string, true>();

export function msgAlreadyProcessed(id: string): boolean {
  if (processedIds.has(id)) return true;
  if (processedIds.size >= MAX_IDS) {
    const arr = [...processedIds];
    processedIds.clear();
    arr.slice(-MAX_IDS / 2).forEach((x) => processedIds.add(x));
  }
  processedIds.add(id);
  return false;
}

export function levelUpAlreadySent(userId: string, level: number): boolean {
  const key = `${userId}_${level}`;
  if (sentLevelUps.has(key)) return true;
  sentLevelUps.set(key, true);
  if (sentLevelUps.size > 5000) {
    [...sentLevelUps.keys()].slice(0, 2500).forEach((k) => sentLevelUps.delete(k));
  }
  return false;
}

// --- Daily bonus ---

export async function checkAndGrantDailyBonus(userId: string): Promise<boolean> {
  const now = new Date();
  if (now.getHours() < 6) return false;

  const today = now.toISOString().slice(0, 10);
  const bonus = await repo.getDailyBonus().catch(() => null);
  const rawLastDate = bonus?.lastBonusDate ?? null;
  const lastDate = rawLastDate
    ? typeof rawLastDate === 'string'
      ? rawLastDate.slice(0, 10)
      : new Date(rawLastDate).toISOString().slice(0, 10)
    : null;

  if (lastDate === today) return false;

  await repo.setDailyBonus(today, userId);
  await repo.updateUser(userId, {
    dailyBonusMultiplier: 1.0,
    dailyBonusExpiry: new Date(now.getTime() + 86400000).toISOString(),
  });
  return true;
}

// --- Core: process one message for XP ---

export interface ProcessMessageResult {
  oldLevel: number;
  newLevel: number;
  xpGained: number;
  isLevelUp: boolean;
  isDailyBonus: boolean;
  totalMultiplier: number;
  dailyBonusMultiplier: number;
}

export async function processMessage(userId: string): Promise<ProcessMessageResult | null> {
  const user = await repo.getUserById(userId);
  if (!user) return null;

  let bonusExpired = false;
  if (user.dailyBonusExpiry && new Date(user.dailyBonusExpiry) < new Date()) {
    user.dailyBonusMultiplier = 0;
    user.dailyBonusExpiry = null;
    bonusExpired = true;
  }

  const isDailyBonus = await checkAndGrantDailyBonus(userId);
  if (isDailyBonus) {
    user.dailyBonusMultiplier = 1.0;
    user.dailyBonusExpiry = new Date(Date.now() + 86400000).toISOString();
  }

  const mult = computeMultiplier(user);
  const finalXP = Math.floor(10 * mult.total);
  const oldLevel = user.level;
  const newXP = user.xp + finalXP;
  const newLevel = calculateLevel(newXP);

  const updates: Partial<User> = {
    xp: newXP,
    level: newLevel,
    totalMessages: (user.totalMessages || 0) + 1,
    lastMessageTime: new Date().toISOString(),
  };

  if (bonusExpired && !isDailyBonus) {
    updates.dailyBonusMultiplier = 0;
    updates.dailyBonusExpiry = null;
  }

  if (newLevel > oldLevel) {
    updates.prestigeAvailable = Math.max(0, maxPrestiges(newLevel) - (user.prestige || 0));
  }

  await repo.updateUser(userId, updates);

  return {
    oldLevel,
    newLevel,
    xpGained: finalXP,
    isLevelUp: newLevel > oldLevel,
    isDailyBonus,
    totalMultiplier: mult.total,
    dailyBonusMultiplier: mult.daily,
  };
}

// --- Prestige ---

export interface PrestigeFailure {
  success: false;
  message: string;
}

export interface PrestigeSuccess {
  success: true;
  message: string;
  newPrestige: number;
  prestigeAvailable: number;
}

export type PrestigeResult = PrestigeSuccess | PrestigeFailure;

export interface PrestigeAllSuccess {
  success: true;
  message: string;
  newPrestige: number;
  count: number;
  added: string[];
}

export type PrestigeAllResult = PrestigeAllSuccess | PrestigeFailure;

export type OperationResult = { success: boolean; message: string };

export async function prestige(userId: string): Promise<PrestigeResult> {
  const user = await repo.getUserById(userId);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };

  user.prestigeAvailable = Math.max(0, maxPrestiges(user.level) - user.prestige);

  if (user.level < 10) {
    return {
      success: false,
      message: 'Você precisa estar no nível 10 ou superior para fazer prestígio!',
    };
  }
  if (user.prestigeAvailable <= 0) {
    return {
      success: false,
      message: `Você não tem prestígios disponíveis! Você tem ${user.prestige} prestígios usados e pode ter até ${maxPrestiges(user.level)} no nível ${user.level}.`,
    };
  }

  const badge = `🏆 Prestígio ${user.prestige + 1}`;
  const badges = [...(user.badges || [])];
  if (!badges.includes(badge)) badges.push(badge);

  const newPrestige = user.prestige + 1;
  const newAvailable = user.prestigeAvailable - 1;

  await repo.updateUser(userId, {
    prestige: newPrestige,
    prestigeAvailable: newAvailable,
    badges,
  });

  return {
    success: true,
    message: `🎉 Prestígio realizado! Você agora é Prestígio ${newPrestige}! Badge adicionado!\n💎 Prestígios restantes: ${newAvailable}`,
    newPrestige,
    prestigeAvailable: newAvailable,
  };
}

export async function prestigeAll(userId: string): Promise<PrestigeAllResult> {
  const user = await repo.getUserById(userId);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };

  user.prestigeAvailable = Math.max(0, maxPrestiges(user.level) - user.prestige);

  if (user.level < 10) {
    return {
      success: false,
      message: 'Você precisa estar no nível 10 ou superior para fazer prestígio!',
    };
  }
  if (user.prestigeAvailable <= 0) {
    return {
      success: false,
      message: `Você não tem prestígios disponíveis! Você tem ${user.prestige} prestígios usados e pode ter até ${maxPrestiges(user.level)} no nível ${user.level}.`,
    };
  }

  const count = user.prestigeAvailable;
  const badges = [...(user.badges || [])];
  const added: string[] = [];

  for (let i = 0; i < count; i++) {
    const badge = `🏆 Prestígio ${user.prestige + 1 + i}`;
    if (!badges.includes(badge)) {
      badges.push(badge);
      added.push(badge);
    }
  }

  const newPrestige = user.prestige + count;
  await repo.updateUser(userId, { prestige: newPrestige, prestigeAvailable: 0, badges });

  return {
    success: true,
    message: `🎉 Todos os prestígios realizados! Você agora é Prestígio ${newPrestige}! 🎉\n📊 Prestígios usados: ${count}\n🏆 Badges adicionados: ${added.join(', ')}\n💎 Prestígios restantes: 0`,
    newPrestige,
    count,
    added,
  };
}

// --- Admin: set / reset level ---

export async function setLevel(userId: string, targetLevel: number): Promise<OperationResult> {
  if (targetLevel < 1) return { success: false, message: 'O nível deve ser pelo menos 1!' };
  if (targetLevel > 999) return { success: false, message: 'O nível máximo é 999!' };

  const user = await repo.getUserById(userId);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };

  const history: LevelHistoryEntry[] = [...(user.levelHistory || [])];
  history.push({
    action: 'setlevel',
    timestamp: new Date().toISOString(),
    oldLevel: user.level,
    oldXP: user.xp,
    oldPrestigeAvailable: user.prestigeAvailable ?? 0,
    oldPrestige: user.prestige ?? 0,
    newLevel: targetLevel,
    newXP: xpForLevel(targetLevel),
  });
  if (history.length > 10) history.splice(0, history.length - 10);

  const newXP = xpForLevel(targetLevel);
  const newAvailable = Math.max(0, maxPrestiges(targetLevel) - (user.prestige || 0));

  await repo.updateUser(userId, {
    level: targetLevel,
    xp: newXP,
    prestigeAvailable: newAvailable,
    levelHistory: history,
  });

  return {
    success: true,
    message: `✅ Nível alterado com sucesso!\n📊 ${user.level} → ${targetLevel}\n⭐ XP: ${user.xp} → ${newXP}\n💎 Prestígios disponíveis: ${newAvailable}`,
  };
}

export async function resetSetLevel(userId: string): Promise<OperationResult> {
  const user = await repo.getUserById(userId);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };

  const history: LevelHistoryEntry[] = [...(user.levelHistory || [])];
  const lastIdx = history.findLastIndex((e) => e.action === 'setlevel');
  const last = lastIdx === -1 ? undefined : history[lastIdx];
  if (!last) {
    return {
      success: false,
      message: 'Nenhuma alteração de nível administrativa encontrada para reverter!',
    };
  }

  history.splice(lastIdx, 1);

  await repo.updateUser(userId, {
    level: last.oldLevel,
    xp: last.oldXP,
    prestigeAvailable: last.oldPrestigeAvailable ?? 0,
    prestige: last.oldPrestige ?? 0,
    levelHistory: history,
  });

  return {
    success: true,
    message: `🔄 Nível revertido com sucesso!\n📊 ${user.level} → ${last.oldLevel}\n⭐ XP: ${user.xp} → ${last.oldXP}\n💎 Prestígios disponíveis: ${user.prestigeAvailable} → ${last.oldPrestigeAvailable ?? 0}\n🏆 Prestígios usados: ${user.prestige} → ${last.oldPrestige ?? 0}`,
  };
}

// --- Ranking ---

export type LevelRankingRow = LevelRankingEntry & { rank: Rank };

export async function getRanking(limit = 10): Promise<LevelRankingRow[]> {
  const rows = await repo.getLevelRanking(limit);
  return rows.map((r) => ({ ...r, rank: getUserRank(r.level) }));
}

// --- Public API ---

export async function getUserInfo(userId: string): Promise<EnrichedUser<User> | null> {
  const user = await repo.getUserById(userId);
  if (!user) return null;

  if (user.dailyBonusExpiry && new Date(user.dailyBonusExpiry) < new Date()) {
    user.dailyBonusMultiplier = 0;
    user.dailyBonusExpiry = null;
    await repo.updateUser(userId, { dailyBonusMultiplier: 0, dailyBonusExpiry: null });
  }

  user.prestigeAvailable = Math.max(0, maxPrestiges(user.level) - (user.prestige || 0));
  return enrichUserInfo(user);
}
