const config = require('../../config');
const repo = require('../../database/repository');
const mentions = require('../../lib/mentions');
const users = require('../../services/users');
const level = require('../../services/level');

// --- Shared user info formatter ---

function formatUserInfo(info, mentionText, isAdmin, showDailyDetails = false) {
  let t = `👤 *Informações de ${mentionText}*\n`;
  if (isAdmin) t += '👑 ADMINISTRADOR⭐😎\n';
  t += `📊 Nível: ${info.level}\n`;
  t += `⭐ XP: ${info.xp}\n`;
  t += `🏆 Prestígio: ${info.prestige}\n`;
  t += `💎 Prestígios disponíveis: ${info.prestigeAvailable}\n`;
  t += `🌟 Elo: ${info.rank.name}\n`;
  t += `📈 Progresso: ${info.progressXP}/${info.nextLevelXP} XP\n`;
  t += `🎯 XP necessário: ${info.neededXP}\n`;
  t += `⚡ Multiplicador: ${info.totalMultiplier}x`;

  if (showDailyDetails && info.dailyBonusMultiplier > 0) {
    const hoursLeft = Math.ceil((new Date(info.dailyBonusExpiry) - new Date()) / 3600000);
    t += ` (${info.prestigeMultiplier}x prestígio + ${info.dailyBonusMultiplier}x bônus)\n`;
    t += `🌅 Bônus diário ativo por mais ${hoursLeft}h`;
  } else {
    t += ` (${info.prestigeMultiplier}x prestígio)\n`;
  }

  t += `\n💬 Mensagens: ${info.totalMessages}\n`;
  if (info.badges?.length > 0) t += `🏅 Badges: ${info.badges.join(', ')}\n`;
  return t;
}

async function sendAdminResult(sock, msg, sender, result) {
  const { jid, raw } = msg;
  if (!result.success) {
    await sock.sendMessage(jid, { text: `❌ Erro: ${result.message}` }, { quoted: raw });
    return;
  }
  const [mTarget, mSender] = await Promise.all([
    mentions.processSingleMention(result.targetId || sender),
    mentions.processSingleMention(sender),
  ]);
  await sock.sendMessage(jid, {
    text: `🔧 *Comando Administrativo Executado*\n\n${result.message}\n\n👤 Usuário: ${mTarget.mentionText}\n👑 Executado por: ${mSender.mentionText}`,
    mentions: [...mTarget.mentions, ...mSender.mentions],
  }, { quoted: raw });
}

// --- Command handler ---

