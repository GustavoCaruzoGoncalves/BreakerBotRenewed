const users = require('./services/users');
const level = require('./services/level');
const mentions = require('./lib/mentions');
const repo = require('./database/repository');
const config = require('./config');

const stickerCommand = require('./commands/media/sticker');
const audioCommand = require('./commands/media/audio');
const gptCommand = require('./commands/ai/gpt');
const zhipuCommand = require('./commands/ai/zhipu');
const grokCommand = require('./commands/ai/grok');
const jokesCommand = require('./commands/fun/jokes');
const pfpCommand = require('./commands/fun/pfp');
const triviaCommand = require('./commands/fun/trivia');
const amigoSecretoCommand = require('./commands/fun/amigosecreto');
const preferencesCommand = require('./commands/settings/preferences');
const levelCommand = require('./commands/level/level');
const auraCommand = require('./commands/aura/aura');
const auraSvc = require('./services/aura');
const utilityCommand = require('./commands/utility/util');
const banCommand = require('./commands/moderation/ban');

const handlers = [
  stickerCommand,
  audioCommand,
  gptCommand,
  zhipuCommand,
  grokCommand,
  jokesCommand,
  pfpCommand,
  triviaCommand,
  amigoSecretoCommand,
  preferencesCommand,
  utilityCommand,
  banCommand,
  levelCommand,
  auraCommand,
];

const knownUsers = new Set();

function formatSender(jid) {
  return jid?.split('@')[0]?.split(':')[0] || '?';
}

function extractCommand(text) {
  if (!text || !text.startsWith('!')) return null;
  return text.split(/\s/)[0].toLowerCase();
}

function logCommand(msg, cmd, status, ms) {
  const sender = msg.raw.pushName || formatSender(msg.jid);
  const where = msg.jid.endsWith('@g.us') ? 'grupo' : 'DM';
  const time = ms !== undefined ? ` (${ms}ms)` : '';
  console.log(`[CMD] ${cmd} | ${sender} | ${where} | ${status}${time}`);
}

async function migratePhantom(phantomId, realUserId, pushName) {
  if (!phantomId || phantomId === realUserId) return false;
  const phantom = await repo.getUserById(phantomId);
  if (!phantom) return false;

  await repo.migrateUserId(phantomId, realUserId, {
    jid: phantomId,
    pushName: pushName || phantom.pushName,
  });
  console.log(`[USERS] Phantom ${phantomId} migrado para ${realUserId}`);
  return true;
}

async function ensureSender(msg, sock) {
  const key = msg.raw.key;
  if (key?.fromMe) return;
  if (users.isIgnoredChatJid(key?.remoteJid)) return;

  const userId = await users.resolveSender(msg.raw);
  if (!userId || knownUsers.has(userId)) return;
  if (users.isBotUser(sock, userId)) return;

  const pushName = msg.raw.pushName || null;
  const lidJid = users.getLidJid(msg.raw);
  const jid = lidJid?.endsWith('@lid') ? lidJid : userId;
  const existing = await repo.getUserById(userId);

  if (existing) {
    if (pushName && existing.pushName !== pushName) {
      await repo.updateUser(userId, { pushName });
    }
    await migratePhantom(jid, userId, pushName);
  } else {
    const migrated = await migratePhantom(jid, userId, pushName);
    if (!migrated) {
      await repo.createUser(userId, {
        ...users.USER_DEFAULTS,
        pushName,
        jid,
      });
    }
  }

  knownUsers.add(userId);
}

// --- XP processing + level-up notifications ---

async function processXP(sock, msg) {
  if (!msg.text?.trim() || msg.raw.key.fromMe) return;
  if (users.isIgnoredChatJid(msg.jid)) return;

  const msgId = msg.raw.key?.id || `${msg.jid}_${msg.raw.messageTimestamp || Date.now()}`;
  if (level.msgAlreadyProcessed(msgId)) return;

  const userId = await users.resolveSender(msg.raw);
  if (!userId) return;
  if (users.isBotUser(sock, userId)) return;

  const result = await level.processMessage(userId);
  if (!result?.isLevelUp) return;
  if (level.levelUpAlreadySent(userId, result.newLevel)) return;

  const m = await mentions.processSingleMention(userId);
  const rank = level.getUserRank(result.newLevel);

  let text = `🎉 ${m.mentionText} subiu para o nível ${result.newLevel}! 🎉\n`;
  if (config.admins.includes(userId)) text += '👑 ADMINISTRADOR⭐😎\n';
  text += `📊 Elo: ${rank.name}\n`;

  const info = await level.getUserInfo(userId);
  text += `⭐ XP: ${info?.xp ?? 0}\n`;
  text += `🏆 Prestígio: ${info?.prestige ?? 0}\n`;

  if (result.isDailyBonus) {
    text += '🌅 Bônus diário ativado: +1.0x multiplicador por 24h!';
  } else if (result.dailyBonusMultiplier > 0) {
    text += `🌅 Multiplicador bônus ativo: +${result.dailyBonusMultiplier}x`;
  }

  await sock.sendMessage(msg.jid, { text, mentions: m.mentions });

  if (result.newLevel >= 10 && result.newLevel % 10 === 0) {
    const m2 = await mentions.processSingleMention(userId);
    await sock.sendMessage(msg.jid, {
      text: `🏆 ${m2.mentionText} alcançou o nível ${result.newLevel}! Você tem ${info?.prestigeAvailable ?? 0} prestígios disponíveis! Use !prestigio para resgatar! 🏆`,
      mentions: m2.mentions,
    });
  }

  const oldRank = level.getUserRank(result.oldLevel);
  if (oldRank.name !== rank.name) {
    const m3 = await mentions.processSingleMention(userId);
    await sock.sendMessage(msg.jid, {
      text: `🌟 ${m3.mentionText} alcançou o elo ${rank.name}! 🌟`,
      mentions: m3.mentions,
    });
  }
}

// --- Main handler ---

async function handle(sock, msg) {
  await ensureSender(msg, sock);

  processXP(sock, msg).catch(err => console.error('[XP] Erro:', err.message));
  auraCommand.processAuraMissions(sock, msg).catch(err => console.error('[AURA-MISSION] Erro:', err.message));
  auraCommand.processAuraSticker(sock, msg).catch(err => console.error('[AURA-STICKER] Erro:', err.message));
  auraSvc.trySpawnEvent(sock, msg.jid).catch(() => {});

  const cmd = extractCommand(msg.text);
  if (!cmd) return;

  const start = Date.now();

  for (const handler of handlers) {
    try {
      const handled = await handler(sock, msg);
      if (handled) {
        logCommand(msg, cmd, 'ok', Date.now() - start);
        return;
      }
    } catch (err) {
      logCommand(msg, cmd, 'erro', Date.now() - start);
      throw err;
    }
  }

  logCommand(msg, cmd, 'ignorado');
}

function handleReaction(sock, item) {
  auraCommand.handleAuraReaction(sock, item).catch(() => {});
}

module.exports = { handle, handleReaction };
