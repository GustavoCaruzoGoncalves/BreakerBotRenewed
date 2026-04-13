const fs = require('fs');
const path = require('path');
const mentions = require('../../lib/mentions');
const repo = require('../../database/repository');
const users = require('../../services/users');
const config = require('../../config');

// importando os comandos do guh
const handleAindaNamora = require('./olhodopai');

const ASSETS = path.resolve(__dirname, '..', '..', '..', 'assets');

// --- Config tables (replaces 500+ lines of duplicated handlers) ---

const PERCENT_CMDS = {
  '!gay':           { emoji: '🏳‍🌈🏳‍🌈🏳‍🌈', label: 'gay' },
  '!corno':         { emoji: '🐂🐂🐂',       label: 'corno' },
  '!hetero':        { emoji: '🩲',            label: 'hétero' },
  '!chato':         { emoji: '😡',            label: 'chato' },
  '!petista':       { emoji: '🚩🚩🚩',       label: 'petista' },
  '!bolsonaro':  { emoji: '🇧🇷🇧🇷🇧🇷', label: 'Bolsonaro' },
  '!leitada':       { emoji: '🥛🥛🥛',       label: 'de leitada', verb: 'levou' },
  '!burro':         { emoji: '🫏🫏🫏',       label: 'burro' },
};

const PAIR_CMDS = {
  '!ship':       { template: (a, b, p) => `${a} e ${b} tem ${p}% de chance de namorarem! 👫👫👫` },
  '!hug':        { template: (a, b) => `${a} abraçou ${b}!!! 🫂🫂🫂`, noPercent: true },
  '!transar':    { template: (a, b, p) => `${a} e ${b} tem ${p}% de chance de transarem! 🔥🔥🔥` },
  '!arrebentar': { template: (a, b, p) => `${a} tem ${p}% de chance de arrebentar ${b}! 💥💥💥` },
};

const SELF_REFS = new Set(['eu', 'me', 'eu me', 'me eu']);
const PEDRAO_VARIATIONS = ['pedrão', 'pedrao', 'perdão', 'perdao'];

function rand101() { return Math.floor(Math.random() * 101); }

function isPedrao(name) {
  const lower = name.toLowerCase();
  return PEDRAO_VARIATIONS.some(v => lower.includes(v));
}

function isPedraoNumber(jid) {
  return jid === (process.env.PEDRAO_NUMBER || '') + '@s.whatsapp.net';
}

// --- Emoji reaction (auto-react) ---
// Chamado pelo router em toda mensagem com texto (não só em comandos !).

async function handleEmojiReaction(sock, msg) {
  if (msg.raw.key.fromMe) return;
  if (users.isIgnoredChatJid(msg.jid)) return;
  const type = Object.keys(msg.raw.message || {})[0];
  if (type === 'reactionMessage') return;

  const userId = await users.resolveSender(msg.raw);
  if (!userId) return;

  const user = await repo.getUserById(userId);
  if (!user?.emojiReaction || !user?.emoji) return;

  await sock.sendMessage(msg.jid, { react: { text: user.emoji, key: msg.raw.key } }).catch(() => {});
}

// --- Generic percentage command handler ---

