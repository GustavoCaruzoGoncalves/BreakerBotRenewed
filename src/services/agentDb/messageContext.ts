import type { BotMessage } from '../../types/bot.js';

export type MediaKind = 'image' | 'video' | 'sticker' | null;

export function mediaKindFromMessage(msg: BotMessage): MediaKind {
  if (!msg.media) return null;
  switch (msg.media.type) {
    case 'imageMessage':
      return 'image';
    case 'videoMessage':
      return 'video';
    case 'stickerMessage':
      return 'sticker';
    default:
      return null;
  }
}

/** Contexto objetivo da mensagem WhatsApp para o planejador (não inventar mídia). */
export function buildMessageContextBlock(msg: BotMessage): string {
  const kind = mediaKindFromMessage(msg);
  const lines = ['[Contexto da mensagem WhatsApp]'];
  if (kind) {
    const label = kind === 'image' ? 'imagem' : kind === 'video' ? 'vídeo' : 'figurinha';
    lines.push(`- Mídia anexa ou citada: ${label} (já disponível para comandos de figurinha).`);
    lines.push(
      '- Se pedirem figurinha/sticker/converter, use run_bot_command com !sticker, !fsticker ou !toimg conforme o caso.',
    );
  } else {
    lines.push('- Mídia anexa ou citada: nenhuma.');
  }
  if (msg.quoted) {
    const quotedText =
      msg.quoted.conversation ||
      msg.quoted.extendedTextMessage?.text ||
      msg.quoted.imageMessage?.caption ||
      '';
    if (quotedText.trim()) {
      lines.push(`- Texto citado (resumo): ${quotedText.trim().slice(0, 400)}`);
    }
  }
  return lines.join('\n');
}
