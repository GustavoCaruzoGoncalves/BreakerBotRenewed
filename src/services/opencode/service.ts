import type { OpencodeClient } from '@opencode-ai/sdk';
import { config } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import * as memRepo from '../../database/memoryRepository.js';
import { buildAiContextAppend } from '../memory/context.js';
import {
  checkOpencodeHealth,
  extractTextFromParts,
  getOpencodeClient,
  withTimeout,
} from './client.js';

const sessionLocks = new Map<string, Promise<unknown>>();

async function withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn);
  sessionLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function createSession(client: OpencodeClient, title: string): Promise<string> {
  const res = await client.session.create({
    body: { title },
  });
  if (res.error || !res.data?.id) {
    throw new Error('Não foi possível criar sessão OpenCode');
  }
  return res.data.id;
}

async function ensureOpencodeSession(
  client: OpencodeClient,
  contextKey: string,
  title: string,
): Promise<string> {
  const existing = await memRepo.getOpencodeSessionId(contextKey);
  if (existing) {
    const check = await client.session.get({ path: { id: existing } });
    if (!check.error && check.data?.id) return existing;
    await memRepo.deleteOpencodeSessionMapping(contextKey);
  }

  const id = await createSession(client, title);
  await memRepo.saveOpencodeSessionId(contextKey, id);
  return id;
}

export interface OpencodeChatInput {
  contextKey: string;
  sessionTitle: string;
  chatJid: string;
  senderUserId: string;
  userPrompt: string;
  quotedText?: string | null;
  isAdmin: boolean;
  systemBase: string;
}

export interface OpencodeChatResult {
  ok: boolean;
  text: string;
  unavailable?: boolean;
}

const DEFAULT_SYSTEM =
  'Você é o assistente de IA do BreakerBot no WhatsApp. Responda em português do Brasil, de forma clara e útil. ' +
  'Use pesquisa na web quando precisar de informação atual ou fontes externas; cite links quando usar resultados da web. ' +
  'Não execute ações destrutivas nem compartilhe segredos do servidor.';

export async function chatWithOpencode(
  input: OpencodeChatInput,
  client = getOpencodeClient(),
): Promise<OpencodeChatResult> {
  if (!config.opencode.enabled) {
    return { ok: false, text: 'OpenCode desabilitado (OPENCODE_ENABLED).' };
  }

  const healthy = await checkOpencodeHealth().catch(() => false);
  if (!healthy) {
    return {
      ok: false,
      unavailable: true,
      text: 'Serviço OpenCode indisponível no momento. Tente novamente mais tarde.',
    };
  }

  return withSessionLock(input.contextKey, async () => {
    try {
      const sessionId = await ensureOpencodeSession(client, input.contextKey, input.sessionTitle);
      const memoryAppend = await buildAiContextAppend(input.chatJid, input.senderUserId);

      let promptText = input.userPrompt;
      if (input.quotedText) {
        promptText = `[Mensagem citada]\n${input.quotedText}\n\n[Pergunta]\n${input.userPrompt}`;
      }

      const tools = input.isAdmin ? config.opencode.adminTools : config.opencode.publicTools;

      const body: NonNullable<Parameters<OpencodeClient['session']['prompt']>[0]>['body'] = {
        agent: config.opencode.agent,
        system: `${input.systemBase || DEFAULT_SYSTEM}${memoryAppend}`,
        tools,
        parts: [{ type: 'text', text: promptText }],
      };

      if (config.opencode.modelProvider && config.opencode.modelId) {
        body.model = {
          providerID: config.opencode.modelProvider,
          modelID: config.opencode.modelId,
        };
      }

      const res = await withTimeout(
        client.session.prompt({
          path: { id: sessionId },
          body,
        }),
        config.opencode.timeoutMs,
        'OpenCode',
      );

      if (res.error) {
        if (res.response?.status === 404) {
          await memRepo.deleteOpencodeSessionMapping(input.contextKey);
        }
        console.error('[OPENCODE] Erro na resposta:', getErrorMessage(res.error));
        return { ok: false, text: 'Erro ao processar com OpenCode.' };
      }

      const text = extractTextFromParts(res.data?.parts);
      if (!text) {
        return { ok: false, text: 'OpenCode não retornou texto na resposta.' };
      }

      return { ok: true, text };
    } catch (err) {
      console.error('[OPENCODE]', getErrorMessage(err));
      return { ok: false, text: 'Erro ao comunicar com o OpenCode.' };
    }
  });
}
