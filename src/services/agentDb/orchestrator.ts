import type { OpencodeClient } from '@opencode-ai/sdk';
import { config } from '../../config.js';
import { extractTextFromParts, withTimeout } from '../opencode/client.js';
import { looksLikePromptInjection } from './policy.js';
import { buildToolCatalogPrompt, executeToolBatch } from './tools.js';
import type { AgentPlan, ToolCall, ToolName, ToolRequestContext } from './types.js';

const ALLOWED_TOOLS = new Set<string>([
  'get_my_level_stats',
  'get_my_badges',
  'get_my_aura',
  'get_my_missions',
  'get_my_preferences',
  'get_my_level_history',
  'get_my_truco_stats',
  'get_level_ranking',
  'get_aura_ranking',
  'get_truco_ranking',
  'get_mentioned_user_public_stats',
  'lookup_users_public',
  'get_user_extended_stats',
]);

function parseJsonPlan(text: string): AgentPlan | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return sanitizePlan(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function sanitizePlan(raw: unknown): AgentPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const step = obj.step;
  if (step !== 'respond' && step !== 'use_tools') return null;
  if (step === 'respond') {
    return { step, message: typeof obj.message === 'string' ? obj.message : '' };
  }
  const toolsRaw = Array.isArray(obj.tools) ? obj.tools : [];
  const tools: ToolCall[] = [];
  for (const item of toolsRaw) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const name = String(t.tool ?? '');
    if (!ALLOWED_TOOLS.has(name)) continue;
    tools.push({
      tool: name as ToolName,
      args: (t.args as Record<string, unknown>) ?? {},
    });
  }
  return { step: 'use_tools', tools };
}

async function promptPlan(
  client: OpencodeClient,
  sessionId: string,
  system: string,
  userText: string,
): Promise<AgentPlan | null> {
  const body: NonNullable<Parameters<OpencodeClient['session']['prompt']>[0]>['body'] = {
    agent: config.opencode.agent,
    system:
      system +
      '\n\nResponda SOMENTE com JSON válido no formato {"step":"respond","message":"..."} ou {"step":"use_tools","tools":[{"tool":"nome","args":{}}]}.',
    parts: [{ type: 'text', text: userText }],
  };
  if (config.opencode.modelProvider && config.opencode.modelId) {
    body.model = {
      providerID: config.opencode.modelProvider,
      modelID: config.opencode.modelId,
    };
  }

  const res = await withTimeout(
    client.session.prompt({ path: { id: sessionId }, body }),
    config.opencode.timeoutMs,
    'OpenCode plan',
  );
  if (res.error) return null;
  const text = extractTextFromParts(res.data?.parts);
  if (!text) return null;
  return parseJsonPlan(text);
}

async function promptFinalAnswer(
  client: OpencodeClient,
  sessionId: string,
  system: string,
  userText: string,
  toolFlags: Record<string, boolean>,
): Promise<string | null> {
  const body: NonNullable<Parameters<OpencodeClient['session']['prompt']>[0]>['body'] = {
    agent: config.opencode.agent,
    system,
    tools: toolFlags,
    parts: [{ type: 'text', text: userText }],
  };
  if (config.opencode.modelProvider && config.opencode.modelId) {
    body.model = {
      providerID: config.opencode.modelProvider,
      modelID: config.opencode.modelId,
    };
  }
  const res = await withTimeout(
    client.session.prompt({ path: { id: sessionId }, body }),
    config.opencode.timeoutMs,
    'OpenCode answer',
  );
  if (res.error) return null;
  return extractTextFromParts(res.data?.parts) || null;
}

export async function runAgentWithDbTools(input: {
  client: OpencodeClient;
  sessionId: string;
  baseSystem: string;
  userPrompt: string;
  toolContext: ToolRequestContext;
  isAdmin: boolean;
}): Promise<{ ok: boolean; text: string }> {
  if (!config.agentDb.enabled) {
    return { ok: false, text: '' };
  }

  if (looksLikePromptInjection(input.userPrompt)) {
    return {
      ok: true,
      text: 'Não posso seguir instruções que tentem alterar regras de segurança ou identidade.',
    };
  }

  const catalog = buildToolCatalogPrompt();
  const system =
    input.baseSystem +
    catalog +
    '\n\nRegras: estatísticas do BreakerBot vêm das ferramentas, não da memória conversacional. ' +
    'Se faltar dado, diga que não sabe.';

  const planPrompt =
    `Pergunta do usuário:\n${input.userPrompt}\n\n` +
    'Decida se precisa consultar ferramentas BreakerBot antes de responder.';

  const plan = await promptPlan(input.client, input.sessionId, system, planPrompt);
  if (!plan) {
    return { ok: false, text: '' };
  }

  if (plan.step === 'respond' && plan.message?.trim()) {
    return { ok: true, text: plan.message.trim() };
  }

  const toolResults = plan.tools?.length
    ? await executeToolBatch(plan.tools, input.toolContext)
    : [];

  const synthesisPrompt =
    `Pergunta original:\n${input.userPrompt}\n\n` +
    `Resultados autorizados das ferramentas (JSON):\n${JSON.stringify(toolResults)}\n\n` +
    'Responda em português, de forma natural, usando apenas estes dados para estatísticas.';

  const tools = input.isAdmin ? config.opencode.adminTools : config.opencode.publicTools;
  const answer = await promptFinalAnswer(
    input.client,
    input.sessionId,
    system,
    synthesisPrompt,
    tools,
  );

  if (!answer) return { ok: false, text: '' };
  return { ok: true, text: answer };
}
