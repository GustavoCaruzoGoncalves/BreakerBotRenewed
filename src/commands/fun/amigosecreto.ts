import { config } from '../../config.js';
import * as repo from '../../database/repository.js';
import type { AmigoSecretoMap, UsersMap } from '../../database/types.js';
import type { BotMessage, Command, CommandHandler, WASocket } from '../../types/bot.js';

/**
 * O código legado consultava um cache de contatos do Baileys que nunca chegou a ser
 * populado; o objeto continua aqui para preservar a ordem de resolução dos nomes.
 */
interface ContactInfo {
  notify?: string;
  name?: string;
  pushname?: string;
}

type ContactsCache = Record<string, ContactInfo>;

// --- Helpers ---

async function loadParticipantes(): Promise<AmigoSecretoMap> {
  return repo.getAmigoSecretoAll().catch(() => ({}) as AmigoSecretoMap);
}

async function saveParticipantes(data: AmigoSecretoMap): Promise<void> {
  for (const [gid, gdata] of Object.entries(data)) {
    await repo
      .saveAmigoSecretoGroup(gid, gdata)
      .catch((e: unknown) => console.error('Erro salvar amigo secreto:', e));
  }
}

function getParticipantName(
  jid: string,
  usersData: UsersMap,
  contactsCache: ContactsCache,
): string {
  const direct = usersData[jid];
  if (direct?.pushName) return direct.pushName;
  for (const u of Object.values(usersData)) {
    if (u.jid === jid && u.pushName) return u.pushName;
  }
  const c = contactsCache[jid];
  return c?.notify || c?.name || c?.pushname || (jid.split('@')[0] ?? jid);
}

function updateNames(
  data: AmigoSecretoMap,
  chatId: string,
  usersData: UsersMap,
  contactsCache: ContactsCache,
): boolean {
  const group = data[chatId];
  if (!group?.participantes?.length) return false;

  let changed = false;
  const nomes = group.nomes || {};
  for (const jid of group.participantes) {
    const current = nomes[jid];
    if (current && /^Participante \d+$/.test(current)) {
      const real = getParticipantName(jid, usersData, contactsCache);
      const num = jid.split('@')[0];
      if (real.trim() && real !== num) {
        nomes[jid] = real;
        changed = true;
      }
    }
  }
  if (changed) group.nomes = nomes;
  return changed;
}

async function findGroupByName(sock: WASocket, name: string): Promise<string | null> {
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (const [gid, meta] of Object.entries(groups)) {
      if (meta.subject?.toLowerCase() === name.toLowerCase()) return gid;
    }
  } catch (e) {
    console.error('Erro buscar grupos:', e);
  }
  return null;
}

/** Mapa presenteador → presenteado, garantindo que ninguém tire a si mesmo. */
function sortear(participantes: string[]): Record<string, string> | null {
  const [first, second] = participantes;
  if (participantes.length < 2 || !first || !second) return null;
  if (participantes.length === 2) {
    return { [first]: second, [second]: first };
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    const shuffled = [...participantes];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = shuffled[i];
      const b = shuffled[j];
      if (a !== undefined && b !== undefined) {
        shuffled[i] = b;
        shuffled[j] = a;
      }
    }
    if (participantes.every((p, i) => p !== shuffled[i])) {
      return Object.fromEntries(participantes.map((p, i) => [p, shuffled[i] as string]));
    }
  }

  return Object.fromEntries(
    participantes.map((p, i) => [p, participantes[(i + 1) % participantes.length] as string]),
  );
}

function findJid(
  participant: string | null | undefined,
  participantAlt: string | null | undefined,
  list: string[],
): string | null {
  if (participant && list.includes(participant)) return participant;
  if (participantAlt && list.includes(participantAlt)) return participantAlt;
  return null;
}

interface GiftList {
  text: string;
  mentions: string[];
}

