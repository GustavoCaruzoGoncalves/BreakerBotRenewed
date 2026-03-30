const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const repo = require('../../database/repository');
const config = require('../../config');
const users = require('../../services/users');

const JOKES_PATH = path.join(__dirname, '..', 'fun', 'jokes.js');
const GENIUS_KEY = process.env.GENIUS_API_KEY;

const searchByChat = new Map();

const MENU = `📌 *Menu de Comandos*

🎛️ *Gerais*
• *!menu* / *!ajuda* / *!help* / *!sobre* — Esta lista
• *!feature* — Sugestões (digite só *!feature* para ver os subcomandos)

🖼️ *Figurinhas e mídia*
• *!sticker* / *!fsticker* — Cria figurinha (imagem, vídeo ou GIF)
• *!toimg* — Figurinha → PNG
• *!play* / *!playmp4* — Áudio ou vídeo do YouTube

🤪 *Zueiras*
• *!ship*, *!gay*, *!corno*, *!hetero*, *!chato*, *!petista*, *!bolsonaro*, *!leitada*, *!burro*, *!fazol* …
• *!pfp* — Foto de perfil
• *!trivia* — Quiz (*!trivia start*, *!trivia resposta …*)
• *!amigoSecreto* — Amigo secreto

🤖 *IA*
• *!gpt* / *!gpt5* — ChatGPT com memória (marque imagem para análise)
• *!resetGpt* — Limpa o contexto do GPT
• *!grok* / *!grokangry* / *!grokimg*
• *!zhipu* / *!resetZhipu*
• *!lyrics* — Letras via Genius (*!lyrics "artista" "música"* → *!lyrics escolha N*)

📊 *Níveis*
• *!me* *!info* *!elos* *!prestigio* *!ranking* *!niveis*

✨ *Aura*
• *!aura* — Guia completo; *!aura info me*; *!meditar* *!treinar* *!mog* *!mognow* …

⚙️ *Preferências*
• *!marcacoes* *!marcarme* *!setCustomName* *!customName*

🔧 *Admin*
• *!setlevel* / *!resetsetlevel*
• *!feature finish* — Marcar sugestão como feita
• *!js* — Envia o arquivo fonte das zueiras
• *!sendJson* — Exporta dados dos usuários (JSON)`;

function formatLyricsText(raw) {
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

async function handleLyrics(sock, msg) {
  const { text, jid, raw } = msg;
  const lower = text.toLowerCase();

  if (lower.startsWith('!lyrics escolha')) {
    const n = parseInt(text.split(/\s+/)[2], 10);
    if (Number.isNaN(n)) {
      await sock.sendMessage(jid, { text: '❗ Número inválido. Use: *!lyrics escolha 1*' }, { quoted: raw });
      return true;
    }
    if (!GENIUS_KEY) {
      await sock.sendMessage(jid, { text: '❌ GENIUS_API_KEY não configurada no servidor.' }, { quoted: raw });
      return true;
    }
    const hits = searchByChat.get(jid);
    const hit = hits?.[n - 1];
    if (!hit) {
      await sock.sendMessage(jid, { text: '❗ Escolha inválida ou resultados expirados. Busque de novo.' }, { quoted: raw });
      return true;
    }
    const song = hit.result;
    try {
      const songRes = await axios.get(`https://api.genius.com/songs/${song.id}`, {
        headers: { Authorization: `Bearer ${GENIUS_KEY}` },
      });
      const embed = songRes.data.response.song.embed_content || '';
      const m = embed.match(/<a href='([^']+)'/);
      const pageUrl = m ? m[1] : null;
      if (!pageUrl) {
        await sock.sendMessage(jid, { text: '❌ Não foi possível obter o link da letra.' }, { quoted: raw });
        return true;
      }
      const pageRes = await axios.get(pageUrl);
      const $ = cheerio.load(pageRes.data);
      let lyrics = '';
      $('.Lyrics__Container, [data-lyrics-container="true"]').each((_, el) => {
        const v = $(el).text().trim();
        if (v) lyrics += `${v}\n\n`;
      });
      lyrics = lyrics.trim();
      if (!lyrics) {
        await sock.sendMessage(jid, { text: '❌ Não foi possível extrair a letra.' }, { quoted: raw });
        return true;
      }
      await sock.sendMessage(jid, {
        text: `🎵 *${song.title}* - ${song.primary_artist.name}\n\n${formatLyricsText(lyrics)}`,
      }, { quoted: raw });
    } catch (e) {
      console.error('[lyrics]', e.message);
      await sock.sendMessage(jid, { text: '❌ Erro ao carregar a letra.' }, { quoted: raw });
    }
    return true;
  }

  if (!lower.startsWith('!lyrics')) return false;

  const query = text.slice('!lyrics'.length).trim();
  const quoted = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(query)) !== null) quoted.push(m[1]);
  if (quoted.length !== 2) {
    await sock.sendMessage(jid, { text: '❗ Use: *!lyrics "nome do cantor" "nome da música"*' }, { quoted: raw });
    return true;
  }
  if (!GENIUS_KEY) {
    await sock.sendMessage(jid, { text: '❌ GENIUS_API_KEY não configurada no servidor.' }, { quoted: raw });
    return true;
  }
  const artist = quoted[0].trim();
  const title = quoted[1].trim();
  try {
    const searchRes = await axios.get(
      `https://api.genius.com/search?q=${encodeURIComponent(`${title} ${artist}`)}`,
      { headers: { Authorization: `Bearer ${GENIUS_KEY}` } },
    );
    const hits = searchRes.data.response.hits;
    if (!hits?.length) {
      await sock.sendMessage(jid, { text: '🔍 Música não encontrada. Confira artista e título.' }, { quoted: raw });
      return true;
    }
    searchByChat.set(jid, hits);
    const list = hits.slice(0, 10).map((h, i) => `*${i + 1}.* ${h.result.title} - ${h.result.primary_artist.name}`).join('\n');
    await sock.sendMessage(jid, {
      text: `🎵 Resultados:\n\n${list}\n\nResponda com *!lyrics escolha N* para ver a letra.`,
    }, { quoted: raw });
  } catch (e) {
    console.error('[lyrics]', e.message);
    await sock.sendMessage(jid, { text: '❌ Erro ao buscar músicas.' }, { quoted: raw });
  }
  return true;
}

