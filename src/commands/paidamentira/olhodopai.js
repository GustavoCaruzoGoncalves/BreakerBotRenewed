const mentions = require('../../lib/mentions');

// mensagens aleatórias
const MENSAGENS = [
  (nome) => `${nome} tá namorando, quase casando... Não sabia? Vish 🥺`,
  (nome) => `nem reza braba faz ${nome} namorar, haha 🤭`,
  (nome) => `${nome} JÁ TERMINOU PORRA, PODE JOGAR O LEITE! ⚠️⚠️⚠️`,
  (nome) => `${nome} morreu. Esquece.`
];

// mensagens personalizadas
const ESPECIAIS = {
  elizabethe: 'Essa daí vai longe, viu? Já esquece. É até melhorKKKKKKK',
  kiara: 'Ah... a nossa menina... ela ainda está namorando com o cara do Astra 💔, vamos continuar rezando para que isso mude!',
  'mina do trote': 'Sossega o facho GustavoKKKKKKKKKK pqp'
};

async function handleAindaNamora(sock, msg) {
  const text = msg.text;

  const mentionedJid = msg.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid;

  let nome = '';
  let mentionsArr = [];

  // 👉 CASO 1: veio menção
  if (mentionedJid?.length > 0) {
    const info = await mentions.processSingleMention(mentionedJid[0]);
    nome = info.mentionText;
    mentionsArr = info.mentions;
  } else {
    // 👉 CASO 2: veio nome digitado
    nome = text.replace('!aindanamora', '').trim();

    if (!nome) {
      await sock.sendMessage(msg.jid, {
        text: 'Fala o nome aí po...'
      }, { quoted: msg.raw });
      return true;
    }
  }

  const nomeLower = nome.toLowerCase();

  // 👉 verifica se é especial
  if (ESPECIAIS[nomeLower]) {
    const resposta = ESPECIAIS[nomeLower];

    await sock.sendMessage(
      msg.jid,
      { text: resposta, mentions: mentionsArr },
      { quoted: msg.raw }
    );

    return true;
  }

  // 👉 mensagem aleatória
  const random = MENSAGENS[Math.floor(Math.random() * MENSAGENS.length)];
  const resposta = random(nome);

  await sock.sendMessage(
    msg.jid,
    { text: resposta, mentions: mentionsArr },
    { quoted: msg.raw }
  );

  return true;
}

module.exports = handleAindaNamora;