async function handlePercentCmd(sock, msg, cmd, { emoji, label, verb }) {
  const isLeitada = cmd === '!leitada'; 
  const action = verb || 'é';
  const mentionedJid = msg.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid;

  if (mentionedJid?.length > 0) {
    const rawJid = mentionedJid[0];
    const userId = (await repo.findUserIdByJid(rawJid)) || rawJid;
    const info = await mentions.processSingleMention(userId);
    let pct = rand101();
    let text;

    if (isPedraoNumber(userId) && isLeitada) {
      pct = 100;
      text = `${info.mentionText} ${action} ${pct}% ${label}! ${emoji} KKKKKKKKKKK`;
      await sendPedraoSticker(sock, msg);
    } else {
      text = isLeitada
        ? `${info.mentionText} ${action} ${pct}% ${label}! ${emoji}`
        : `${info.mentionText} é ${pct}% ${label}! ${emoji}`;
    }

    if (!info.hasName && !info.canMention) {
      text += '\n\n💡 Dica: os usuários precisam enviar alguma mensagem para que seus nomes apareçam quando as menções estão desativadas, ou podem adicionar um nome personalizado para que assim possam ser chamados';
    }

    await sock.sendMessage(msg.jid, { text, mentions: info.mentions }, { quoted: msg.raw });
    return true;
  }

  const nameArg = msg.text.slice(cmd.length).trim();

  if (SELF_REFS.has(nameArg.toLowerCase())) {
    const pct = rand101();
    const text = isLeitada
      ? `Você ${action} ${pct}% ${label}! ${emoji}`
      : `Você é ${pct}% ${label}! ${emoji}`;
    await sock.sendMessage(msg.jid, { text }, { quoted: msg.raw });
    return true;
  }

  if (nameArg) {
    let pct = rand101();
    let text;
    if (isPedrao(nameArg) && isLeitada) {
      pct = 100;
      text = `${nameArg} ${action} ${pct}% ${label}! ${emoji} KKKKKKKKKKK`;
      await sendPedraoSticker(sock, msg);
    } else {
      text = isLeitada
        ? `${nameArg} ${action} ${pct}% ${label}! ${emoji}`
        : `${nameArg} é ${pct}% ${label}! ${emoji}`;
    }
    await sock.sendMessage(msg.jid, { text }, { quoted: msg.raw });
    return true;
  }

  await sock.sendMessage(msg.jid, {
    text: `Por favor, mencione um usuário ou forneça um nome com o comando ${cmd} nome.`,
  }, { quoted: msg.raw });
  return true;
}

// --- Generic pair command handler ---

async function handlePairCmd(sock, msg, cmd, { template, noPercent }) {
  const rawMentions = msg.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const mentionedJid = await Promise.all(rawMentions.map(r => repo.findUserIdByJid(r).then(id => id || r)));
  const input = msg.text.slice(cmd.length).trim();

  if (!input && mentionedJid.length === 0) {
    await sock.sendMessage(msg.jid, {
      text: `Por favor, mencione dois usuários ou forneça dois nomes.\nExemplo: ${cmd} João e Maria ou ${cmd} eu e Maria`,
    }, { quoted: msg.raw });
    return true;
  }

  let name1 = '', name2 = '';
  let allMentions = [];
  let mIdx = 0;

  if (input.toLowerCase().includes(' e ')) {
    const parts = input.split(/ e /i);
    name1 = parts[0].trim();
    name2 = parts.slice(1).join(' e ').trim();
  } else if (input.includes(' ')) {
    const i = input.indexOf(' ');
    name1 = input.slice(0, i).trim();
    name2 = input.slice(i + 1).trim();
  } else if (mentionedJid.length === 2) {
    const [i1, i2] = await Promise.all(mentionedJid.map(j => mentions.processSingleMention(j)));
    name1 = i1.mentionText;
    name2 = i2.mentionText;
    allMentions = [...i1.mentions, ...i2.mentions];
  } else {
    await sock.sendMessage(msg.jid, {
      text: `Por favor, forneça dois nomes separados por 'e' ou espaço.\nExemplo: ${cmd} João e Maria`,
    }, { quoted: msg.raw });
    return true;
  }

  const resolve = async (name) => {
    if (['eu', 'me'].includes(name.toLowerCase().trim())) return 'Você';
    if (name.includes('@') && mentionedJid.length > mIdx) {
      const info = await mentions.processSingleMention(mentionedJid[mIdx++]);
      allMentions.push(...info.mentions);
      return info.mentionText;
    }
    return name;
  };

  if (name1 && name2) {
    name1 = await resolve(name1);
    name2 = await resolve(name2);
  }

  if (!name1 || !name2) {
    await sock.sendMessage(msg.jid, {
      text: `Por favor, forneça dois nomes.\nExemplo: ${cmd} João e Maria ou ${cmd} eu e Maria`,
    }, { quoted: msg.raw });
    return true;
  }

  const pct = rand101();
  const text = noPercent ? template(name1, name2) : template(name1, name2, pct);
  await sock.sendMessage(msg.jid, { text, mentions: allMentions }, { quoted: msg.raw });
  return true;
}

