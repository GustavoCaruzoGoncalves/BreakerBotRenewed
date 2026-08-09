import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import * as mentions from '../../lib/mentions.js';
import * as repo from '../../database/repository.js';
import { fetchImageAsBase64 } from '../../services/users.js';
import { projectPath } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { UsersMap } from '../../database/types.js';
import type { BotMessage, Command, CommandHandler, WASocket } from '../../types/bot.js';

const ASSETS = projectPath('assets');

// --- Filters ---

type GradientStop = [offset: string, color: string, opacity: number];

function gradientSVG(w: number, h: number, id: string, stops: GradientStop[]): Buffer {
  const stopTags = stops
    .map(
      ([offset, color, opacity]) =>
        `<stop offset="${offset}" style="stop-color:${color};stop-opacity:${opacity}" />`,
    )
    .join('');
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="${id}" x1="0%" y1="0%" x2="0%" y2="100%">${stopTags}</linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#${id})" />
  </svg>`);
}

type ImageFilter = (buf: Buffer) => Promise<Buffer>;

async function filterGrayscale(buf: Buffer): Promise<Buffer> {
  return sharp(buf).grayscale().jpeg().toBuffer();
}

async function filterLGBT(buf: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  const overlay = gradientSVG(width, height, 'rainbow', [
    ['0%', '#FF0000', 0.95],
    ['16.66%', '#FF8C00', 0.95],
    ['33.33%', '#FFD700', 0.95],
    ['50%', '#00FF00', 0.95],
    ['66.66%', '#0000FF', 0.95],
    ['83.33%', '#8B00FF', 0.95],
    ['100%', '#FF1493', 0.95],
  ]);
  return sharp(buf)
    .composite([{ input: overlay, blend: 'overlay' }])
    .modulate({ saturation: 1.8, brightness: 1.1 })
    .jpeg()
    .toBuffer();
}

async function filterBrazilWithLogo(
  buf: Buffer,
  logoFile: string,
  logoScale: number,
  logoYOffset = 0,
): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  const overlay = gradientSVG(width, height, 'brazil', [
    ['0%', '#009B3A', 0.9],
    ['50%', '#FFDF00', 0.9],
    ['100%', '#002776', 0.9],
  ]);
  const composites: OverlayOptions[] = [{ input: overlay, blend: 'overlay' }];

  const logoPath = path.join(ASSETS, logoFile);
  if (fs.existsSync(logoPath)) {
    const logoMeta = await sharp(logoPath).metadata();
    const ratio = (logoMeta.width ?? 1) / (logoMeta.height ?? 1);
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
    .jpeg()
    .toBuffer();
}

async function filterBolsonaro3(buf: Buffer): Promise<Buffer> {
  const framePath = path.join(ASSETS, 'logobolsonaro3.png');
  if (!fs.existsSync(framePath)) return sharp(buf).jpeg().toBuffer();

  const { width: fw = 0, height: fh = 0 } = await sharp(framePath).metadata();
  const photoSize = Math.floor(Math.min(fw, fh) * 0.625);
  const photo = await sharp(buf).resize(photoSize, photoSize, { fit: 'cover' }).toBuffer();
  const frame = await sharp(framePath).toBuffer();

  return sharp({
    create: { width: fw, height: fh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: photo, gravity: 'center', blend: 'over' },
      { input: frame, gravity: 'center', blend: 'over' },
    ])
    .jpeg()
    .toBuffer();
}

// --- Command config ---

interface PfpVariant {
  filter: ImageFilter | null;
  caption: (name: string) => string;
  /** Usado no `!menu`; fica aqui para não sair de sincronia com o comando. */
  description: string;
}

const PFP_FILTERS: Record<string, PfpVariant> = {
  '!pfp': {
    filter: null,
    caption: (n) => `📸 Foto de perfil de ${n}`,
    description: 'Mostra a foto de perfil, sem filtro',
  },
  '!pfpdead': {
    filter: filterGrayscale,
    caption: (n) => `🪦 ${n} ⚰️`,
    description: 'Foto de perfil em preto e branco',
  },
  '!pfpgay': {
    filter: filterLGBT,
    caption: (n) => `🌈 ${n} 🏳️‍🌈`,
    description: 'Foto de perfil com as cores do arco-íris',
  },
  '!pfpbolsonaro': {
    filter: (b) => filterBrazilWithLogo(b, 'logobolsonaro.png', 0.35),
    caption: (n) => `🇧🇷 ${n} 2026`,
    description: 'Foto de perfil com a bandeira e a logo do Bolsonaro',
  },
  '!pfpbolsonaro2': {
    filter: (b) => filterBrazilWithLogo(b, 'logobolsonaro2.png', 0.6, 0.1),
    caption: (n) => `🇧🇷 ${n} COM BOLSONARO`,
    description: 'Foto de perfil ao lado do Bolsonaro',
  },
  '!pfpbolsonaro3': {
    filter: filterBolsonaro3,
    caption: (n) => `🟢 ${n} DEUS, PÁTRIA, FAMÍLIA, LIBERDADE 🟡`,
    description: 'Foto de perfil com a moldura Deus, Pátria, Família e Liberdade',
  },
};

// --- Shared helpers ---

type PfpTarget =
  | { kind: 'user'; userId: string }
  | { kind: 'error'; error: string }
  | { kind: 'usage' };

async function resolveTarget(msg: BotMessage): Promise<PfpTarget> {
  const parts = msg.text.split(' ');
  const sender = msg.jid.endsWith('@g.us')
    ? msg.raw.key.participantAlt || msg.raw.key.participant || msg.jid
    : msg.jid;

  const arg = parts[1];
  if (!arg) return { kind: 'user', userId: sender };

  if (arg.toLowerCase() === 'me') return { kind: 'user', userId: sender };
  if (arg.startsWith('@')) {
    const jids = msg.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    const first = jids[0];
    if (first) {
      return { kind: 'user', userId: (await repo.findUserIdByJid(first)) ?? first };
    }
    return { kind: 'error', error: '❌ Usuário não encontrado na menção!' };
  }
  return { kind: 'usage' };
}

interface ProfileImage {
  buffer: Buffer;
  cached: boolean;
  updatedAt?: string | null;
}

async function fetchProfileImage(
  sock: WASocket,
  userId: string,
): Promise<ProfileImage | null> {
  const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);

  let userKey: string | null = null;
  if (usersData[userId]) userKey = userId;
  else {
    for (const [k, u] of Object.entries(usersData)) {
      if (u.jid === userId) {
        userKey = k;
        break;
      }
    }
  }

  const user = userKey ? usersData[userKey] : null;

  if (user?.profilePicture) {
    const base64Data = user.profilePicture.split(',')[1] ?? '';
    return {
      buffer: Buffer.from(base64Data, 'base64'),
      cached: true,
      updatedAt: user.profilePictureUpdatedAt,
    };
  }

  const url = await sock.profilePictureUrl(userId, 'image').catch(() => null);
  if (!url) return null;

  const base64Image = await fetchImageAsBase64(url);
  const base64Data = base64Image.split(',')[1] ?? '';
  const buffer = Buffer.from(base64Data, 'base64');

  if (userKey && user) {
    user.profilePicture = base64Image;
    user.profilePictureUpdatedAt = new Date().toISOString();
    await repo.saveAllUsers(usersData, { writeScope: 'preferences' }).catch(() => {});
  }

  return { buffer, cached: false };
}

// --- Main handler ---

const handle: CommandHandler = async (sock, msg) => {
  const { text, raw } = msg;
  if (!text || raw.key.fromMe) return;

  const lower = text.toLowerCase();
  const cmdKey = Object.keys(PFP_FILTERS)
    .sort((a, b) => b.length - a.length)
    .find((c) => lower === c || lower.startsWith(`${c} `));

  if (!cmdKey) return;
  const variant = PFP_FILTERS[cmdKey];
  if (!variant) return;
  const { filter, caption } = variant;

  const target = await resolveTarget(msg);
  if (target.kind === 'error') {
    await sock.sendMessage(msg.jid, { text: target.error }, { quoted: raw });
    return true;
  }
  if (target.kind === 'usage') {
    await sock.sendMessage(
      msg.jid,
      { text: `📝 *Uso:* ${cmdKey} @usuario ou ${cmdKey} me` },
      { quoted: raw },
    );
    return true;
  }

  try {
    const result = await fetchProfileImage(sock, target.userId);

    if (!result) {
      await sock.sendMessage(
        msg.jid,
        {
          text: '❌ Não foi possível obter a foto de perfil deste usuário.\nPode ser que a foto esteja privada ou o usuário não tenha foto.',
        },
        { quoted: raw },
      );
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

    await sock.sendMessage(
      msg.jid,
      { image: finalBuf, caption: cap, mentions: info.mentions },
      { quoted: raw },
    );
  } catch (err) {
    console.error(`Erro ${cmdKey}:`, err);
    await sock.sendMessage(
      msg.jid,
      { text: `❌ Erro ao processar imagem: ${getErrorMessage(err)}` },
      { quoted: raw },
    );
  }
  return true;
};

const pfpCommand: Command = {
  meta: {
    category: 'Zueiras',
    entries: Object.entries(PFP_FILTERS).map(([trigger, cfg]) => ({
      trigger,
      description: cfg.description,
      // Todas as variantes aceitam os mesmos alvos; só a base detalha para não poluir o menu.
      ...(trigger === '!pfp'
        ? {
            usages: [
              { syntax: '!pfp me', description: 'Usa a sua própria foto (padrão)' },
              { syntax: '!pfp @usuario', description: 'Usa a foto de quem você marcar' },
            ],
          }
        : {}),
    })),
  },
  handle,
};

export default pfpCommand;
