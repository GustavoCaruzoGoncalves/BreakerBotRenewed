/** Contexto confiável — sempre montado pelo bot a partir da mensagem Baileys. */
export interface ToolRequestContext {
  requestId: string;
  canonicalUserId: string;
  chatJid: string;
  chatKind: 'dm' | 'group';
  groupJid: string | null;
  displayName: string | null;
  isBotAdmin: boolean;
  waMessageId: string | null;
  /** IDs canônicos resolvidos a partir de menções na mensagem (nunca do modelo). */
  mentionedUserIds: readonly string[];
}

export type ConsentScope =
  | 'profile_extended'
  | 'aura_detail'
  | 'mission_progress'
  | 'preferences'
  | 'level_history';

export type ToolName =
  | 'get_my_level_stats'
  | 'get_my_badges'
  | 'get_my_aura'
  | 'get_my_missions'
  | 'get_my_preferences'
  | 'get_my_level_history'
  | 'get_my_truco_stats'
  | 'get_level_ranking'
  | 'get_aura_ranking'
  | 'get_truco_ranking'
  | 'get_mentioned_user_public_stats'
  | 'lookup_users_public'
  | 'get_user_extended_stats';

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code:
        | 'forbidden'
        | 'not_found'
        | 'invalid_args'
        | 'consent_required'
        | 'rate_limited'
        | 'internal_error';
      message: string;
      consentRequestId?: string;
    };

export interface AgentPlan {
  step: 'respond' | 'use_tools';
  tools?: ToolCall[];
  message?: string;
}
