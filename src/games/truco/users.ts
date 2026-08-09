import * as repo from '../../database/repository.js';
import { USER_DEFAULTS } from '../../services/users.js';

/**
 * Converte o JID de uma menção no `users.user_id` canônico. Menções podem vir
 * como `@lid`, então a busca também olha a coluna `jid`.
 */
export async function resolveMentionUserId(mentionJid: string): Promise<string | null> {
  if (!mentionJid) return null;
  const found = await repo.findUserByJid(mentionJid);
  if (found) return found;
  const byLid = await repo.findUserIdByJid(mentionJid);
  if (byLid) return byLid;
  return mentionJid.endsWith('@s.whatsapp.net') ? mentionJid : null;
}

export interface TrucoUser {
  userId: string;
  mentionJid: string;
  dmJid: string;
  displayName: string;
}

function handleOf(userId: string): string {
  return userId.split('@')[0] ?? userId;
}

/**
 * Garante que exista linha em `users` — as tabelas do Truco têm FK para lá e
 * adversários citados numa partida de debug podem nunca ter falado com o bot.
 */
export async function ensureTrucoUser(userId: string, fallbackName?: string): Promise<TrucoUser> {
  const existing = await repo.getUserById(userId);

  if (!existing) {
    await repo.createUser(userId, {
      ...USER_DEFAULTS,
      pushName: fallbackName ?? null,
      jid: userId,
    });
    return {
      userId,
      mentionJid: userId,
      dmJid: userId,
      displayName: fallbackName || handleOf(userId),
    };
  }

  const displayName =
    (existing.customNameEnabled && existing.customName) ||
    existing.pushName ||
    fallbackName ||
    handleOf(userId);

  return {
    userId,
    mentionJid: mentionJidFor(userId, existing.jid),
    dmJid: dmJidFor(userId, existing.jid),
    displayName,
  };
}

/** Menção precisa do PN quando existir; LID não renderiza o @ corretamente. */
export function mentionJidFor(userId: string, storedJid?: string | null): string {
  if (userId.endsWith('@s.whatsapp.net')) return userId;
  if (storedJid?.endsWith('@s.whatsapp.net')) return storedJid;
  return userId;
}

/** Privado: PN preferido, LID como fallback quando não há número conhecido. */
export function dmJidFor(userId: string, storedJid?: string | null): string {
  if (userId.endsWith('@s.whatsapp.net')) return userId;
  if (storedJid) return storedJid;
  return userId;
}