async function handleFeature(sock, msg) {
  const { text, jid, raw } = msg;
  const parts = text.trim().split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();
  const userId = (await users.resolveSender(raw)) || jid;

  if (!sub || sub === 'help') {
    await sock.sendMessage(jid, {
      text: '🛠 *Sugestões de features*\n\n'
        + '• !feature add descrição\n'
        + '• !feature lista\n'
        + '• !feature finish número *(admins)*\n'
        + '• !feature remove número',
    }, { quoted: raw });
    return true;
  }

  if (sub === 'add') {
    const description = parts.slice(2).join(' ').trim();
    if (!description) {
      await sock.sendMessage(jid, { text: '✏️ Uso: *!feature add* descrição da feature' }, { quoted: raw });
      return true;
    }
    try {
      const f = await repo.addFeature(description, userId);
      await sock.sendMessage(jid, { text: `✅ Feature #${f.id} adicionada:\n${f.description}` }, { quoted: raw });
    } catch (e) {
      console.error('[feature]', e.message);
      await sock.sendMessage(jid, { text: '❌ Erro ao salvar a feature.' }, { quoted: raw });
    }
    return true;
  }

  if (sub === 'lista') {
    try {
      const features = await repo.getFeatures();
      if (!features.length) {
        await sock.sendMessage(jid, { text: '📭 Nenhuma feature cadastrada. Use *!feature add …*' }, { quoted: raw });
        return true;
      }
      const body = features.map(f => `#${f.id} ${f.status === 'finished' ? '✅' : '📝'} ${f.description}`).join('\n');
      await sock.sendMessage(jid, { text: `🛠 *Lista de features*\n\n${body}` }, { quoted: raw });
    } catch (e) {
      console.error('[feature]', e.message);
      await sock.sendMessage(jid, { text: '❌ Erro ao carregar features.' }, { quoted: raw });
    }
    return true;
  }

  if (sub === 'finish') {
    const num = parseInt(parts[2], 10);
    if (Number.isNaN(num) || num <= 0) {
      await sock.sendMessage(jid, { text: '✏️ Uso: *!feature finish* número' }, { quoted: raw });
      return true;
    }
    if (!config.admins.includes(userId)) {
      await sock.sendMessage(jid, { text: '❌ Apenas administradores podem usar *!feature finish*.' }, { quoted: raw });
      return true;
    }
    try {
      const features = await repo.getFeatures();
      const f = features.find(x => x.id === num);
      if (!f) {
        await sock.sendMessage(jid, { text: `❌ Feature #${num} não encontrada.` }, { quoted: raw });
        return true;
      }
      await repo.updateFeatureStatus(num, 'finished');
      await sock.sendMessage(jid, { text: `✅ Feature #${num} marcada como *finalizada*:\n${f.description}` }, { quoted: raw });
    } catch (e) {
      console.error('[feature]', e.message);
      await sock.sendMessage(jid, { text: '❌ Erro ao atualizar a feature.' }, { quoted: raw });
    }
    return true;
  }

  if (sub === 'remove') {
    const num = parseInt(parts[2], 10);
    if (Number.isNaN(num) || num <= 0) {
      await sock.sendMessage(jid, { text: '✏️ Uso: *!feature remove* número' }, { quoted: raw });
      return true;
    }
    try {
      const features = await repo.getFeatures();
      const f = features.find(x => x.id === num);
      if (!f) {
        await sock.sendMessage(jid, { text: `❌ Feature #${num} não encontrada.` }, { quoted: raw });
        return true;
      }
      await repo.removeFeature(num);
      await sock.sendMessage(jid, { text: `🗑 Feature removida:\n${f.description}` }, { quoted: raw });
    } catch (e) {
      console.error('[feature]', e.message);
      await sock.sendMessage(jid, { text: '❌ Erro ao remover a feature.' }, { quoted: raw });
    }
    return true;
  }

  await sock.sendMessage(jid, {
    text: '❓ Subcomando inválido. Use *!feature* para ver a ajuda.',
  }, { quoted: raw });
  return true;
}

