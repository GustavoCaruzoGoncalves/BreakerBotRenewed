import { config } from '../../config.js';
import * as repo from '../../database/repository.js';
import * as memRepo from '../../database/memoryRepository.js';
import {
  buildMemorySystemAppend,
  resolveThread,
  truncateContent,
  type ThreadKind,
} from './logic.js';

const nameCache = new Map<string, string>();

async function displayNameFor(userId: string | null): Promise<string> {
  if (!userId) return 'Alguém';
  const cached = nameCache.get(userId);
  if (cached) return cached;

  const user = await repo.getUserById(userId);
  let name: string;
  if (user?.customNameEnabled && user.customName) name = user.customName;
  else if (user?.pushName) name = user.pushName;
  else name = userId.split('@')[0]?.split(':')[0] || 'Alguém';

  nameCache.set(userId, name);
  return name;
}

async function formatLineAsync(
  role: string,
  senderUserId: string | null,
  content: string,
  viewerUserId: string,
): Promise<string> {
  if (role === 'assistant') {
    return `Breaker Bot: ${truncateContent(content, 600)}`;
  }
  const who =
    senderUserId && senderUserId === viewerUserId
      ? 'Você'
      : await displayNameFor(senderUserId);
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
  const personal =
    enabled && !isGroup
      ? await memRepo.getPersonalMemoriesForContext(
          viewerUserId,
          config.memory.personalMemoryLimit,
          true,
        )
      : enabled && isGroup
        ? await memRepo.getPersonalMemoriesForContext(
            viewerUserId,
            config.memory.personalMemoryLimit,
            false,
          )
        : [];

  if (!enabled && !isGroup) return '';

  const threadMsgs = await memRepo.getRecentThreadMessages(
    threadId,
    config.memory.shortTermLimit,
  );

  const threadRecentLines = await Promise.all(
    threadMsgs.map((m) =>
      formatLineAsync(m.role, m.sender_user_id, m.content, viewerUserId),
    ),
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
