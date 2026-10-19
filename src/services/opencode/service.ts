import type { OpencodeClient } from '@opencode-ai/sdk';
import { config } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import * as memRepo from '../../database/memoryRepository.js';
import { buildBotCapabilitiesPrompt } from '../agentDb/capabilities.js';
import { isAgentPlanJson, runAgentWithDbTools } from '../agentDb/orchestrator.js';
import type { ToolRequestContext } from '../agentDb/types.js';
import { buildPersonalityPrompt, shouldSkipProactiveReply } from '../ai/personality.js';
import type { AiInteractionMode } from '../ai/personality.js';
import type { MediaKind } from '../agentDb/messageContext.js';
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
  toolContext?: ToolRequestContext;
  interactionMode?: AiInteractionMode;
  skipAgentDb?: boolean;
  mediaKind?: MediaKind;
}

export interface OpencodeChatResult {
  ok: boolean;
  text: string;
  unavailable?: boolean;
}

function composeSystem(input: OpencodeChatInput, memoryAppend: string): string {
  const mode = input.interactionMode ?? 'direct';
  const personality = input.systemBase.trim() || buildPersonalityPrompt(mode);
  const capabilities =
    !input.skipAgentDb && config.agentDb.enabled && mode === 'direct'
      ? `\n\n${buildBotCapabilitiesPrompt()}`
      : '';
  return `${personality}${capabilities}${memoryAppend}`;
}

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

      const baseSystem = composeSystem(input, memoryAppend);

      if (config.agentDb.enabled && input.toolContext && !input.skipAgentDb) {
        const agentResult = await runAgentWithDbTools({
          client,
          sessionId,
          baseSystem,
          userPrompt: promptText,
          toolContext: input.toolContext,
          isAdmin: input.isAdmin,
          mediaKind: input.mediaKind,
        });
        if (agentResult.ok) {
          return { ok: true, text: agentResult.text };
        }
      }

      const tools = input.isAdmin ? config.opencode.adminTools : config.opencode.publicTools;

      const body: NonNullable<Parameters<OpencodeClient['session']['prompt']>[0]>['body'] = {
        agent: config.opencode.agent,
        system: baseSystem,
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

      let text = extractTextFromParts(res.data?.parts);
      if (!text) {
        return { ok: false, text: 'OpenCode não retornou texto na resposta.' };
      }
      if (isAgentPlanJson(text)) {
        text = 'Perdeu no caminho — manda de novo?';
      }
      if (input.interactionMode === 'proactive' && shouldSkipProactiveReply(text)) {
        return { ok: false, text: '' };
      }

      return { ok: true, text };
    } catch (err) {
      console.error('[OPENCODE]', getErrorMessage(err));
      return { ok: false, text: 'Erro ao comunicar com o OpenCode.' };
    }
  });
}
