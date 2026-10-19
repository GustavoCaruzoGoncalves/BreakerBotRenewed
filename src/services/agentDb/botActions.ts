import { getCommands } from '../../commands/registry.js';
import { getErrorMessage } from '../../lib/errors.js';
import type { BotMessage, WASocket } from '../../types/bot.js';
import type { ToolRequestContext, ToolResult } from './types.js';

/** Comandos que a IA pode disparar (whitelist explícita). */
export const AI_RUNNABLE_COMMANDS = new Set([
  '!sticker',
  '!fsticker',
  '!toimg',
  '!me',
  '!ranking',
  '!elos',
  '!niveis',
  '!menu',
  '!meusdados',
  '!meunivel',
  '!minhasaura',
  '!meuranking',
  '!meditar',
  '!treinar',
  '!dominar',
  '!ritual',
  '!lyrics',
  '!trivia',
  '!pinto',
  '!fazol',
  '!vumvum',
]);

const ADMIN_EXTRA = new Set(['!feature']);

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

  const trigger = trimmed.split(/\s/)[0]?.toLowerCase() ?? '';
  const allowed =
    AI_RUNNABLE_COMMANDS.has(trigger) || (ctx.isBotAdmin && ADMIN_EXTRA.has(trigger));
  if (!allowed) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'forbidden',
        message: `Comando ${trigger} não pode ser executado pela IA.`,
      },
    };
  }

  for (const cmd of getCommands()) {
    for (const entry of cmd.meta.entries) {
      if (entry.trigger.toLowerCase() !== trigger) continue;
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
    }
  }

  return { ok: true, line: trimmed, trigger };
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
