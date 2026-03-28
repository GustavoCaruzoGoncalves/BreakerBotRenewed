const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mentions = require('../../lib/mentions');
const repo = require('../../database/repository');
const { fetchImageAsBase64 } = require('../../services/users');

const ASSETS = path.resolve(__dirname, '..', '..', '..', 'assets');

// --- Filters ---

function gradientSVG(w, h, id, stops) {
  const stopTags = stops.map(([offset, color, opacity]) =>
    `<stop offset="${offset}" style="stop-color:${color};stop-opacity:${opacity}" />`
  ).join('');
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="${id}" x1="0%" y1="0%" x2="0%" y2="100%">${stopTags}</linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#${id})" />
  </svg>`);
}

async function filterGrayscale(buf) {
  return sharp(buf).grayscale().jpeg().toBuffer();
}

async function filterLGBT(buf) {
  const { width, height } = await sharp(buf).metadata();
  const overlay = gradientSVG(width, height, 'rainbow', [
    ['0%', '#FF0000', 0.95], ['16.66%', '#FF8C00', 0.95], ['33.33%', '#FFD700', 0.95],
    ['50%', '#00FF00', 0.95], ['66.66%', '#0000FF', 0.95], ['83.33%', '#8B00FF', 0.95],
    ['100%', '#FF1493', 0.95],
  ]);
  return sharp(buf)
    .composite([{ input: overlay, blend: 'overlay' }])
    .modulate({ saturation: 1.8, brightness: 1.1 })
    .jpeg().toBuffer();
}

async function filterBrazilWithLogo(buf, logoFile, logoScale, logoYOffset = 0) {
  const { width, height } = await sharp(buf).metadata();
  const overlay = gradientSVG(width, height, 'brazil', [
    ['0%', '#009B3A', 0.9], ['50%', '#FFDF00', 0.9], ['100%', '#002776', 0.9],
  ]);
  const composites = [{ input: overlay, blend: 'overlay' }];

  const logoPath = path.join(ASSETS, logoFile);
  if (fs.existsSync(logoPath)) {
    const logoMeta = await sharp(logoPath).metadata();
    const ratio = logoMeta.width / logoMeta.height;
    const logoH = Math.min(Math.floor(height * logoScale), height);
    const logoW = Math.floor(logoH * ratio);
    const logoBuf = await sharp(logoPath).resize(logoW, logoH, { fit: 'contain' }).toBuffer();
    composites.push({
      input: logoBuf,
      top: Math.max(0, height - logoH + Math.floor(height * logoYOffset)),
      left: Math.floor((width - logoW) / 2),
      blend: 'over',
    });
  }

  return sharp(buf)
    .composite(composites)
    .modulate({ saturation: 1.4, brightness: 1.05 })
    .jpeg().toBuffer();
}

async function filterBolsonaro3(buf) {
  const framePath = path.join(ASSETS, 'logobolsonaro3.png');
  if (!fs.existsSync(framePath)) return sharp(buf).jpeg().toBuffer();

  const { width: fw, height: fh } = await sharp(framePath).metadata();
  const photoSize = Math.floor(Math.min(fw, fh) * 0.625);
  const photo = await sharp(buf).resize(photoSize, photoSize, { fit: 'cover' }).toBuffer();
  const frame = await sharp(framePath).toBuffer();

  return sharp({ create: { width: fw, height: fh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: photo, gravity: 'center', blend: 'over' },
      { input: frame, gravity: 'center', blend: 'over' },
    ])
    .jpeg().toBuffer();
}

// --- Command config ---

const PFP_FILTERS = {
  '!pfp':           { filter: null, caption: n => `📸 Foto de perfil de ${n}` },
  '!pfpdead':       { filter: filterGrayscale, caption: n => `🪦 ${n} ⚰️` },
  '!pfpgay':        { filter: filterLGBT, caption: n => `🌈 ${n} 🏳️‍🌈` },
  '!pfpbolsonaro':  { filter: b => filterBrazilWithLogo(b, 'logobolsonaro.png', 0.35), caption: n => `🇧🇷 ${n} 2026` },
  '!pfpbolsonaro2': { filter: b => filterBrazilWithLogo(b, 'logobolsonaro2.png', 0.6, 0.1), caption: n => `🇧🇷 ${n} COM BOLSONARO` },
  '!pfpbolsonaro3': { filter: filterBolsonaro3, caption: n => `🟢 ${n} DEUS, PÁTRIA, FAMÍLIA, LIBERDADE 🟡` },
};

// --- Shared helpers ---

async function resolveTarget(msg) {
  const parts = msg.text.split(' ');
  const sender = msg.jid.endsWith('@g.us')
    ? (msg.raw.key.participantAlt || msg.raw.key.participant || msg.jid)
    : msg.jid;

  if (parts.length < 2) return { userId: sender };

  const arg = parts[1];
  if (arg.toLowerCase() === 'me') return { userId: sender };
  if (arg.startsWith('@')) {
    const jids = msg.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (jids.length > 0) {
      const userId = (await repo.findUserIdByJid(jids[0])) || jids[0];
      return { userId };
    }
    return { error: '❌ Usuário não encontrado na menção!' };
  }
  return { usage: true };
}

async function fetchProfileImage(sock, userId) {
  const usersData = await repo.getAllUsers().catch(() => ({}));

  let userKey = null;
  if (usersData[userId]) userKey = userId;
  else {
    for (const [k, u] of Object.entries(usersData)) {
      if (u.jid === userId) { userKey = k; break; }
    }
  }

  const user = userKey ? usersData[userKey] : null;

  if (user?.profilePicture) {
    const base64Data = user.profilePicture.split(',')[1];
    return { buffer: Buffer.from(base64Data, 'base64'), cached: true, updatedAt: user.profilePictureUpdatedAt };
  }

  const url = await sock.profilePictureUrl(userId, 'image').catch(() => null);
  if (!url) return null;

  const base64Image = await fetchImageAsBase64(url);
  const base64Data = base64Image.split(',')[1];
  const buffer = Buffer.from(base64Data, 'base64');

  if (userKey) {
    usersData[userKey].profilePicture = base64Image;
    usersData[userKey].profilePictureUpdatedAt = new Date().toISOString();
    await repo.saveAllUsers(usersData, { writeScope: 'preferences' }).catch(() => {});
  }

  return { buffer, cached: false };
}

// --- Main handler ---

async function pfpCommand(sock, msg) {
  const { text, raw } = msg;
  if (!text || raw.key.fromMe) return;

  const lower = text.toLowerCase();
  const cmdKey = Object.keys(PFP_FILTERS)
    .sort((a, b) => b.length - a.length)
    .find(c => lower === c || lower.startsWith(c + ' '));

  if (!cmdKey) return;
  const { filter, caption } = PFP_FILTERS[cmdKey];

  const target = await resolveTarget(msg);
  if (target.error) {
    await sock.sendMessage(msg.jid, { text: target.error }, { quoted: raw });
    return true;
  }
  if (target.usage) {
    await sock.sendMessage(msg.jid, {
      text: `📝 *Uso:* ${cmdKey} @usuario ou ${cmdKey} me`,
    }, { quoted: raw });
    return true;
  }

  try {
    const result = await fetchProfileImage(sock, target.userId);

    if (!result) {
      await sock.sendMessage(msg.jid, {
        text: '❌ Não foi possível obter a foto de perfil deste usuário.\nPode ser que a foto esteja privada ou o usuário não tenha foto.',
      }, { quoted: raw });
      return true;
    }

    const finalBuf = filter ? await filter(result.buffer) : result.buffer;
    const info = await mentions.processSingleMention(target.userId);

    let cap = caption(info.mentionText);
    if (!filter && result.cached) {
      cap += `\n\n✅ Carregada do cache\n🕐 Última atualização: ${result.updatedAt ? new Date(result.updatedAt).toLocaleString('pt-BR') : 'N/A'}`;
    } else if (!filter) {
      cap += '\n\n🔄 Buscada do WhatsApp';
    }

    await sock.sendMessage(msg.jid, { image: finalBuf, caption: cap, mentions: info.mentions }, { quoted: raw });
  } catch (err) {
    console.error(`Erro ${cmdKey}:`, err);
    await sock.sendMessage(msg.jid, { text: `❌ Erro ao processar imagem: ${err.message}` }, { quoted: raw });
  }
  return true;
}

module.exports = pfpCommand;
