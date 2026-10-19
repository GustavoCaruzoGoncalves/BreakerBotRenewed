import * as repo from '../../database/repository.js';
import * as level from '../level.js';
import * as aura from '../aura.js';
import * as trucoRepo from '../../games/truco/repository.js';
import type { User } from '../../database/types.js';
import type { ToolRequestContext } from './types.js';

export function displayNameFor(user: User | null, ctx: ToolRequestContext, userId: string): string {
  if (user?.customNameEnabled && user.customName) return user.customName;
  if (user?.pushName) return user.pushName;
  if (ctx.canonicalUserId === userId && ctx.chatKind === 'dm') {
    return userId.split('@')[0] ?? 'Você';
  }
  return 'Usuário';
}

export async function buildMyLevelStats(userId: string, ctx: ToolRequestContext) {
  const info = await level.getUserInfo(userId);
  if (!info) return null;
  return {
    displayName: displayNameFor(info, ctx, userId),
    level: info.level,
    xp: info.xp,
    prestige: info.prestige,
    prestigeAvailable: info.prestigeAvailable,
    rankName: info.rank.name,
    progressXP: info.progressXP,
    nextLevelXP: info.nextLevelXP,
    neededXP: info.neededXP,
    totalMultiplier: info.totalMultiplier,
    totalMessages: info.totalMessages,
  };
}

export async function buildMyBadges(userId: string) {
  const info = await level.getUserInfo(userId);
  if (!info) return null;
  return { badges: info.badges ?? [] };
}

export async function buildMyAura(userId: string) {
  const points = await repo.getAuraPointsDirect(userId);
  const user = await repo.getUserById(userId);
  return {
    auraPoints: points,
    character: user?.aura?.character ?? null,
    tier: aura.getTier(points).name,
  };
}

export async function buildMyMissions(userId: string) {
  const user = await repo.getUserById(userId);
  const dm = user?.aura?.dailyMissions;
  if (!dm) return { missions: [] as unknown[] };
  return {
    lastResetDate: dm.lastResetDate,
    drawnMissions: dm.drawnMissions,
    completedMissionIds: dm.completedMissionIds,
    progress: dm.progress,
  };
}

export async function buildMyPreferences(userId: string) {
  const user = await repo.getUserById(userId);
  if (!user) return null;
  return {
    allowMentions: user.allowMentions,
    customNameEnabled: user.customNameEnabled,
    customName: user.customNameEnabled ? user.customName : null,
    emojiReaction: user.emojiReaction,
  };
}

export async function buildMyLevelHistory(userId: string, limit = 10) {
  const user = await repo.getUserById(userId);
  if (!user) return { history: [] };
  const history = (user.levelHistory ?? []).slice(-limit);
  return { history };
}

export async function buildMyTrucoStats(userId: string) {
  const stats = await trucoRepo.getUserStats(userId);
  return {
    matchesPlayed: stats.matches_played,
    wins: stats.wins,
    losses: stats.losses,
    winStreak: stats.win_streak,
    bestWinStreak: stats.best_win_streak,
    matches1v1: stats.matches_1v1,
    matches2v2: stats.matches_2v2,
  };
}

export async function buildPublicUserStats(targetUserId: string, ctx: ToolRequestContext) {
  const info = await level.getUserInfo(targetUserId);
  if (!info) return null;
  const auraPoints = await repo.getAuraPointsDirect(targetUserId);
  const truco = await trucoRepo.getUserStats(targetUserId);
  return {
    displayName: displayNameFor(info, ctx, targetUserId),
    level: info.level,
    xp: info.xp,
    prestige: info.prestige,
    rankName: info.rank.name,
    badges: info.badges ?? [],
    auraPoints,
    trucoWins: truco.wins,
    trucoMatchesPlayed: truco.matches_played,
  };
}

export async function buildExtendedUserStats(targetUserId: string, ctx: ToolRequestContext) {
  const base = await buildPublicUserStats(targetUserId, ctx);
  if (!base) return null;
  const prefs = await buildMyPreferences(targetUserId);
  const missions = await buildMyMissions(targetUserId);
  const history = await buildMyLevelHistory(targetUserId, 5);
  return { ...base, preferences: prefs, missions, recentLevelHistory: history.history };
}

export async function searchUsersPublic(queryText: string, limit: number) {
  return repo.searchUsersByDisplayName(queryText, limit);
}
