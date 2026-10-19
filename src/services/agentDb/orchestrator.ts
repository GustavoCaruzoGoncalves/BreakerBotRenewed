import type { OpencodeClient } from '@opencode-ai/sdk';
import { config } from '../../config.js';
import { extractTextFromParts, withTimeout } from '../opencode/client.js';
import { buildBotCapabilitiesPrompt } from './capabilities.js';
import { looksLikePromptInjection } from './policy.js';
import { buildToolCatalogPrompt, executeToolBatch } from './tools.js';
import type { MediaKind } from './messageContext.js';
import type { AgentPlan, ToolCall, ToolName, ToolRequestContext, ToolResult } from './types.js';

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
  'run_bot_command',
]);

const TOOL_ALIASES: Record<string, ToolName> = {
  get_my_aura_summary: 'get_my_aura',
  get_aura_summary: 'get_my_aura',
  get_my_aura_stats: 'get_my_aura',
  get_missions: 'get_my_missions',
  get_my_stats: 'get_my_level_stats',
  get_level: 'get_my_level_stats',
};

export function isAgentPlanJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith('{') && t.includes('"step"') && (t.includes('use_tools') || t.includes('respond'));
}

function normalizeToolName(name: string): ToolName | null {
  const mapped = TOOL_ALIASES[name] ?? name;
  return ALLOWED_TOOLS.has(mapped) ? (mapped as ToolName) : null;
}

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
    const normalized = normalizeToolName(String(t.tool ?? ''));
    if (!normalized) continue;
    tools.push({
      tool: normalized,
      args: (t.args as Record<string, unknown>) ?? {},
    });
  }
  return { step: 'use_tools', tools };
}

function actionExecutedInResults(
  toolResults: Array<{ tool: ToolName; result: ToolResult }>,
): boolean {
  return toolResults.some(
    (t) =>
      t.tool === 'run_bot_command' &&
      t.result.ok &&
      typeof t.result.data === 'object' &&
      t.result.data !== null &&
      (t.result.data as { executed?: boolean }).executed === true,
  );
}

export function inferToolsFromQuestion(question: string, mediaKind: MediaKind = null): ToolCall[] {
  const lower = question.toLowerCase();

  if (mediaKind === 'sticker' && /png|imagem|toimg|converter/.test(lower)) {
    return [{ tool: 'run_bot_command', args: { command: '!toimg' } }];
  }
  if (
    (mediaKind === 'image' || mediaKind === 'video') &&
    /figurin|sticker|fsticker|converte|transforma|faz(\s*a[ií])?|manda(\s*a[ií])?|cria/.test(lower)
  ) {
    const cmd = /fsticker|fundo transparente|inteir/.test(lower) ? '!fsticker' : '!sticker';
    return [{ tool: 'run_bot_command', args: { command: cmd } }];
  }
  if (
    (mediaKind === 'image' || mediaKind === 'video') &&
    (lower.length < 24 || !/\?/.test(lower))
  ) {
    return [{ tool: 'run_bot_command', args: { command: '!sticker' } }];
  }

  if (
    /o que (tem|dá|da pra|posso)|funcionalidades|comandos|fazer (no|neste|nesse|na porra)|bot\?*$/.test(
      lower,
    ) ||
    /tem de bom|o que (eu )?faço|como (usar|funciona)/.test(lower)
  ) {
    return [
      { tool: 'get_my_level_stats', args: {} },
      { tool: 'get_my_aura', args: {} },
      { tool: 'get_my_missions', args: {} },
    ];
  }
  if (/meu (nível|level|xp|prestígio)/.test(lower)) {
    return [{ tool: 'get_my_level_stats', args: {} }];
  }
  if (/minha aura|meu aura|saldo de aura/.test(lower)) {
    return [{ tool: 'get_my_aura', args: {} }];
  }
  if (/ranking|top \d|maior nível/.test(lower)) {
    return [{ tool: 'get_level_ranking', args: { limit: 5 } }];
  }
  return [];
}

function sanitizeUserFacingText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isAgentPlanJson(trimmed)) return null;
  return trimmed;
}

