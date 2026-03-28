const { create } = require('../../lib/chatai');

const SYSTEM = 'Você é um assistente que leva muito em conta as informações passadas pelo usuário, mas ele não é absoluto, quando se tratar de coisas, pessoas e acontecimentos públicos ao invés desses mesmos cenários só que em contextos de imaginação pelo usuário, valide as informações. Se o usuário afirmar algo, você tem que reafirmar isso com convicção, mas se o usuário fizer uma pergunta, ou seja, terminar com interrogração, você não deve só anotar e afirmar que aquilo é contexto, só deve-se considerar contexto o que é afirmado pelo usuário. O que não for informado ou não estiver no contexto, você não avisa que não está no contexto e que pesquisou para responder, apenas use sua base e responda-o.';

module.exports = create({
  name: 'gpt',
  prefix: '!gpt',
  commands: ['!gpt5', '!gpt '],
  resetCmd: '!resetGpt',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKeyEnv: 'OPENAI_API_KEY',
  model: 'gpt-5-nano',
  systemPrompt: SYSTEM,
  imageSystemPrompt: 'Você é um assistente que interpreta imagens e responde de forma precisa com base na imagem e no texto enviado pelo usuário.',
});
