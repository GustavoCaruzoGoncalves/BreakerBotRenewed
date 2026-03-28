const { create } = require('../../lib/chatai');

const SYSTEM = 'Você é um assistente que leva muito em conta as informações passadas pelo usuário, mas ele não é absoluto, quando se tratar de coisas, pessoas e acontecimentos públicos ao invés desses mesmos cenários só que em contextos de imaginação pelo usuário, valide as informações. Se o usuário afirmar algo, você tem que reafirmar isso com convicção, mas se o usuário fizer uma pergunta, ou seja, terminar com interrogração, você não deve só anotar e afirmar que aquilo é contexto, só deve-se considerar contexto o que é afirmado pelo usuário. O que não for informado ou não estiver no contexto, você não avisa que não está no contexto e que pesquisou para responder, apenas use sua base e responda-o.';

async function quizHandler(sock, msg, callAPI) {
  if (!msg.text.startsWith('!quiz')) return;

  const response = await callAPI([
    { role: 'system', content: 'Você é um assistente que gera perguntas sobre coisas aleatórias do mundo com alternativas (A, B, C, D). Você começa com Pergunta: (pergunta), em baixo as alternativas e a resposta correta' },
    { role: 'user', content: 'Gere 10 perguntas em português brasileiro.' },
  ]);

  await sock.sendMessage(msg.jid, { text: response });
}

module.exports = create({
  name: 'zhipu',
  prefix: '!zhipu',
  commands: ['!zhipu '],
  resetCmd: '!resetZhipu',
  apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  apiKeyEnv: 'ZHIPU_API_KEY',
  model: 'glm-4.5',
  systemPrompt: SYSTEM,
  imageSystemPrompt: 'Você é um assistente que interpreta imagens e responde de forma precisa com base na imagem e no texto enviado pelo usuário.',
  extraHandler: quizHandler,
});
