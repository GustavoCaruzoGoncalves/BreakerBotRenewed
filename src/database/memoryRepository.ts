import { query, getClient } from './pool.js';
import type { HeuristicMemory } from '../services/memory/logic.js';

export interface MemorySettingsRow {
  user_id: string;
  enabled: boolean;
  purged_at: Date | null;
}

export interface ChatMessageRow {
  id: number;
  thread_id: string;
  sender_user_id: string | null;
  role: string;
  content: string;
  quoted_snippet: string | null;
  is_from_bot: boolean;
  created_at: Date;
}

export interface UserMemoryRow {
  id: number;
  category: string;
  content: string;
  shareable: boolean;
  confidence: number;
  created_at: Date;
}

export async function ensureMemorySettings(userId: string): Promise<MemorySettingsRow> {
  await query(
    `INSERT INTO ai_memory_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const r = await query<MemorySettingsRow>(
    'SELECT user_id, enabled, purged_at FROM ai_memory_settings WHERE user_id = $1',
    [userId],
  );
  return r.rows[0]!;
}

export async function isMemoryEnabledForUser(userId: string): Promise<boolean> {
  const r = await query<{ enabled: boolean }>(
    'SELECT enabled FROM ai_memory_settings WHERE user_id = $1',
    [userId],
  );
  if (r.rows.length === 0) return true;
  return r.rows[0]!.enabled;
}

export async function setMemoryEnabled(userId: string, enabled: boolean): Promise<void> {
  await ensureMemorySettings(userId);
  await query(
    'UPDATE ai_memory_settings SET enabled = $2, updated_at = NOW() WHERE user_id = $1',
    [userId, enabled],
  );
}

export async function purgeUserMemory(userId: string): Promise<void> {
  await ensureMemorySettings(userId);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ai_user_memories SET deleted_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    await client.query(
      `UPDATE ai_memory_settings SET purged_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listActiveMemories(userId: string, limit: number): Promise<UserMemoryRow[]> {
  const r = await query<UserMemoryRow>(
    `SELECT id, category, content, shareable, confidence, created_at
     FROM ai_user_memories
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC, id DESC
     LIMIT $2`,
    [userId, limit],
  );
  return r.rows;
}

export async function ensureThread(
  threadId: string,
  chatJid: string,
  kind: 'dm' | 'group',
  dmUserId: string | null,
): Promise<void> {
  await query(
    `INSERT INTO ai_conversation_threads (thread_id, chat_jid, kind, dm_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (thread_id) DO UPDATE SET
       chat_jid = EXCLUDED.chat_jid,
       updated_at = NOW()`,
    [threadId, chatJid, kind, dmUserId],
  );
}

export interface InsertChatMessageInput {
  threadId: string;
  waMessageId: string;
  chatJid: string;
  senderUserId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  quotedSnippet?: string | null;
  isFromBot?: boolean;
}

export async function insertChatMessage(input: InsertChatMessageInput): Promise<boolean> {
  const r = await query(
    `INSERT INTO ai_chat_messages (
       thread_id, wa_message_id, chat_jid, sender_user_id, role, content, quoted_snippet, is_from_bot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (chat_jid, wa_message_id) DO NOTHING
     RETURNING id`,
    [
      input.threadId,
      input.waMessageId,
      input.chatJid,
      input.senderUserId,
      input.role,
      input.content,
      input.quotedSnippet ?? null,
      input.isFromBot ?? false,
    ],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function getRecentThreadMessages(
  threadId: string,
  limit: number,
): Promise<ChatMessageRow[]> {
  const r = await query<ChatMessageRow>(
    `SELECT id, thread_id, sender_user_id, role, content, quoted_snippet, is_from_bot, created_at
     FROM ai_chat_messages
     WHERE thread_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [threadId, limit],
  );
  return r.rows.reverse();
}

export async function getPersonalMemoriesForContext(
  userId: string,
  limit: number,
  includeNonShareable: boolean,
): Promise<string[]> {
  const r = await query<{ content: string }>(
    `SELECT content FROM ai_user_memories
     WHERE user_id = $1 AND deleted_at IS NULL
       AND ($2::boolean OR shareable = true)
     ORDER BY updated_at DESC, id DESC
     LIMIT $3`,
    [userId, includeNonShareable, limit],
  );
  return r.rows.map((row) => row.content);
}

export async function upsertHeuristicMemory(
  userId: string,
  memory: HeuristicMemory,
  sourceThreadId: string,
  sourceWaMessageId: string,
): Promise<void> {
  const existing = await query<{ id: number }>(
    `SELECT id FROM ai_user_memories
     WHERE user_id = $1 AND deleted_at IS NULL AND category = $2 AND content = $3
     LIMIT 1`,
    [userId, memory.category, memory.content],
  );
  if (existing.rows.length > 0) {
    await query(
      `UPDATE ai_user_memories SET updated_at = NOW(), confidence = GREATEST(confidence, $2)
       WHERE id = $1`,
      [existing.rows[0]!.id, memory.confidence],
    );
    return;
  }

  await query(
    `INSERT INTO ai_user_memories (
       user_id, category, content, source_thread_id, source_wa_message_id, shareable, confidence
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      memory.category,
      memory.content,
      sourceThreadId,
      sourceWaMessageId,
      memory.shareable,
      memory.confidence,
    ],
  );
}

export async function getOpencodeSessionId(contextKey: string): Promise<string | null> {
  const r = await query<{ opencode_session_id: string }>(
    'SELECT opencode_session_id FROM ai_opencode_sessions WHERE context_key = $1',
    [contextKey],
  );
  return r.rows[0]?.opencode_session_id ?? null;
}

export async function saveOpencodeSessionId(
  contextKey: string,
  sessionId: string,
): Promise<void> {
  await query(
    `INSERT INTO ai_opencode_sessions (context_key, opencode_session_id)
     VALUES ($1, $2)
     ON CONFLICT (context_key) DO UPDATE SET
       opencode_session_id = EXCLUDED.opencode_session_id,
       updated_at = NOW()`,
    [contextKey, sessionId],
  );
}

export async function deleteOpencodeSessionMapping(contextKey: string): Promise<void> {
  await query('DELETE FROM ai_opencode_sessions WHERE context_key = $1', [contextKey]);
}

export async function migrateMemoryUserId(oldId: string, newId: string): Promise<void> {
  await query(
    `UPDATE ai_chat_messages SET sender_user_id = $1 WHERE sender_user_id = $2`,
    [newId, oldId],
  );
  await query(`UPDATE ai_user_memories SET user_id = $1 WHERE user_id = $2`, [newId, oldId]);
  await query(`UPDATE ai_conversation_threads SET dm_user_id = $1 WHERE dm_user_id = $2`, [
    newId,
    oldId,
  ]);

  const oldSettings = await query<MemorySettingsRow>(
    'SELECT user_id, enabled, purged_at FROM ai_memory_settings WHERE user_id = $1',
    [oldId],
  );
  const newSettings = await query('SELECT 1 FROM ai_memory_settings WHERE user_id = $1', [newId]);

  if (oldSettings.rows.length > 0 && newSettings.rows.length === 0) {
    await query(
      `UPDATE ai_memory_settings SET user_id = $1, updated_at = NOW() WHERE user_id = $2`,
      [newId, oldId],
    );
  } else if (oldSettings.rows.length > 0) {
    await query('DELETE FROM ai_memory_settings WHERE user_id = $1', [oldId]);
  }
}