async function promptPlan(
  client: OpencodeClient,
  sessionId: string,
  system: string,
  userText: string,
): Promise<AgentPlan | null> {
  const body: NonNullable<Parameters<OpencodeClient['session']['prompt']>[0]>['body'] = {
    agent: config.opencode.agent,
    noReply: true,
    system:
      system +
      '\n\n[Fase interna — não fale com o usuário.] Responda SOMENTE JSON: {"step":"respond","message":"..."} ou {"step":"use_tools","tools":[{"tool":"nome_exato","args":{}}]}. Use apenas nomes de ferramentas listados.',
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
    system:
      system +
      '\n\nResponda em português coloquial de WhatsApp. Sem travessão (—), sem bullets, sem JSON ou nomes de ferramentas.',
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
  return sanitizeUserFacingText(extractTextFromParts(res.data?.parts) || '');
}

async function synthesizeAnswer(
  client: OpencodeClient,
  sessionId: string,
  system: string,
  userPrompt: string,
  toolResults: Awaited<ReturnType<typeof executeToolBatch>>,
  isAdmin: boolean,
  extraContext?: string,
): Promise<string | null> {
  const synthesisPrompt =
    `Pergunta original:\n${userPrompt}\n\n` +
    (extraContext ? `Contexto do bot:\n${extraContext}\n\n` : '') +
    `Resultados das ferramentas (JSON):\n${JSON.stringify(toolResults)}\n\n` +
    'Responda de forma natural e direta, no tom do Breaker Bot. Use os dados das ferramentas só onde couber. ' +
    'Não liste comandos nem dicas do bot a menos que a pergunta seja claramente sobre o que dá pra fazer aqui.';

  const tools = isAdmin ? config.opencode.adminTools : config.opencode.publicTools;
  return promptFinalAnswer(client, sessionId, system, synthesisPrompt, tools);
}

export async function runAgentWithDbTools(input: {
  client: OpencodeClient;
  sessionId: string;
  baseSystem: string;
  userPrompt: string;
  toolContext: ToolRequestContext;
  isAdmin: boolean;
  mediaKind?: MediaKind;
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

  const capabilities = buildBotCapabilitiesPrompt();
  const catalog = buildToolCatalogPrompt();
  const system =
    input.baseSystem +
    '\n\n' +
    capabilities +
    catalog +
    '\n\nRegras: estatísticas do BreakerBot vêm das ferramentas, não da memória conversacional. ' +
    'Se o usuário pedir uma ação (figurinha, ranking, menu etc.) e houver mídia ou comando aplicável, use run_bot_command em vez de só explicar como usar.';

  const planPrompt =
    `Pergunta do usuário:\n${input.userPrompt}\n\n` +
    'Decida se precisa consultar ferramentas ou executar run_bot_command antes de responder.';

  let plan = await promptPlan(input.client, input.sessionId, system, planPrompt);

  if (!plan) {
    plan = {
      step: 'use_tools',
      tools: inferToolsFromQuestion(input.userPrompt, input.mediaKind ?? null),
    };
  }

  const inferredActions = inferToolsFromQuestion(input.userPrompt, input.mediaKind ?? null);
  const hasInferredAction = inferredActions.some((t) => t.tool === 'run_bot_command');

  if (plan.step === 'respond' && hasInferredAction) {
    plan = { step: 'use_tools', tools: inferredActions };
  } else if (plan.step === 'respond' && plan.message?.trim()) {
    if (isAgentPlanJson(plan.message)) {
      plan = parseJsonPlan(plan.message) ?? plan;
    } else {
      const safe = sanitizeUserFacingText(plan.message);
      if (safe) return { ok: true, text: safe };
    }
  }

  let tools = plan.tools?.length
    ? plan.tools
    : inferToolsFromQuestion(input.userPrompt, input.mediaKind ?? null);
  const toolResults = tools.length
    ? await executeToolBatch(tools, input.toolContext)
    : [];

  if (actionExecutedInResults(toolResults)) {
    return { ok: true, text: '' };
  }

  const answer = await synthesizeAnswer(
    input.client,
    input.sessionId,
    system,
    input.userPrompt,
    toolResults,
    input.isAdmin,
    capabilities,
  );

  if (answer) return { ok: true, text: answer };

  return {
    ok: true,
    text: 'Hmm, não achei muita coisa no banco pra isso — reformula ou me manda outra?',
  };
}
