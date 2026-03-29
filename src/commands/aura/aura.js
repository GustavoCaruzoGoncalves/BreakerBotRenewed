const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const repo = require('../../database/repository');
const mentions = require('../../lib/mentions');
const users = require('../../services/users');
const aura = require('../../services/aura');

// --- In-memory game state ---

const mogDuels = new Map();
const mogPending = new Map();
const mognowActive = new Map();
const processedStickerIds = new Set();

const MOG_DURATION_MS = 15000;
const MOGNOW_COUNTDOWN = 5;
const MOGNOW_WINDOW_MS = 15000;
const MAX_STICKER_IDS = 50000;

// --- Helpers ---

function getMentionedJid(raw) {
  const jids = raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  return Array.isArray(jids) && jids.length > 0 ? jids[0] : null;
}

async function resolveMentionedUser(sock, raw, jid) {
  const mentionedJid = getMentionedJid(raw);
  if (!mentionedJid) {
    await sock.sendMessage(jid, { text: '⚠️ Marque alguém: *@usuario*' }, { quoted: raw });
    return null;
  }
  const userId = await repo.findUserIdByJid(mentionedJid);
  if (!userId) {
    await sock.sendMessage(jid, { text: '❌ Usuário não encontrado no banco. O usuário mencionado pode não ter interagido com o bot ainda.' }, { quoted: raw });
    return null;
  }
  return userId;
}

async function checkNegativePunish(sock, jid, userId) {
  const data = await aura.getAuraData(userId);
  if (!data || (data.auraPoints ?? 0) >= 0 || data.negativeFarmPunished) return;
  const m = await mentions.processSingleMention(userId);
  await sock.sendMessage(jid, {
    text: `${m.mentionText} FARMOU AURA NEGATIVA, -${aura.formatAura(1000)} AURA 💀💀💀`,
    mentions: m.mentions.length ? m.mentions : undefined,
  });
  await aura.addPoints(userId, -1000);
  await aura.setNegativeFarmPunished(userId, true);
}

// --- Mog duels ---

async function endMogDuel(sock, chatId, duel) {
  mogDuels.delete(chatId);
  const { fromKey, toKey, countFrom = 0, countTo = 0 } = duel;
  const winnerKey = countFrom > countTo ? fromKey : countTo > countFrom ? toKey : null;

  if (!winnerKey) {
    await sock.sendMessage(chatId, { text: `⏱ Empate! (${countFrom} x ${countTo} mensagens) Ninguém ganha aura.` });
    return;
  }

  const winnerCount = winnerKey === fromKey ? countFrom : countTo;
  const loserCount = winnerKey === fromKey ? countTo : countFrom;
  await aura.addPoints(winnerKey, 500);

  const missionReward = await aura.hasMission(winnerKey, 'duel_win') ? await aura.completeMission(winnerKey, 'duel_win') : 0;
  const total = 500 + missionReward;
  const m = await mentions.processSingleMention(winnerKey);

  await sock.sendMessage(chatId, {
    text: `🏆 Duelo encerrado! ${m.mentionText} venceu o mog! (${winnerCount} x ${loserCount} mensagens)\n✨ *+${aura.formatAura(500)}* aura pela vitória${missionReward ? ` + *${aura.formatAura(missionReward)}* pela missão` : ''} = *${aura.formatAura(total)}* aura no total.`,
    mentions: m.mentions.length ? m.mentions : undefined,
  });
}

// --- Command handler ---

