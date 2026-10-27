import type { FilePartInput, TextPartInput } from '@opencode-ai/sdk';
import { config } from '../../config.js';
import { downloadMedia } from '../../lib/message.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { BotMessage, MediaRef, WASocket } from '../../types/bot.js';

export interface VisionAttachment {
  mime: string;
  filename: string;
  dataUrl: string;
  byteLength: number;
  kind: 'image' | 'video' | 'sticker';
}

export type VisionCollectResult =
  | { ok: true; attachments: VisionAttachment[] }
  | { ok: false; reason: 'disabled' | 'no_media' | 'unsupported' | 'too_large' | 'download_failed' };

function isVisionMediaType(type: MediaRef['type']): boolean {
  return type === 'imageMessage' || type === 'stickerMessage' || type === 'videoMessage';
}

export function messageHasVisionMedia(msg: BotMessage): boolean {
  if (!msg.media) return false;
  return isVisionMediaType(msg.media.type);
}

function maxBytesForMedia(media: MediaRef): number {
  if (media.type === 'videoMessage') return config.opencode.visionVideoMaxBytes;
  return config.opencode.visionMaxBytes;
}

function mediaKind(media: MediaRef): VisionAttachment['kind'] {
  if (media.type === 'videoMessage') return 'video';
  if (media.type === 'stickerMessage') return 'sticker';
  return 'image';
}

function mimeForMedia(media: MediaRef): string {
  if (media.type === 'stickerMessage') return 'image/webp';
  if (media.type === 'videoMessage') {
    const mimetype = media.content.mimetype?.trim();
    if (mimetype?.startsWith('video/')) return mimetype.split(';')[0]!;
    return 'video/mp4';
  }
  const mimetype = media.content.mimetype?.trim();
  if (mimetype?.startsWith('image/')) return mimetype.split(';')[0]!;
  return 'image/jpeg';
}

function filenameForMedia(media: MediaRef): string {
  if (media.type === 'stickerMessage') return 'sticker.webp';
  if (media.type === 'videoMessage') {
    const ext = mimeForMedia(media).split('/')[1] || 'mp4';
    return `video.${ext}`;
  }
  const ext = mimeForMedia(media).split('/')[1] || 'jpg';
  return `photo.${ext}`;
}

async function attachmentFromMedia(
  sock: WASocket,
  media: MediaRef,
): Promise<{ attachment: VisionAttachment | null; tooLarge: boolean }> {
  const maxBytes = maxBytesForMedia(media);
  try {
    const buffer = await downloadMedia(sock, media);
    if (buffer.length === 0) return { attachment: null, tooLarge: false };
    if (buffer.length > maxBytes) return { attachment: null, tooLarge: true };
    const mime = mimeForMedia(media);
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    return {
      attachment: {
        mime,
        filename: filenameForMedia(media),
        dataUrl,
        byteLength: buffer.length,
        kind: mediaKind(media),
      },
      tooLarge: false,
    };
  } catch (err) {
    console.error('[VISION] Falha ao baixar mídia:', getErrorMessage(err));
    return { attachment: null, tooLarge: false };
  }
}

/** Baixa imagem, figurinha ou vídeo anexo/citado para o modelo multimodal. */
export async function collectVisionAttachments(
  sock: WASocket,
  msg: BotMessage,
): Promise<VisionCollectResult> {
  if (!config.opencode.visionEnabled) return { ok: false, reason: 'disabled' };
  if (!msg.media) return { ok: false, reason: 'no_media' };
  if (!isVisionMediaType(msg.media.type)) return { ok: false, reason: 'unsupported' };

  const { attachment, tooLarge } = await attachmentFromMedia(sock, msg.media);
  if (tooLarge) return { ok: false, reason: 'too_large' };
  if (!attachment) return { ok: false, reason: 'download_failed' };
  return { ok: true, attachments: [attachment] };
}

export function visionFailureMessage(
  reason: 'disabled' | 'no_media' | 'unsupported' | 'too_large' | 'download_failed',
): string {
  switch (reason) {
    case 'too_large':
      return 'Esse vídeo/imagem é grande demais pro modelo. Manda um corte menor ou uma captura de tela.';
    case 'download_failed':
      return 'Não consegui baixar a mídia do WhatsApp. Tenta reenviar ou citar de novo.';
    default:
      return '';
  }
}

export function buildMultimodalParts(
  promptText: string,
  attachments: VisionAttachment[],
): Array<TextPartInput | FilePartInput> {
  const parts: Array<TextPartInput | FilePartInput> = [
    {
      type: 'text',
      text: promptText,
    },
  ];
  for (const file of attachments) {
    parts.push({
      type: 'file',
      mime: file.mime,
      url: file.dataUrl,
      filename: file.filename,
    });
  }
  return parts;
}

export const VISION_SYSTEM_HINT =
  '\n\n[Visão: o usuário pode enviar imagem, figurinha ou vídeo junto com o texto. ' +
  'Observe o conteúdo visual (incluindo ação/fala em vídeos curtos) e responda à pergunta; ' +
  'não diga que não consegue ver mídia.]';
