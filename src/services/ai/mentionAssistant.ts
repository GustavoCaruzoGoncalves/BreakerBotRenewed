import { config } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import { buildToolContextFromMessage } from '../agentDb/context.js';
import {
  buildMessageContextBlock,
  mediaKindFromMessage,
} from '../agentDb/messageContext.js';
import { trackBotOutgoingMessage } from './botReplyIndex.js';
import {
  buildPersonalityPromptForChat,
  humanizeAiText,
  shouldSkipProactiveReply,
} from './personality.js';
import { buildDmThreadId, buildGroupThreadId } from '../memory/logic.js';
import { recordAssistantMessage } from '../memory/recorder.js';
import { chatWithOpencode } from '../opencode/service.js';
import type { AiInteractionMode } from './personality.js';
import * as users from '../users.js';
import type { BotMessage, WASocket } from '../../types/bot.js';
import {
  extractPromptFromMentionText,
  shouldActivateAiAssistant,
} from './botMention.js';

export interface RunAiChatOptions {
  mode?: AiInteractionMode;
  skipAgentDb?: boolean;
}

export async function runAiChat(
  sock: WASocket,
  msg: BotMessage,
  sender: string,
  prompt: string,
  options: RunAiChatOptions = {},
): Promise<boolean> {
  const mode = options.mode ?? 'direct';
  const quotedMsg = msg.raw.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedText =
    quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || null;

  const { jid } = msg;
  const contextKey = jid.endsWith('@g.us') ? buildGroupThreadId(jid) : buildDmThreadId(sender);
  const title = jid.endsWith('@g.us') ? `Grupo ${jid}` : `DM ${sender}`;

  try {
    const toolContext = options.skipAgentDb
      ? undefined
      : {
          ...(await buildToolContextFromMessage(msg, sender)),
          actionDispatch: { sock, msg },
        };
    const messageContext = buildMessageContextBlock(msg);
    const result = await chatWithOpencode({
      contextKey,
      sessionTitle: title,
      chatJid: jid,
      senderUserId: sender,
      userPrompt: `${messageContext}\n\n${prompt}`,
      mediaKind: mediaKindFromMessage(msg),
      quotedText,
      isAdmin: config.admins.includes(sender),
      systemBase: await buildPersonalityPromptForChat(jid, mode),
      toolContext,
      interactionMode: mode,
      skipAgentDb: options.skipAgentDb,
    });

    if (mode === 'proactive' && shouldSkipProactiveReply(result.text)) {
      return false;
    }

    const outgoing = humanizeAiText(result.text);
    if (!outgoing) return false;

    const sent = await sock.sendMessage(msg.jid, { text: outgoing });
    const waId = sent?.key?.id ?? undefined;
    trackBotOutgoingMessage(jid, waId ?? null);
    if (result.ok) {
      await recordAssistantMessage(jid, sender, outgoing, waId);
    }
    return true;
  } catch (err) {
    console.error('[AI-CHAT]', getErrorMessage(err));
    if (mode === 'direct') {
      await sock.sendMessage(msg.jid, { text: 'Deu ruim aqui, manda de novo daqui a pouco.' });
      return true;
    }
    return false;
  }
}

export async function tryHandleAiMention(sock: WASocket, msg: BotMessage): Promise<boolean> {
  if (!config.opencode.enabled) return false;

  if (!(await shouldActivateAiAssistant(sock, msg, config.opencode.requireMentionInDm))) {
    return false;
  }

  const sender = await users.resolveSender(msg.raw);
  if (!sender || users.isGroupUserId(sender) || users.isBotUser(sock, sender)) {
    return false;
  }

  let prompt = extractPromptFromMentionText(msg.text);
  if (!prompt && msg.media) {
    prompt = 'Faz o que pedi com a mídia que mandei.';
  }
  if (!prompt) {
    await sock.sendMessage(msg.jid, { text: 'Fala — tô ouvindo. 😎' });
    return true;
  }

  return runAiChat(sock, msg, sender, prompt, { mode: 'direct' });
}
