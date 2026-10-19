import { areJidsSameUser } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import type { BotMessage } from '../../types/bot.js';

function contextInfo(msg: BotMessage) {
  const m = msg.raw.message;
  return (
    m?.extendedTextMessage?.contextInfo ??
    m?.imageMessage?.contextInfo ??
    m?.videoMessage?.contextInfo ??
    null
  );
}

export function isBotMentioned(sock: WASocket, msg: BotMessage): boolean {
  const me = sock.user?.id;
  if (!me) return false;

  const mentioned = contextInfo(msg)?.mentionedJid ?? [];
  for (const jid of mentioned) {
    if (areJidsSameUser(jid, me)) return true;
    if (sock.user?.lid && areJidsSameUser(jid, sock.user.lid)) return true;
  }
  return false;
}

/** Remove menções visíveis (@5511...) do texto da pergunta. */
export function extractPromptFromMentionText(text: string): string {
  return text
    .replace(/@\d[\d\s-]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldActivateAiAssistant(
  sock: WASocket,
  msg: BotMessage,
  requireMentionInDm: boolean,
): boolean {
  if (msg.raw.key.fromMe) return false;
  if (!msg.text?.trim()) return false;
  if (msg.text.trim().startsWith('!')) return false;

  const isGroup = msg.jid.endsWith('@g.us');
  if (isGroup) return isBotMentioned(sock, msg);
  if (requireMentionInDm) return isBotMentioned(sock, msg);
  return true;
}
