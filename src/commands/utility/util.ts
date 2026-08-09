import fs from 'node:fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as repo from '../../database/repository.js';
import { config, optionalEnv, projectPath } from '../../config.js';
import * as users from '../../services/users.js';
import { getErrorMessage } from '../../lib/errors.js';
import { renderMenu } from '../../lib/menu.js';
import { getCommands } from '../registry.js';
import type { BotMessage, Command, CommandHandler, WASocket } from '../../types/bot.js';

/** `!js` envia o fonte das zueiras; após a migração o arquivo é TypeScript. */
const JOKES_PATH = projectPath('src', 'commands', 'fun', 'jokes.ts');

const searchByChat = new Map<string, GeniusHit[]>();

interface GeniusHit {
  result: {
    id: number;
    title: string;
    primary_artist: { name: string };
  };
}

interface GeniusSearchResponse {
  response: { hits: GeniusHit[] };
}

interface GeniusSongResponse {
  response: { song: { embed_content?: string } };
}

function formatLyricsText(raw: string): string {
  return raw
    .replace(/Translations\s*(?:[\s\S]*?)?Baby Lyrics\s*/i, '')
    .replace(/^\s*\d+\s+Contributors\s*/i, '')
    .replace(/\[Produced by[^\]]*\]/i, '')
    .replace(/\[([^\]]+)\]/g, '\n\n[$1]')
    .replace(/([a-z])([A-Z])/g, '$1\n$2')
    .replace(/([.?!])(?=\S)/g, '$1 ')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .slice(0, 4000);
}

async function handleLyrics(sock: WASocket, msg: BotMessage): Promise<boolean> {
  const { text, jid, raw } = msg;
  const lower = text.toLowerCase();
  const geniusKey = optionalEnv.geniusApiKey();

  if (lower.startsWith('!lyrics escolha')) {
    const n = parseInt(text.split(/\s+/)[2] ?? '', 10);
    if (Number.isNaN(n)) {
      await sock.sendMessage(
        jid,
        { text: '❗ Número inválido. Use: *!lyrics escolha 1*' },
        { quoted: raw },
      );
      return true;
    }
    if (!geniusKey) {
      await sock.sendMessage(
        jid,
        { text: '❌ GENIUS_API_KEY não configurada no servidor.' },
        { quoted: raw },
      );
      return true;
    }
    const hits = searchByChat.get(jid);
    const hit = hits?.[n - 1];
    if (!hit) {
      await sock.sendMessage(
        jid,
        { text: '❗ Escolha inválida ou resultados expirados. Busque de novo.' },
        { quoted: raw },
      );
      return true;
    }
    const song = hit.result;
    try {
      const songRes = await axios.get<GeniusSongResponse>(
        `https://api.genius.com/songs/${song.id}`,
        { headers: { Authorization: `Bearer ${geniusKey}` } },
      );
      const embed = songRes.data.response.song.embed_content ?? '';
      const m = embed.match(/<a href='([^']+)'/);
      const pageUrl = m?.[1];
      if (!pageUrl) {
        await sock.sendMessage(
          jid,
          { text: '❌ Não foi possível obter o link da letra.' },
          { quoted: raw },
        );
        return true;
      }
      const pageRes = await axios.get<string>(pageUrl);
      const $ = cheerio.load(pageRes.data);
      let lyrics = '';
      $('.Lyrics__Container, [data-lyrics-container="true"]').each((_, el) => {
        const v = $(el).text().trim();
        if (v) lyrics += `${v}\n\n`;
      });
      lyrics = lyrics.trim();
      if (!lyrics) {
        await sock.sendMessage(
          jid,
          { text: '❌ Não foi possível extrair a letra.' },
          { quoted: raw },
        );
        return true;
      }
      await sock.sendMessage(
        jid,
        {
          text: `🎵 *${song.title}* - ${song.primary_artist.name}\n\n${formatLyricsText(lyrics)}`,
        },
        { quoted: raw },
      );
    } catch (e) {
      console.error('[lyrics]', getErrorMessage(e));
      await sock.sendMessage(jid, { text: '❌ Erro ao carregar a letra.' }, { quoted: raw });
    }
    return true;
  }

  if (!lower.startsWith('!lyrics')) return false;

  const query = text.slice('!lyrics'.length).trim();
  const quoted: string[] = [];
  const re = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    if (m[1]) quoted.push(m[1]);
  }
  if (quoted.length !== 2) {
    await sock.sendMessage(
      jid,
      { text: '❗ Use: *!lyrics "nome do cantor" "nome da música"*' },
      { quoted: raw },
    );
    return true;
  }
  if (!geniusKey) {
    await sock.sendMessage(
      jid,
      { text: '❌ GENIUS_API_KEY não configurada no servidor.' },
      { quoted: raw },
    );
    return true;
  }
  const artist = (quoted[0] ?? '').trim();
  const title = (quoted[1] ?? '').trim();
  try {
    const searchRes = await axios.get<GeniusSearchResponse>(
      `https://api.genius.com/search?q=${encodeURIComponent(`${title} ${artist}`)}`,
      { headers: { Authorization: `Bearer ${geniusKey}` } },
    );
    const hits = searchRes.data.response.hits;
    if (!hits?.length) {
      await sock.sendMessage(
        jid,
        { text: '🔍 Música não encontrada. Confira artista e título.' },
        { quoted: raw },
      );
      return true;
    }
    searchByChat.set(jid, hits);
    const list = hits
      .slice(0, 10)
      .map((h, i) => `*${i + 1}.* ${h.result.title} - ${h.result.primary_artist.name}`)
      .join('\n');
    await sock.sendMessage(
      jid,
      { text: `🎵 Resultados:\n\n${list}\n\nResponda com *!lyrics escolha N* para ver a letra.` },
      { quoted: raw },
    );
  } catch (e) {
    console.error('[lyrics]', getErrorMessage(e));
    await sock.sendMessage(jid, { text: '❌ Erro ao buscar músicas.' }, { quoted: raw });
  }
  return true;
}

