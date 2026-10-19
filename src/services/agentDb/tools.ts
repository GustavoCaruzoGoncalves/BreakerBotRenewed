import { config } from '../../config.js';
import * as consentRepo from '../../database/consentRepository.js';
import * as aura from '../aura.js';
import * as level from '../level.js';
import * as trucoRepo from '../../games/truco/repository.js';
import { getErrorMessage } from '../../lib/errors.js';
import * as readModels from './readModels.js';
import {
  canRunTool,
  isGroup,
  scopeForExtendedTool,
  stripUntrustedIdentityArgs,
} from './policy.js';
import { dispatchBotCommand } from './botActions.js';
import type { ConsentScope, ToolCall, ToolName, ToolRequestContext, ToolResult } from './types.js';

const MAX_CALLS_PER_MINUTE = 30;
const callWindows = new Map<string, { count: number; since: number }>();

export const TOOL_CATALOG: ReadonlyArray<{ name: ToolName; description: string }> = [
  { name: 'get_my_level_stats', description: 'Nível, XP, prestígio e progresso do solicitante.' },
  { name: 'get_my_badges', description: 'Badges do solicitante.' },
  { name: 'get_my_aura', description: 'Aura, tier e personagem do solicitante.' },
  { name: 'get_my_missions', description: 'Missões diárias de aura do solicitante (privado).' },
  { name: 'get_my_preferences', description: 'Preferências do solicitante (privado).' },
  { name: 'get_my_level_history', description: 'Histórico recente de nível do solicitante.' },
  { name: 'get_my_truco_stats', description: 'Estatísticas de Truco do solicitante.' },
  { name: 'get_level_ranking', description: 'Ranking público de níveis (limite parametrizável).' },
  { name: 'get_aura_ranking', description: 'Ranking público de aura.' },
  { name: 'get_truco_ranking', description: 'Ranking público de Truco.' },
  {
    name: 'get_mentioned_user_public_stats',
    description:
      'Estatísticas públicas de um usuário mencionado na mensagem (índice 0 = primeira menção).',
  },
  {
    name: 'lookup_users_public',
    description: 'Busca por nome/apelido e retorna estatísticas públicas (máx. 3 resultados).',
  },
  {
    name: 'get_user_extended_stats',
    description:
      'Perfil estendido de usuário mencionado; exige consentimento do titular se não for o solicitante.',
  },
  {
    name: 'run_bot_command',
    description:
      'Executa um comando real do BreakerBot (ex.: !sticker com mídia já anexa). Args: { "command": "!sticker" } — pode incluir argumentos após o gatilho.',
  },
];

