import { config } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import { buildToolContextFromMessage } from '../agentDb/context.js';
import { buildDmThreadId, buildGroupThreadId } from '../memory/logic.js';
import { recordAssistantMessage } from '../memory/recorder.js';
import { chatWithOpencode } from '../opencode/service.js';
import * as users from '../users.js';
import type { BotMessage, WASocket } from '../../types/bot.js';
import {
  extractPromptFromMentionText,
  shouldActivateAiAssistant,
} from './botMention.js';

export async function tryHandleAiMention(sock: WASocket, msg: BotMessage): Promise<boolean> {
  if (!config.opencode.enabled) return false;

  if (
    !shouldActivateAiAssistant(sock, msg, config.opencode.requireMentionInDm)
  ) {
    return false;
  }

  const sender = await users.resolveSender(msg.raw);
  if (!sender || users.isGroupUserId(sender) || users.isBotUser(sock, sender)) {
    return false;
  }

  const prompt = extractPromptFromMentionText(msg.text);
  if (!prompt) {
    await sock.sendMessage(msg.jid, {
      text: 'Oi! Me mencione com uma pergunta, por exemplo: @Breaker Bot o que posso fazer aqui?',
    });
    return true;
  }

  const quotedMsg = msg.raw.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedText =
    quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || null;

  const { jid } = msg;
  const contextKey = jid.endsWith('@g.us') ? buildGroupThreadId(jid) : buildDmThreadId(sender);
  const title = jid.endsWith('@g.us') ? `Grupo ${jid}` : `DM ${sender}`;

  try {
    const toolContext = await buildToolContextFromMessage(msg, sender);
    const result = await chatWithOpencode({
      contextKey,
      sessionTitle: title,
      chatJid: jid,
      senderUserId: sender,
      userPrompt: prompt,
      quotedText,
      isAdmin: config.admins.includes(sender),
      systemBase: '',
      toolContext,
    });

    await sock.sendMessage(msg.jid, { text: result.text });
    if (result.ok) {
      await recordAssistantMessage(jid, sender, result.text);
    }
    return true;
  } catch (err) {
    console.error('[AI-MENTION]', getErrorMessage(err));
    await sock.sendMessage(msg.jid, { text: 'Não consegui processar agora. Tente de novo em instantes.' });
    return true;
  }
}
