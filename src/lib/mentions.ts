import * as repo from '../database/repository.js';
import { findUserKey } from '../services/users.js';
import type { User, UsersMap } from '../database/types.js';

export async function getMentionsEnabled(): Promise<boolean> {
  const prefs = await repo.getMentionsPreferences().catch(() => ({ globalEnabled: false }));
  return prefs.globalEnabled || false;
}

export async function setMentionsEnabled(enabled: boolean): Promise<void> {
  await repo.updateMentionsPreferences({ globalEnabled: enabled });
}

function resolveUser(usersData: UsersMap, jid: string): User | null {
  const key = findUserKey(usersData, jid);
  return key ? (usersData[key] ?? null) : null;
}

export async function getUserMentionPreference(jid: string): Promise<boolean> {
  const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);
  return resolveUser(usersData, jid)?.allowMentions === true;
}

export async function setUserMentionPreference(jid: string, enabled: boolean): Promise<void> {
  const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);
  const key = findUserKey(usersData, jid) || jid;
  const user = usersData[key];
  if (user) user.allowMentions = enabled;
  await repo.saveAllUsers(usersData, { writeScope: 'preferences' });
}

export async function setCustomName(jid: string, customName: string): Promise<void> {
  const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);
  const key = findUserKey(usersData, jid) || jid;
  const user = usersData[key];
  if (user) {
    user.customName = customName;
    user.customNameEnabled = true;
  }
  await repo.saveAllUsers(usersData, { writeScope: 'preferences' });
}

export async function setCustomNameEnabled(jid: string, enabled: boolean): Promise<void> {
  const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);
  const key = findUserKey(usersData, jid) || jid;
  const user = usersData[key];
  if (user) user.customNameEnabled = enabled;
  await repo.saveAllUsers(usersData, { writeScope: 'preferences' });
}

export interface DisplayNameInfo {
  displayName: string | null;
  hasCustomName: boolean;
  hasPushName: boolean;
}

function displayNameOf(user: User | null): DisplayNameInfo {
  if (user?.customNameEnabled && user.customName) {
    return { displayName: user.customName, hasCustomName: true, hasPushName: false };
  }
  if (user?.pushName) {
    return { displayName: user.pushName, hasCustomName: false, hasPushName: true };
  }
  return { displayName: null, hasCustomName: false, hasPushName: false };
}

export async function getUserDisplayName(jid: string | null | undefined): Promise<DisplayNameInfo> {
  if (!jid) return { displayName: null, hasCustomName: false, hasPushName: false };
  const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);
  return displayNameOf(resolveUser(usersData, jid));
}

export async function getPushName(jid: string): Promise<string> {
  const info = await getUserDisplayName(jid);
  return info.displayName || (jid.split('@')[0] ?? jid);
}

export async function canMentionUser(jid: string): Promise<boolean> {
  if (!(await getMentionsEnabled())) return false;
  return getUserMentionPreference(jid);
}

export interface MentionInfo {
  canMention: boolean;
  mentionText: string;
  mentions: string[];
  hasName: boolean;
  hasCustomName: boolean;
}

function buildMentionInfo(
  globalEnabled: boolean,
  key: string,
  user: User | null,
): MentionInfo {
  const nameInfo = displayNameOf(user);
  const canMention = globalEnabled && user?.allowMentions === true;
  const hasName = Boolean(nameInfo.displayName?.trim());
  const handle = key.split('@')[0] ?? key;

  let mentionText: string;
  if (canMention) {
    mentionText = nameInfo.hasCustomName ? `@${handle} (${nameInfo.displayName})` : `@${handle}`;
  } else {
    mentionText = hasName && nameInfo.displayName ? nameInfo.displayName : 'O usuário mencionado';
  }

  return {
    canMention,
    mentionText,
    mentions: canMention ? [key] : [],
    hasName,
    hasCustomName: nameInfo.hasCustomName,
  };
}

async function loadUserForMention(
  jid: string,
  usersData: UsersMap,
): Promise<{ key: string; user: User | null }> {
  const cachedKey = findUserKey(usersData, jid);
  if (cachedKey && usersData[cachedKey]) {
    return { key: cachedKey, user: usersData[cachedKey] };
  }

  const canonical = (await repo.resolveMentionJid(jid)) ?? cachedKey ?? jid;
  const user = usersData[canonical] ?? (await repo.getUserById(canonical));
  return { key: canonical, user: user ?? null };
}

export async function processSingleMention(jid: string): Promise<MentionInfo> {
  const [usersData, globalEnabled] = await Promise.all([getUsersData(), getMentionsEnabled()]);
  const { key, user } = await loadUserForMention(jid, usersData);
  return buildMentionInfo(globalEnabled, key, user);
}

export async function getUsersData(): Promise<UsersMap> {
  return repo.getAllUsers().catch(() => ({}) as UsersMap);
}

function handleOf(jid: string | null | undefined): string | null {
  const handle = jid?.split('@')[0]?.split(':')[0];
  return handle || null;
}

/** Índice `handle -> usuário` para reconhecer os `@numero` já escritos no texto. */
function indexByHandle(usersData: UsersMap): Map<string, User> {
  const index = new Map<string, User>();
  for (const [key, user] of Object.entries(usersData)) {
    for (const candidate of [key, user.jid]) {
      const handle = handleOf(candidate);
      if (handle && !index.has(handle)) index.set(handle, user);
    }
  }
  return index;
}

export interface RenderedMessage {
  text: string;
  mentions: string[];
}

export interface MentionRenderer {
  /**
   * `pingJids` são os candidatos a marcação; quem não permite menções sai da
   * lista e vira texto simples.
   */
  render(text: string, pingJids?: readonly string[]): RenderedMessage;
}

/**
 * Carrega as preferências uma única vez e devolve um renderizador síncrono, para
 * que uma resposta com várias mensagens não releia a tabela de usuários a cada uma.
 */
export async function createMentionRenderer(): Promise<MentionRenderer> {
  const [usersData, globalEnabled] = await Promise.all([getUsersData(), getMentionsEnabled()]);
  const byHandle = indexByHandle(usersData);

  return {
    render(text, pingJids = []) {
      const mentions = [...new Set(pingJids.map((jid) => findUserKey(usersData, jid) || jid))].filter(
        (jid) => globalEnabled && resolveUser(usersData, jid)?.allowMentions === true,
      );

      if (!text.includes('@')) return { text, mentions };

      const rendered = text.replace(/@(\d+)/g, (tag, handle: string) => {
        const user = byHandle.get(handle);
        if (!user) return tag;

        const nameInfo = displayNameOf(user);
        if (globalEnabled && user.allowMentions) {
          return nameInfo.hasCustomName ? `${tag} (${nameInfo.displayName})` : tag;
        }
        // Sem nome conhecido o `@numero` fica como está: já não marca ninguém,
        // porque o JID não entra em `mentions`.
        return nameInfo.displayName?.trim() || tag;
      });

      return { text: rendered, mentions };
    },
  };
}

export async function applyMentionRules(
  text: string,
  pingJids: readonly string[] = [],
): Promise<RenderedMessage> {
  const renderer = await createMentionRenderer();
  return renderer.render(text, pingJids);
}
