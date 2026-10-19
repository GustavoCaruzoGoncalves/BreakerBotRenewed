import { areJidsSameUser } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import * as memRepo from '../../database/memoryRepository.js';
import type { BotMessage } from '../../types/bot.js';
import { isTrackedBotMessage } from './botReplyIndex.js';

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

function quotedStanzaId(msg: BotMessage): string | null {
  const ctx = contextInfo(msg);
  return ctx?.stanzaId ?? null;
}

function isQuotedParticipantBot(sock: WASocket, msg: BotMessage): boolean {
  const me = sock.user?.id;
  if (!me) return false;
  const participant = contextInfo(msg)?.participant;
  if (!participant) return false;
  if (areJidsSameUser(participant, me)) return true;
  if (sock.user?.lid && areJidsSameUser(participant, sock.user.lid)) return true;
  return false;
}

/** Resposta (quote) a uma mensagem enviada pelo bot. */
export async function isReplyToBotMessage(sock: WASocket, msg: BotMessage): Promise<boolean> {
  const ctx = contextInfo(msg);
  if (!ctx?.quotedMessage && !ctx?.stanzaId) return false;

  if (isQuotedParticipantBot(sock, msg)) return true;

  const stanzaId = quotedStanzaId(msg);
  if (!stanzaId) return false;
  if (isTrackedBotMessage(msg.jid, stanzaId)) return true;

  try {
    return await memRepo.isAssistantMessageInChat(msg.jid, stanzaId);
  } catch {
    return false;
  }
}

export async function shouldActivateAiAssistant(
  sock: WASocket,
  msg: BotMessage,
  requireMentionInDm: boolean,
): Promise<boolean> {
  if (msg.raw.key.fromMe) return false;
  if (msg.text?.trim().startsWith('!')) return false;

  const replyToBot = await isReplyToBotMessage(sock, msg);
  if (replyToBot) {
    if (msg.media || msg.text?.trim()) return true;
    return false;
  }

  if (!msg.text?.trim()) return false;

  const isGroup = msg.jid.endsWith('@g.us');
  if (isGroup) return isBotMentioned(sock, msg);
  if (requireMentionInDm) return isBotMentioned(sock, msg);
  return true;
}
