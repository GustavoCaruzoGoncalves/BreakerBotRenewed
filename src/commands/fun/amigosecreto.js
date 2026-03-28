const config = require('../../config');
const repo = require('../../database/repository');
const mentions = require('../../lib/mentions');

// --- Helpers ---

async function loadParticipantes() {
  return repo.getAmigoSecretoAll().catch(() => ({}));
}

async function saveParticipantes(data) {
  for (const [gid, gdata] of Object.entries(data)) {
    await repo.saveAmigoSecretoGroup(gid, gdata).catch(e => console.error('Erro salvar amigo secreto:', e));
  }
}

function getParticipantName(jid, usersData, contactsCache) {
  if (usersData[jid]?.pushName) return usersData[jid].pushName;
  for (const [, u] of Object.entries(usersData)) {
    if (u.jid === jid && u.pushName) return u.pushName;
  }
  const c = contactsCache?.[jid];
  return c?.notify || c?.name || c?.pushname || jid.split('@')[0];
}

async function updateNames(data, chatId, usersData, contactsCache) {
  const group = data[chatId];
  if (!group?.participantes?.length) return false;

  let changed = false;
  const nomes = group.nomes || {};
  for (const jid of group.participantes) {
    if (nomes[jid] && /^Participante \d+$/.test(nomes[jid])) {
      const real = getParticipantName(jid, usersData, contactsCache);
      const num = jid.split('@')[0];
      if (real && real.trim() && real !== num) {
        nomes[jid] = real;
        changed = true;
      }
    }
  }
  if (changed) group.nomes = nomes;
  return changed;
}

async function findGroupByName(sock, name) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (const gid in groups) {
      if (groups[gid].subject?.toLowerCase() === name.toLowerCase()) return gid;
    }
  } catch (e) { console.error('Erro buscar grupos:', e); }
  return null;
}

function sortear(participantes) {
  if (participantes.length < 2) return null;
  if (participantes.length === 2) {
    return { [participantes[0]]: participantes[1], [participantes[1]]: participantes[0] };
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    const shuffled = [...participantes];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (participantes.every((p, i) => p !== shuffled[i])) {
      return Object.fromEntries(participantes.map((p, i) => [p, shuffled[i]]));
    }
  }

  return Object.fromEntries(participantes.map((p, i) => [p, participantes[(i + 1) % participantes.length]]));
}

function findJid(participant, participantAlt, list) {
  if (participant && list.includes(participant)) return participant;
  if (participantAlt && list.includes(participantAlt)) return participantAlt;
  return null;
}

function buildGiftList(participantes, presentes) {
  const com = [], sem = [];
  for (const jid of participantes) {
    if (presentes[jid]) com.push({ jid, presente: presentes[jid] });
    else sem.push(jid);
  }
  let text = '';
  if (com.length > 0) {
    text += '🎁 *Com presentes:*\n';
    com.forEach((item, i) => { text += `${i + 1}. @${item.jid.split('@')[0]} - *${item.presente}*\n`; });
    text += '\n';
  }
  if (sem.length > 0) {
    text += '⚠️ *Ainda não escolheram:*\n';
    sem.forEach((jid, i) => { text += `${i + 1}. @${jid.split('@')[0]}\n`; });
  }
  return { text, mentions: [...com.map(i => i.jid), ...sem] };
}

// --- Subcommand: listaPresente ---