// --- !pinto (special) ---

async function handlePinto(sock, msg) {
  const isSpecial = Math.random() < 0.01;
  const mentionedJid = msg.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const sender = msg.jid.endsWith('@g.us')
    ? (msg.raw.key.participantAlt || msg.raw.key.participant || msg.jid)
    : msg.jid;

  async function sendSpecial(target, mentionArr) {
    await sock.sendMessage(msg.jid, {
      text: `${target}, VOCÊ TEM 1000km DE PICA KKKKKKKKKKKKKKKKKK`,
      mentions: mentionArr,
    }, { quoted: msg.raw });
    if (process.env.PINTO_MESSAGE) {
      await sock.sendMessage(msg.jid, { text: process.env.PINTO_MESSAGE, mentions: mentionArr }, { quoted: msg.raw });
    }
  }

  if (mentionedJid?.length > 0) {
    const userId = (await repo.findUserIdByJid(mentionedJid[0])) || mentionedJid[0];
    const info = await mentions.processSingleMention(userId);

    if (isSpecial) {
      await sendSpecial(info.mentionText, info.mentions);
    } else {
      const size = (Math.random() * 39.9 + 0.1).toFixed(1);
      let text = `${info.mentionText} tem ${size}cm de pinto! 🍆`;
      if (!info.hasName && !info.canMention) {
        text += '\n\n💡 Dica: os usuários precisam enviar alguma mensagem para que seus nomes apareçam quando as menções estão desativadas, ou podem adicionar um nome personalizado para que assim possam ser chamados';
      }
      await sock.sendMessage(msg.jid, { text, mentions: info.mentions }, { quoted: msg.raw });
    }
    return true;
  }

  const nameArg = msg.text.slice(6).trim();

  if (SELF_REFS.has(nameArg.toLowerCase())) {
    if (isSpecial) {
      const info = await mentions.processSingleMention(sender);
      await sendSpecial(info.mentionText, info.mentions);
    } else {
      const size = (Math.random() * 39.9 + 0.1).toFixed(1);
      await sock.sendMessage(msg.jid, { text: `Você tem ${size}cm de pinto! 🍆` }, { quoted: msg.raw });
    }
    return true;
  }

  if (nameArg) {
    if (isSpecial) {
      await sendSpecial(nameArg, []);
    } else {
      const size = (Math.random() * 39.9 + 0.1).toFixed(1);
      await sock.sendMessage(msg.jid, { text: `${nameArg} tem ${size}cm de pinto! 🍆` }, { quoted: msg.raw });
    }
    return true;
  }

  await sock.sendMessage(msg.jid, {
    text: 'Por favor, mencione um usuário ou forneça um nome com o comando !pinto nome.',
  }, { quoted: msg.raw });
  return true;
}

// --- !rankingGay ---

