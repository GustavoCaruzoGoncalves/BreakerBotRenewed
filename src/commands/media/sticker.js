const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { downloadMedia } = require('../../lib/message');

ffmpeg.setFfmpegPath(ffmpegPath);

const VARIANTS = {
  '!sticker': {
    image: { width: 512, height: 512, fit: 'inside' },
    videoFilter: 'scale=512:512:force_original_aspect_ratio=decrease',
  },
  '!fsticker': {
    image: { width: 512, height: 512, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } },
    videoFilter: 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
  },
};

const VARIANT_PREFIXES = Object.keys(VARIANTS);

async function stickerCommand(sock, msg) {
  const { text, jid, media, type, raw } = msg;

  const cmd = VARIANT_PREFIXES.find(p => text.startsWith(p));

  if (cmd) return handleSticker(sock, raw, jid, media, cmd);

  if (text.startsWith('!toimg') && media?.type === 'stickerMessage' && type !== 'stickerMessage') {
    return handleToImage(sock, raw, jid, media);
  }
}

async function handleSticker(sock, raw, jid, media, cmd) {
  if (!media || (media.type !== 'imageMessage' && media.type !== 'videoMessage')) {
    await sock.sendMessage(jid, {
      text: 'Envie ou responda a uma imagem, vídeo ou GIF com `!sticker` ou `!fsticker`!',
    }, { quoted: raw });
    return true;
  }

  try {
    const buffer = await downloadMedia(media);
    if (!buffer) throw new Error('Falha ao baixar mídia');

    const variant = VARIANTS[cmd];
    const sticker = media.type === 'videoMessage'
      ? await videoToWebp(buffer, variant.videoFilter)
      : await imageToWebp(buffer, variant.image);

    await sock.sendMessage(jid, { sticker }, { quoted: raw });
  } catch (err) {
    console.error('[sticker]', err.message);
    await sock.sendMessage(jid, {
      text: `Erro ao criar a figurinha!\n\nDetalhes: ${err.message}`,
    }, { quoted: raw });
  }
  return true;
}

async function handleToImage(sock, raw, jid, media) {
  try {
    const buffer = await downloadMedia(media);
    const image = await sharp(buffer).png().toBuffer();
    await sock.sendMessage(jid, { image }, { quoted: raw });
  } catch (err) {
    console.error('[toimg]', err.message);
    await sock.sendMessage(jid, { text: 'Erro ao converter a figurinha!' }, { quoted: raw });
  }
  return true;
}

function imageToWebp(buffer, opts) {
  const resizeOpts = { fit: opts.fit };
  if (opts.background) resizeOpts.background = opts.background;
  return sharp(buffer)
    .resize(opts.width, opts.height, resizeOpts)
    .webp()
    .toBuffer();
}

function videoToWebp(videoBuffer, videoFilter) {
  const id = crypto.randomBytes(6).toString('hex');
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `bb_in_${id}.mp4`);
  const outputPath = path.join(tmpDir, `bb_out_${id}.webp`);

  fs.writeFileSync(inputPath, videoBuffer);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vf', videoFilter,
        '-c:v', 'libwebp',
        '-loop', '0',
        '-quality', '80',
        '-compression_level', '6',
        '-f', 'webp',
      ])
      .output(outputPath)
      .on('end', () => {
        try {
          const result = fs.readFileSync(outputPath);
          cleanup(inputPath, outputPath);
          resolve(result);
        } catch (err) {
          cleanup(inputPath, outputPath);
          reject(err);
        }
      })
      .on('error', (err) => {
        cleanup(inputPath, outputPath);
        reject(err);
      })
      .run();
  });
}

function cleanup(...files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* noop */ }
  }
}

module.exports = stickerCommand;
