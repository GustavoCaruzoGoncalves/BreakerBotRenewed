const repo = require('../database/repository');

const RANKS = [
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

// --- XP math ---

function getRequiredXP(level) {
  return level < 10 ? 100 + (level - 1) * 10 : 190 + (level - 10) * 100;
}

function calculateLevel(xp) {
  let level = 1, total = 0;
  while (total + getRequiredXP(level) <= xp) {
    total += getRequiredXP(level);
    level++;
  }
  return level;
}

function xpForLevel(targetLevel) {
  let total = 0;
  for (let i = 1; i < targetLevel; i++) total += getRequiredXP(i);
  return total;
}

function getUserRank(level) {
  return RANKS.find(r => level >= r.minLevel && level <= r.maxLevel) || RANKS[RANKS.length - 1];
}

function maxPrestiges(level) {
  return Math.floor(level / 10);
}

function computeMultiplier(user) {
  const prestige = 1 + ((user.prestige || 0) * 0.5);
  const daily = user.dailyBonusMultiplier || 0;
  return { prestige, daily, total: prestige + daily };
}

function computeProgress(user) {
  const totalXP = xpForLevel(user.level);
  const nextLevelXP = getRequiredXP(user.level);
  const progress = user.xp - totalXP;
  return {
    progressXP: Math.min(progress, nextLevelXP),
    neededXP: Math.max(0, nextLevelXP - progress),
    nextLevelXP,
  };
}

function enrichUserInfo(user) {
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

const processedIds = new Set();
const MAX_IDS = 100000;
const sentLevelUps = new Map();

function msgAlreadyProcessed(id) {
  if (processedIds.has(id)) return true;
  if (processedIds.size >= MAX_IDS) {
    const arr = [...processedIds];
    processedIds.clear();
    arr.slice(-MAX_IDS / 2).forEach(x => processedIds.add(x));
  }
  processedIds.add(id);
  return false;
}

function levelUpAlreadySent(userId, level) {
  const key = `${userId}_${level}`;
  if (sentLevelUps.has(key)) return true;
  sentLevelUps.set(key, true);
  if (sentLevelUps.size > 5000) {
    [...sentLevelUps.keys()].slice(0, 2500).forEach(k => sentLevelUps.delete(k));
  }
  return false;
}

// --- Daily bonus ---

async function checkAndGrantDailyBonus(userId) {
  const now = new Date();
  if (now.getHours() < 6) return false;

  const today = now.toISOString().slice(0, 10);
  const bonus = await repo.getDailyBonus().catch(() => ({}));
  const lastDate = bonus.lastBonusDate
    ? (typeof bonus.lastBonusDate === 'string'
      ? bonus.lastBonusDate.slice(0, 10)
      : new Date(bonus.lastBonusDate).toISOString().slice(0, 10))
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

async function processMessage(userId) {
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

  const updates = {
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

async function prestige(userId) {
  const user = await repo.getUserById(userId);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };

  user.prestigeAvailable = Math.max(0, maxPrestiges(user.level) - user.prestige);

  if (user.level < 10) {
    return { success: false, message: 'Você precisa estar no nível 10 ou superior para fazer prestígio!' };
  }
  if (user.prestigeAvailable <= 0) {
    return { success: false, message: `Você não tem prestígios disponíveis! Você tem ${user.prestige} prestígios usados e pode ter até ${maxPrestiges(user.level)} no nível ${user.level}.` };
  }

  const badge = `🏆 Prestígio ${user.prestige + 1}`;
  const badges = [...(user.badges || [])];
  if (!badges.includes(badge)) badges.push(badge);

  const newPrestige = user.prestige + 1;
  const newAvailable = user.prestigeAvailable - 1;

  await repo.updateUser(userId, { prestige: newPrestige, prestigeAvailable: newAvailable, badges });

  return {
    success: true,
    message: `🎉 Prestígio realizado! Você agora é Prestígio ${newPrestige}! Badge adicionado!\n💎 Prestígios restantes: ${newAvailable}`,
    newPrestige, prestigeAvailable: newAvailable,
  };
}

async function prestigeAll(userId) {
  const user = await repo.getUserById(userId);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };

  user.prestigeAvailable = Math.max(0, maxPrestiges(user.level) - user.prestige);

  if (user.level < 10) {
    return { success: false, message: 'Você precisa estar no nível 10 ou superior para fazer prestígio!' };
  }
  if (user.prestigeAvailable <= 0) {
    return { success: false, message: `Você não tem prestígios disponíveis! Você tem ${user.prestige} prestígios usados e pode ter até ${maxPrestiges(user.level)} no nível ${user.level}.` };
  }

  const count = user.prestigeAvailable;
  const badges = [...(user.badges || [])];
  const added = [];

  for (let i = 0; i < count; i++) {
    const badge = `🏆 Prestígio ${user.prestige + 1 + i}`;
    if (!badges.includes(badge)) { badges.push(badge); added.push(badge); }
  }

  const newPrestige = user.prestige + count;
  await repo.updateUser(userId, { prestige: newPrestige, prestigeAvailable: 0, badges });

  return {
    success: true,
    message: `🎉 Todos os prestígios realizados! Você agora é Prestígio ${newPrestige}! 🎉\n📊 Prestígios usados: ${count}\n🏆 Badges adicionados: ${added.join(', ')}\n💎 Prestígios restantes: 0`,
    newPrestige, count, added,
  };
}

// --- Admin: set / reset level ---

async function setLevel(userId, targetLevel) {
  if (targetLevel < 1) return { success: false, message: 'O nível deve ser pelo menos 1!' };
  if (targetLevel > 999) return { success: false, message: 'O nível máximo é 999!' };

  const user = await repo.getUserById(userId);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };

  const history = [...(user.levelHistory || [])];
  history.push({
    action: 'setlevel', timestamp: new Date().toISOString(),
    oldLevel: user.level, oldXP: user.xp,
    oldPrestigeAvailable: user.prestigeAvailable ?? 0, oldPrestige: user.prestige ?? 0,
    newLevel: targetLevel, newXP: xpForLevel(targetLevel),
  });
  if (history.length > 10) history.splice(0, history.length - 10);

  const newXP = xpForLevel(targetLevel);
  const newAvailable = Math.max(0, maxPrestiges(targetLevel) - (user.prestige || 0));

  await repo.updateUser(userId, {
    level: targetLevel, xp: newXP,
    prestigeAvailable: newAvailable, levelHistory: history,
  });

  return {
    success: true,
    message: `✅ Nível alterado com sucesso!\n📊 ${user.level} → ${targetLevel}\n⭐ XP: ${user.xp} → ${newXP}\n💎 Prestígios disponíveis: ${newAvailable}`,
  };
}

async function resetSetLevel(userId) {
  const user = await repo.getUserById(userId);
  if (!user) return { success: false, message: 'Usuário não encontrado.' };

  const history = [...(user.levelHistory || [])];
  const lastIdx = history.findLastIndex(e => e.action === 'setlevel');
  if (lastIdx === -1) return { success: false, message: 'Nenhuma alteração de nível administrativa encontrada para reverter!' };

  const last = history[lastIdx];
  history.splice(lastIdx, 1);

  await repo.updateUser(userId, {
    level: last.oldLevel, xp: last.oldXP,
    prestigeAvailable: last.oldPrestigeAvailable ?? 0, prestige: last.oldPrestige ?? 0,
    levelHistory: history,
  });

  return {
    success: true,
    message: `🔄 Nível revertido com sucesso!\n📊 ${user.level} → ${last.oldLevel}\n⭐ XP: ${user.xp} → ${last.oldXP}\n💎 Prestígios disponíveis: ${user.prestigeAvailable} → ${last.oldPrestigeAvailable ?? 0}\n🏆 Prestígios usados: ${user.prestige} → ${last.oldPrestige ?? 0}`,
  };
}

// --- Ranking ---

async function getRanking(limit = 10) {
  const rows = await repo.getLevelRanking(limit);
  return rows.map(r => ({ ...r, rank: getUserRank(r.level) }));
}

// --- Public API ---

async function getUserInfo(userId) {
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

module.exports = {
  RANKS, getUserRank, getRequiredXP, enrichUserInfo,
  processMessage, msgAlreadyProcessed, levelUpAlreadySent,
  getUserInfo, prestige, prestigeAll,
  setLevel, resetSetLevel, getRanking,
};