async function handleRankingGay(sock, msg) {
  if (!msg.jid.endsWith('@g.us')) {
    await sock.sendMessage(msg.jid, { text: '❌ Este comando só funciona em grupos!' }, { quoted: msg.raw });
    return true;
  }

  try {
    const meta = await sock.groupMetadata(msg.jid);
    const participants = (meta.participants || []).map(p => p.id);

    const botNumber = sock.user?.id?.split(':')[0];
    const valid = participants.filter(jid => {
      if (jid.includes('@g.us')) return false;
      if (botNumber && jid.split('@')[0].split(':')[0] === botNumber) return false;
      return true;
    });

    if (valid.length < 3) {
      await sock.sendMessage(msg.jid, { text: '❌ Não há participantes suficientes para fazer o ranking!' }, { quoted: msg.raw });
      return true;
    }

    const shuffled = [...valid].sort(() => Math.random() - 0.5).slice(0, 3);
    const messages = [
      process.env.RANKING_GAY_MESSAGE_1,
      process.env.RANKING_GAY_MESSAGE_2,
      process.env.RANKING_GAY_MESSAGE_3,
    ];

    for (let i = 0; i < shuffled.length; i++) {
      const info = await mentions.processSingleMention(shuffled[i]);
      await sock.sendMessage(msg.jid, {
        text: `${info.mentionText}! ${messages[i]}`,
        mentions: info.mentions,
      }, { quoted: msg.raw });
      if (i < shuffled.length - 1) await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    console.error('Erro !rankingGay:', err);
    await sock.sendMessage(msg.jid, { text: '❌ Erro ao gerar o ranking. Tente novamente!' }, { quoted: msg.raw });
  }
  return true;
}

// --- Pedrao Easter egg ---

function checkPedraoGreeting(text) {
  const lower = text.toLowerCase();
  const greetings = ['bom dia', 'boa tarde', 'boa noite'];
  return greetings.some(g =>
    PEDRAO_VARIATIONS.some(v => lower.startsWith(`${g} ${v}`) || lower.startsWith(`${g}, ${v}`))
  );
}

async function sendPedraoSticker(sock, msg) {
  const stickerPath = path.join(ASSETS, 'pedrao_sticker.webp');
  if (fs.existsSync(stickerPath)) {
    await sock.sendMessage(msg.jid, { sticker: fs.readFileSync(stickerPath) }, { quoted: msg.raw });
  }
}

// --- Asset commands ---

async function handleFazol(sock, msg) {
  const videoPath = path.join(ASSETS, 'MarioFazOL.mp4');
  if (fs.existsSync(videoPath)) {
    await sock.sendMessage(msg.jid, { video: fs.readFileSync(videoPath), caption: 'FAZ O L CARALHOOOOOOOOOO' }, { quoted: msg.raw });
  } else {
    await sock.sendMessage(msg.jid, { text: 'O vídeo do FAZOL não foi encontrado 😢' }, { quoted: msg.raw });
  }
  return true;
}

async function handleVumvum(sock, msg) {
  const audioPath = path.join(ASSETS, 'vumvum.mp3');
  if (fs.existsSync(audioPath)) {
    await sock.sendMessage(msg.jid, { audio: fs.readFileSync(audioPath), mimetype: 'audio/mp4', fileName: 'vumvum.mp3' }, { quoted: msg.raw });
  } else {
    await sock.sendMessage(msg.jid, { text: '❌ O áudio do VUMVUM não foi encontrado 😢' }, { quoted: msg.raw });
  }
  return true;
}

// --- Main handler ---

async function jokesCommand(sock, msg) {
  const { text, raw } = msg;
  if (!text || raw.key.fromMe || Object.keys(raw.message)[0] === 'reactionMessage') return;

  if (checkPedraoGreeting(text)) {
    await sendPedraoSticker(sock, msg);
    await sock.sendMessage(msg.jid, { text: 'O PERDÃO JÁ LEVOU 100% DA LEITADA KKKKKKKKKKKKKKKKK' }, { quoted: raw });
    return true;
  }

  const lower = text.toLowerCase();

  for (const [cmd, cfg] of Object.entries(PERCENT_CMDS)) {
    if (text.startsWith(cmd)) return handlePercentCmd(sock, msg, cmd, cfg);
  }

  if (text.startsWith('!pinto')) return handlePinto(sock, msg);

  for (const [cmd, cfg] of Object.entries(PAIR_CMDS)) {
    if (text.startsWith(cmd)) return handlePairCmd(sock, msg, cmd, cfg);
  }

  if (lower.startsWith('!fazol')) return handleFazol(sock, msg);
  if (text.startsWith('!vumvum')) return handleVumvum(sock, msg);
  if (text.startsWith('!rankingGay')) return handleRankingGay(sock, msg);
 
  if (text.toLowerCase().startsWith('!aindanamora')) {
  return handleAindaNamora(sock, msg);
}
}

module.exports = jokesCommand;
module.exports.handleEmojiReaction = handleEmojiReaction;
