import { areJidsSameUser } from '@whiskeysockets/baileys';
import * as repo from '../../database/repository.js';
import type { BotMessage } from '../../types/bot.js';

export interface ResolvedChatMention {
  userId: string;
  label: string;
  tagInText: string | null;
}

function contextInfos(msg: BotMessage) {
  const m = msg.raw.message;
  if (!m) return [];
  const infos = [
    m.extendedTextMessage?.contextInfo,
    m.imageMessage?.contextInfo,
    m.videoMessage?.contextInfo,
    m.audioMessage?.contextInfo,
    m.documentMessage?.contextInfo,
    m.stickerMessage?.contextInfo,
    m.buttonsResponseMessage?.contextInfo,
    m.listResponseMessage?.contextInfo,
  ];
  return infos.filter(Boolean);
}

export function collectWaMentionedJids(msg: BotMessage): string[] {
  const out: string[] = [];
  for (const ci of contextInfos(msg)) {
    const list = ci?.mentionedJid;
    if (list?.length) out.push(...list);
  }
  return [...new Set(out)];
}

function isBotJid(jid: string, botUserIds: readonly string[]): boolean {
  return botUserIds.some((bot) => areJidsSameUser(jid, bot));
}

const TEXT_MENTION_RE = /@([^\s@]+(?:\s+[^\s@]+)*)/g;

function isBotTextTag(tag: string): boolean {
  return /breaker|bot/i.test(tag.trim());
}

export function extractTextMentionTags(text: string): string[] {
  const tags: string[] = [];
  let m: RegExpExecArray | null;
  TEXT_MENTION_RE.lastIndex = 0;
  while ((m = TEXT_MENTION_RE.exec(text)) !== null) {
    const tag = m[1]?.trim();
    if (!tag || isBotTextTag(tag)) continue;
    const firstToken = tag.split(/\s+/)[0] ?? tag;
    if (/^\d[\d-]*$/.test(firstToken)) continue;
    const cleaned = tag.replace(/[?!.,;:…]+$/u, '').trim();
    if (cleaned) tags.push(cleaned);
  }
  return [...new Set(tags)];
}

async function displayLabelForUserId(userId: string): Promise<string> {
  const user = await repo.getUserById(userId);
  if (user?.customNameEnabled && user.customName?.trim()) return user.customName.trim();
  if (user?.pushName?.trim()) return user.pushName.trim();
  return userId.split('@')[0]?.split(':')[0] ?? userId;
}

async function resolveTagToUserId(tag: string): Promise<string | null> {
  const exact = await repo.findUsersByExactDisplayName(tag, 2);
  if (exact.length === 1) return exact[0]!.userId;
  if (exact.length > 1) return exact[0]!.userId;

  const fuzzy = await repo.searchUsersByDisplayName(tag, 1);
  return fuzzy[0]?.userId ?? null;
}

export interface ResolveChatMentionsInput {
  senderUserId: string;
  botUserIds: readonly string[];
}

export interface ResolveChatMentionsResult {
  mentionedUserIds: string[];
  resolved: ResolvedChatMention[];
  contextBlock: string;
}

export async function resolveChatMentions(
  msg: BotMessage,
  input: ResolveChatMentionsInput,
): Promise<ResolveChatMentionsResult> {
  const mentionedUserIds: string[] = [];
  const resolved: ResolvedChatMention[] = [];
  const seen = new Set<string>();

  const pushUser = async (userId: string, tagInText: string | null) => {
    if (seen.has(userId)) return;
    if (userId === input.senderUserId) return;
    seen.add(userId);
    mentionedUserIds.push(userId);
    const label = await displayLabelForUserId(userId);
    resolved.push({ userId, label, tagInText });
  };

  for (const jid of collectWaMentionedJids(msg)) {
    if (isBotJid(jid, input.botUserIds)) continue;
    const userId = (await repo.resolveMentionJid(jid)) ?? jid;
    if (input.botUserIds.some((b) => areJidsSameUser(userId, b))) continue;
    await pushUser(userId, null);
  }

  const text = msg.text ?? '';
  for (const tag of extractTextMentionTags(text)) {
    const userId = await resolveTagToUserId(tag);
    if (userId) await pushUser(userId, `@${tag}`);
  }

  if (resolved.length === 0) {
    return { mentionedUserIds, resolved, contextBlock: '' };
  }

  const lines = resolved.map((r, index) => {
    const tagPart = r.tagInText ? ` (texto ${r.tagInText})` : ' (menção WhatsApp)';
    return `- Índice ${index}: ${r.label}${tagPart} — use get_mentioned_user_public_stats com mentionIndex=${index} para stats públicas.`;
  });

  const contextBlock = [
    '[Pessoas mencionadas nesta mensagem — já mapeadas ao cadastro do BreakerBot]',
    ...lines,
    'Não peça para o usuário repetir nome ou marcar de novo se já consta acima.',
  ].join('\n');

  return { mentionedUserIds, resolved, contextBlock };
}
