import { config } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import * as memRepo from '../../database/memoryRepository.js';
import { buildDmThreadId, buildGroupThreadId } from '../../services/memory/logic.js';
import { recordAssistantMessage } from '../../services/memory/recorder.js';
import { chatWithOpencode } from '../../services/opencode/service.js';
import * as users from '../../services/users.js';
import type { BotMessage, Command, CommandHandler, WASocket } from '../../types/bot.js';

const RESET = '!resetOpencode';

function extractPrompt(text: string): string | null {
  if (text.startsWith('!oc ')) return text.slice(4).trim();
  if (text.startsWith('!opencode ')) return text.slice('!opencode '.length).trim();
  return null;
}

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

  if (trimmed === '!opencode' || trimmed === '!oc') {
    await sock.sendMessage(jid, {
      text: '❌ Use `!opencode <pergunta>` (ou `!oc`) para conversar com o agente OpenCode.',
    });
    return true;
  }

  const prompt = extractPrompt(trimmed);
  if (prompt === null) return false;

  if (!prompt) {
    await sock.sendMessage(jid, { text: '❌ Digite uma pergunta junto com `!opencode`.' });
    return true;
  }

  const sender = await users.resolveSender(raw);
  if (!sender || users.isGroupUserId(sender)) {
    await sock.sendMessage(jid, { text: '❌ Não foi possível identificar o remetente.' });
    return true;
  }

  const quotedMsg = raw.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedText =
    quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || null;

  const contextKey = jid.endsWith('@g.us') ? buildGroupThreadId(jid) : buildDmThreadId(sender);
  const title = jid.endsWith('@g.us') ? `Grupo ${jid}` : `DM ${sender}`;

  try {
    const result = await chatWithOpencode({
      contextKey,
      sessionTitle: title,
      chatJid: jid,
      senderUserId: sender,
      userPrompt: prompt,
      quotedText,
      isAdmin: config.admins.includes(sender),
      systemBase: '',
    });

    await sock.sendMessage(jid, { text: result.text });
    if (result.ok) {
      await recordAssistantMessage(jid, sender, result.text);
    }
    return true;
  } catch (err) {
    console.error('[OPENCODE-CMD]', getErrorMessage(err));
    await sock.sendMessage(jid, { text: 'Erro ao processar com OpenCode.' });
    return true;
  }
};

const opencodeCommand: Command = {
  meta: {
    category: 'IA',
    entries: [
      {
        trigger: '!opencode',
        aliases: ['!oc'],
        description: 'Conversa com o agente OpenCode (memória persistente e pesquisa web)',
        usages: [{ syntax: '!opencode <pergunta>', description: 'Pergunta em texto' }],
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
