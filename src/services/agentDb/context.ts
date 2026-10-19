import { randomUUID } from 'node:crypto';
import type { BotMessage } from '../../types/bot.js';
import { config, getAdminJids } from '../../config.js';
import * as repo from '../../database/repository.js';
import * as users from '../users.js';
import type { ToolRequestContext } from './types.js';

export async function buildToolContextFromMessage(
  msg: BotMessage,
  senderUserId: string,
): Promise<ToolRequestContext> {
  const chatKind = msg.jid.endsWith('@g.us') ? 'group' : 'dm';
  const mentionedJids =
    msg.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ??
    msg.raw.message?.imageMessage?.contextInfo?.mentionedJid ??
    [];

  const mentionedUserIds: string[] = [];
  for (const jid of mentionedJids) {
    const resolved = await repo.resolveMentionJid(jid);
    if (resolved) mentionedUserIds.push(resolved);
  }

  return {
    requestId: randomUUID(),
    canonicalUserId: senderUserId,
    chatJid: msg.jid,
    chatKind,
    groupJid: chatKind === 'group' ? msg.jid : null,
    displayName: msg.raw.pushName ?? null,
    isBotAdmin: config.admins.includes(senderUserId) || getAdminJids().includes(senderUserId),
    waMessageId: msg.raw.key.id ?? null,
    mentionedUserIds,
  };
}

export async function buildToolContextFromSender(
  msg: BotMessage,
): Promise<ToolRequestContext | null> {
  const sender = await users.resolveSender(msg.raw);
  if (!sender || users.isGroupUserId(sender)) return null;
  return buildToolContextFromMessage(msg, sender);
}
