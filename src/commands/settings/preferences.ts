import { config } from '../../config.js';
import * as mentions from '../../lib/mentions.js';
import type { Command, CommandHandler } from '../../types/bot.js';

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (!text || raw.key.fromMe) return;

  const sender = jid.endsWith('@g.us')
    ? raw.key.participantAlt || raw.key.participant || jid
    : jid;
  const isAdmin = config.admins.includes(sender);

  if (text.startsWith('!marcacoes')) {
    const arg = text.slice(11).trim().toLowerCase();

    if (arg === 'on' || arg === 'off') {
      if (!isAdmin) {
        await sock.sendMessage(
          jid,
          { text: '❌ Apenas administradores podem alterar marcações globais.' },
          { quoted: raw },
        );
        return true;
      }
      await mentions.setMentionsEnabled(arg === 'on');
      const icon = arg === 'on' ? '✅' : '❌';
      const label = arg === 'on' ? 'ativadas' : 'desativadas';
      await sock.sendMessage(jid, { text: `${icon} Marcações ${label}!` }, { quoted: raw });
    } else {
      const status = (await mentions.getMentionsEnabled()) ? 'ativadas' : 'desativadas';
      await sock.sendMessage(
        jid,
        { text: `📋 Status das marcações: ${status}\n\nUse !marcacoes on/off para alterar.` },
        { quoted: raw },
      );
    }
    return true;
  }

  if (text.toLowerCase().startsWith('!marcarme')) {
    const arg = text.slice(9).trim().toLowerCase();
    const userJid = raw.key.participantAlt || raw.key.participant || sender;

    if (arg === 'on' || arg === 'off') {
      await mentions.setUserMentionPreference(userJid, arg === 'on');
      const globalStatus = (await mentions.getMentionsEnabled()) ? 'ativadas' : 'desativadas';
      const icon = arg === 'on' ? '✅' : '❌';
      const label = arg === 'on' ? 'ativadas' : 'desativadas';
      await sock.sendMessage(
        jid,
        {
          text: `${icon} Suas marcações foram ${label}!\n\nNota: Marcações globais estão ${globalStatus}.`,
        },
        { quoted: raw },
      );
    } else {
      const userPref = (await mentions.getUserMentionPreference(userJid))
        ? 'ativadas'
        : 'desativadas';
      const globalStatus = (await mentions.getMentionsEnabled()) ? 'ativadas' : 'desativadas';
      await sock.sendMessage(
        jid,
        {
          text: `📋 Suas marcações: ${userPref}\n📋 Marcações globais: ${globalStatus}\n\nUse !marcarMe on/off para alterar.`,
        },
        { quoted: raw },
      );
    }
    return true;
  }

  if (text.startsWith('!setCustomName')) {
    const args = text.slice(15).trim();
    const userJid = raw.key.participantAlt || raw.key.participant || sender;

    if (!args) {
      await sock.sendMessage(
        jid,
        { text: '📝 *Uso:* !setCustomName "nome"\n\n*Exemplo:* !setCustomName "João Silva"' },
        { quoted: raw },
      );
      return true;
    }

    const match = args.match(/^["'](.+?)["']$/);
    const captured = match?.[1];
    if (!captured) {
      await sock.sendMessage(
        jid,
        { text: '❌ O nome deve estar entre aspas!\n\n*Exemplo:* !setCustomName "João Silva"' },
        { quoted: raw },
      );
      return true;
    }

    const name = captured.trim();
    if (!name) {
      await sock.sendMessage(jid, { text: '❌ O nome não pode estar vazio!' }, { quoted: raw });
      return true;
    }
    if (name.length > 50) {
      await sock.sendMessage(
        jid,
        { text: '❌ O nome não pode ter mais de 50 caracteres!' },
        { quoted: raw },
      );
      return true;
    }

    await mentions.setCustomName(userJid, name);
    await sock.sendMessage(
      jid,
      {
        text: `✅ Nome personalizado definido como: "${name}"\n\nUse !customName on/off para ativar/desativar.`,
      },
      { quoted: raw },
    );
    return true;
  }

  if (text.startsWith('!customName')) {
    const arg = text.slice(12).trim().toLowerCase();
    const userJid = raw.key.participantAlt || raw.key.participant || sender;

    if (arg === 'on' || arg === 'off') {
      await mentions.setCustomNameEnabled(userJid, arg === 'on');
      const icon = arg === 'on' ? '✅' : '❌';
      const label = arg === 'on' ? 'ativado' : 'desativado';
      await sock.sendMessage(
        jid,
        { text: `${icon} Nome personalizado ${label}!` },
        { quoted: raw },
      );
    } else {
      const usersData = await mentions.getUsersData();
      const user = usersData[userJid];
      const status = user?.customNameEnabled ? 'ativado' : 'desativado';
      const name = user?.customName || null;
      let text2 = `📋 Status do nome personalizado: ${status}`;
      text2 += name
        ? `\n📝 Nome atual: "${name}"`
        : '\n📝 Nenhum nome definido. Use !setCustomName "nome".';
      text2 += '\n\nUse !customName on/off para alterar.';
      await sock.sendMessage(jid, { text: text2 }, { quoted: raw });
    }
    return true;
  }
};

const preferencesCommand: Command = {
  meta: {
    category: 'Preferências',
    entries: [
      {
        trigger: '!marcacoes',
        description: 'Consulta se o bot marca as pessoas nas respostas',
        usages: [{ syntax: '!marcacoes on|off', description: 'Liga ou desliga *(admins)*' }],
      },
      {
        trigger: '!marcarme',
        description: 'Escolhe se você quer ser marcado',
        usages: [{ syntax: '!marcarme on|off', description: 'Vale só para você' }],
      },
      {
        trigger: '!setCustomName',
        description: 'Define o nome pelo qual o bot vai te chamar',
        usages: [{ syntax: '!setCustomName <nome>', description: 'Sem argumento, remove o nome' }],
      },
      { trigger: '!customName', description: 'Mostra o seu nome personalizado atual' },
    ],
  },
  handle,
};

export default preferencesCommand;
