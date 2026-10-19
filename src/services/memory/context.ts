import { config } from '../../config.js';
import * as memRepo from '../../database/memoryRepository.js';
import {
  buildMemorySystemAppend,
  resolveThread,
  truncateContent,
  type ThreadKind,
} from './logic.js';

function formatLine(
  role: string,
  senderUserId: string | null,
  content: string,
  viewerUserId: string,
): string {
  const who =
    role === 'assistant'
      ? 'Bot'
      : senderUserId && senderUserId === viewerUserId
        ? 'Usuário'
        : senderUserId
          ? `Participante`
          : 'Usuário';
  return `${who}: ${truncateContent(content, 600)}`;
}

export async function buildAiContextAppend(
  chatJid: string,
  viewerUserId: string,
): Promise<string> {
  if (!config.memory.enabled) return '';

  const { threadId, kind } = resolveThread(chatJid, viewerUserId);
  const isGroup = kind === 'group';

  const enabled = await memRepo.isMemoryEnabledForUser(viewerUserId);
  if (!enabled) return '';

  const personal = await memRepo.getPersonalMemoriesForContext(
    viewerUserId,
    config.memory.personalMemoryLimit,
    !isGroup,
  );

  const threadMsgs = await memRepo.getRecentThreadMessages(
    threadId,
    config.memory.shortTermLimit,
  );

  const threadRecentLines = threadMsgs.map((m) =>
    formatLine(m.role, m.sender_user_id, m.content, viewerUserId),
  );

  let groupRecentLines: string[] = [];
  if (isGroup) {
    groupRecentLines = threadRecentLines;
    threadRecentLines.length = 0;
  }

  return buildMemorySystemAppend({
    personalMemories: personal,
    groupRecentLines,
    threadRecentLines,
    isGroup,
  });
}

export async function getThreadMeta(
  chatJid: string,
  senderUserId: string,
): Promise<{ threadId: string; kind: ThreadKind }> {
  const { threadId, kind } = resolveThread(chatJid, senderUserId);
  return { threadId, kind };
}
