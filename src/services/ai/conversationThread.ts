import { config } from '../../config.js';

/** Conversa ativa por (chat + usuário) — continua sem @ após menção/resposta ao bot. */
const lastActiveMs = new Map<string, number>();

export function aiThreadKey(chatJid: string, userId: string): string {
  return `${chatJid}|${userId}`;
}

function threadTtlMs(): number {
  return config.opencode.conversationThreadTtlMs;
}

export function touchAiConversationThread(chatJid: string, userId: string): void {
  lastActiveMs.set(aiThreadKey(chatJid, userId), Date.now());
}

export function hasActiveAiConversationThread(chatJid: string, userId: string): boolean {
  const key = aiThreadKey(chatJid, userId);
  const at = lastActiveMs.get(key);
  if (!at) return false;
  if (Date.now() - at > threadTtlMs()) {
    lastActiveMs.delete(key);
    return false;
  }
  return true;
}

export function clearAiConversationThread(chatJid: string, userId: string): void {
  lastActiveMs.delete(aiThreadKey(chatJid, userId));
}

/** Para testes. */
export function resetAiConversationThreads(): void {
  lastActiveMs.clear();
}
