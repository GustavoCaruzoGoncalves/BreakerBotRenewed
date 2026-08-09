import * as repo from '../../database/repository.js';
import { config } from '../../config.js';
import * as users from '../../services/users.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { Command, CommandHandler } from '../../types/bot.js';

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (!text?.startsWith('!ban') || !jid.endsWith('@g.us')) return;

  const sender = await users.resolveSender(raw);
  if (!sender || !config.admins.includes(sender)) {
    await sock.sendMessage(jid, {
      text: '❌ Você não tem permissão para usar este comando. Somente administradores podem usar `!ban`.',
    });
    return true;
  }

  const rawMentioned = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  const targetJid = rawMentioned ? ((await repo.findUserIdByJid(rawMentioned)) ?? rawMentioned) : null;

  if (!targetJid) {
    await sock.sendMessage(jid, {
      text: '❌ Você precisa marcar alguém para banir. Exemplo: `!ban @usuario`',
    });
    return true;
  }

  try {
    await sock.groupParticipantsUpdate(jid, [targetJid], 'remove');
    await sock.sendMessage(jid, { text: '✅ Usuário removido com sucesso.' });
  } catch (err) {
    const message = getErrorMessage(err);
    const lowered = message.toLowerCase();
    if (
      lowered.includes('admin') ||
      lowered.includes('permission') ||
      lowered.includes('401') ||
      lowered.includes('403')
    ) {
      await sock.sendMessage(jid, {
        text: '⚠️ Eu preciso ser administrador do grupo para poder remover alguém.',
      });
    } else {
      await sock.sendMessage(jid, { text: `❌ Erro ao remover: ${message}` });
    }
  }
  return true;
};

const banCommand: Command = {
  meta: {
    category: 'Moderação',
    entries: [
      {
        trigger: '!ban',
        description: 'Remove alguém do grupo (o bot precisa ser admin)',
        admin: true,
        groupOnly: true,
        usages: [{ syntax: '!ban @usuario', description: 'Marque quem será removido' }],
      },
    ],
  },
  handle,
};

export default banCommand;
