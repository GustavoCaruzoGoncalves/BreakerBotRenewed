import * as users from './services/users.js';
import * as level from './services/level.js';
import * as mentions from './lib/mentions.js';
import * as repo from './database/repository.js';
import { config } from './config.js';
import { getErrorMessage } from './lib/errors.js';

import stickerCommand from './commands/media/sticker.js';
import audioCommand from './commands/media/audio.js';
import gptCommand from './commands/ai/gpt.js';
import zhipuCommand from './commands/ai/zhipu.js';
import grokCommand from './commands/ai/grok.js';
import jokesCommand, { handleEmojiReaction } from './commands/fun/jokes.js';
import pfpCommand from './commands/fun/pfp.js';
import triviaCommand from './commands/fun/trivia.js';
import amigoSecretoCommand from './commands/fun/amigosecreto.js';
import preferencesCommand from './commands/settings/preferences.js';
import levelCommand from './commands/level/level.js';
import auraCommand, {
  handleAuraReaction,
  processAuraMissions,
  processAuraSticker,
} from './commands/aura/aura.js';
import * as auraSvc from './services/aura.js';
import utilityCommand from './commands/utility/util.js';
import banCommand from './commands/moderation/ban.js';
import trucoCommand from './commands/games/truco.js';

import { setCommands } from './commands/registry.js';
import type { BotMessage, Command, ReactionEvent, WASocket } from './types/bot.js';

const commands: Command[] = [
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
  // Antes da aura: `!entrar` e `!aceitar` são gatilhos compartilhados e o comando
  // do Truco só os consome quando a partida realmente espera por eles.
  trucoCommand,
  utilityCommand,
  banCommand,
  levelCommand,
  ...(config.aura.enabled ? [auraCommand] : []),
];

setCommands(commands);

const knownUsers = new Set<string>();

function formatSender(jid: string | null | undefined): string {
  return jid?.split('@')[0]?.split(':')[0] || '?';
}

function extractCommand(text: string | null | undefined): string | null {
  if (!text || !text.startsWith('!')) return null;
  return text.split(/\s/)[0]?.toLowerCase() ?? null;
}

type CommandStatus = 'ok' | 'erro' | 'ignorado';

function logCommand(msg: BotMessage, cmd: string, status: CommandStatus, ms?: number): void {
  const sender = msg.raw.pushName || formatSender(msg.jid);
  const where = msg.jid.endsWith('@g.us') ? 'grupo' : 'DM';
  const time = ms !== undefined ? ` (${ms}ms)` : '';
  console.log(`[CMD] ${cmd} | ${sender} | ${where} | ${status}${time}`);
}

/**
 * Usuários "fantasma" são registros criados a partir do JID `@lid` antes de o bot
 * conhecer o número real; ao descobri-lo, os dados são movidos para o ID canônico.
 */
async function migratePhantom(
  phantomId: string,
  realUserId: string,
  pushName: string | null,
): Promise<boolean> {
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

async function ensureSender(msg: BotMessage, sock: WASocket): Promise<void> {
  const key = msg.raw.key;
  if (key.fromMe) return;
  if (users.isIgnoredChatJid(key.remoteJid)) return;

  const userId = await users.resolveSender(msg.raw);
  if (!userId || knownUsers.has(userId)) return;
  if (users.isGroupUserId(userId)) return;
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

async function processXP(sock: WASocket, msg: BotMessage): Promise<void> {
  if (!msg.text?.trim() || msg.raw.key.fromMe) return;
  if (users.isIgnoredChatJid(msg.jid)) return;

  const msgId = msg.raw.key.id || `${msg.jid}_${msg.raw.messageTimestamp ?? Date.now()}`;
  if (level.msgAlreadyProcessed(msgId)) return;

  const userId = await users.resolveSender(msg.raw);
  if (!userId) return;
  if (users.isGroupUserId(userId)) return;
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

export async function handle(sock: WASocket, msg: BotMessage): Promise<void> {
  await ensureSender(msg, sock);

  processXP(sock, msg).catch((err: unknown) => console.error('[XP] Erro:', getErrorMessage(err)));
  if (config.aura.enabled) {
    processAuraMissions(sock, msg).catch((err: unknown) =>
      console.error('[AURA-MISSION] Erro:', getErrorMessage(err)),
    );
    processAuraSticker(sock, msg).catch((err: unknown) =>
      console.error('[AURA-STICKER] Erro:', getErrorMessage(err)),
    );
    auraSvc.trySpawnEvent(sock, msg.jid).catch(() => {});
  }

  if (msg.text?.trim() && !msg.raw.key.fromMe) {
    const msgType = Object.keys(msg.raw.message ?? {})[0];
    if (msgType !== 'reactionMessage') {
      handleEmojiReaction(sock, msg).catch(() => {});
    }
  }

  const cmd = extractCommand(msg.text);
  if (!cmd) return;

  const start = Date.now();

  for (const command of commands) {
    try {
      const handled = await command.handle(sock, msg);
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

export function handleReaction(sock: WASocket, item: ReactionEvent): void {
  if (config.aura.enabled) {
    handleAuraReaction(sock, item).catch(() => {});
  }
}
