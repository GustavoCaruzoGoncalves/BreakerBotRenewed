import axios from 'axios';
import type { WASocket } from '@whiskeysockets/baileys';
import { downloadMedia } from './message.js';
import { config, getAiApiKey } from '../config.js';
import { getErrorMessage } from './errors.js';
import type { BotMessage, CommandHandler } from '../types/bot.js';
import type { AiApiKeyEnv } from '../config.js';

const MAX_HISTORY = 30;

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentPart[];
}

/** Chamada crua ao provedor, exposta aos `extraHandler` (ex.: `!quiz` do Zhipu). */
export type CallApi = (messages: ChatMessage[]) => Promise<string>;

export type ExtraHandler = (
  sock: WASocket,
  msg: BotMessage,
  callAPI: CallApi,
) => Promise<unknown> | unknown;

export interface ChatAiOptions {
  name: string;
  prefix: string;
  commands: string[];
  resetCmd: string;
  apiUrl: string;
  apiKeyEnv: AiApiKeyEnv;
  model: string;
  systemPrompt: string;
  imageSystemPrompt: string;
  extraHandler?: ExtraHandler;
}

/** Formato compatível com a API de chat completions da OpenAI. */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

function describeApiError(err: unknown): unknown {
  if (axios.isAxiosError(err)) return err.response?.data ?? err.message;
  return getErrorMessage(err);
}

export function create(opts: ChatAiOptions): CommandHandler {
  const memory: Record<string, ChatMessage[]> = {};

  function push(chatId: string, role: ChatRole, content: string): void {
    const history = (memory[chatId] ??= []);
    history.push({ role, content });
    if (history.length > MAX_HISTORY) {
      memory[chatId] = history.slice(-MAX_HISTORY);
    }
  }

  const callAPI: CallApi = async (messages) => {
    try {
      const { data } = await axios.post<ChatCompletionResponse>(
        opts.apiUrl,
        { model: opts.model, messages },
        {
          headers: {
            Authorization: `Bearer ${getAiApiKey(opts.apiKeyEnv) ?? ''}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return data.choices?.[0]?.message?.content ?? `Erro ao processar com ${opts.name}.`;
    } catch (err) {
      console.error(`[${opts.name}]`, describeApiError(err));
      return `Erro ao processar com ${opts.name}.`;
    }
  };

  return async function handler(sock, msg) {
    const { text, jid, raw, media } = msg;
    if (raw.key.fromMe) return;

    const sender = jid.endsWith('@g.us')
      ? raw.key.participantAlt || raw.key.participant || jid
      : jid;

    if (text && !text.startsWith(opts.prefix)) {
      push(jid, 'user', text);
    }

    if (text.startsWith(opts.resetCmd)) {
      if (!config.admins.includes(sender)) {
        await sock.sendMessage(jid, { text: '❌ Somente administradores podem resetar.' });
        return;
      }
      delete memory[jid];
      await sock.sendMessage(jid, { text: '✅ Histórico apagado.' });
      return;
    }

    const cmd = opts.commands.find((c) => text.startsWith(c));
    if (!cmd) {
      if (opts.extraHandler) await opts.extraHandler(sock, msg, callAPI);
      return;
    }

    const prompt = text.slice(cmd.length).trim();
    const quoted = raw.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (media?.type === 'imageMessage') {
      try {
        const buffer = await downloadMedia(sock, media);
        const imgPrompt = prompt || 'Descreva essa imagem.';
        const response = await callAPI([
          { role: 'system', content: opts.imageSystemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: imgPrompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` },
              },
            ],
          },
        ]);
        push(jid, 'user', imgPrompt);
        push(jid, 'assistant', response);
        await sock.sendMessage(jid, { text: response });
        return;
      } catch (err) {
        console.error(`[${opts.name}]`, getErrorMessage(err));
        await sock.sendMessage(jid, { text: 'Erro ao processar imagem.' });
        return;
      }
    }

    if (!prompt) {
      await sock.sendMessage(jid, { text: `❌ Digite uma pergunta junto com \`${cmd}\`.` });
      return;
    }

    const newMessages: Array<{ role: ChatRole; content: string }> = [];
    const quotedText =
      quoted?.conversation ||
      quoted?.extendedTextMessage?.text ||
      quoted?.imageMessage?.caption ||
      quoted?.videoMessage?.caption;
    if (quotedText) newMessages.push({ role: 'user', content: quotedText });
    newMessages.push({ role: 'user', content: prompt });

    const response = await callAPI([
      { role: 'system', content: opts.systemPrompt },
      ...(memory[jid] ?? []),
      ...newMessages,
    ]);

    for (const m of newMessages) push(jid, m.role, m.content);
    push(jid, 'assistant', response);

    await sock.sendMessage(jid, { text: response });
  };
}