async function handleFeature(sock: WASocket, msg: BotMessage): Promise<boolean> {
  const { text, jid, raw } = msg;
  const parts = text.trim().split(/\s+/);
  const sub = (parts[1] ?? '').toLowerCase();
  const userId = (await users.resolveSender(raw)) ?? jid;

  if (!sub || sub === 'help') {
    await sock.sendMessage(
      jid,
      {
        text:
          '🛠 *Sugestões de features*\n\n' +
          '• !feature add descrição\n' +
          '• !feature lista\n' +
          '• !feature finish número *(admins)*\n' +
          '• !feature remove número',
      },
      { quoted: raw },
    );
    return true;
  }

  if (sub === 'add') {
    const description = parts.slice(2).join(' ').trim();
    if (!description) {
      await sock.sendMessage(
        jid,
        { text: '✏️ Uso: *!feature add* descrição da feature' },
        { quoted: raw },
      );
      return true;
    }
    try {
      const f = await repo.addFeature(description, userId);
      await sock.sendMessage(
        jid,
        { text: `✅ Feature #${f.id} adicionada:\n${f.description}` },
        { quoted: raw },
      );
    } catch (e) {
      console.error('[feature]', getErrorMessage(e));
      await sock.sendMessage(jid, { text: '❌ Erro ao salvar a feature.' }, { quoted: raw });
    }
    return true;
  }

  if (sub === 'lista') {
    try {
      const features = await repo.getFeatures();
      if (!features.length) {
        await sock.sendMessage(
          jid,
          { text: '📭 Nenhuma feature cadastrada. Use *!feature add …*' },
          { quoted: raw },
        );
        return true;
      }
      const body = features
        .map((f) => `#${f.id} ${f.status === 'finished' ? '✅' : '📝'} ${f.description}`)
        .join('\n');
      await sock.sendMessage(jid, { text: `🛠 *Lista de features*\n\n${body}` }, { quoted: raw });
    } catch (e) {
      console.error('[feature]', getErrorMessage(e));
      await sock.sendMessage(jid, { text: '❌ Erro ao carregar features.' }, { quoted: raw });
    }
    return true;
  }

  if (sub === 'finish') {
    const num = parseInt(parts[2] ?? '', 10);
    if (Number.isNaN(num) || num <= 0) {
      await sock.sendMessage(jid, { text: '✏️ Uso: *!feature finish* número' }, { quoted: raw });
      return true;
    }
    if (!config.admins.includes(userId)) {
      await sock.sendMessage(
        jid,
        { text: '❌ Apenas administradores podem usar *!feature finish*.' },
        { quoted: raw },
      );
      return true;
    }
    try {
      const features = await repo.getFeatures();
      const f = features.find((x) => x.id === num);
      if (!f) {
        await sock.sendMessage(
          jid,
          { text: `❌ Feature #${num} não encontrada.` },
          { quoted: raw },
        );
        return true;
      }
      await repo.updateFeatureStatus(num, 'finished');
      await sock.sendMessage(
        jid,
        { text: `✅ Feature #${num} marcada como *finalizada*:\n${f.description}` },
        { quoted: raw },
      );
    } catch (e) {
      console.error('[feature]', getErrorMessage(e));
      await sock.sendMessage(jid, { text: '❌ Erro ao atualizar a feature.' }, { quoted: raw });
    }
    return true;
  }

  if (sub === 'remove') {
    const num = parseInt(parts[2] ?? '', 10);
    if (Number.isNaN(num) || num <= 0) {
      await sock.sendMessage(jid, { text: '✏️ Uso: *!feature remove* número' }, { quoted: raw });
      return true;
    }
    try {
      const features = await repo.getFeatures();
      const f = features.find((x) => x.id === num);
      if (!f) {
        await sock.sendMessage(
          jid,
          { text: `❌ Feature #${num} não encontrada.` },
          { quoted: raw },
        );
        return true;
      }
      await repo.removeFeature(num);
      await sock.sendMessage(jid, { text: `🗑 Feature removida:\n${f.description}` }, { quoted: raw });
    } catch (e) {
      console.error('[feature]', getErrorMessage(e));
      await sock.sendMessage(jid, { text: '❌ Erro ao remover a feature.' }, { quoted: raw });
    }
    return true;
  }

  await sock.sendMessage(
    jid,
    { text: '❓ Subcomando inválido. Use *!feature* para ver a ajuda.' },
    { quoted: raw },
  );
  return true;
}

