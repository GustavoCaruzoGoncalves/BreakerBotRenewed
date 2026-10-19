import type { WASocket } from '@whiskeysockets/baileys';
import { config } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { BotMessage } from '../../types/bot.js';
import * as memRepo from '../../database/memoryRepository.js';
import * as users from '../users.js';
import { extractHeuristicMemories, quotedSnippet, resolveThread, shouldRecordIncomingMessage, truncateContent } from './logic.js';

function waMessageId(msg: BotMessage): string {
  return msg.raw.key.id || `${msg.jid}_${msg.raw.messageTimestamp ?? Date.now()}`;
}

async function runExtraction(
  userId: string,
  text: string,
  threadId: string,
  waId: string,
): Promise<void> {
  const memories = extractHeuristicMemories(text);
  for (const memory of memories) {
    await memRepo.upsertHeuristicMemory(userId, memory, threadId, waId);
  }
}

export async function recordIncomingMessage(sock: WASocket, msg: BotMessage): Promise<void> {
  if (!config.memory.enabled) return;

  try {
    const userId = await users.resolveSender(msg.raw);
    if (!userId || users.isGroupUserId(userId)) return;
    if (users.isBotUser(sock, userId)) return;
    if (users.isIgnoredChatJid(msg.jid)) return;
    if (!shouldRecordIncomingMessage(msg, false)) return;

    const enabled = await memRepo.isMemoryEnabledForUser(userId);
    if (!enabled) return;

    const { threadId, kind, dmUserId } = resolveThread(msg.jid, userId);
    await memRepo.ensureThread(threadId, msg.jid, kind, dmUserId);

    const content = truncateContent(msg.text.trim(), config.memory.maxMessageChars);
    const inserted = await memRepo.insertChatMessage({
      threadId,
      waMessageId: waMessageId(msg),
      chatJid: msg.jid,
      senderUserId: userId,
      role: 'user',
      content,
      quotedSnippet: quotedSnippet(msg),
      isFromBot: false,
    });

    if (inserted) {
      void runExtraction(userId, content, threadId, waMessageId(msg)).catch((err) =>
        console.error('[MEMORY] Extração:', getErrorMessage(err)),
      );
    }
  } catch (err) {
    console.error('[MEMORY] Falha ao registrar mensagem:', getErrorMessage(err));
  }
}

export async function recordAssistantMessage(
  chatJid: string,
  senderUserId: string,
  content: string,
  syntheticId?: string,
): Promise<void> {
  if (!config.memory.enabled) return;

  try {
    const { threadId, kind, dmUserId } = resolveThread(chatJid, senderUserId);
    await memRepo.ensureThread(threadId, chatJid, kind, dmUserId);
    await memRepo.insertChatMessage({
      threadId,
      waMessageId: syntheticId ?? `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      chatJid,
      senderUserId: null,
      role: 'assistant',
      content: truncateContent(content, config.memory.maxMessageChars),
      isFromBot: true,
    });
  } catch (err) {
    console.error('[MEMORY] Falha ao registrar resposta:', getErrorMessage(err));
  }
}
