import axios from 'axios';
import { areJidsSameUser, isJidGroup, isJidStatusBroadcast } from '@whiskeysockets/baileys';
import type { Contact, WAMessage, WASocket } from '@whiskeysockets/baileys';
import * as repo from '../database/repository.js';
import type { User, UserInput, UsersMap } from '../database/types.js';

export const USER_DEFAULTS: UserInput = {
  xp: 0,
  level: 1,
  prestige: 0,
  prestigeAvailable: 0,
  totalMessages: 0,
  lastMessageTime: null,
  badges: [],
  lastPrestigeLevel: 0,
  levelHistory: [],
  dailyBonusMultiplier: 0,
  dailyBonusExpiry: null,
  allowMentions: false,
  pushName: null,
  customName: null,
  customNameEnabled: false,
  jid: undefined,
  profilePicture: null,
  profilePictureUpdatedAt: null,
};

export type ContactsCache = Record<string, Contact>;

// --- User initialization ---

export interface EnsureUserOptions {
  pushName?: string | null;
  lidJid?: string | null;
}

function applyDefault<K extends keyof User>(user: User, key: K, value: User[K]): void {
  if (user[key] === undefined) user[key] = value;
}

/** Retorna `true` quando o usuário foi criado agora. */
export function ensureUser(
  usersData: UsersMap,
  userId: string,
  { pushName, lidJid }: EnsureUserOptions = {},
): boolean {
  const existing = usersData[userId];

  if (!existing) {
    usersData[userId] = {
      ...(USER_DEFAULTS as User),
      jid: lidJid?.endsWith('@lid') ? lidJid : userId,
      pushName: pushName || null,
    };
    return true;
  }

  for (const [key, val] of Object.entries(USER_DEFAULTS) as [keyof User, User[keyof User]][]) {
    applyDefault(existing, key, val);
  }

  if (lidJid?.endsWith('@lid') && existing.jid !== lidJid) existing.jid = lidJid;
  if (pushName && existing.pushName !== pushName) existing.pushName = pushName;

  return false;
}

// --- JID resolution ---

export function findUserKey(usersData: UsersMap, jid: string): string | null {
  if (usersData[jid]) return jid;

  for (const [key, user] of Object.entries(usersData)) {
    if (typeof key !== 'string' || !key.includes('@')) continue;
    if (user.jid === jid) return key;
  }

  const phone = jid.split('@')[0]?.split(':')[0];
  const waJid = `${phone}@s.whatsapp.net`;
  if (usersData[waJid]) return waJid;

  return null;
}

export function getSender(raw: WAMessage): string {
  const jid = raw.key.remoteJid;
  if (!jid) return '';
  if (!jid.endsWith('@g.us')) return jid;
  return raw.key.participantAlt || raw.key.participant || jid;
}

export function getLidJid(raw: WAMessage): string | null {
  const remoteJid = raw.key.remoteJid;
  if (!remoteJid) return null;
  if (remoteJid.endsWith('@g.us')) {
    return raw.key.participant?.endsWith('@lid') ? raw.key.participant : null;
  }
  return raw.key.remoteJidAlt || null;
}

export function isIgnoredChatJid(jid: string | null | undefined): boolean {
  return Boolean(jid && isJidStatusBroadcast(jid));
}

/** Grupo WhatsApp não é entidade de usuário na tabela users. */
export function isGroupUserId(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && Boolean(isJidGroup(userId));
}

/** Evita persistir o próprio bot (PN em creds.me.id ou LID em creds.me.lid). */
export function isBotUser(sock: WASocket, resolvedUserId: string | null | undefined): boolean {
  if (!resolvedUserId || !sock?.user) return false;
  const me = sock.user;
  if (resolvedUserId === me.id) return true;
  if (me.lid && resolvedUserId === me.lid) return true;
  return areJidsSameUser(resolvedUserId, me.id);
}

export async function resolveSender(raw: WAMessage): Promise<string | null> {
  return repo.resolveCanonicalUserId(raw.key);
}

export function getPushName(raw: WAMessage, contactsCache: ContactsCache = {}): string | null {
  const userId = getSender(raw);
  const contact = contactsCache[userId];
  return raw.pushName || contact?.notify || contact?.name || null;
}

// --- Target resolution (for commands like !info @user, !setlevel me) ---

export interface ResolvedTarget {
  userId: string | null;
  error: string | null;
}

export async function resolveTarget(
  raw: WAMessage,
  sender: string | null,
): Promise<ResolvedTarget> {
  const text = raw.message?.conversation || raw.message?.extendedTextMessage?.text || '';
  const parts = text.split(' ');

  if (parts.length < 2) return { userId: null, error: null };

  const target = parts[1];
  if (!target) return { userId: null, error: null };

  if (target.toLowerCase() === 'me') {
    return { userId: sender, error: null };
  }

  if (target.startsWith('@')) {
    const mentions = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    const first = mentions[0];
    if (!first) {
      return { userId: null, error: '❌ Usuário não encontrado na menção!' };
    }
    const userId = await repo.findUserIdByJid(first);
    if (!userId) {
      return {
        userId: null,
        error:
          '❌ Usuário não encontrado no banco. O usuário pode não ter interagido com o bot ainda.',
      };
    }
    return { userId, error: null };
  }

  return { userId: null, error: '❌ Use @usuario ou "me".' };
}

// --- Profile picture ---

const PROFILE_PIC_TTL_MS = 24 * 60 * 60 * 1000;

export type UsersWriter = (usersData: UsersMap) => Promise<void> | void;

export async function updateProfilePicture(
  sock: WASocket,
  userId: string,
  usersData: UsersMap,
  writeFn: UsersWriter,
): Promise<boolean> {
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

    user.profilePicture = await fetchImageAsBase64(url);
    user.profilePictureUpdatedAt = new Date().toISOString();
    await writeFn(usersData);
    return true;
  } catch {
    return false;
  }
}

export async function fetchProfilePicture(
  sock: WASocket,
  userId: string,
): Promise<string | null> {
  const url = await sock.profilePictureUrl(userId, 'image').catch(() => null);
  if (!url) return null;
  return fetchImageAsBase64(url);
}

export async function fetchImageAsBase64(url: string): Promise<string> {
  const { data, headers } = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 10000,
  });
  const contentType = headers['content-type'] || 'image/jpeg';
  return `data:${contentType};base64,${Buffer.from(data).toString('base64')}`;
}
