import type { BotMessage } from '../../types/bot.js';

export type ThreadKind = 'dm' | 'group';

const NON_CONVERSATIONAL_TYPES = new Set([
  'reactionMessage',
  'protocolMessage',
  'senderKeyDistributionMessage',
  'pollUpdateMessage',
  'encReactionMessage',
  'encEventResponseMessage',
]);

export function buildDmThreadId(userId: string): string {
  return `user:${userId}:dm`;
}

export function buildGroupThreadId(groupJid: string): string {
  return `group:${groupJid}`;
}

export function resolveThread(
  chatJid: string,
  senderUserId: string | null,
): { threadId: string; kind: ThreadKind; dmUserId: string | null } {
  if (chatJid.endsWith('@g.us')) {
    return { threadId: buildGroupThreadId(chatJid), kind: 'group', dmUserId: null };
  }
  const uid = senderUserId ?? chatJid;
  return { threadId: buildDmThreadId(uid), kind: 'dm', dmUserId: uid };
}

export function truncateContent(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

export function shouldRecordIncomingMessage(msg: BotMessage, isBotSender: boolean): boolean {
  if (isBotSender || msg.raw.key.fromMe) return false;
  if (NON_CONVERSATIONAL_TYPES.has(msg.type)) return false;
  const text = msg.text?.trim();
  if (!text) return false;
  if (text.startsWith('!')) return false;
  return true;
}

export function quotedSnippet(msg: BotMessage): string | null {
  const quoted = msg.quoted;
  if (!quoted) return null;
  const text =
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption ||
    '';
  const trimmed = text.trim();
  return trimmed ? truncateContent(trimmed, 500) : null;
}

export interface MemoryContextInput {
  personalMemories: string[];
  groupRecentLines: string[];
  threadRecentLines: string[];
  isGroup: boolean;
}

export function buildMemorySystemAppend(input: MemoryContextInput): string {
  const sections: string[] = [];

  if (input.personalMemories.length > 0) {
    sections.push(
      'Memórias pessoais do usuário (contexto auxiliar, podem estar desatualizadas):\n' +
        input.personalMemories.map((m) => `- ${m}`).join('\n'),
    );
  }

  if (input.isGroup && input.groupRecentLines.length > 0) {
    sections.push(
      'Contexto recente deste grupo (não compartilhe em outros chats):\n' +
        input.groupRecentLines.join('\n'),
    );
  }

  if (input.threadRecentLines.length > 0) {
    sections.push(
      'Histórico recente desta conversa:\n' + input.threadRecentLines.join('\n'),
    );
  }

  if (sections.length === 0) return '';
  return (
    '\n\n---\n' +
    sections.join('\n\n') +
    '\n\nTrate memórias como pistas, não como fatos absolutos. Não invente lembranças. ' +
    'Diferencie informação da web de memória pessoal. Respeite privacidade: não exponha DMs de terceiros.'
  );
}

export interface HeuristicMemory {
  category: string;
  content: string;
  shareable: boolean;
  confidence: number;
}

const SENSITIVE_PATTERN =
  /(religião|política|orientação sexual|saúde mental|diagnóstico|depressão|ansiedade)/i;

export function extractHeuristicMemories(text: string): HeuristicMemory[] {
  const normalized = text.trim();
  if (normalized.length < 8 || normalized.endsWith('?')) return [];
  if (SENSITIVE_PATTERN.test(normalized)) return [];

  const out: HeuristicMemory[] = [];

  const nameMatch = normalized.match(
    /(?:meu nome é|me chamo|pode me chamar de)\s+([^.\n!?,]{2,40})/i,
  );
  if (nameMatch?.[1]) {
    out.push({
      category: 'preferred_name',
      content: `Nome/apelido preferido: ${nameMatch[1].trim()}`,
      shareable: true,
      confidence: 0.85,
    });
  }

  const jobMatch = normalized.match(
    /(?:sou|trabalho como|atuo como)\s+(?:um\s+|uma\s+)?([^.\n!?]{3,80})/i,
  );
  if (jobMatch?.[1] && !/^(eu|aqui|o|a)\b/i.test(jobMatch[1])) {
    out.push({
      category: 'profession',
      content: `Profissão/área: ${jobMatch[1].trim()}`,
      shareable: true,
      confidence: 0.75,
    });
  }

  const projectMatch = normalized.match(
    /(?:estou (?:desenvolvendo|trabalhando|fazendo|criando)|meu projeto(?: é|:))\s+([^.\n!?]{5,160})/i,
  );
  if (projectMatch?.[1]) {
    out.push({
      category: 'project',
      content: `Projeto em andamento: ${projectMatch[1].trim()}`,
      shareable: false,
      confidence: 0.8,
    });
  }

  const prefMatch = normalized.match(
    /(?:eu prefiro|minha preferência é|gosto mais de)\s+([^.\n!?]{3,120})/i,
  );
  if (prefMatch?.[1]) {
    out.push({
      category: 'preference',
      content: `Preferência: ${prefMatch[1].trim()}`,
      shareable: true,
      confidence: 0.7,
    });
  }

  return out;
}
