import { downloadMediaMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import type { proto, WAMessage, WAMessageKey, WASocket } from '@whiskeysockets/baileys';
import { isIgnoredChatJid } from '../services/users.js';
import type { BotMessage, MediaMessageType, MediaRef } from '../types/bot.js';

const MEDIA_TYPES: readonly MediaMessageType[] = ['imageMessage', 'videoMessage', 'stickerMessage'];

/** Quanto esperar pela WhatsApp devolver a mídia reenviada antes de desistir. */
const REUPLOAD_TIMEOUT_MS = 15000;

function isMediaType(type: string): type is MediaMessageType {
  return (MEDIA_TYPES as readonly string[]).includes(type);
}

export function parse(msg: WAMessage | null | undefined): BotMessage | null {
  if (!msg?.message || !msg.key?.remoteJid) return null;
  if (isIgnoredChatJid(msg.key.remoteJid)) return null;

  const jid = msg.key.remoteJid;
  const type = Object.keys(msg.message)[0] ?? '';
  const context = msg.message.extendedTextMessage?.contextInfo ?? null;
  const quoted = context?.quotedMessage ?? null;

  const text =
    msg.message.conversation ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    msg.message.extendedTextMessage?.text ||
    '';

  const media = resolveMedia(type, msg, context);

  return { jid, type, text, media, quoted, raw: msg };
}

function resolveMedia(
  type: string,
  msg: WAMessage,
  context: proto.IContextInfo | null,
): MediaRef | null {
  const message = msg.message;
  if (!message) return null;

  if (isMediaType(type)) {
    const content = message[type];
    if (content) return { type, content, key: msg.key } as MediaRef;
  }

  const quoted = context?.quotedMessage;
  if (quoted && context) {
    for (const mediaType of MEDIA_TYPES) {
      const content = quoted[mediaType];
      if (content) return { type: mediaType, content, key: quotedKey(msg.key, context) } as MediaRef;
    }
  }

  return null;
}

/**
 * Reconstrói a chave da mensagem citada a partir do `contextInfo`. Sem ela o
 * Baileys não consegue identificar qual mídia pedir de volta à WhatsApp.
 */
function quotedKey(key: WAMessageKey, context: proto.IContextInfo): WAMessageKey {
  return {
    remoteJid: key.remoteJid,
    id: context.stanzaId ?? undefined,
    fromMe: false,
    participant: context.participant ?? undefined,
  };
}

/** `downloadMediaMessage` só lê `message`, mas exige o formato completo do Baileys. */
function toDownloadable(media: MediaRef, sock: WASocket): WAMessage {
  const message: proto.IMessage = {};
  if (media.type === 'imageMessage') message.imageMessage = media.content;
  else if (media.type === 'videoMessage') message.videoMessage = media.content;
  else message.stickerMessage = media.content;

  return { key: { ...media.key, fromMe: isOwnMessage(sock, media.key) }, message };
}

function isOwnMessage(sock: WASocket, key: WAMessageKey): boolean {
  const me = sock.user?.id;
  if (!me || !key.participant) return key.fromMe ?? false;
  return jidNormalizedUser(key.participant) === jidNormalizedUser(me);
}

/**
 * Pede à WhatsApp que reenvie a mídia. O Baileys não impõe timeout aqui, então
 * a espera fica pendurada para sempre se o aparelho não responder.
 */
async function requestReupload(sock: WASocket, message: WAMessage): Promise<WAMessage> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Timeout ao pedir o reenvio da mídia')),
      REUPLOAD_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([sock.updateMediaMessage(message), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function downloadMedia(sock: WASocket, media: MediaRef): Promise<Buffer> {
  const message = toDownloadable(media, sock);
  const ctx = { logger: sock.logger, reuploadRequest: sock.updateMediaMessage };

  try {
    return await downloadMediaMessage(message, 'buffer', {}, ctx);
  } catch (error) {
    // O Baileys só tenta o reupload quando o erro expõe `.status`, mas o download
    // lança Boom (`output.statusCode`) ou o TypeError do fetch. Repetimos aqui.
    try {
      const refreshed = await requestReupload(sock, message);
      return await downloadMediaMessage(refreshed, 'buffer', {}, ctx);
    } catch {
      throw error;
    }
  }
}
