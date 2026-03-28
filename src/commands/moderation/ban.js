const repo = require('../../database/repository');
const config = require('../../config');
const users = require('../../services/users');

async function banCommand(sock, msg) {
  const { text, jid, raw } = msg;
  if (!text?.startsWith('!ban') || !jid.endsWith('@g.us')) return;

  const sender = await users.resolveSender(raw);
  if (!config.admins.includes(sender)) {
    await sock.sendMessage(jid, {
      text: '❌ Você não tem permissão para usar este comando. Somente administradores podem usar `!ban`.',
    });
    return true;
  }

  const rawMentioned = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const targetJid = rawMentioned ? ((await repo.findUserIdByJid(rawMentioned)) || rawMentioned) : null;

  if (!targetJid) {
    await sock.sendMessage(jid, { text: '❌ Você precisa marcar alguém para banir. Exemplo: `!ban @usuario`' });
    return true;
  }

  try {
    await sock.groupParticipantsUpdate(jid, [targetJid], 'remove');
    await sock.sendMessage(jid, { text: '✅ Usuário removido com sucesso.' });
  } catch (err) {
    const errMsg = (err?.message || String(err)).toLowerCase();
    if (errMsg.includes('admin') || errMsg.includes('permission') || errMsg.includes('401') || errMsg.includes('403')) {
      await sock.sendMessage(jid, { text: '⚠️ Eu preciso ser administrador do grupo para poder remover alguém.' });
    } else {
      await sock.sendMessage(jid, { text: `❌ Erro ao remover: ${err?.message || err}` });
    }
  }
  return true;
}

module.exports = banCommand;
