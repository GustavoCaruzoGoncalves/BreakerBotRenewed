const axios = require('axios');
const { areJidsSameUser, isJidStatusBroadcast } = require('@whiskeysockets/baileys');
const repo = require('../database/repository');

const USER_DEFAULTS = {
  xp: 0, level: 1, prestige: 0, prestigeAvailable: 0,
  totalMessages: 0, lastMessageTime: null, badges: [],
  lastPrestigeLevel: 0, levelHistory: [],
  dailyBonusMultiplier: 0, dailyBonusExpiry: null,
  allowMentions: false, pushName: null,
  customName: null, customNameEnabled: false,
  jid: null, profilePicture: null, profilePictureUpdatedAt: null,
};

// --- User initialization ---

function ensureUser(usersData, userId, { pushName, lidJid } = {}) {
  if (!usersData[userId]) {
    usersData[userId] = {
      ...USER_DEFAULTS,
      jid: lidJid?.endsWith('@lid') ? lidJid : userId,
      pushName: pushName || null,
    };
    return true;
  }

  const user = usersData[userId];

  for (const [key, val] of Object.entries(USER_DEFAULTS)) {
    if (user[key] === undefined) user[key] = val;
  }

  if (lidJid?.endsWith('@lid') && user.jid !== lidJid) user.jid = lidJid;
  if (pushName && user.pushName !== pushName) user.pushName = pushName;

  return false;
}

// --- JID resolution ---

function findUserKey(usersData, jid) {
  if (usersData[jid]) return jid;

  for (const [key, user] of Object.entries(usersData)) {
    if (typeof key !== 'string' || !key.includes('@')) continue;
    if (user.jid === jid) return key;
  }

  const phone = jid.split('@')[0].split(':')[0];
  const waJid = `${phone}@s.whatsapp.net`;
  if (usersData[waJid]) return waJid;

  return null;
}

function getSender(raw) {
  const jid = raw.key.remoteJid;
  if (!jid.endsWith('@g.us')) return jid;
  return raw.key.participantAlt || raw.key.participant || jid;
}

function getLidJid(raw) {
  const isGroup = raw.key.remoteJid.endsWith('@g.us');
  if (isGroup) {
    return raw.key.participant?.endsWith('@lid') ? raw.key.participant : null;
  }
  return raw.key.remoteJidAlt || null;
}

function isIgnoredChatJid(jid) {
  return isJidStatusBroadcast(jid);
}

/** Evita persistir o próprio bot (PN em creds.me.id ou LID em creds.me.lid). */
function isBotUser(sock, resolvedUserId) {
  if (!resolvedUserId || !sock?.user) return false;
  const me = sock.user;
  if (resolvedUserId === me.id) return true;
  if (me.lid && resolvedUserId === me.lid) return true;
  return areJidsSameUser(resolvedUserId, me.id);
}

async function resolveSender(raw) {
  return repo.resolveCanonicalUserId(raw.key);
}

function getPushName(raw, contactsCache = {}) {
  const userId = getSender(raw);
  return raw.pushName
    || contactsCache[userId]?.notify
    || contactsCache[userId]?.name
    || null;
}

// --- Target resolution (for commands like !info @user, !setlevel me) ---

async function resolveTarget(raw, sender) {
  const text = raw.message?.conversation
    || raw.message?.extendedTextMessage?.text
    || '';
  const parts = text.split(' ');

  if (parts.length < 2) return { userId: null, error: null };

  const target = parts[1];

  if (target.toLowerCase() === 'me') {
    return { userId: sender, error: null };
  }

  if (target.startsWith('@')) {
    const mentions = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentions.length === 0) {
      return { userId: null, error: '❌ Usuário não encontrado na menção!' };
    }
    const userId = await repo.findUserIdByJid(mentions[0]);
    if (!userId) {
      return { userId: null, error: '❌ Usuário não encontrado no banco. O usuário pode não ter interagido com o bot ainda.' };
    }
    return { userId, error: null };
  }

  return { userId: null, error: '❌ Use @usuario ou "me".' };
}

// --- Profile picture ---

const PROFILE_PIC_TTL_MS = 24 * 60 * 60 * 1000;

async function updateProfilePicture(sock, userId, usersData, writeFn) {
  try {
    const user = usersData[userId];
    if (!user) return false;

    const lastUpdate = user.profilePictureUpdatedAt ? new Date(user.profilePictureUpdatedAt) : null;
    const age = lastUpdate ? Date.now() - lastUpdate.getTime() : Infinity;
    if (user.profilePicture && age < PROFILE_PIC_TTL_MS) return false;

    const url = await sock.profilePictureUrl(userId, 'image').catch(() => null);

    if (!url) {
      if (user.profilePicture !== null) {
        user.profilePicture = null;
        user.profilePictureUpdatedAt = new Date().toISOString();
        await writeFn(usersData);
      }
      return false;
    }

    const base64 = await fetchImageAsBase64(url);
    user.profilePicture = base64;
    user.profilePictureUpdatedAt = new Date().toISOString();
    await writeFn(usersData);
    return true;
  } catch {
    return false;
  }
}

async function fetchProfilePicture(sock, userId) {
  const url = await sock.profilePictureUrl(userId, 'image').catch(() => null);
  if (!url) return null;
  return fetchImageAsBase64(url);
}

async function fetchImageAsBase64(url) {
  const { data, headers } = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
  const contentType = headers['content-type'] || 'image/jpeg';
  return `data:${contentType};base64,${Buffer.from(data).toString('base64')}`;
}

module.exports = {
  USER_DEFAULTS,
  ensureUser,
  findUserKey,
  getSender,
  getLidJid,
  isIgnoredChatJid,
  isBotUser,
  resolveSender,
  getPushName,
  resolveTarget,
  updateProfilePicture,
  fetchProfilePicture,
  fetchImageAsBase64,
};
