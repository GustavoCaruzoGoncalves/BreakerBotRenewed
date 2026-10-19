import { config } from '../../config.js';
import * as memRepo from '../../database/memoryRepository.js';
import { buildDmThreadId, buildGroupThreadId } from '../../services/memory/logic.js';
import * as users from '../../services/users.js';
import type { BotMessage, Command, CommandHandler, WASocket } from '../../types/bot.js';

const RESET = '!resetOpencode';

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (raw.key.fromMe) return false;

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === RESET || lower.startsWith(`${RESET} `)) {
    const sender =
      (await users.resolveSender(raw)) ??
      (jid.endsWith('@g.us') ? raw.key.participantAlt || raw.key.participant || jid : jid);
    if (!config.admins.includes(sender)) {
      await sock.sendMessage(jid, {
        text: '❌ Somente administradores podem resetar a sessão OpenCode.',
      });
      return true;
    }
    const contextKey = jid.endsWith('@g.us') ? buildGroupThreadId(jid) : buildDmThreadId(sender);
    await memRepo.deleteOpencodeSessionMapping(contextKey);
    await sock.sendMessage(jid, { text: '✅ Sessão OpenCode deste chat resetada.' });
    return true;
  }

  if (lower === '!ia') {
    const where = jid.endsWith('@g.us') ? 'Mencione @Breaker Bot' : 'Envie sua pergunta aqui no privado';
    await sock.sendMessage(jid, {
      text:
        `🤖 *IA do BreakerBot*\n\n${where} com sua pergunta.\n` +
        'Ex.: _@Breaker Bot o que posso fazer neste bot?_\n\n`!menu` lista comandos com `!`.',
    });
    return true;
  }

  if (
    lower === '!opencode' ||
    lower.startsWith('!opencode ') ||
    lower === '!oc' ||
    lower.startsWith('!oc ')
  ) {
    const where = jid.endsWith('@g.us') ? 'Mencione @Breaker Bot' : 'Envie sua pergunta no privado';
    await sock.sendMessage(jid, {
      text:
        `🤖 A IA não usa mais \`!oc\` / \`!opencode\`.\n\n` +
        `${where} com sua pergunta (ex.: o que posso fazer neste bot?).\n` +
        'Comandos com `!` continuam iguais (`!menu`, `!gpt`, etc.).',
    });
    return true;
  }

  return false;
};

const opencodeCommand: Command = {
  meta: {
    category: 'IA',
    entries: [
      {
        trigger: '!ia',
        aliases: ['!opencode', '!oc'],
        description: 'IA por menção: no grupo, mencione @Breaker Bot; no privado, converse normalmente',
        usages: [
          {
            syntax: '@Breaker Bot <pergunta>',
            description: 'No grupo, mencione o bot (substitui !oc)',
          },
        ],
      },
      {
        trigger: '!resetOpencode',
        description: 'Reseta a sessão OpenCode deste chat (admin)',
        admin: true,
      },
    ],
  },
  handle,
};

export default opencodeCommand;