function buildGiftList(participantes: string[], presentes: Record<string, string>): GiftList {
  const com: Array<{ jid: string; presente: string }> = [];
  const sem: string[] = [];
  for (const jid of participantes) {
    const presente = presentes[jid];
    if (presente) com.push({ jid, presente });
    else sem.push(jid);
  }
  let text = '';
  if (com.length > 0) {
    text += '🎁 *Com presentes:*\n';
    com.forEach((item, i) => {
      text += `${i + 1}. @${item.jid.split('@')[0]} - *${item.presente}*\n`;
    });
    text += '\n';
  }
  if (sem.length > 0) {
    text += '⚠️ *Ainda não escolheram:*\n';
    sem.forEach((jid, i) => {
      text += `${i + 1}. @${jid.split('@')[0]}\n`;
    });
  }
  return { text, mentions: [...com.map((i) => i.jid), ...sem] };
}

// --- Subcommand: listaPresente ---

async function handleListaPresente(
  sock: WASocket,
  msg: BotMessage,
  subCmd: string | undefined,
  data: AmigoSecretoMap,
  chatId: string,
  isGroup: boolean,
  contactsCache: ContactsCache,
): Promise<void> {
  void contactsCache;
  const participant = msg.raw.key.participant;
  const participantAlt = msg.raw.key.participantAlt;

  if (subCmd === 'add' || subCmd === 'delete' || subCmd === 'edit') {
    if (!isGroup) {
      await sock.sendMessage(
        chatId,
        { text: '❌ Este comando só pode ser usado em grupos!' },
        { quoted: msg.raw },
      );
      return;
    }
    const group = data[chatId];
    if (!group?.participantes) {
      await sock.sendMessage(
        chatId,
        {
          text: '❌ Nenhum participante adicionado ao amigo secreto ainda!\n\n💡 Use *!amigoSecreto add* primeiro.',
        },
        { quoted: msg.raw },
      );
      return;
    }

    const myJid = findJid(participant, participantAlt, group.participantes);
    if (!myJid) {
      await sock.sendMessage(
        chatId,
        { text: '❌ Você não está na lista de participantes do amigo secreto!' },
        { quoted: msg.raw },
      );
      return;
    }

    if (!group.presentes) group.presentes = {};

    if (subCmd === 'add') {
      const presente = msg.text.slice('!amigosecreto listapresente add'.length).trim();
      if (!presente) {
        await sock.sendMessage(
          chatId,
          {
            text: '❌ Especifique o presente!\n\n💡 Use: !amigoSecreto listaPresente add <presente>',
          },
          { quoted: msg.raw },
        );
        return;
      }
      const atual = group.presentes[myJid];
      group.presentes[myJid] = atual ? `${atual}, ${presente}` : presente;
      await saveParticipantes(data);
      await sock.sendMessage(
        chatId,
        { text: `✅ Presente adicionado!\n\n🎁 Seus desejos: *${group.presentes[myJid]}*` },
        { quoted: msg.raw },
      );
    } else if (subCmd === 'delete') {
      if (!group.presentes[myJid]) {
        await sock.sendMessage(
          chatId,
          { text: '❌ Você não tem nenhum presente cadastrado!' },
          { quoted: msg.raw },
        );
        return;
      }
      delete group.presentes[myJid];
      await saveParticipantes(data);
      await sock.sendMessage(
        chatId,
        { text: '✅ Presente removido com sucesso!' },
        { quoted: msg.raw },
      );
    } else {
      const presente = msg.text.slice('!amigosecreto listapresente edit'.length).trim();
      if (!presente) {
        await sock.sendMessage(
          chatId,
          {
            text: '❌ Especifique o novo presente!\n\n💡 Use: !amigoSecreto listaPresente edit <presente>',
          },
          { quoted: msg.raw },
        );
        return;
      }
      group.presentes[myJid] = presente;
      await saveParticipantes(data);
      await sock.sendMessage(
        chatId,
        { text: `✅ Presente editado!\n\n🎁 Seu desejo: *${presente}*` },
        { quoted: msg.raw },
      );
    }
    return;
  }

  if (subCmd === 'grupo') {
    if (isGroup) {
      await sock.sendMessage(
        chatId,
        { text: '❌ Este comando só pode ser usado no privado!' },
        { quoted: msg.raw },
      );
      return;
    }
    const match = msg.text.match(/grupo\s+["'](.+?)["']/i);
    const groupNameArg = match?.[1];
    if (!groupNameArg) {
      await sock.sendMessage(
        chatId,
        {
          text: '❌ Especifique o nome do grupo entre aspas!\n\n💡 Use: !amigoSecreto listaPresente grupo "Nome do Grupo"',
        },
        { quoted: msg.raw },
      );
      return;
    }
    const groupId = await findGroupByName(sock, groupNameArg);
    if (!groupId) {
      await sock.sendMessage(
        chatId,
        { text: `❌ Grupo "${groupNameArg}" não encontrado!` },
        { quoted: msg.raw },
      );
      return;
    }
    const group = data[groupId];
    if (!group?.participantes) {
      await sock.sendMessage(
        chatId,
        { text: '❌ Nenhum participante neste grupo!' },
        { quoted: msg.raw },
      );
      return;
    }
    try {
      const meta = await sock.groupMetadata(groupId);
      const list = buildGiftList(group.participantes, group.presentes || {});
      await sock.sendMessage(
        chatId,
        {
          text: `📋 *Lista de Presentes - ${meta.subject}*\n\n${list.text}`,
          mentions: list.mentions,
        },
        { quoted: msg.raw },
      );
    } catch (e) {
      console.error('Erro dados grupo:', e);
      await sock.sendMessage(
        chatId,
        { text: '❌ Erro ao obter informações do grupo.' },
        { quoted: msg.raw },
      );
    }
    return;
  }

  if (!isGroup) {
    await sock.sendMessage(
      chatId,
      {
        text: '❌ Este comando só pode ser usado em grupos!\n\n💡 No privado: !amigoSecreto listaPresente grupo "Nome do Grupo"',
      },
      { quoted: msg.raw },
    );
    return;
  }
  const group = data[chatId];
  if (!group?.participantes) {
    await sock.sendMessage(
      chatId,
      { text: '❌ Nenhum participante ainda!\n\n💡 Use *!amigoSecreto add* primeiro.' },
      { quoted: msg.raw },
    );
    return;
  }
  const list = buildGiftList(group.participantes, group.presentes || {});
  await sock.sendMessage(
    chatId,
    { text: `📋 *Lista de Presentes*\n\n${list.text}`, mentions: list.mentions },
    { quoted: msg.raw },
  );
}

// --- Main handler ---

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (!text || raw.key.fromMe) return;
  if (!text.toLowerCase().startsWith('!amigosecreto')) return;

  const chatId = jid;
  const isGroup = chatId.endsWith('@g.us');
  const sender = isGroup ? raw.key.participantAlt || raw.key.participant || chatId : chatId;
  const contactsCache: ContactsCache = {};

  const parts = text.toLowerCase().split(/\s+/);
  const cmd = parts[1];
  const sub = parts[2];

  if (isGroup) {
    const data = await loadParticipantes();
    const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);
    if (updateNames(data, chatId, usersData, contactsCache)) {
      await saveParticipantes(data);
    }
  }

  if (cmd === 'listapresente') {
    const data = await loadParticipantes();
    await handleListaPresente(sock, msg, sub, data, chatId, isGroup, contactsCache);
    return true;
  }

  if (!config.admins.includes(sender)) {
    await sock.sendMessage(
      chatId,
      { text: '❌ Apenas administradores podem usar comandos de amigo secreto.' },
      { quoted: raw },
    );
    return true;
  }

  if (!isGroup) {
    await sock.sendMessage(
      chatId,
      { text: '❌ Este comando só pode ser usado em grupos!' },
      { quoted: raw },
    );
    return true;
  }

  if (cmd === 'add') {
    const rawMentions = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    const resolved = await Promise.all(
      rawMentions.map((r) => repo.findUserIdByJid(r).then((id) => id ?? r)),
    );

    const words = text.toLowerCase().split(/\s+/);
    const mePos = words.findIndex((w) => w === 'me' || w === 'eu');
    const includeAdmin = mePos >= 0;

    let list: string[] = [];
    if (includeAdmin) {
      if (mePos <= 2) {
        list.push(sender);
        list.push(...resolved);
      } else {
        const pos = Math.min(mePos - 2, resolved.length);
        list.push(...resolved.slice(0, pos), sender, ...resolved.slice(pos));
      }
    } else {
      list = [...resolved];
    }

    if (list.length === 0) {
      await sock.sendMessage(
        chatId,
        {
          text: '❌ Marque participantes ou use "me"/"eu"!\n\n💡 !amigoSecreto add @pessoa1 @pessoa2 ...',
        },
        { quoted: raw },
      );
      return true;
    }

    const unique = [...new Set(list)];
    const data = await loadParticipantes();
    const usersData = await repo.getAllUsers().catch(() => ({}) as UsersMap);

    let groupName = 'Grupo Desconhecido';
    try {
      groupName = (await sock.groupMetadata(chatId)).subject || groupName;
    } catch {
      /* metadados indisponíveis: mantém o nome padrão */
    }

    const nomes: Record<string, string> = {};
    unique.forEach((participantJid, i) => {
      const real = getParticipantName(participantJid, usersData, contactsCache);
      const num = participantJid.split('@')[0];
      nomes[participantJid] = real.trim() && real !== num ? real : `Participante ${i + 1}`;
    });

    const existing = data[chatId];
    if (!existing) {
      data[chatId] = {
        groupName,
        participantes: [],
        presentes: {},
        nomes: {},
        sorteio: null,
        sorteioData: null,
      };
    }
    const group = data[chatId];
    if (!group) return true;
    Object.assign(group, { groupName, participantes: unique, nomes, sorteio: null });
    if (!group.presentes) group.presentes = {};
    await saveParticipantes(data);

    let confirm = `✅ *Participantes adicionados ao Amigo Secreto!*\n\n📋 *Total:* ${unique.length}\n\n👥 *Participantes:*\n`;
    unique.forEach((participantJid, i) => {
      const num = participantJid.split('@')[0];
      const nome = nomes[participantJid];
      const hasReal = nome && nome.trim() && nome !== num;
      confirm += `${i + 1}. ${hasReal ? `${nome} (@${num})` : `@${num}`}\n`;
    });
    confirm += '\n💡 Use *!amigoSecreto sortear* para realizar o sorteio!';
    await sock.sendMessage(chatId, { text: confirm, mentions: unique }, { quoted: raw });
    return true;
  }

  if (cmd === 'sortear') {
    const data = await loadParticipantes();
    const group = data[chatId];
    const participantes = group?.participantes ?? [];
    const nomes = group?.nomes ?? {};
    const presentes = group?.presentes ?? {};

    if (!group || participantes.length < 2) {
      await sock.sendMessage(
        chatId,
        {
          text: '❌ Precisa de pelo menos 2 participantes!\n\n💡 Use *!amigoSecreto add* primeiro.',
        },
        { quoted: raw },
      );
      return true;
    }

    const result = sortear(participantes);
    if (!result) {
      await sock.sendMessage(
        chatId,
        { text: '❌ Erro ao realizar o sorteio. Tente novamente.' },
        { quoted: raw },
      );
      return true;
    }

    group.sorteio = result;
    group.sorteioData = new Date().toISOString();
    await saveParticipantes(data);

    let groupName = 'o grupo';
    try {
      groupName = (await sock.groupMetadata(chatId)).subject || groupName;
    } catch {
      /* metadados indisponíveis: mantém o nome padrão */
    }

    let ok = 0;
    let fail = 0;
    for (const [giver, receiver] of Object.entries(result)) {
      try {
        const nome = nomes[receiver] || receiver.split('@')[0];
        let dm = `🎁 *Amigo Secreto Sorteado!*\n\n📱 *Grupo:* ${groupName}\n\n🎉 Você foi sorteado para presentear:\n\n👤 *${nome}* (@${receiver.split('@')[0]})\n`;
        if (presentes[receiver]) dm += `\n🎁 *Presente desejado:* ${presentes[receiver]}\n`;
        dm += '\n💝 Boa sorte com o presente!';
        await sock.sendMessage(giver, { text: dm, mentions: [receiver] });
        ok++;
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        fail++;
      }
    }

    let confirm = `✅ *Sorteio realizado com sucesso!*\n\n📤 Mensagens enviadas: ${ok}\n`;
    if (fail > 0) confirm += `⚠️ Falhas: ${fail}\n`;
    confirm += '\n💬 Todos receberam no privado quem é seu amigo secreto!\n\n👥 *Participantes:*\n';
    participantes.forEach((participantJid, i) => {
      const num = participantJid.split('@')[0];
      const nome = nomes[participantJid];
      confirm += `${i + 1}. ${nome && nome.trim() && nome !== num ? nome : `@${num}`}\n`;
    });
    await sock.sendMessage(chatId, { text: confirm, mentions: participantes }, { quoted: raw });
    return true;
  }

  if (cmd === 'lista') {
    const data = await loadParticipantes();
    const participantes = data[chatId]?.participantes ?? [];
    if (participantes.length === 0) {
      await sock.sendMessage(
        chatId,
        { text: '❌ Nenhum participante ainda!\n\n💡 Use *!amigoSecreto add* primeiro.' },
        { quoted: raw },
      );
      return true;
    }
    let listText = `📋 *Lista de Participantes do Amigo Secreto*\n\n👥 *Total:* ${participantes.length}\n\n*Participantes:*\n`;
    participantes.forEach((participantJid, i) => {
      listText += `${i + 1}. @${participantJid.split('@')[0]}\n`;
    });
    listText += '\n💡 Use *!amigoSecreto sortear* para realizar o sorteio!';
    await sock.sendMessage(chatId, { text: listText, mentions: participantes }, { quoted: raw });
    return true;
  }

  await sock.sendMessage(
    chatId,
    {
      text:
        `📖 *Como usar o Amigo Secreto:*\n\n` +
        `✅ *!amigoSecreto add* - Marque participantes (ou "me"/"eu")\n` +
        `📋 *!amigoSecreto lista* - Lista de participantes\n` +
        `🎁 *!amigoSecreto listaPresente add <presente>* - Seu desejo\n` +
        `✏️ *!amigoSecreto listaPresente edit <presente>* - Editar\n` +
        `🗑️ *!amigoSecreto listaPresente delete* - Remover\n` +
        `📋 *!amigoSecreto listaPresente* - Ver todos\n` +
        `📋 *!amigoSecreto listaPresente grupo "nome"* - No PV\n` +
        `🎲 *!amigoSecreto sortear* - Realiza o sorteio`,
    },
    { quoted: raw },
  );
  return true;
};

const amigoSecretoCommand: Command = {
  meta: {
    category: 'Zueiras',
    entries: [
      {
        trigger: '!amigosecreto',
        description: 'Organiza o amigo secreto do grupo',
        groupOnly: true,
        usages: [
          {
            syntax: '!amigosecreto listapresente',
            description: 'Sua lista de presentes (*add*, *edit*, *ver*)',
          },
          { syntax: '!amigosecreto add @fulano', description: 'Adiciona participantes *(admins)*' },
          { syntax: '!amigosecreto sortear', description: 'Sorteia e avisa cada um *(admins)*' },
          { syntax: '!amigosecreto lista', description: 'Mostra os participantes *(admins)*' },
        ],
      },
    ],
  },
  handle,
};

export default amigoSecretoCommand;
