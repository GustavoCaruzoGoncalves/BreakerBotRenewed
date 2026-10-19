import { config } from '../../config.js';
import type { BotMessage, WASocket } from '../../types/bot.js';
import * as users from '../users.js';
import { isBotMentioned, isReplyToBotMessage } from './botMention.js';
import { runAiChat } from './mentionAssistant.js';

const lastReplyByChat = new Map<string, number>();

export function isProactiveCandidate(text: string): boolean {
  const t = text.trim();
  const minLen = config.opencode.proactiveMinMessageLength;
  if (t.length < minLen) return false;
  if (t.startsWith('!')) return false;

  const roll = () => Math.random() < config.opencode.proactiveChance;

  if (/\?\s*$/.test(t) || /\?/.test(t)) return roll() || roll();
  if (/^(mano|velho|cara|gente|olha|socorro|inacredit|kkk|rsrs|haha|aff|mds|tnc|pqp)/i.test(t)) {
    return roll();
  }
  if (/(discordo|concordo|penso|ach(o|ei)|será|credo|tomar no|que isso)/i.test(t)) {
    return roll();
  }

  return Math.random() < config.opencode.proactiveChance * 0.35;
}

function cooldownOk(chatJid: string): boolean {
  const last = lastReplyByChat.get(chatJid) ?? 0;
  return Date.now() - last >= config.opencode.proactiveMinIntervalMs;
}

function markReplied(chatJid: string): void {
  lastReplyByChat.set(chatJid, Date.now());
}

export async function tryProactiveGroupChat(sock: WASocket, msg: BotMessage): Promise<boolean> {
  if (!config.opencode.enabled || !config.opencode.proactiveEnabled) return false;
  if (!msg.jid.endsWith('@g.us')) return false;
  if (msg.raw.key.fromMe) return false;
  if (!msg.text?.trim() || msg.text.trim().startsWith('!')) return false;
  if (isBotMentioned(sock, msg)) return false;
  if (await isReplyToBotMessage(sock, msg)) return false;
  if (!cooldownOk(msg.jid)) return false;
  if (!isProactiveCandidate(msg.text)) return false;

  const sender = await users.resolveSender(msg.raw);
  if (!sender || users.isGroupUserId(sender) || users.isBotUser(sock, sender)) {
    return false;
  }

  const senderLabel = msg.raw.pushName || sender.split('@')[0] || 'Alguém';
  const prompt =
    `[Contexto: mensagem espontânea no grupo, você NÃO foi mencionado.]\n` +
    `${senderLabel} disse:\n"${msg.text.trim()}"\n\n` +
    'Se quiser entrar na conversa, responda em tom de grupo. Senão, use [SKIP].';

  const sent = await runAiChat(sock, msg, sender, prompt, {
    mode: 'proactive',
    skipAgentDb: true,
  });

  if (sent) markReplied(msg.jid);
  return sent;
}

/** Para testes. */
export function resetProactiveCooldowns(): void {
  lastReplyByChat.clear();
}