async function auraCommand(sock, msg) {
  const { text, jid, raw } = msg;
  if (!text || raw.key.fromMe) return;

  const sender = await users.resolveSender(raw);
  if (!sender) return;

  const lower = text.toLowerCase().trim();

  // --- Random event claim ---
  const event = aura.activeEvents.get(jid);
  if (event && lower === event.command.toLowerCase() && Date.now() <= event.endsAt) {
    if (event.type === 'first') {
      if (event.winnerKey) {
        await sock.sendMessage(jid, { text: '⏳ Esse evento já foi conquistado por alguém!' }, { quoted: raw });
        return true;
      }
      const result = await aura.applyEffect(event.effect, sender);
      event.winnerKey = sender;
      aura.clearEvent(jid);
      const m = await mentions.processSingleMention(sender);
      const emoji = result.amount >= 0 ? '✨' : '💀';
      await sock.sendMessage(jid, {
        text: `${emoji} ${m.mentionText} ${result.amount >= 0 ? 'ganhou' : 'perdeu'} *${aura.formatAura(Math.abs(result.amount))}* de aura! Total: *${aura.formatAura(result.newTotal)}*`,
        mentions: m.mentions.length ? m.mentions : undefined,
      }, { quoted: raw });
      return true;
    }
    if (event.type === 'all') {
      if (event.participants.has(sender)) {
        await sock.sendMessage(jid, { text: '✅ Você já participou deste evento!' }, { quoted: raw });
        return true;
      }
      event.participants.add(sender);
      const result = await aura.applyEffect(event.effect, sender);
      const m = await mentions.processSingleMention(sender);
      await sock.sendMessage(jid, {
        text: `✨ ${m.mentionText} entrou e ganhou *${aura.formatAura(result.amount)}* de aura! Total: *${aura.formatAura(result.newTotal)}*`,
        mentions: m.mentions.length ? m.mentions : undefined,
      }, { quoted: raw });
      return true;
    }
  }

  // --- Mognow message counting ---
  const mognow = mognowActive.get(jid);
  if (mognow) {
    const now = Date.now();
    if (now >= mognow.gameStartsAt && now <= mognow.gameEndsAt) {
      if (sender === mognow.attackerKey) mognow.countAttacker++;
      else if (sender === mognow.targetKey) mognow.countTarget++;
    }
  }

  // --- Mog duel message counting ---
  const duel = mogDuels.get(jid);
  if (duel && Date.now() < duel.endTime) {
    if (sender === duel.fromKey) duel.countFrom++;
    else if (sender === duel.toKey) duel.countTo++;
  }

  // !mog aceitar
  if (lower === '!mog aceitar') {
    const list = mogPending.get(jid) || [];
    const idx = list.findIndex(p => p.toKey === sender);
    if (idx === -1) {
      await sock.sendMessage(jid, { text: '⚠️ Não há desafio de duelo para você aceitar aqui.' }, { quoted: raw });
      return true;
    }
    const pending = list[idx];
    mogPending.delete(jid);
    mogDuels.set(jid, { fromKey: pending.fromKey, toKey: pending.toKey, countFrom: 0, countTo: 0, endTime: Date.now() + MOG_DURATION_MS });
    await sock.sendMessage(jid, { text: '⚔️ Duelo começando! Mandem mensagens por *15 segundos*. Quem tiver mais mensagens ganha!' });
    setTimeout(() => { const d = mogDuels.get(jid); if (d) endMogDuel(sock, jid, d).catch(() => {}); }, MOG_DURATION_MS + 500);
    return true;
  }

  // !mog @user
  if (lower.startsWith('!mog ') && !lower.startsWith('!mognow')) {
    const toKey = await resolveMentionedUser(sock, raw, jid);
    if (!toKey) return true;
    if (sender === toKey) { await sock.sendMessage(jid, { text: '⚠️ Você não pode mogar a si mesmo.' }, { quoted: raw }); return true; }
    const list = mogPending.get(jid) || [];
    list.push({ fromKey: sender, toKey });
    mogPending.set(jid, list);
    const m = await mentions.processSingleMention(toKey);
    await sock.sendMessage(jid, {
      text: `⚔️ Desafio de duelo! ${m.mentionText} pode aceitar respondendo *!mog aceitar*. Quem mandar mais mensagens em 15 segundos vence e ganha 500 de aura.`,
      mentions: m.mentions.length ? m.mentions : undefined,
    }, { quoted: raw });
    return true;
  }

  // !mognow @user
  if (lower.startsWith('!mognow')) {
    const targetKey = await resolveMentionedUser(sock, raw, jid);
    if (!targetKey) return true;
    if (mognowActive.has(jid)) { await sock.sendMessage(jid, { text: '⚠️ Já há um ataque em andamento neste chat.' }, { quoted: raw }); return true; }
    if (sender === targetKey) { await sock.sendMessage(jid, { text: '⚠️ Você não pode atacar a si mesmo.' }, { quoted: raw }); return true; }

    const gameStartsAt = Date.now() + MOGNOW_COUNTDOWN * 1000;
    const gameEndsAt = gameStartsAt + MOGNOW_WINDOW_MS;

    for (let i = MOGNOW_COUNTDOWN; i >= 1; i--) {
      setTimeout(() => sock.sendMessage(jid, { text: `${i}` }).catch(() => {}), (MOGNOW_COUNTDOWN - i) * 1000);
    }
    const targetM = await mentions.processSingleMention(targetKey);
    setTimeout(() => {
      sock.sendMessage(jid, {
        text: `💀 *MOGNOW!* ${targetM.mentionText} — *15 segundos*: quem mandar *mais mensagens* vence. Alvo ganha 500 de aura se vencer; atacante ganha 5 se vencer.`,
        mentions: targetM.mentions.length ? targetM.mentions : undefined,
      }).catch(() => {});
    }, MOGNOW_COUNTDOWN * 1000);

    mognowActive.set(jid, { attackerKey: sender, targetKey, gameStartsAt, gameEndsAt, countAttacker: 0, countTarget: 0 });

    setTimeout(async () => {
      const state = mognowActive.get(jid);
      if (!state) return;
      mognowActive.delete(jid);
      const { attackerKey, countAttacker = 0, countTarget = 0 } = state;
      const atkM = await mentions.processSingleMention(attackerKey);
      const tgtM = await mentions.processSingleMention(state.targetKey);
      const allMentions = [...(atkM.mentions || []), ...(tgtM.mentions || [])];

      if (countTarget > countAttacker) {
        await aura.addPoints(state.targetKey, 500);
        const missionReward = await aura.hasMission(state.targetKey, 'survive_attack') ? await aura.completeMission(state.targetKey, 'survive_attack') : 0;
        const total = 500 + missionReward;
        sock.sendMessage(jid, {
          text: `🛡️ ${tgtM.mentionText} sobreviveu ao ataque! (${countTarget} x ${countAttacker} mensagens)\n✨ *+${aura.formatAura(500)}* aura${missionReward ? ` + *${aura.formatAura(missionReward)}* pela missão` : ''} = *${aura.formatAura(total)}* aura.`,
          mentions: allMentions.length ? allMentions : undefined,
        }).catch(() => {});
      } else if (countAttacker > countTarget) {
        await aura.addPoints(attackerKey, 5);
        sock.sendMessage(jid, {
          text: `⏱ ${atkM.mentionText} venceu o mognow! (${countAttacker} x ${countTarget} mensagens)\n✨ Atacante ganha *${aura.formatAura(5)}* de aura.`,
          mentions: allMentions.length ? allMentions : undefined,
        }).catch(() => {});
      } else {
        sock.sendMessage(jid, { text: `⏱ Empate! (${countAttacker} x ${countTarget}) Ninguém ganha aura.` }).catch(() => {});
      }
    }, MOGNOW_WINDOW_MS + MOGNOW_COUNTDOWN * 1000 + 500);
    return true;
  }

  // !meditar
  if (lower === '!meditar') {
    const options = [0, 10, 20, 30, 40, 50];
    const gained = options[Math.floor(Math.random() * options.length)];
    await aura.addPoints(sender, gained);
    const total = await aura.getPoints(sender);
    await sock.sendMessage(jid, {
      text: gained > 0 ? `🧘 Meditação concluída. Você absorveu *+${aura.formatAura(gained)}* de aura. Total: *${aura.formatAura(total)}*` : `🧘 Meditação concluída. Sua aura permanece estável. Total: *${aura.formatAura(total)}*`,
    }, { quoted: raw });
    return true;
  }

  // !treinar
  if (lower === '!treinar') {
    const COOLDOWN = 3600000;
    const lastAt = await aura.getCooldown(sender, 'lastTreinarAt');
    const elapsed = Date.now() - (lastAt || 0);
    if (lastAt && elapsed < COOLDOWN) {
      const minLeft = Math.ceil((COOLDOWN - elapsed) / 60000);
      await sock.sendMessage(jid, { text: `⏳ Aguarde *${minLeft === 1 ? '1 minuto' : `${minLeft} minutos`}* para treinar de novo.` }, { quoted: raw });
      return true;
    }
    await aura.setCooldown(sender, 'lastTreinarAt', Date.now());
    if (Math.random() < 0.5) {
      await aura.addPoints(sender, 500);
      const total = await aura.getPoints(sender);
      await sock.sendMessage(jid, { text: `💪 Treino intenso! *+${aura.formatAura(500)}* de aura. Total: *${aura.formatAura(total)}*` }, { quoted: raw });
    } else {
      await aura.addPoints(sender, -1000);
      const total = await aura.getPoints(sender);
      await sock.sendMessage(jid, { text: `💔 O treino foi além do limite. *-${aura.formatAura(1000)}* de aura. Total: *${aura.formatAura(total)}*` }, { quoted: raw });
      await checkNegativePunish(sock, jid, sender);
    }
    return true;
  }

  // !dominar
  if (lower === '!dominar') {
    const COOLDOWN = 12 * 3600000;
    const lastAt = await aura.getCooldown(sender, 'lastDominarAt');
    const elapsed = Date.now() - (lastAt || 0);
    if (lastAt && elapsed < COOLDOWN) {
      const hoursLeft = ((COOLDOWN - elapsed) / 3600000).toFixed(1);
      await sock.sendMessage(jid, { text: `⏳ Dominação disponível em *${hoursLeft}h*.` }, { quoted: raw });
      return true;
    }
    await aura.setCooldown(sender, 'lastDominarAt', Date.now());
    if (Math.random() < 0.5) {
      await aura.addPoints(sender, 1000);
      const total = await aura.getPoints(sender);
      await sock.sendMessage(jid, { text: `👑 Dominação absoluta! *+${aura.formatAura(1000)}* de aura. Total: *${aura.formatAura(total)}*` }, { quoted: raw });
    } else {
      await sock.sendMessage(jid, { text: '😤 A dominação falhou. Nenhuma aura obtida.' }, { quoted: raw });
    }
    return true;
  }

  // !ritual
  if (lower === '!ritual') {
    const today = aura.todayStr();
    const lastDate = await aura.getCooldown(sender, 'lastRitualDate');
    if (lastDate === today) {
      await sock.sendMessage(jid, { text: '⏳ O ritual só pode ser feito *uma vez por dia*. Volte amanhã.' }, { quoted: raw });
      return true;
    }
    await aura.setCooldown(sender, 'lastRitualDate', today);
    const lines = [
      '💀🔥 *O ritual começa...* 🔥💀', '💀 A aura emana energias sombrias... 💀',
      '🔥 O fogo consome e renasce... 🔥', '💀🔥 Ondas de poder cruzam o éter... 🔥💀',
      '💀 O véu entre mundos se abre... 💀', '🔥 Tudo ou nada. O destino decide. 🔥',
      '💀🔥 *O ritual se completa.* 🔥💀',
    ];
    lines.forEach((line, i) => setTimeout(() => sock.sendMessage(jid, { text: line }).catch(() => {}), i * 1800));
    const won = Math.random() < 0.5;
    setTimeout(async () => {
      const amt = won ? 5000 : -5000;
      await aura.addPoints(sender, amt);
      const total = await aura.getPoints(sender);
      if (won) {
        sock.sendMessage(jid, { text: `👑💀 *O ritual te abençoou.* +${aura.formatAura(5000)} de aura. Total: *${aura.formatAura(total)}* 🔥` }).catch(() => {});
      } else {
        sock.sendMessage(jid, { text: `💀🔥 *O ritual te consumiu.* -${aura.formatAura(5000)} de aura. Total: *${aura.formatAura(total)}* 💀` }).catch(() => {});
        checkNegativePunish(sock, jid, sender).catch(() => {});
      }
    }, lines.length * 1800 + 800);
    return true;
  }

  // !respeito @user
  if (lower.startsWith('!respeito ')) {
    const targetId = await resolveMentionedUser(sock, raw, jid);
    if (!targetId) return true;
    if (targetId === sender) { await sock.sendMessage(jid, { text: '⚠️ Você não pode dar respeito a si mesmo.' }, { quoted: raw }); return true; }
    const result = await aura.transfer(sender, targetId, 50);
    if (!result.ok) { await sock.sendMessage(jid, { text: `❌ Você precisa de pelo menos *${aura.formatAura(50)}* de aura para usar !respeito.` }, { quoted: raw }); return true; }
    await checkNegativePunish(sock, jid, sender);
    const hadHelp = await aura.hasMission(sender, 'help_someone');
    if (hadHelp) await aura.completeMission(sender, 'help_someone');
    await sock.sendMessage(jid, {
      text: `🙏 Você transferiu *${aura.formatAura(50)}* de aura como respeito.${hadHelp ? ` Missão "Ajude alguém" concluída: *+${aura.formatAura(aura.MISSIONS.help_someone.reward)}* aura.` : ''}`,
    }, { quoted: raw });
    return true;
  }

  // !elogiar @user
  if (lower.startsWith('!elogiar ')) {
    const targetId = await resolveMentionedUser(sock, raw, jid);
    if (!targetId) return true;
    if (targetId === sender) { await sock.sendMessage(jid, { text: '⚠️ Você não pode elogiar a si mesmo.' }, { quoted: raw }); return true; }
    await aura.addPoints(targetId, 100);
    await repo.addPraise(sender, targetId);
    const [sM, tM] = await Promise.all([mentions.processSingleMention(sender), mentions.processSingleMention(targetId)]);
    await sock.sendMessage(jid, {
      text: `🌟 ${sM.mentionText} elogiou ${tM.mentionText}! ${tM.mentionText} ganhou *+${aura.formatAura(100)}* de aura.`,
      mentions: [...sM.mentions, ...tM.mentions].filter(Boolean),
    }, { quoted: raw });
    return true;
  }

  // !provocar @user
  if (lower.startsWith('!provocar ')) {
    const targetId = await resolveMentionedUser(sock, raw, jid);
    if (!targetId) return true;
    if (targetId === sender) { await sock.sendMessage(jid, { text: '⚠️ Você não pode provocar a si mesmo.' }, { quoted: raw }); return true; }
    const [sM, tM] = await Promise.all([mentions.processSingleMention(sender), mentions.processSingleMention(targetId)]);
    await sock.sendMessage(jid, {
      text: `${sM.mentionText} está te provocando ${tM.mentionText}, não quer tentar farmar aura rsrs? 🔥💀🔥💀`,
      mentions: [...sM.mentions, ...tM.mentions].filter(Boolean),
    }, { quoted: raw });
    return true;
  }

  // !elogiados me / !elogiados @user
  if (lower.startsWith('!elogiados')) {
    const isMe = /^!elogiados\s+me(\s|$)/i.test(text);
    let targetId;
    if (isMe) {
      targetId = sender;
    } else {
      targetId = await resolveMentionedUser(sock, raw, jid);
      if (!targetId) return true;
    }
    const list = await repo.getWhoPraised(targetId);
    const unique = [...new Set(list)];
    if (unique.length === 0) {
      const m = isMe ? null : await mentions.processSingleMention(targetId);
      const name = m ? m.mentionText : 'te';
      await sock.sendMessage(jid, {
        text: isMe ? '📋 Ninguém te elogiou ainda. Use *!elogiar @alguém* para elogiar e dar +100 de aura!' : `📋 Ninguém elogiou ${name} ainda.`,
        mentions: m?.mentions?.length ? m.mentions : undefined,
      }, { quoted: raw });
      return true;
    }
    const parts = [], allMentions = [];
    for (const uid of unique) {
      const m = await mentions.processSingleMention(uid);
      parts.push(m.mentionText);
      if (m.mentions.length) allMentions.push(...m.mentions);
    }
    const prefix = isMe ? 'Quem te elogiou' : `Quem elogiou ${(await mentions.processSingleMention(targetId)).mentionText}`;
    await sock.sendMessage(jid, {
      text: `📋 ${prefix}: ${parts.join(', ')}`,
      mentions: allMentions.length ? allMentions : undefined,
    }, { quoted: raw });
    return true;
  }

  // !aura doar valor @user
  if (lower.startsWith('!aura doar ')) {
    const targetId = await resolveMentionedUser(sock, raw, jid);
    if (!targetId) return true;
    const match = text.match(/!aura\s+doar\s+(\d+)/i);
    const amount = match ? parseInt(match[1], 10) : 0;
    if (!amount || amount < 1) { await sock.sendMessage(jid, { text: '⚠️ Informe um valor válido. Ex: *!aura doar 100 @usuario*' }, { quoted: raw }); return true; }
    if (targetId === sender) { await sock.sendMessage(jid, { text: '⚠️ Você não pode doar aura para si mesmo.' }, { quoted: raw }); return true; }
    const balance = await aura.getPoints(sender);
    if (balance < amount) { await sock.sendMessage(jid, { text: `❌ Você precisa de pelo menos *${aura.formatAura(amount)}* de aura para doar. Seu saldo: *${aura.formatAura(balance)}*` }, { quoted: raw }); return true; }
    const result = await aura.transfer(sender, targetId, amount);
    if (!result.ok) { await sock.sendMessage(jid, { text: '❌ Erro ao transferir aura.' }, { quoted: raw }); return true; }
    const m = await mentions.processSingleMention(targetId);
    await sock.sendMessage(jid, {
      text: `💫 Você doou *${aura.formatAura(amount)}* de aura para ${m.mentionText}. Seu saldo: *${aura.formatAura(result.fromRemaining)}*`,
      mentions: m.mentions.length ? m.mentions : undefined,
    }, { quoted: raw });
    await checkNegativePunish(sock, jid, sender);
    return true;
  }

  // !aura farmar @user
  if (lower.startsWith('!aura farmar ')) {
    const targetId = await resolveMentionedUser(sock, raw, jid);
    if (!targetId) return true;
    if (targetId === sender) { await sock.sendMessage(jid, { text: '⚠️ Você não pode farmar aura de si mesmo.' }, { quoted: raw }); return true; }
    if (Math.random() < 0.5) {
      await aura.addPoints(targetId, -100);
      await aura.addPoints(sender, 100);
      const m = await mentions.processSingleMention(targetId);
      await sock.sendMessage(jid, {
        text: `🩸 Você farmou *${aura.formatAura(100)}* de aura de ${m.mentionText}. Você ganhou *+${aura.formatAura(100)}* de aura.`,
        mentions: m.mentions.length ? m.mentions : undefined,
      }, { quoted: raw });
      await checkNegativePunish(sock, jid, targetId);
    } else {
      await aura.addPoints(sender, -200);
      const total = await aura.getPoints(sender);
      await sock.sendMessage(jid, { text: `💔 Falhou! Você perdeu *${aura.formatAura(200)}* de aura. Total: *${aura.formatAura(total)}*` }, { quoted: raw });
      await checkNegativePunish(sock, jid, sender);
    }
    return true;
  }

  // !aura figurinha
  if (lower.startsWith('!aura figurinha')) {
    const stickerMsg = aura.getStickerMsg(raw);
    if (!stickerMsg) { await sock.sendMessage(jid, { text: '⚠️ Envie *!aura figurinha* junto com uma figurinha ou respondendo a uma figurinha.' }, { quoted: raw }); return true; }
    const hash = aura.getStickerHash(raw);
    if (!hash) { await sock.sendMessage(jid, { text: '❌ Não foi possível obter o hash desta figurinha.' }, { quoted: raw }); return true; }
    try {
      const buffer = await downloadMediaMessage({ message: { stickerMessage: stickerMsg } }, 'buffer');
      const dataUrl = buffer ? `data:image/webp;base64,${buffer.toString('base64')}` : null;
      await aura.setStickerData(sender, hash, dataUrl);
    } catch {
      await aura.setStickerData(sender, hash, null);
    }
    await sock.sendMessage(jid, { text: '✅ Figurinha de aura definida! Use essa figurinha para ter chance de ganhar +100 de aura.' }, { quoted: raw });
    return true;
  }

  // !aura personagem "name"
  if (lower.startsWith('!aura personagem')) {
    const match = text.match(/!aura\s+personagem\s+"([^"]+)"/i) || text.match(/!aura\s+personagem\s+(.+)/i);
    const character = (match?.[1] || '').trim();
    if (!character) { await sock.sendMessage(jid, { text: '⚠️ Uso: *!aura personagem "nome do personagem"*' }, { quoted: raw }); return true; }
    await aura.setCharacter(sender, character);
    await sock.sendMessage(jid, { text: `✅ Personagem definido: *${character}*` }, { quoted: raw });
    return true;
  }

  // !aura missoes | !aura missões
  if (/^!aura\s+miss[oõ]es\s*$/i.test(text.trim())) {
    const data = await aura.getAuraData(sender);
    if (!data) { await sock.sendMessage(jid, { text: '❌ Você ainda não tem dados de aura.' }, { quoted: raw }); return true; }
    const { drawnMissions = [], completedMissionIds = [], progress = {} } = data.dailyMissions;
    let t = `📋 *Suas missões de hoje* (${completedMissionIds.length}/3 concluídas)\n_Reset às 00:00_\n\n`;
    drawnMissions.forEach(id => {
      const cfg = aura.MISSIONS[id];
      if (!cfg) return;
      const val = progress[cfg.key] ?? 0;
      const done = completedMissionIds.includes(id);
      t += `${done ? '✅' : '⬜'} *${cfg.label}*\n   ${done ? 'Concluída' : `${val}/${cfg.target}`} → *+${aura.formatAura(cfg.reward)}* aura\n\n`;
    });
    await sock.sendMessage(jid, { text: t }, { quoted: raw });
    return true;
  }

  // !aura ranking / !aura rank
  if (/^!aura\s+rank(ing)?\s*$/i.test(text.trim())) {
    const ranking = await aura.getRanking(10);
    if (ranking.length === 0) { await sock.sendMessage(jid, { text: '📈 Ninguém no ranking de aura ainda.' }, { quoted: raw }); return true; }
    const globalMentions = await mentions.getMentionsEnabled();
    let t = '📈 *Ranking de Aura — Quem tem mais aura* 📈\n_Posição · Nome · Categoria (nível) · Pontos_\n\n';
    const allMentions = [];
    for (let i = 0; i < ranking.length; i++) {
      const r = ranking[i];
      const mentionJid = r.jid?.endsWith('@lid') ? r.userId : (r.jid || r.userId);
      const m = await mentions.processSingleMention(mentionJid);
      if (globalMentions && r.allowMentions && m.mentions.length) allMentions.push(...m.mentions);
      const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
      t += `${medal} ${m.mentionText}\n   📊 Categoria: *${r.tierName}*  │  💫 *${aura.formatAura(r.auraPoints)}* aura\n\n`;
    }
    t += '—— *Categorias (níveis)* ——\n0 = NPC · 500 = Presença · 2.000 = Dominante · 5.000 = Sigma · 10.000 = Entidade · 50.000 = Deus do chat';
    await sock.sendMessage(jid, { text: t, mentions: allMentions.length ? allMentions : undefined }, { quoted: raw });
    return true;
  }

  // !aura info me / !aura info @user
  if (lower.startsWith('!aura info')) {
    const isMe = /^!aura\s+info\s+me\s*$/i.test(text.trim());
    let targetId;
    if (isMe) { targetId = sender; } else {
      targetId = await resolveMentionedUser(sock, raw, jid);
      if (!targetId) { await sock.sendMessage(jid, { text: '⚠️ Use *!aura info me* ou *!aura info @usuario*' }, { quoted: raw }); return true; }
    }
    const data = await aura.getAuraData(targetId);
    if (!data) { await sock.sendMessage(jid, { text: '❌ Esse usuário ainda não tem dados de aura no sistema.' }, { quoted: raw }); return true; }
    const m = await mentions.processSingleMention(targetId);
    const tier = aura.getTier(data.auraPoints);
    const { drawnMissions = [], completedMissionIds = [], progress = {} } = data.dailyMissions || {};
    let t = `✨ *🔥 ${m.mentionText} — ${tier.name} ${jid.endsWith('@g.us') ? 'do Grupo' : 'do Chat'}*\n\n`;
    t += `💫 Aura: *${aura.formatAura(data.auraPoints)}*  │  📈 Nível: *${tier.name}*\n`;
    if (data.character) t += `🎭 Personagem: *${data.character}*\n`;
    t += data.stickerHash ? '🖼 Figurinha de aura: definida\n' : '🖼 Figurinha de aura: não definida\n';
    t += `\n📋 Missões de hoje (${completedMissionIds.length}/3) – reset 00:00\n`;
    drawnMissions.forEach(id => {
      const cfg = aura.MISSIONS[id];
      if (!cfg) return;
      const val = progress[cfg.key] ?? 0;
      const done = completedMissionIds.includes(id);
      t += `${done ? '✅' : '⬜'} ${cfg.label}: ${done ? 'concluída' : `${val}/${cfg.target}`}\n`;
    });
    await sock.sendMessage(jid, { text: t, mentions: m.mentions.length ? m.mentions : undefined }, { quoted: raw });
    return true;
  }

  // !aura (help)
  if (lower === '!aura' || (lower.startsWith('!aura ') && !['figurinha', 'personagem', 'missoes', 'missões', 'farmar', 'doar', 'ranking', 'rank', 'info'].some(k => lower.includes(k)))) {
    const eventCommands = [...new Set(aura.RANDOM_EVENTS.map(e => e.command))].sort().join(', ');
    const t =
      '✨ *SISTEMA DE AURA — GUIA COMPLETO* ✨\n\n' +
      '📌 *O que é:* Aura é a moeda/status do bot. Você ganha ou perde aura com comandos, missões e eventos. Seu *nível* (NPC, Presença, Dominante, Sigma, Entidade, Deus do chat) depende dos pontos.\n\n' +
      '📈 *Níveis (títulos):*\n0 = NPC · 500 = Presença · 2.000 = Dominante · 5.000 = Sigma · 10.000 = Entidade · 50.000 = Deus do chat\n\n' +
      '—— *COMANDOS DE AÇÃO* ——\n' +
      '• *!meditar* — Chance de ganhar 0, 10, 20, 30, 40 ou 50 aura (sem cooldown)\n' +
      '• *!treinar* — 50% +500 aura, 50% -1000 aura. Cooldown: 1 hora\n' +
      '• *!dominar* — 50% +1000 aura, 50% nada. Cooldown: 12 horas\n' +
      '• *!ritual* — 50% +5000 ou 50% -5000 aura. Uma vez por dia\n' +
      '• *!respeito @usuario* — Transfere 50 de sua aura para a pessoa\n' +
      '• *!elogiar @usuario* — Dá +100 aura ao elogiado (sem tirar de você)\n' +
      '• *!provocar @usuario* — Mensagem de provocação\n' +
      '• *!elogiados me* — Lista quem te elogiou\n' +
      '• *!elogiados @usuario* — Lista quem elogiou a pessoa\n\n' +
      '—— *DUELOS E ATAQUES* ——\n' +
      '• *!mog @usuario* — Desafia para duelo. O desafiado usa *!mog aceitar*\n' +
      '• *!mognow @usuario* — Ataca alguém (15s quem mandar mais mensagens)\n' +
      '• *!aura farmar @usuario* — 50% tira 100 do alvo; 50% perde 200\n\n' +
      '—— *COMANDOS !aura* ——\n' +
      '• *!aura* — Este guia\n' +
      '• *!aura info me* — Suas informações\n' +
      '• *!aura info @usuario* — Informações de outra pessoa\n' +
      '• *!aura figurinha* — Definir figurinha de aura (+100 aura ao usar)\n' +
      '• *!aura personagem "nome"* — Definir seu personagem\n' +
      '• *!aura doar valor @usuario* — Doa aura para alguém\n' +
      '• *!aura missoes* — Ver suas 3 missões do dia\n' +
      '• *!aura ranking* — Top 10 global por aura\n\n' +
      '—— *EVENTOS ALEATÓRIOS* ——\n' +
      `Comandos que podem aparecer nos eventos: ${eventCommands}\n` +
      'Alguns eventos: primeiro a digitar ganha; outros: todos no tempo ganham. Cuidado com aura negativa!\n\n' +
      '—— *MISSÕES DIÁRIAS* ——\n' +
      'Todo dia 3 missões aleatórias. Concluir dá bônus de aura. Reset às 00:00.\n\n' +
      '_Use *!aura info me* para ver seu perfil completo._';
    await sock.sendMessage(jid, { text: t }, { quoted: raw });
    return true;
  }
}

