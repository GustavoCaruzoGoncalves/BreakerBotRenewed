import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import type { ResizeOptions } from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { downloadMedia } from '../../lib/message.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { Command, CommandHandler, MediaRef, WAMessage, WASocket } from '../../types/bot.js';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

interface StickerVariant {
  image: ResizeOptions & { width: number; height: number };
  videoFilter: string;
}

const VARIANTS: Record<string, StickerVariant> = {
  '!sticker': {
    image: { width: 512, height: 512, fit: 'inside' },
    videoFilter: 'scale=512:512:force_original_aspect_ratio=decrease',
  },
  '!fsticker': {
    image: {
      width: 512,
      height: 512,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
    videoFilter:
      'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
  },
};

const VARIANT_PREFIXES = Object.keys(VARIANTS);

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, media, type, raw } = msg;

  const cmd = VARIANT_PREFIXES.find((p) => text.startsWith(p));

  if (cmd) return handleSticker(sock, raw, jid, media, cmd);

  if (text.startsWith('!toimg') && media?.type === 'stickerMessage' && type !== 'stickerMessage') {
    return handleToImage(sock, raw, jid, media);
  }
};

async function handleSticker(
  sock: WASocket,
  raw: WAMessage,
  jid: string,
  media: MediaRef | null,
  cmd: string,
): Promise<boolean> {
  if (!media || (media.type !== 'imageMessage' && media.type !== 'videoMessage')) {
    await sock.sendMessage(
      jid,
      { text: 'Envie ou responda a uma imagem, vídeo ou GIF com `!sticker` ou `!fsticker`!' },
      { quoted: raw },
    );
    return true;
  }

  try {
    const buffer = await downloadMedia(sock, media);
    if (!buffer) throw new Error('Falha ao baixar mídia');

    const variant = VARIANTS[cmd];
    if (!variant) throw new Error('Variante de figurinha desconhecida');

    const sticker =
      media.type === 'videoMessage'
        ? await videoToWebp(buffer, variant.videoFilter)
        : await imageToWebp(buffer, variant.image);

    await sock.sendMessage(jid, { sticker }, { quoted: raw });
  } catch (err) {
    const message = getErrorMessage(err);
    console.error('[sticker]', message);
    await sock.sendMessage(
      jid,
      { text: `Erro ao criar a figurinha!\n\nDetalhes: ${message}` },
      { quoted: raw },
    );
  }
  return true;
}

async function handleToImage(
  sock: WASocket,
  raw: WAMessage,
  jid: string,
  media: MediaRef,
): Promise<boolean> {
  try {
    const buffer = await downloadMedia(sock, media);
    const image = await sharp(buffer).png().toBuffer();
    await sock.sendMessage(jid, { image }, { quoted: raw });
  } catch (err) {
    console.error('[toimg]', getErrorMessage(err));
    await sock.sendMessage(jid, { text: 'Erro ao converter a figurinha!' }, { quoted: raw });
  }
  return true;
}

function imageToWebp(buffer: Buffer, opts: StickerVariant['image']): Promise<Buffer> {
  const resizeOpts: ResizeOptions = { fit: opts.fit };
  if (opts.background) resizeOpts.background = opts.background;
  return sharp(buffer).resize(opts.width, opts.height, resizeOpts).webp().toBuffer();
}

function videoToWebp(videoBuffer: Buffer, videoFilter: string): Promise<Buffer> {
  const id = crypto.randomBytes(6).toString('hex');
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `bb_in_${id}.mp4`);
  const outputPath = path.join(tmpDir, `bb_out_${id}.webp`);

  fs.writeFileSync(inputPath, videoBuffer);

  return new Promise<Buffer>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vf',
        videoFilter,
        '-c:v',
        'libwebp',
        '-loop',
        '0',
        '-quality',
        '80',
        '-compression_level',
        '6',
        '-f',
        'webp',
      ])
      .output(outputPath)
      .on('end', () => {
        try {
          const result = fs.readFileSync(outputPath);
          cleanup(inputPath, outputPath);
          resolve(result);
        } catch (err) {
          cleanup(inputPath, outputPath);
          reject(err instanceof Error ? err : new Error(getErrorMessage(err)));
        }
      })
      .on('error', (err: Error) => {
        cleanup(inputPath, outputPath);
        reject(err);
      })
      .run();
  });
}

function cleanup(...files: string[]): void {
  for (const f of files) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* noop */
    }
  }
}

const stickerCommand: Command = {
  meta: {
    category: 'Figurinhas e mídia',
    entries: [
      {
        trigger: '!sticker',
        description: 'Cria figurinha a partir de imagem, vídeo ou GIF (envie junto ou responda)',
      },
      {
        trigger: '!fsticker',
        description: 'Mesma coisa, mas mantém a imagem inteira em fundo transparente',
      },
      { trigger: '!toimg', description: 'Converte uma figurinha respondida em imagem PNG' },
    ],
  },
  handle,
};

export default stickerCommand;
