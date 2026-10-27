import type { proto, WAMessage } from '@whiskeysockets/baileys';
import * as repo from '../../database/repository.js';
import type { BotMessage } from '../../types/bot.js';

const QUOTED_TEXT_MAX = 1200;

export function messageContextInfo(message: proto.IMessage | null | undefined): proto.IContextInfo | null {
  if (!message) return null;
  return (
    message.extendedTextMessage?.contextInfo ??
    message.imageMessage?.contextInfo ??
    message.videoMessage?.contextInfo ??
    message.audioMessage?.contextInfo ??
    message.documentMessage?.contextInfo ??
    null
  );
}

export function extractQuotedBody(quoted: proto.IMessage): string {
  return (
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption ||
    quoted.documentMessage?.caption ||
    ''
  ).trim();
}

export function quotedMediaKind(quoted: proto.IMessage): string | null {
  if (quoted.imageMessage) return 'imagem';
  if (quoted.videoMessage) return 'vídeo';
  if (quoted.stickerMessage) return 'figurinha';
  if (quoted.audioMessage) return 'áudio';
  if (quoted.documentMessage) return 'documento';
  return null;
}

async function labelForParticipant(participantJid: string | null | undefined): Promise<string | null> {
  if (!participantJid) return null;
  const userId = (await repo.resolveMentionJid(participantJid)) ?? participantJid;
  const user = await repo.getUserById(userId);
  if (user?.customNameEnabled && user.customName?.trim()) return user.customName.trim();
  if (user?.pushName?.trim()) return user.pushName.trim();
  return userId.split('@')[0]?.split(':')[0] ?? null;
}

export interface BuildQuotedContextOptions {
  /** Marcação @ ao bot + quote = foco principal na citação. */
  prioritize: boolean;
}

/** Bloco de prompt enfatizando a mensagem citada. */
export async function buildQuotedContextForAi(
  msg: BotMessage,
  options: BuildQuotedContextOptions,
): Promise<string | null> {
  const quoted = msg.quoted;
  if (!quoted) return null;

  const body = extractQuotedBody(quoted);
  const media = quotedMediaKind(quoted);
  if (!body && !media) return null;

  const ctx = messageContextInfo(msg.raw.message ?? undefined);
  const authorLabel = await labelForParticipant(ctx?.participant ?? undefined);

  const lines: string[] = [];
  if (options.prioritize) {
    lines.push('[CONTEXTO PRIORITÁRIO — mensagem citada (quote)]');
    lines.push(
      'Quem te marcou está falando SOBRE este trecho. Interprete a pergunta/comentário deles em função do quote; ' +
        'não ignore o citado nem responda só ao texto solto da menção.',
    );
  } else {
    lines.push('[Mensagem citada (quote) — contexto adicional]');
  }

  if (authorLabel) lines.push(`Autor do trecho citado: ${authorLabel}`);
  if (media) lines.push(`Tipo da mensagem citada: ${media}`);
  if (body) {
    lines.push(`Conteúdo citado:\n"""${body.slice(0, QUOTED_TEXT_MAX)}"""`);
  } else {
    lines.push('(Mensagem citada sem texto; considere a mídia citada se houver.)');
  }

  return lines.join('\n');
}

/** Texto plano do quote (fallback / pesquisa web). */
export function flatQuotedText(msg: BotMessage): string | null {
  if (!msg.quoted) return null;
  const body = extractQuotedBody(msg.quoted);
  return body ? body.slice(0, QUOTED_TEXT_MAX) : null;
}

/** Garante `msg.quoted` preenchido a partir do raw (qualquer tipo de mensagem). */
export function syncQuotedFromRaw(msg: BotMessage): BotMessage {
  if (msg.quoted) return msg;
  const ctx = messageContextInfo(msg.raw.message ?? undefined);
  const quoted = ctx?.quotedMessage ?? null;
  if (!quoted) return msg;
  return { ...msg, quoted };
}

export function quotedContextFromRaw(raw: WAMessage): proto.IMessage | null {
  return messageContextInfo(raw.message ?? undefined)?.quotedMessage ?? null;
}
