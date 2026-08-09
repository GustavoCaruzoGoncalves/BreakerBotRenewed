import axios from 'axios';
import * as mentions from '../../lib/mentions.js';
import { optionalEnv } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { Command, CommandHandler, WAMessage, WASocket } from '../../types/bot.js';

interface Question {
  question: string;
  options: string[];
  answer: string;
}

interface Game {
  score: number;
  idx: number;
  questions: Question[];
}

const games = new Map<string, Game>();

const RATE_LIMIT_ERROR = 'rate-overlimit';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

async function generateQuestions(): Promise<string | null> {
  try {
    const res = await axios.post<ChatCompletionResponse>(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content:
              "Você é um assistente que gera perguntas de quiz sobre cultura geral. Você deve gerar perguntas com 4 alternativas (A, B, C, D) seguindo o formato: 'Pergunta: [pergunta]' seguido de 'A) [opção]', 'B) [opção]', 'C) [opção]', 'D) [opção]' e por último 'Resposta correta: [letra]) [resposta]'.",
          },
          {
            role: 'user',
            content:
              'Gere 10 perguntas de cultura geral em português brasileiro com 4 alternativas cada.',
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${optionalEnv.openAiApiKey() ?? ''}`,
          'Content-Type': 'application/json',
        },
      },
    );
    return res.data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.error('Erro trivia GPT:', axios.isAxiosError(err) ? (err.response?.data ?? err) : err);
    return null;
  }
}

export function parseQuestions(raw: string): Question[] {
  const questions: Question[] = [];
  let current: Question | null = null;
  let opts: string[] = [];

  for (const line of raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (line.startsWith('Pergunta:')) {
      if (current?.answer) questions.push(current);
      current = { question: line.replace('Pergunta:', '').trim(), options: [], answer: '' };
      opts = [];
    } else if (/^[A-D]\)/.test(line) && current) {
      opts.push(line);
      current.options = opts;
    } else if (line.startsWith('Resposta correta:') && current) {
      const m = line.match(/^Resposta correta:\s*([A-D])\)/);
      if (m?.[1]) current.answer = m[1];
    }
  }
  if (current?.answer) questions.push(current);
  return questions;
}

async function send(
  sock: WASocket,
  jid: string,
  text: string,
  mentionArr: string[] = [],
  retries = 3,
): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      await sock.sendMessage(jid, { text, mentions: mentionArr });
      return;
    } catch (err) {
      if (getErrorMessage(err).includes(RATE_LIMIT_ERROR) && i < retries) {
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        console.error('Erro trivia send:', err);
        return;
      }
    }
  }
}

function getPlayerId(raw: WAMessage): string {
  return raw.key.participant || raw.key.participantAlt || raw.key.remoteJid || '';
}

interface PlayerPrefix {
  prefix: string;
  mentions: string[];
}

async function playerPrefix(playerId: string): Promise<PlayerPrefix> {
  const info = await mentions.processSingleMention(playerId);
  return { prefix: `🎯 Jogo de ${info.mentionText}\n\n`, mentions: info.mentions };
}

function askNext(sock: WASocket, jid: string, playerId: string): void {
  const game = games.get(playerId);
  if (!game || game.idx >= game.questions.length) return;

  setTimeout(() => {
    void (async () => {
      const q = game.questions[game.idx];
      if (!q) return;
      const { prefix, mentions: m } = await playerPrefix(playerId);
      const text = `${prefix}📝 Pergunta ${game.idx + 1}/${game.questions.length}:\n\n${q.question}\n\n${q.options.join('\n')}\n\nResponda com: !trivia resposta [letra]\nExemplo: !trivia resposta A`;
      await send(sock, jid, text, m);
    })();
  }, 1000);
}

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (!text) return;

  const playerId = getPlayerId(raw);

  if (text === '!trivia start') {
    const game: Game = { score: 0, idx: 0, questions: [] };
    games.set(playerId, game);
    const { prefix, mentions: m } = await playerPrefix(playerId);

    await send(sock, jid, `${prefix}Bem-vindo ao jogo de trivia! Gerando perguntas com IA... ⏳`, m);

    const generated = await generateQuestions();
    if (!generated) {
      await send(sock, jid, `${prefix}Erro ao gerar perguntas. Tente novamente mais tarde.`, m);
      games.delete(playerId);
      return true;
    }

    game.questions = parseQuestions(generated);
    if (game.questions.length === 0) {
      await send(sock, jid, `${prefix}Erro ao processar perguntas. Tente novamente.`, m);
      games.delete(playerId);
      return true;
    }

    await send(
      sock,
      jid,
      `${prefix}Perguntas geradas! Total: ${game.questions.length} perguntas. Vamos começar! 🎮`,
      m,
    );
    askNext(sock, jid, playerId);
    return true;
  }

  if (text.startsWith('!trivia resposta')) {
    const answer = (text.split(' ')[2] || '').toUpperCase();
    const { prefix, mentions: m } = await playerPrefix(playerId);

    if (!answer) {
      await send(
        sock,
        jid,
        `${prefix}Por favor, forneça uma resposta (A, B, C ou D). Exemplo: !trivia resposta A`,
        m,
      );
      return true;
    }

    const game = games.get(playerId);
    const question = game?.questions[game.idx];
    if (!game || !question) {
      await send(sock, jid, `${prefix}Nenhum jogo em andamento. Use !trivia start para começar.`, m);
      return true;
    }

    const correct = question.answer;
    if (answer === correct.toUpperCase()) {
      game.score++;
      await send(sock, jid, `${prefix}✅ Resposta correta! Sua pontuação é: ${game.score}`, m);
    } else {
      await send(sock, jid, `${prefix}❌ Resposta errada! A resposta correta era: ${correct}`, m);
    }

    game.idx++;
    if (game.idx < game.questions.length) {
      askNext(sock, jid, playerId);
    } else {
      await send(
        sock,
        jid,
        `${prefix}🎉 Você terminou o jogo! Sua pontuação final é ${game.score} de ${game.questions.length}`,
        m,
      );
      games.delete(playerId);
    }
    return true;
  }
};

const triviaCommand: Command = {
  meta: {
    category: 'Zueiras',
    entries: [
      {
        trigger: '!trivia',
        description: 'Quiz de perguntas geradas por IA',
        usages: [
          { syntax: '!trivia start', description: 'Começa uma rodada no chat' },
          { syntax: '!trivia resposta <A-D>', description: 'Responde a pergunta atual' },
        ],
      },
    ],
  },
  handle,
};

export default triviaCommand;