async function handleListaPresente(sock, msg, subCmd, data, chatId, isGroup, contactsCache) {
  const participant = msg.raw.key.participant;
  const participantAlt = msg.raw.key.participantAlt;

  if (subCmd === 'add' || subCmd === 'delete' || subCmd === 'edit') {
    if (!isGroup) {
      await sock.sendMessage(chatId, { text: '❌ Este comando só pode ser usado em grupos!' }, { quoted: msg.raw });
      return;
    }
    if (!data[chatId]?.participantes) {
      await sock.sendMessage(chatId, { text: '❌ Nenhum participante adicionado ao amigo secreto ainda!\n\n💡 Use *!amigoSecreto add* primeiro.' }, { quoted: msg.raw });
      return;
    }

    const myJid = findJid(participant, participantAlt, data[chatId].participantes);
    if (!myJid) {
      await sock.sendMessage(chatId, { text: '❌ Você não está na lista de participantes do amigo secreto!' }, { quoted: msg.raw });
      return;
    }

    if (!data[chatId].presentes) data[chatId].presentes = {};

    if (subCmd === 'add') {
      const presente = msg.text.slice('!amigosecreto listapresente add'.length).trim();
      if (!presente) {
        await sock.sendMessage(chatId, { text: '❌ Especifique o presente!\n\n💡 Use: !amigoSecreto listaPresente add <presente>' }, { quoted: msg.raw });
        return;
      }
      const atual = data[chatId].presentes[myJid];
      data[chatId].presentes[myJid] = atual ? `${atual}, ${presente}` : presente;
      await saveParticipantes(data);
      await sock.sendMessage(chatId, { text: `✅ Presente adicionado!\n\n🎁 Seus desejos: *${data[chatId].presentes[myJid]}*` }, { quoted: msg.raw });
    } else if (subCmd === 'delete') {
      if (!data[chatId].presentes[myJid]) {
        await sock.sendMessage(chatId, { text: '❌ Você não tem nenhum presente cadastrado!' }, { quoted: msg.raw });
        return;
      }
      delete data[chatId].presentes[myJid];
      await saveParticipantes(data);
      await sock.sendMessage(chatId, { text: '✅ Presente removido com sucesso!' }, { quoted: msg.raw });
    } else {
      const presente = msg.text.slice('!amigosecreto listapresente edit'.length).trim();
      if (!presente) {
        await sock.sendMessage(chatId, { text: '❌ Especifique o novo presente!\n\n💡 Use: !amigoSecreto listaPresente edit <presente>' }, { quoted: msg.raw });
        return;
      }
      data[chatId].presentes[myJid] = presente;
      await saveParticipantes(data);
      await sock.sendMessage(chatId, { text: `✅ Presente editado!\n\n🎁 Seu desejo: *${presente}*` }, { quoted: msg.raw });
    }
    return;
  }

  if (subCmd === 'grupo') {
    if (isGroup) {
      await sock.sendMessage(chatId, { text: '❌ Este comando só pode ser usado no privado!' }, { quoted: msg.raw });
      return;
    }
    const match = msg.text.match(/grupo\s+["'](.+?)["']/i);
    if (!match) {
      await sock.sendMessage(chatId, { text: '❌ Especifique o nome do grupo entre aspas!\n\n💡 Use: !amigoSecreto listaPresente grupo "Nome do Grupo"' }, { quoted: msg.raw });
      return;
    }
    const groupId = await findGroupByName(sock, match[1]);
    if (!groupId) {
      await sock.sendMessage(chatId, { text: `❌ Grupo "${match[1]}" não encontrado!` }, { quoted: msg.raw });
      return;
    }
    if (!data[groupId]?.participantes) {
      await sock.sendMessage(chatId, { text: '❌ Nenhum participante neste grupo!' }, { quoted: msg.raw });
      return;
    }
    try {
      const meta = await sock.groupMetadata(groupId);
      const list = buildGiftList(data[groupId].participantes, data[groupId].presentes || {});
      await sock.sendMessage(chatId, { text: `📋 *Lista de Presentes - ${meta.subject}*\n\n${list.text}`, mentions: list.mentions }, { quoted: msg.raw });
    } catch (e) {
      console.error('Erro dados grupo:', e);
      await sock.sendMessage(chatId, { text: '❌ Erro ao obter informações do grupo.' }, { quoted: msg.raw });
    }
    return;
  }

  if (!isGroup) {
    await sock.sendMessage(chatId, { text: '❌ Este comando só pode ser usado em grupos!\n\n💡 No privado: !amigoSecreto listaPresente grupo "Nome do Grupo"' }, { quoted: msg.raw });
    return;
  }
  if (!data[chatId]?.participantes) {
    await sock.sendMessage(chatId, { text: '❌ Nenhum participante ainda!\n\n💡 Use *!amigoSecreto add* primeiro.' }, { quoted: msg.raw });
    return;
  }
  const list = buildGiftList(data[chatId].participantes, data[chatId].presentes || {});
  await sock.sendMessage(chatId, { text: `📋 *Lista de Presentes*\n\n${list.text}`, mentions: list.mentions }, { quoted: msg.raw });
}

// --- Main handler ---

async function amigoSecretoCommand(sock, msg) {
  const { text, jid, raw } = msg;
  if (!text || raw.key.fromMe) return;
  if (!text.toLowerCase().startsWith('!amigosecreto')) return;

  const chatId = jid;
  const isGroup = chatId.endsWith('@g.us');
  const sender = isGroup ? (raw.key.participantAlt || raw.key.participant || chatId) : chatId;
  const contactsCache = {};

  const parts = text.toLowerCase().split(/\s+/);
  const cmd = parts[1];
  const sub = parts[2];

  if (isGroup) {
    const data = await loadParticipantes();
    const usersData = await repo.getAllUsers().catch(() => ({}));
    if (await updateNames(data, chatId, usersData, contactsCache)) {
      await saveParticipantes(data);
    }
  }

  if (cmd === 'listapresente') {
    const data = await loadParticipantes();
    await handleListaPresente(sock, msg, sub, data, chatId, isGroup, contactsCache);
    return true;
  }

  if (!config.admins.includes(sender)) {
    await sock.sendMessage(chatId, { text: '❌ Apenas administradores podem usar comandos de amigo secreto.' }, { quoted: raw });
    return true;
  }

  if (!isGroup) {
    await sock.sendMessage(chatId, { text: '❌ Este comando só pode ser usado em grupos!' }, { quoted: raw });
    return true;
  }

  if (cmd === 'add') {
    const rawMentions = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const resolved = await Promise.all(rawMentions.map(r => repo.findUserIdByJid(r).then(id => id || r)));

    const words = text.toLowerCase().split(/\s+/);
    const mePos = words.findIndex(w => w === 'me' || w === 'eu');
    const includeAdmin = mePos >= 0;

    let list = [];
    if (includeAdmin) {
      if (mePos <= 2) { list.push(sender); list.push(...resolved); }
      else {
        const pos = Math.min(mePos - 2, resolved.length);
        list.push(...resolved.slice(0, pos), sender, ...resolved.slice(pos));
      }
    } else {
      list = [...resolved];
    }

    if (list.length === 0) {
      await sock.sendMessage(chatId, { text: '❌ Marque participantes ou use "me"/"eu"!\n\n💡 !amigoSecreto add @pessoa1 @pessoa2 ...' }, { quoted: raw });
      return true;
    }

    const unique = [...new Set(list)];
    const data = await loadParticipantes();
    const usersData = await repo.getAllUsers().catch(() => ({}));

    let groupName = 'Grupo Desconhecido';
    try { groupName = (await sock.groupMetadata(chatId)).subject || groupName; } catch {}

    const nomes = {};
    unique.forEach((jid, i) => {
      const real = getParticipantName(jid, usersData, contactsCache);
      const num = jid.split('@')[0];
      nomes[jid] = (real && real.trim() && real !== num) ? real : `Participante ${i + 1}`;
    });

    if (!data[chatId]) data[chatId] = { groupName, participantes: [], presentes: {}, nomes: {}, sorteio: null };
    Object.assign(data[chatId], { groupName, participantes: unique, nomes, sorteio: null });
    if (!data[chatId].presentes) data[chatId].presentes = {};
    await saveParticipantes(data);

    let confirm = `✅ *Participantes adicionados ao Amigo Secreto!*\n\n📋 *Total:* ${unique.length}\n\n👥 *Participantes:*\n`;
    unique.forEach((jid, i) => {
      const num = jid.split('@')[0];
      const nome = nomes[jid];
      const hasReal = nome && nome.trim() && nome !== num;
      confirm += `${i + 1}. ${hasReal ? nome + ' (@' + num + ')' : '@' + num}\n`;
    });
    confirm += '\n💡 Use *!amigoSecreto sortear* para realizar o sorteio!';
    await sock.sendMessage(chatId, { text: confirm, mentions: unique }, { quoted: raw });
    return true;
  }

  if (cmd === 'sortear') {
    const data = await loadParticipantes();
    const group = data[chatId] || {};
    const participantes = group.participantes || [];
    const nomes = group.nomes || {};
    const presentes = group.presentes || {};

    if (participantes.length < 2) {
      await sock.sendMessage(chatId, { text: '❌ Precisa de pelo menos 2 participantes!\n\n💡 Use *!amigoSecreto add* primeiro.' }, { quoted: raw });
      return true;
    }

    const result = sortear(participantes);
    if (!result) {
      await sock.sendMessage(chatId, { text: '❌ Erro ao realizar o sorteio. Tente novamente.' }, { quoted: raw });
      return true;
    }

    data[chatId].sorteio = result;
    data[chatId].sorteioData = new Date().toISOString();
    await saveParticipantes(data);

    let groupName = 'o grupo';
    try { groupName = (await sock.groupMetadata(chatId)).subject || groupName; } catch {}

    let ok = 0, fail = 0;
    for (const [giver, receiver] of Object.entries(result)) {
      try {
        const nome = nomes[receiver] || receiver.split('@')[0];
        let dm = `🎁 *Amigo Secreto Sorteado!*\n\n📱 *Grupo:* ${groupName}\n\n🎉 Você foi sorteado para presentear:\n\n👤 *${nome}* (@${receiver.split('@')[0]})\n`;
        if (presentes[receiver]) dm += `\n🎁 *Presente desejado:* ${presentes[receiver]}\n`;
        dm += '\n💝 Boa sorte com o presente!';
        await sock.sendMessage(giver, { text: dm, mentions: [receiver] });
        ok++;
        await new Promise(r => setTimeout(r, 500));
      } catch { fail++; }
    }

    let confirm = `✅ *Sorteio realizado com sucesso!*\n\n📤 Mensagens enviadas: ${ok}\n`;
    if (fail > 0) confirm += `⚠️ Falhas: ${fail}\n`;
    confirm += '\n💬 Todos receberam no privado quem é seu amigo secreto!\n\n👥 *Participantes:*\n';
    participantes.forEach((jid, i) => {
      const num = jid.split('@')[0];
      const nome = nomes[jid];
      confirm += `${i + 1}. ${(nome && nome.trim() && nome !== num) ? nome : '@' + num}\n`;
    });
    await sock.sendMessage(chatId, { text: confirm, mentions: participantes }, { quoted: raw });
    return true;
  }

  if (cmd === 'lista') {
    const data = await loadParticipantes();
    const participantes = data[chatId]?.participantes || [];
    if (participantes.length === 0) {
      await sock.sendMessage(chatId, { text: '❌ Nenhum participante ainda!\n\n💡 Use *!amigoSecreto add* primeiro.' }, { quoted: raw });
      return true;
    }
    let text2 = `📋 *Lista de Participantes do Amigo Secreto*\n\n👥 *Total:* ${participantes.length}\n\n*Participantes:*\n`;
    participantes.forEach((jid, i) => { text2 += `${i + 1}. @${jid.split('@')[0]}\n`; });
    text2 += '\n💡 Use *!amigoSecreto sortear* para realizar o sorteio!';
    await sock.sendMessage(chatId, { text: text2, mentions: participantes }, { quoted: raw });
    return true;
  }

  await sock.sendMessage(chatId, {
    text: `📖 *Como usar o Amigo Secreto:*\n\n` +
      `✅ *!amigoSecreto add* - Marque participantes (ou "me"/"eu")\n` +
      `📋 *!amigoSecreto lista* - Lista de participantes\n` +
      `🎁 *!amigoSecreto listaPresente add <presente>* - Seu desejo\n` +
      `✏️ *!amigoSecreto listaPresente edit <presente>* - Editar\n` +
      `🗑️ *!amigoSecreto listaPresente delete* - Remover\n` +
      `📋 *!amigoSecreto listaPresente* - Ver todos\n` +
      `📋 *!amigoSecreto listaPresente grupo "nome"* - No PV\n` +
      `🎲 *!amigoSecreto sortear* - Realiza o sorteio`,
  }, { quoted: raw });
  return true;
}

module.exports = amigoSecretoCommand;