async function handleAdminFiles(sock: WASocket, msg: BotMessage): Promise<boolean> {
  const { text, jid, raw } = msg;
  if (raw.key.fromMe) return false;

  const userId = (await users.resolveSender(raw)) ?? jid;

  if (text.startsWith('!js')) {
    if (!config.admins.includes(userId)) {
      await sock.sendMessage(
        jid,
        { text: '❌ Apenas administradores podem usar *!js*.' },
        { quoted: raw },
      );
      return true;
    }
    try {
      if (!fs.existsSync(JOKES_PATH)) {
        await sock.sendMessage(
          jid,
          { text: '❌ Arquivo jokes.ts não encontrado.' },
          { quoted: raw },
        );
        return true;
      }
      const buf = fs.readFileSync(JOKES_PATH);
      await sock.sendMessage(
        jid,
        {
          document: buf,
          fileName: 'jokes.ts',
          mimetype: 'text/plain',
          caption: '📁 jokes.ts (comando !js)',
        },
        { quoted: raw },
      );
    } catch (e) {
      console.error('[!js]', getErrorMessage(e));
      await sock.sendMessage(jid, { text: '❌ Erro ao enviar o arquivo.' }, { quoted: raw });
    }
    return true;
  }

  if (text.startsWith('!sendJson')) {
    if (!config.admins.includes(userId)) {
      await sock.sendMessage(
        jid,
        { text: '❌ Apenas administradores podem usar *!sendJson*.' },
        { quoted: raw },
      );
      return true;
    }
    try {
      const usersData = await repo.getAllUsers();
      const buf = Buffer.from(JSON.stringify(usersData, null, 2), 'utf8');
      await sock.sendMessage(
        jid,
        {
          document: buf,
          fileName: 'users.json',
          mimetype: 'application/json',
          caption: '📊 Export users (banco) — !sendJson',
        },
        { quoted: raw },
      );
    } catch (e) {
      console.error('[!sendJson]', getErrorMessage(e));
      await sock.sendMessage(jid, { text: '❌ Erro ao exportar usuários.' }, { quoted: raw });
    }
    return true;
  }

  return false;
}

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (!text || raw.key.fromMe) return;

  const lower = text.toLowerCase();
  if (
    lower.startsWith('!menu') ||
    lower.startsWith('!ajuda') ||
    lower.startsWith('!help') ||
    lower.startsWith('!sobre')
  ) {
    const userId = (await users.resolveSender(raw)) ?? jid;
    const menu = renderMenu(getCommands(), config.admins.includes(userId));
    await sock.sendMessage(jid, { text: menu }, { quoted: raw });
    return true;
  }

  if (lower.startsWith('!feature')) return handleFeature(sock, msg);
  if (lower.startsWith('!lyrics')) return handleLyrics(sock, msg);

  return handleAdminFiles(sock, msg);
};

const utilityCommand: Command = {
  meta: {
    category: 'Gerais',
    entries: [
      {
        trigger: '!menu',
        aliases: ['!ajuda', '!help', '!sobre'],
        description: 'Esta lista de comandos',
      },
      {
        trigger: '!feature',
        description: 'Sugestões de novas funcionalidades',
        usages: [
          { syntax: '!feature add <descrição>', description: 'Registra uma sugestão' },
          { syntax: '!feature lista', description: 'Mostra as sugestões cadastradas' },
          { syntax: '!feature remove <número>', description: 'Apaga uma sugestão' },
          { syntax: '!feature finish <número>', description: 'Marca como feita *(admins)*' },
        ],
      },
      {
        trigger: '!lyrics',
        description: 'Busca a letra de uma música no Genius',
        usages: [
          { syntax: '!lyrics "artista" "música"', description: 'Lista os resultados' },
          { syntax: '!lyrics escolha <n>', description: 'Mostra a letra do resultado escolhido' },
        ],
      },
      { trigger: '!js', description: 'Envia o arquivo fonte das zueiras', admin: true },
      { trigger: '!sendJson', description: 'Exporta os dados dos usuários em JSON', admin: true },
    ],
  },
  handle,
};

export default utilityCommand;