async function levelCommand(sock, msg) {
  const { text, jid, raw } = msg;
  if (!text) return;

  const sender = await users.resolveSender(raw);
  if (!sender) return;
  const isAdmin = config.admins.includes(sender);

  // !me
  if (text === '!me' || text.startsWith('!me ')) {
    const info = await level.getUserInfo(sender);
    if (!info) return true;
    const m = await mentions.processSingleMention(sender);
    await sock.sendMessage(jid, {
      text: formatUserInfo(info, m.mentionText, isAdmin, true),
      mentions: m.mentions,
    }, { quoted: raw });
    return true;
  }

  // !info @user
  if (text.startsWith('!info')) {
    const parts = text.split(' ');
    if (parts.length < 2) {
      await sock.sendMessage(jid, { text: '📝 *Uso:* !info @usuario' }, { quoted: raw });
      return true;
    }

    if (!parts[1].startsWith('@')) {
      await sock.sendMessage(jid, { text: '❌ Você deve mencionar um usuário! Use: !info @usuario' }, { quoted: raw });
      return true;
    }

    const jids = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (jids.length === 0) {
      await sock.sendMessage(jid, { text: '❌ Usuário não encontrado na menção!' }, { quoted: raw });
      return true;
    }

    const targetId = await repo.findUserIdByJid(jids[0]);
    if (!targetId) {
      await sock.sendMessage(jid, { text: '❌ Usuário não encontrado no banco. O usuário mencionado pode não ter interagido com o bot ainda.' }, { quoted: raw });
      return true;
    }

    const info = await level.getUserInfo(targetId);
    if (!info) {
      await sock.sendMessage(jid, { text: '❌ Usuário não encontrado.' }, { quoted: raw });
      return true;
    }

    const m = await mentions.processSingleMention(targetId);
    await sock.sendMessage(jid, {
      text: formatUserInfo(info, m.mentionText, config.admins.includes(targetId)),
      mentions: m.mentions,
    }, { quoted: raw });
    return true;
  }

  // !elos
  if (text.startsWith('!elos')) {
    let t = '🌟 *Sistema de Elos* 🌟\n\n';
    level.RANKS.forEach(r => { t += `${r.name} - Níveis ${r.minLevel} a ${r.maxLevel}\n`; });
    t += '\n💡 Use !me para ver seu status atual!';
    await sock.sendMessage(jid, { text: t }, { quoted: raw });
    return true;
  }

  // !prestigioAll (must be checked BEFORE !prestigio)
  if (text.startsWith('!prestigioAll')) {
    const result = await level.prestigeAll(sender);
    const m = await mentions.processSingleMention(sender);
    await sock.sendMessage(jid, { text: result.message, mentions: m.mentions }, { quoted: raw });
    return true;
  }

  // !prestigio
  if (text === '!prestigio' || text.startsWith('!prestigio ')) {
    const result = await level.prestige(sender);
    const m = await mentions.processSingleMention(sender);
    await sock.sendMessage(jid, { text: result.message, mentions: m.mentions }, { quoted: raw });
    return true;
  }

  // !ranking (not !rankingGay)
  if (text.startsWith('!ranking') && !text.startsWith('!rankingGay')) {
    const ranking = await level.getRanking(10);
    const globalMentions = await mentions.getMentionsEnabled();

    let t = '🏆 *Ranking Top 10* 🏆\n\n';
    const allMentions = [];

    for (let i = 0; i < ranking.length; i++) {
      const u = ranking[i];
      const mentionJid = (u.jid?.endsWith('@lid')) ? u.userId : (u.jid || u.userId);
      const m = await mentions.processSingleMention(mentionJid);

      if (globalMentions && u.allowMentions && m.mentions.length > 0) {
        allMentions.push(...m.mentions);
      }

      t += `${i + 1}. ${m.mentionText} - Nível ${u.level} (${u.rank.name})\n`;
      t += `   ⭐ ${u.xp} XP | 🏆 Prestígio ${u.prestige}\n\n`;
    }

    await sock.sendMessage(jid, { text: t, mentions: allMentions }, { quoted: raw });
    return true;
  }

  // !niveis
  if (text.startsWith('!niveis')) {
    const t =
      '🎯 *Sistema de Níveis* 🎯\n\n' +
      '📊 *Como funciona:*\n' +
      '• Ganhe 10 XP a cada mensagem enviada\n' +
      '• Primeiro usuário após 6h da manhã ganha +50 XP\n' +
      '• Multiplicador de prestígio aumenta XP ganho\n\n' +
      '📈 *Fórmula de níveis:*\n' +
      '• Níveis 1-10: 100 + (nível-1) × 10 XP\n' +
      '• Níveis 10+: 100 + 90 + (nível-10) × 100 XP\n\n' +
      '🏆 *Sistema de Prestígio:*\n' +
      '• Requisito: A cada 10 níveis (10, 20, 30, etc.)\n' +
      '• Acumulação: Prestígios se acumulam conforme você progride\n' +
      '• Exemplo: Nível 50 = 5 prestígios disponíveis\n' +
      '• Benefício: +0.5x multiplicador de XP por prestígio\n' +
      '• Não reseta nível: Continua progredindo normalmente\n' +
      '• Badges: Ganha emblemas de prestígio únicos\n\n' +
      '🌟 *Sistema de Elos:*\n' +
      '• 10 elos diferentes baseados no nível\n' +
      '• De Bronze (nível 1) até Transcendente (nível 201+)\n' +
      '• Notificação automática ao mudar de elo\n\n' +
      '💬 *Comandos disponíveis:*\n' +
      '• !me - Seu status atual\n' +
      '• !info @usuario - Informações de outro usuário\n' +
      '• !elos - Lista todos os elos\n' +
      '• !prestigio - Faz prestígio\n' +
      '• !prestigioAll - Usa todos os prestígios disponíveis\n' +
      '• !ranking - Top 10 usuários\n' +
      '• !niveis - Esta explicação\n\n' +
      '🔔 *Notificações automáticas:*\n' +
      '• Level up - Quando sobe de nível\n' +
      '• Mudança de elo - Quando muda de elo\n' +
      '• Bônus diário - Quando ganha bônus de 50 XP';

    await sock.sendMessage(jid, { text: t }, { quoted: raw });
    return true;
  }

  // !setlevel (admin)
  if (text.toLowerCase().startsWith('!setlevel')) {
    if (!isAdmin) {
      await sock.sendMessage(jid, { text: '❌ Acesso negado! Apenas administradores podem usar este comando.' }, { quoted: raw });
      return true;
    }

    const parts = text.split(' ');
    if (parts.length < 3) {
      await sock.sendMessage(jid, { text: '📝 *Uso:* !setlevel @usuario nivel\n📝 *Uso:* !setlevel me nivel' }, { quoted: raw });
      return true;
    }

    const targetLevel = parseInt(parts[2]);
    if (isNaN(targetLevel)) {
      await sock.sendMessage(jid, { text: '❌ Nível inválido! Use um número válido.' }, { quoted: raw });
      return true;
    }

    const { userId: targetId, error } = await users.resolveTarget(raw, sender);
    if (error) { await sock.sendMessage(jid, { text: error }, { quoted: raw }); return true; }
    if (!targetId) { await sock.sendMessage(jid, { text: '📝 *Uso:* !setlevel @usuario nivel' }, { quoted: raw }); return true; }

    const result = await level.setLevel(targetId, targetLevel);
    await sendAdminResult(sock, msg, sender, { ...result, targetId });
    return true;
  }

  // !resetsetlevel (admin)
  if (text.toLowerCase().startsWith('!resetsetlevel')) {
    if (!isAdmin) {
      await sock.sendMessage(jid, { text: '❌ Acesso negado! Apenas administradores podem usar este comando.' }, { quoted: raw });
      return true;
    }

    const { userId: targetId, error } = await users.resolveTarget(raw, sender);
    if (error) { await sock.sendMessage(jid, { text: error }, { quoted: raw }); return true; }
    if (!targetId) { await sock.sendMessage(jid, { text: '📝 *Uso:* !resetSetLevel @usuario\n📝 *Uso:* !resetSetLevel me' }, { quoted: raw }); return true; }

    const result = await level.resetSetLevel(targetId);
    await sendAdminResult(sock, msg, sender, { ...result, targetId });
    return true;
  }
}

module.exports = levelCommand;
