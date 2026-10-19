import { getCommands } from '../../commands/registry.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { CommandEntry } from '../../types/bot.js';
import type { BotMessage, WASocket } from '../../types/bot.js';
import type { ToolRequestContext, ToolResult } from './types.js';

/** Evita loop na IA ou redirecionamento inútil. */
const BLOCKED_AI_TRIGGERS = new Set([
  '!opencode',
  '!oc',
  '!ia',
]);

interface TriggerMeta {
  entry: CommandEntry;
  trigger: string;
}

let triggerIndex: Map<string, TriggerMeta> | null = null;

function getTriggerIndex(): Map<string, TriggerMeta> {
  if (triggerIndex) return triggerIndex;
  triggerIndex = new Map();
  for (const cmd of getCommands()) {
    for (const entry of cmd.meta.entries) {
      const primary = entry.trigger.toLowerCase();
      triggerIndex.set(primary, { entry, trigger: entry.trigger });
      for (const alias of entry.aliases ?? []) {
        triggerIndex.set(alias.toLowerCase(), { entry, trigger: entry.trigger });
      }
    }
  }
  return triggerIndex;
}

export function resetTriggerIndexForTests(): void {
  triggerIndex = null;
}

export function listRunnableCommandTriggers(isAdmin: boolean): string[] {
  const index = getTriggerIndex();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { entry, trigger } of index.values()) {
    const key = trigger.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (BLOCKED_AI_TRIGGERS.has(key)) continue;
    if (entry.admin && !isAdmin) continue;
    out.push(trigger);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function buildRunnableCommandsPrompt(isAdmin: boolean): string {
  const triggers = listRunnableCommandTriggers(isAdmin);
  const lines = triggers.map((t) => `- ${t}`);
  return (
    '\n\nComandos executáveis via run_bot_command (mesmos do !menu; use o gatilho exato + argumentos se houver):\n' +
    lines.join('\n')
  );
}

export function validateRunnableCommandLine(
  commandLine: string,
  ctx: ToolRequestContext,
): { ok: true; line: string; trigger: string } | { ok: false; result: ToolResult } {
  const trimmed = commandLine.trim();
  if (!trimmed.startsWith('!')) {
    return {
      ok: false,
      result: { ok: false, code: 'invalid_args', message: 'Comando deve começar com !.' },
    };
  }

  const token = trimmed.split(/\s/)[0]?.toLowerCase() ?? '';
  if (BLOCKED_AI_TRIGGERS.has(token)) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'forbidden',
        message: `Comando ${token} não pode ser disparado pela IA.`,
      },
    };
  }

  const meta = getTriggerIndex().get(token);
  if (!meta) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'not_found',
        message: `Comando ${token} não existe. Use um gatilho do !menu.`,
      },
    };
  }

  const { entry } = meta;
  if (entry.admin && !ctx.isBotAdmin) {
    return {
      ok: false,
      result: { ok: false, code: 'forbidden', message: 'Comando restrito a administradores.' },
    };
  }
  if (entry.groupOnly && ctx.chatKind !== 'group') {
    return {
      ok: false,
      result: { ok: false, code: 'forbidden', message: 'Comando só funciona em grupo.' },
    };
  }

  const normalizedTrigger = meta.trigger.toLowerCase();
  const rest = trimmed.slice(token.length);
  const line = meta.trigger + rest;

  return { ok: true, line, trigger: normalizedTrigger };
}

export async function dispatchBotCommand(
  sock: WASocket,
  msg: BotMessage,
  commandLine: string,
  ctx: ToolRequestContext,
): Promise<ToolResult> {
  const validated = validateRunnableCommandLine(commandLine, ctx);
  if (!validated.ok) return validated.result;

  const synthetic: BotMessage = { ...msg, text: validated.line };

  try {
    for (const command of getCommands()) {
      const handled = await command.handle(sock, synthetic);
      if (handled) {
        return {
          ok: true,
          data: { executed: true, command: validated.trigger },
        };
      }
    }
    return {
      ok: false,
      code: 'not_found',
      message:
        'Comando reconhecido, mas não aplicável a esta mensagem (ex.: falta mídia ou menção).',
    };
  } catch (err) {
    console.error('[AGENT-ACTION]', getErrorMessage(err));
    return { ok: false, code: 'internal_error', message: 'Erro ao executar o comando.' };
  }
}
