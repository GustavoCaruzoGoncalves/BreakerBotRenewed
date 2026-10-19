import type { ConsentScope, ToolName, ToolRequestContext } from './types.js';

/** Campos permitidos sobre terceiros em qualquer contexto público. */
export const PUBLIC_THIRD_PARTY_TOOL_FIELDS = [
  'displayName',
  'level',
  'xp',
  'prestige',
  'rankName',
  'badges',
  'auraPoints',
  'trucoWins',
  'trucoMatchesPlayed',
] as const;

/** Informações do próprio usuário disponíveis em grupo (evita dados sensíveis). */
export const SELF_GROUP_ALLOWED_TOOLS: ReadonlySet<ToolName> = new Set([
  'get_my_level_stats',
  'get_my_badges',
  'get_my_aura',
  'get_my_truco_stats',
  'get_level_ranking',
  'get_aura_ranking',
  'get_truco_ranking',
  'get_mentioned_user_public_stats',
  'lookup_users_public',
]);

/** Ferramentas que nunca devem ser expostas ao modelo para dados de terceiros. */
export const BLOCKED_THIRD_PARTY_TOOLS: ReadonlySet<ToolName> = new Set([
  'get_my_missions',
  'get_my_preferences',
  'get_my_level_history',
]);

export function isGroup(ctx: ToolRequestContext): boolean {
  return ctx.chatKind === 'group';
}

export function assertSelfTarget(targetUserId: string, ctx: ToolRequestContext): boolean {
  return targetUserId === ctx.canonicalUserId;
}

export function canRunTool(tool: ToolName, ctx: ToolRequestContext): boolean {
  if (tool === 'run_bot_command') return Boolean(ctx.actionDispatch);
  if (!isGroup(ctx)) return true;
  if (tool.startsWith('get_my_')) return SELF_GROUP_ALLOWED_TOOLS.has(tool);
  if (tool === 'get_user_extended_stats') return false;
  return SELF_GROUP_ALLOWED_TOOLS.has(tool);
}

export function scopeForExtendedTool(tool: ToolName): ConsentScope | null {
  switch (tool) {
    case 'get_user_extended_stats':
      return 'profile_extended';
    case 'get_my_missions':
      return 'mission_progress';
    case 'get_my_preferences':
      return 'preferences';
    case 'get_my_level_history':
      return 'level_history';
    case 'get_my_aura':
      return 'aura_detail';
    default:
      return null;
  }
}

/** Bloqueia tentativa de injetar identidade falsa via argumentos. */
export function stripUntrustedIdentityArgs(args: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...args };
  delete copy.requesterId;
  delete copy.senderId;
  delete copy.userId;
  delete copy.canonicalUserId;
  delete copy.jid;
  delete copy.phone;
  return copy;
}

const INJECTION_PATTERNS = [
  /ignore (all|previous) instructions/i,
  /you are now/i,
  /pretend (you are|to be)/i,
  /system prompt/i,
  /execute sql/i,
  /select \* from/i,
];

export function looksLikePromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}