// --- Passive hooks (called from router) ---

async function processAuraSticker(sock, msg) {
  const { jid, raw } = msg;
  if (raw.key.fromMe) return;

  const type = Object.keys(raw.message || {})[0];
  if (type !== 'stickerMessage') return;

  const sender = await users.resolveSender(raw);
  if (!sender) return;

  const hash = aura.getStickerHash(raw);
  if (!hash) return;

  const data = await aura.getAuraData(sender);
  if (!data || data.stickerHash !== hash) return;

  if (!data.stickerDataUrl) {
    try {
      const stickerMsg = aura.getStickerMsg(raw);
      if (stickerMsg) {
        const buffer = await downloadMediaMessage({ message: { stickerMessage: stickerMsg } }, 'buffer');
        if (buffer) await aura.setStickerData(sender, hash, `data:image/webp;base64,${buffer.toString('base64')}`);
      }
    } catch { /* ignore */ }
  }

  if (Math.random() >= 0.5) return;

  const msgId = raw.key?.id || `${jid}_${raw.messageTimestamp || Date.now()}`;
  if (processedStickerIds.has(msgId)) return;
  processedStickerIds.add(msgId);
  if (processedStickerIds.size >= MAX_STICKER_IDS) {
    const arr = [...processedStickerIds];
    processedStickerIds.clear();
    arr.slice(-MAX_STICKER_IDS / 2).forEach(id => processedStickerIds.add(id));
  }

  const newTotal = await aura.addPoints(sender, 100);
  await sock.sendMessage(jid, { text: `✨ +${aura.formatAura(100)} de aura! Total: *${aura.formatAura(newTotal)}*` }, { quoted: raw });
}

