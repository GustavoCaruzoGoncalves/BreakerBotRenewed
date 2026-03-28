const repo = require('../database/repository');
const { findUserKey } = require('../services/users');

async function getMentionsEnabled() {
  const prefs = await repo.getMentionsPreferences().catch(() => ({ globalEnabled: false }));
  return prefs.globalEnabled || false;
}

async function setMentionsEnabled(enabled) {
  await repo.updateMentionsPreferences({ globalEnabled: enabled });
}

function resolveUser(usersData, jid) {
  const key = findUserKey(usersData, jid);
  return key ? usersData[key] : null;
}

async function getUserMentionPreference(jid) {
  const usersData = await repo.getAllUsers().catch(() => ({}));
  const user = resolveUser(usersData, jid);
  return user?.allowMentions === true;
}

async function setUserMentionPreference(jid, enabled) {
  const usersData = await repo.getAllUsers().catch(() => ({}));
  const key = findUserKey(usersData, jid) || jid;
  if (usersData[key]) {
    usersData[key].allowMentions = enabled;
  }
  await repo.saveAllUsers(usersData, { writeScope: 'preferences' });
}

async function setCustomName(jid, customName) {
  const usersData = await repo.getAllUsers().catch(() => ({}));
  const key = findUserKey(usersData, jid) || jid;
  if (usersData[key]) {
    usersData[key].customName = customName;
    usersData[key].customNameEnabled = true;
  }
  await repo.saveAllUsers(usersData, { writeScope: 'preferences' });
}

async function setCustomNameEnabled(jid, enabled) {
  const usersData = await repo.getAllUsers().catch(() => ({}));
  const key = findUserKey(usersData, jid) || jid;
  if (usersData[key]) {
    usersData[key].customNameEnabled = enabled;
  }
  await repo.saveAllUsers(usersData, { writeScope: 'preferences' });
}

async function getUserDisplayName(jid) {
  if (!jid) return { displayName: null, hasCustomName: false, hasPushName: false };
  const usersData = await repo.getAllUsers().catch(() => ({}));
  const user = resolveUser(usersData, jid);

  if (user?.customNameEnabled && user?.customName) {
    return { displayName: user.customName, hasCustomName: true, hasPushName: false };
  }
  if (user?.pushName) {
    return { displayName: user.pushName, hasCustomName: false, hasPushName: true };
  }
  return { displayName: null, hasCustomName: false, hasPushName: false };
}

async function getPushName(jid) {
  const info = await getUserDisplayName(jid);
  return info.displayName || jid.split('@')[0];
}

async function canMentionUser(jid) {
  const global = await getMentionsEnabled();
  if (!global) return false;
  return getUserMentionPreference(jid);
}

async function processSingleMention(jid) {
  const canMention = await canMentionUser(jid);
  const nameInfo = await getUserDisplayName(jid);
  const hasName = !!(nameInfo.displayName?.trim());
  const mentions = canMention ? [jid] : [];

  let mentionText;
  if (canMention) {
    mentionText = nameInfo.hasCustomName
      ? `@${jid.split('@')[0]} (${nameInfo.displayName})`
      : `@${jid.split('@')[0]}`;
  } else {
    mentionText = hasName ? nameInfo.displayName : 'O usuário mencionado';
  }

  return { canMention, mentionText, mentions, hasName, hasCustomName: nameInfo.hasCustomName };
}

async function getUsersData() {
  return repo.getAllUsers().catch(() => ({}));
}

module.exports = {
  getMentionsEnabled, setMentionsEnabled,
  getUserMentionPreference, setUserMentionPreference,
  setCustomName, setCustomNameEnabled,
  getUserDisplayName, getPushName,
  canMentionUser, processSingleMention, getUsersData,
};
