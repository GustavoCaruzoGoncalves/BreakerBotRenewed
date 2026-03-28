const axios = require('axios');
const { downloadMedia } = require('./message');
const config = require('../config');

const MAX_HISTORY = 30;

function create(opts) {
  const memory = {};

  function push(chatId, role, content) {
    if (!memory[chatId]) memory[chatId] = [];
    memory[chatId].push({ role, content });
    if (memory[chatId].length > MAX_HISTORY) {
      memory[chatId] = memory[chatId].slice(-MAX_HISTORY);
    }
  }

  async function callAPI(messages) {
    try {
      const { data } = await axios.post(opts.apiUrl, {
        model: opts.model,
        messages,
      }, {
        headers: {
          Authorization: `Bearer ${process.env[opts.apiKeyEnv]}`,
          'Content-Type': 'application/json',
        },
      });
      return data.choices[0].message.content;
    } catch (err) {
      console.error(`[${opts.name}]`, err?.response?.data || err.message);
      return `Erro ao processar com ${opts.name}.`;
    }
  }

  async function handler(sock, msg) {
    const { text, jid, raw, media } = msg;
    if (raw.key.fromMe) return;

    const sender = jid.endsWith('@g.us')
      ? (raw.key.participantAlt || raw.key.participant || jid)
      : jid;

    if (text && !text.startsWith(opts.prefix)) {
      push(jid, 'user', text);
    }

    if (text.startsWith(opts.resetCmd)) {
      if (!config.admins.includes(sender)) {
        return sock.sendMessage(jid, { text: '❌ Somente administradores podem resetar.' });
      }
      delete memory[jid];
      return sock.sendMessage(jid, { text: '✅ Histórico apagado.' });
    }

    const cmd = opts.commands.find(c => text.startsWith(c));
    if (!cmd) {
      if (opts.extraHandler) return opts.extraHandler(sock, msg, callAPI);
      return;
    }

    const prompt = text.slice(cmd.length).trim();
    const quoted = raw.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (media?.type === 'imageMessage') {
      try {
        const buffer = await downloadMedia(media);
        const imgPrompt = prompt || 'Descreva essa imagem.';
        const response = await callAPI([
          { role: 'system', content: opts.imageSystemPrompt },
          { role: 'user', content: [
            { type: 'text', text: imgPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` } },
          ] },
        ]);
        push(jid, 'user', imgPrompt);
        push(jid, 'assistant', response);
        return sock.sendMessage(jid, { text: response });
      } catch (err) {
        console.error(`[${opts.name}]`, err.message);
        return sock.sendMessage(jid, { text: 'Erro ao processar imagem.' });
      }
    }

    if (!prompt) {
      return sock.sendMessage(jid, { text: `❌ Digite uma pergunta junto com \`${cmd}\`.` });
    }

    const newMessages = [];
    const quotedText = quoted?.conversation
      || quoted?.extendedTextMessage?.text
      || quoted?.imageMessage?.caption
      || quoted?.videoMessage?.caption;
    if (quotedText) newMessages.push({ role: 'user', content: quotedText });
    newMessages.push({ role: 'user', content: prompt });

    const response = await callAPI([
      { role: 'system', content: opts.systemPrompt },
      ...(memory[jid] || []),
      ...newMessages,
    ]);

    for (const m of newMessages) push(jid, m.role, m.content);
    push(jid, 'assistant', response);

    return sock.sendMessage(jid, { text: response });
  }

  return handler;
}

module.exports = { create };