async function processAuraMissions(sock, msg) {
  const { jid, raw } = msg;
  if (raw.key.fromMe) return;

  const sender = await users.resolveSender(raw);
  if (!sender) return;

  if (await aura.hasMission(sender, 'messages_500')) {
    const result = await aura.incrementProgress(sender, 'messages_500', 1);
    if (result) await sock.sendMessage(jid, { text: `📬 Missão "Mande 50 mensagens" concluída! *+${aura.formatAura(result.reward)}* aura.` }, { quoted: raw });
  }

  const type = Object.keys(raw.message || {})[0];
  const isMedia = ['stickerMessage', 'imageMessage', 'videoMessage', 'documentMessage'].includes(type);
  if (isMedia && await aura.hasMission(sender, 'send_media')) {
    const result = await aura.incrementProgress(sender, 'send_media', 1);
    if (result) await sock.sendMessage(jid, { text: `📎 Missão "Envie mídia" concluída! *+${aura.formatAura(result.reward)}* aura.` }, { quoted: raw });
  }
}

async function handleAuraReaction(sock, item) {
  const reaction = item?.reaction || item;
  const key = reaction?.key || item?.key;
  if (!key || key.fromMe) return;

  const chatId = key.remoteJid;
  if (!chatId) return;

  const reactionText = reaction?.text || '';
  if (reactionText !== '💀' && reactionText !== '☠️') return;

  const sender = await repo.resolveCanonicalUserId(key);
  if (!sender) return;

  if (!(await aura.hasMission(sender, 'reactions_500'))) return;

  const result = await aura.incrementProgress(sender, 'reactions_500', 1);
  if (result) {
    await sock.sendMessage(chatId, { text: `💀 Missão "Reaja 20x com 💀 ou ☠️" concluída! *+${aura.formatAura(result.reward)}* aura.` }).catch(() => {});
  }
}

module.exports = auraCommand;
module.exports.processAuraSticker = processAuraSticker;
module.exports.processAuraMissions = processAuraMissions;
module.exports.handleAuraReaction = handleAuraReaction;
