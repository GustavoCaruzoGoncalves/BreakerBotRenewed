import { create } from '../../lib/chatai.js';
import type { Command } from '../../types/bot.js';

const SYSTEM =
  'Você é um assistente que leva muito em conta as informações passadas pelo usuário, mas ele não é absoluto, quando se tratar de coisas, pessoas e acontecimentos públicos ao invés desses mesmos cenários só que em contextos de imaginação pelo usuário, valide as informações. Se o usuário afirmar algo, você tem que reafirmar isso com convicção, mas se o usuário fizer uma pergunta, ou seja, terminar com interrogração, você não deve só anotar e afirmar que aquilo é contexto, só deve-se considerar contexto o que é afirmado pelo usuário. O que não for informado ou não estiver no contexto, você não avisa que não está no contexto e que pesquisou para responder, apenas use sua base e responda-o.';

const handle = create({
  name: 'gpt',
  prefix: '!gpt',
  commands: ['!gpt5', '!gpt '],
  resetCmd: '!resetGpt',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKeyEnv: 'OPENAI_API_KEY',
  model: 'gpt-5-nano',
  systemPrompt: SYSTEM,
  imageSystemPrompt:
    'Você é um assistente que interpreta imagens e responde de forma precisa com base na imagem e no texto enviado pelo usuário.',
});

const gptCommand: Command = {
  meta: {
    category: 'IA',
    entries: [
      {
        trigger: '!gpt',
        aliases: ['!gpt5'],
        description: 'Conversa com o ChatGPT mantendo o contexto do chat',
        usages: [
          { syntax: '!gpt <pergunta>', description: 'Pergunta em texto' },
          {
            syntax: '!gpt <pergunta>',
            description: 'Enviado junto com uma imagem ou respondendo a uma, analisa a imagem',
          },
        ],
      },
      { trigger: '!resetGpt', description: 'Limpa o contexto acumulado do GPT neste chat' },
    ],
  },
  handle,
};

export default gptCommand;