async function handleAdminFiles(sock, msg) {
  const { text, jid, raw } = msg;
  if (raw.key.fromMe) return false;

  const userId = (await users.resolveSender(raw)) || jid;

  if (text.startsWith('!js')) {
    if (!config.admins.includes(userId)) {
      await sock.sendMessage(jid, { text: '❌ Apenas administradores podem usar *!js*.' }, { quoted: raw });
      return true;
    }
    try {
      if (!fs.existsSync(JOKES_PATH)) {
        await sock.sendMessage(jid, { text: '❌ Arquivo jokes.js não encontrado.' }, { quoted: raw });
        return true;
      }
      const buf = fs.readFileSync(JOKES_PATH);
      await sock.sendMessage(jid, {
        document: buf,
        fileName: 'jokes.js',
        mimetype: 'application/javascript',
        caption: '📁 jokes.js (comando !js)',
      }, { quoted: raw });
    } catch (e) {
      console.error('[!js]', e.message);
      await sock.sendMessage(jid, { text: '❌ Erro ao enviar o arquivo.' }, { quoted: raw });
    }
    return true;
  }

  if (text.startsWith('!sendJson')) {
    if (!config.admins.includes(userId)) {
      await sock.sendMessage(jid, { text: '❌ Apenas administradores podem usar *!sendJson*.' }, { quoted: raw });
      return true;
    }
    try {
      const usersData = await repo.getAllUsers();
      const buf = Buffer.from(JSON.stringify(usersData, null, 2), 'utf8');
      await sock.sendMessage(jid, {
        document: buf,
        fileName: 'users.json',
        mimetype: 'application/json',
        caption: '📊 Export users (banco) — !sendJson',
      }, { quoted: raw });
    } catch (e) {
      console.error('[!sendJson]', e.message);
      await sock.sendMessage(jid, { text: '❌ Erro ao exportar usuários.' }, { quoted: raw });
    }
    return true;
  }

  return false;
}

async function utilityCommand(sock, msg) {
  const { text, jid, raw } = msg;
  if (!text || raw.key.fromMe) return;

  const lower = text.toLowerCase();
  if (lower.startsWith('!menu') || lower.startsWith('!ajuda') || lower.startsWith('!help') || lower.startsWith('!sobre')) {
    await sock.sendMessage(jid, { text: MENU }, { quoted: raw });
    return true;
  }

  if (lower.startsWith('!feature')) return handleFeature(sock, msg);
  if (lower.startsWith('!lyrics')) return handleLyrics(sock, msg);

  return handleAdminFiles(sock, msg);
}

module.exports = utilityCommand;