function rateLimit(ctx: ToolRequestContext): ToolResult | null {
  const now = Date.now();
  const key = ctx.canonicalUserId;
  const win = callWindows.get(key);
  if (!win || now - win.since > 60_000) {
    callWindows.set(key, { count: 1, since: now });
    return null;
  }
  win.count += 1;
  if (win.count > MAX_CALLS_PER_MINUTE) {
    return { ok: false, code: 'rate_limited', message: 'Limite de consultas por minuto atingido.' };
  }
  return null;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

async function requireConsent(
  ownerUserId: string,
  requesterUserId: string,
  scope: ConsentScope,
  ctx: ToolRequestContext,
): Promise<ToolResult | null> {
  if (ownerUserId === requesterUserId) return null;
  const ok = await consentRepo.hasActiveConsent(ownerUserId, requesterUserId, scope);
  if (ok) return null;
  const requestId = await consentRepo.createConsentRequest(
    ownerUserId,
    requesterUserId,
    scope,
    ctx.chatJid,
  );
  return {
    ok: false,
    code: 'consent_required',
    message:
      'Consentimento do titular necessário. Peça para a pessoa usar `!consentir aprovar` na DM com o bot.',
    consentRequestId: requestId,
  };
}

function resolveMentionTarget(args: Record<string, unknown>, ctx: ToolRequestContext): string | null {
  const index = Math.max(0, Math.floor(Number(args.mentionIndex ?? 0)));
  return ctx.mentionedUserIds[index] ?? null;
}

export async function executeTool(
  call: ToolCall,
  ctx: ToolRequestContext,
): Promise<ToolResult> {
  const limited = rateLimit(ctx);
  if (limited) return limited;

  if (!canRunTool(call.tool, ctx)) {
    return { ok: false, code: 'forbidden', message: 'Ferramenta não permitida neste contexto.' };
  }

  const args = stripUntrustedIdentityArgs(call.args ?? {});

  try {
    switch (call.tool) {
      case 'get_my_level_stats': {
        const data = await readModels.buildMyLevelStats(ctx.canonicalUserId, ctx);
        if (!data) return { ok: false, code: 'not_found', message: 'Usuário não encontrado.' };
        if (isGroup(ctx)) {
          const { totalMessages: _tm, ...publicSelf } = data;
          return { ok: true, data: publicSelf };
        }
        return { ok: true, data };
      }
      case 'get_my_badges': {
        const data = await readModels.buildMyBadges(ctx.canonicalUserId);
        if (!data) return { ok: false, code: 'not_found', message: 'Usuário não encontrado.' };
        return { ok: true, data };
      }
      case 'get_my_aura': {
        const data = await readModels.buildMyAura(ctx.canonicalUserId);
        return { ok: true, data };
      }
      case 'get_my_missions': {
        if (isGroup(ctx)) {
          return {
            ok: false,
            code: 'forbidden',
            message: 'Missões são privadas; consulte na DM.',
          };
        }
        return { ok: true, data: await readModels.buildMyMissions(ctx.canonicalUserId) };
      }
      case 'get_my_preferences': {
        if (isGroup(ctx)) {
          return { ok: false, code: 'forbidden', message: 'Preferências são privadas; use DM.' };
        }
        const data = await readModels.buildMyPreferences(ctx.canonicalUserId);
        if (!data) return { ok: false, code: 'not_found', message: 'Usuário não encontrado.' };
        return { ok: true, data };
      }
      case 'get_my_level_history': {
        if (isGroup(ctx)) {
          return { ok: false, code: 'forbidden', message: 'Histórico detalhado disponível na DM.' };
        }
        return { ok: true, data: await readModels.buildMyLevelHistory(ctx.canonicalUserId) };
      }
      case 'get_my_truco_stats':
        return { ok: true, data: await readModels.buildMyTrucoStats(ctx.canonicalUserId) };
      case 'get_level_ranking': {
        const limit = clampLimit(args.limit, 5, 10);
        const rows = await level.getRanking(limit);
        const enriched = await Promise.all(
          rows.map(async (r) => {
            const info = await level.getUserInfo(r.userId);
            return {
              displayName: info
                ? readModels.displayNameFor(info, ctx, r.userId)
                : 'Usuário',
              level: r.level,
              xp: r.xp,
              prestige: r.prestige,
              rankName: r.rank.name,
            };
          }),
        );
        return { ok: true, data: enriched };
      }
      case 'get_aura_ranking': {
        const limit = clampLimit(args.limit, 5, 10);
        const rows = await aura.getRanking(limit);
        const enriched = await Promise.all(
          rows.map(async (r) => {
            const info = await level.getUserInfo(r.userId);
            return {
              displayName: info
                ? readModels.displayNameFor(info, ctx, r.userId)
                : 'Usuário',
              auraPoints: r.auraPoints,
              tier: r.tierName,
            };
          }),
        );
        return { ok: true, data: enriched };
      }
      case 'get_truco_ranking': {
        const limit = clampLimit(args.limit, 5, 10);
        const rows = await trucoRepo.getGlobalRanking(limit);
        return {
          ok: true,
          data: rows.map((r) => ({
            displayName: r.display_name,
            wins: r.wins,
            losses: r.losses,
            matchesPlayed: r.matches_played,
            auraPoints: Number(r.aura_points),
          })),
        };
      }
      case 'get_mentioned_user_public_stats': {
        const target = resolveMentionTarget(args, ctx);
        if (!target) {
          return { ok: false, code: 'invalid_args', message: 'Nenhuma menção disponível.' };
        }
        const data = await readModels.buildPublicUserStats(target, ctx);
        if (!data) return { ok: false, code: 'not_found', message: 'Usuário não encontrado.' };
        return { ok: true, data };
      }
      case 'lookup_users_public': {
        const q = String(args.query ?? '').trim();
        if (q.length < 2) {
          return { ok: false, code: 'invalid_args', message: 'Query muito curta.' };
        }
        const matches = await readModels.searchUsersPublic(q, 3);
        const enriched = [];
        for (const m of matches) {
          const stats = await readModels.buildPublicUserStats(m.userId, ctx);
          if (stats) enriched.push(stats);
        }
        return { ok: true, data: { matches: enriched } };
      }
      case 'get_user_extended_stats': {
        const target = resolveMentionTarget(args, ctx);
        if (!target) {
          return { ok: false, code: 'invalid_args', message: 'Informe uma menção válida.' };
        }
        if (target !== ctx.canonicalUserId) {
          const scope = scopeForExtendedTool(call.tool)!;
          const consent = await requireConsent(target, ctx.canonicalUserId, scope, ctx);
          if (consent) return consent;
        }
        const data = await readModels.buildExtendedUserStats(target, ctx);
        if (!data) return { ok: false, code: 'not_found', message: 'Usuário não encontrado.' };
        return { ok: true, data };
      }
      case 'run_bot_command': {
        const dispatch = ctx.actionDispatch;
        if (!dispatch) {
          return { ok: false, code: 'internal_error', message: 'Ações indisponíveis neste contexto.' };
        }
        const command = String(args.command ?? '').trim();
        if (!command) {
          return { ok: false, code: 'invalid_args', message: 'Informe args.command (ex.: "!sticker").' };
        }
        return dispatchBotCommand(dispatch.sock, dispatch.msg, command, ctx);
      }
      default:
        return { ok: false, code: 'forbidden', message: 'Ferramenta desconhecida.' };
    }
  } catch (err) {
    console.error('[AGENT-DB]', getErrorMessage(err));
    return { ok: false, code: 'internal_error', message: 'Falha ao consultar o banco.' };
  }
}

export async function executeToolBatch(
  calls: ToolCall[],
  ctx: ToolRequestContext,
): Promise<Array<{ tool: ToolName; result: ToolResult }>> {
  const capped = calls.slice(0, 5);
  const out: Array<{ tool: ToolName; result: ToolResult }> = [];
  for (const call of capped) {
    out.push({ tool: call.tool, result: await executeTool(call, ctx) });
  }
  return out;
}

export function buildToolCatalogPrompt(): string {
  if (!config.agentDb?.enabled) return '';
  const lines = TOOL_CATALOG.map((t) => `- ${t.name}: ${t.description}`);
  return (
    '\n\nFerramentas BreakerBot (leitura + ações; o backend valida identidade e permissões):\n' +
    lines.join('\n') +
    '\nPara usá-las, responda JSON no formato do plano (step=use_tools). ' +
    'Para figurinha com mídia já na mensagem, prefira run_bot_command com !sticker ou !fsticker. ' +
    'Nunca invente estatísticas: use resultados das ferramentas.'
  );
}
