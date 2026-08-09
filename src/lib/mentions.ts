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

export async function getUserDisplayName(jid: string | null | undefined): Promise<DisplayNameInfo> {
  if (!jid) return { displayName: null, hasCustomName: false, hasPushName: false };
  const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);
  const user = resolveUser(usersData, jid);

  if (user?.customNameEnabled && user.customName) {
    return { displayName: user.customName, hasCustomName: true, hasPushName: false };
  }
  if (user?.pushName) {
    return { displayName: user.pushName, hasCustomName: false, hasPushName: true };
  }
  return { displayName: null, hasCustomName: false, hasPushName: false };
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

export async function processSingleMention(jid: string): Promise<MentionInfo> {
  const canMention = await canMentionUser(jid);
  const nameInfo = await getUserDisplayName(jid);
  const hasName = Boolean(nameInfo.displayName?.trim());
  const mentions = canMention ? [jid] : [];
  const handle = jid.split('@')[0] ?? jid;

  let mentionText: string;
  if (canMention) {
    mentionText = nameInfo.hasCustomName ? `@${handle} (${nameInfo.displayName})` : `@${handle}`;
  } else {
    mentionText = hasName && nameInfo.displayName ? nameInfo.displayName : 'O usuário mencionado';
  }

  return { canMention, mentionText, mentions, hasName, hasCustomName: nameInfo.hasCustomName };
}

export async function getUsersData(): Promise<UsersMap> {
  return repo.getAllUsers().catch(() => ({}) as UsersMap);
}
