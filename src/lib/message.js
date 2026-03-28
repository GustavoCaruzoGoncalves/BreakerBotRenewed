const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const MEDIA_TYPES = new Set(['imageMessage', 'videoMessage', 'stickerMessage']);

function parse(msg) {
  if (!msg?.message || !msg.key?.remoteJid) return null;

  const jid = msg.key.remoteJid;
  const type = Object.keys(msg.message)[0];
  const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

  const text =
    msg.message.conversation ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    msg.message.extendedTextMessage?.text ||
    '';

  const media = resolveMedia(type, msg.message, quoted);

  return { jid, type, text, media, quoted, raw: msg };
}

function resolveMedia(type, message, quoted) {
  if (MEDIA_TYPES.has(type)) {
    return { type, content: message[type] };
  }

  if (quoted) {
    for (const mediaType of MEDIA_TYPES) {
      if (quoted[mediaType]) {
        return { type: mediaType, content: quoted[mediaType] };
      }
    }
  }

  return null;
}

async function downloadMedia(media) {
  return downloadMediaMessage(
    { message: { [media.type]: media.content } },
    'buffer',
  );
}

module.exports = { parse, downloadMedia };
