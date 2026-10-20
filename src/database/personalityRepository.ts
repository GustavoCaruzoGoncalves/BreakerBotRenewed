import { query, getClient } from './pool.js';

export interface PersonalityRow {
  slug: string;
  display_name: string;
  description: string;
  system_prompt: string;
  is_builtin: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface KnownGroupRow {
  group_jid: string;
  subject: string | null;
  last_seen_at: Date;
  first_seen_at: Date;
}

export interface GroupPersonalityRow {
  group_jid: string;
  personality_slug: string;
  updated_by: string | null;
  updated_at: Date;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidPersonalitySlug(slug: string): boolean {
  return SLUG_RE.test(slug) && slug !== 'default';
}

export async function listPersonalities(): Promise<PersonalityRow[]> {
  const r = await query<PersonalityRow>(
    `SELECT slug, display_name, description, system_prompt, is_builtin, created_by, created_at, updated_at
     FROM ai_personalities
     ORDER BY is_builtin DESC, display_name ASC`,
  );
  return r.rows;
}

export async function getPersonality(slug: string): Promise<PersonalityRow | null> {
  const r = await query<PersonalityRow>(
    `SELECT slug, display_name, description, system_prompt, is_builtin, created_by, created_at, updated_at
     FROM ai_personalities WHERE slug = $1`,
    [slug],
  );
  return r.rows[0] ?? null;
}

export async function createPersonality(input: {
  slug: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  createdBy: string | null;
}): Promise<void> {
  if (!isValidPersonalitySlug(input.slug)) {
    throw new Error('Slug inválido (use a-z, 0-9, hífen; mínimo 2 caracteres).');
  }
  await query(
    `INSERT INTO ai_personalities (slug, display_name, description, system_prompt, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.slug, input.displayName, input.description, input.systemPrompt, input.createdBy],
  );
}

export async function updatePersonality(
  slug: string,
  patch: { displayName?: string; description?: string; systemPrompt?: string },
): Promise<boolean> {
  const sets: string[] = ['updated_at = NOW()'];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.displayName !== undefined) {
    sets.push(`display_name = $${i++}`);
    vals.push(patch.displayName);
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    vals.push(patch.description);
  }
  if (patch.systemPrompt !== undefined) {
    sets.push(`system_prompt = $${i++}`);
    vals.push(patch.systemPrompt);
  }
  vals.push(slug);
  const r = await query(
    `UPDATE ai_personalities SET ${sets.join(', ')} WHERE slug = $${i}`,
    vals,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deletePersonality(slug: string): Promise<{ ok: boolean; reason?: string }> {
  if (slug === 'default') {
    return { ok: false, reason: 'A personalidade padrão não pode ser apagada.' };
  }
  const row = await getPersonality(slug);
  if (!row) return { ok: false, reason: 'Personalidade não encontrada.' };
  if (row.is_builtin) {
    return { ok: false, reason: 'Personalidades embutidas (ex.: bolsonaro, lula) não podem ser apagadas.' };
  }
  const used = await query<{ n: string }>(
    'SELECT 1 AS n FROM ai_group_personalities WHERE personality_slug = $1 LIMIT 1',
    [slug],
  );
  if (used.rows.length > 0) {
    return { ok: false, reason: 'Algum grupo ainda usa esta personalidade. Troque antes de apagar.' };
  }
  await query('DELETE FROM ai_personalities WHERE slug = $1', [slug]);
  return { ok: true };
}

export async function getGroupPersonalitySlug(groupJid: string): Promise<string | null> {
  const r = await query<{ personality_slug: string }>(
    'SELECT personality_slug FROM ai_group_personalities WHERE group_jid = $1',
    [groupJid],
  );
  return r.rows[0]?.personality_slug ?? null;
}

export async function setGroupPersonality(
  groupJid: string,
  personalitySlug: string,
  updatedBy: string | null,
): Promise<void> {
  const p = await getPersonality(personalitySlug);
  if (!p) throw new Error('Personalidade não encontrada.');

  if (personalitySlug === 'default') {
    await clearGroupPersonality(groupJid);
    return;
  }

  await query(
    `INSERT INTO ai_group_personalities (group_jid, personality_slug, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_jid) DO UPDATE SET
       personality_slug = EXCLUDED.personality_slug,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [groupJid, personalitySlug, updatedBy],
  );
}

export async function clearGroupPersonality(groupJid: string): Promise<void> {
  await query('DELETE FROM ai_group_personalities WHERE group_jid = $1', [groupJid]);
}

export async function listGroupAssignments(limit = 50): Promise<
  (GroupPersonalityRow & { display_name: string })[]
> {
  const r = await query<GroupPersonalityRow & { display_name: string }>(
    `SELECT g.group_jid, g.personality_slug, g.updated_by, g.updated_at, p.display_name
     FROM ai_group_personalities g
     JOIN ai_personalities p ON p.slug = g.personality_slug
     ORDER BY g.updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return r.rows;
}

export async function touchKnownGroup(groupJid: string, subject: string | null): Promise<void> {
  if (!groupJid.endsWith('@g.us')) return;
  await query(
    `INSERT INTO bot_known_groups (group_jid, subject, last_seen_at, first_seen_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (group_jid) DO UPDATE SET
       subject = COALESCE(EXCLUDED.subject, bot_known_groups.subject),
       last_seen_at = NOW()`,
    [groupJid, subject],
  );
}

export async function listKnownGroups(limit: number, offset: number): Promise<KnownGroupRow[]> {
  const r = await query<KnownGroupRow>(
    `SELECT group_jid, subject, last_seen_at, first_seen_at
     FROM bot_known_groups
     ORDER BY last_seen_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return r.rows;
}

export async function countKnownGroups(): Promise<number> {
  const r = await query<{ c: string }>('SELECT COUNT(*)::text AS c FROM bot_known_groups');
  return Number(r.rows[0]?.c ?? 0);
}

export async function getKnownGroupByIndex(index: number): Promise<KnownGroupRow | null> {
  const r = await query<KnownGroupRow>(
    `SELECT group_jid, subject, last_seen_at, first_seen_at
     FROM bot_known_groups
     ORDER BY last_seen_at DESC
     LIMIT 1 OFFSET $1`,
    [index - 1],
  );
  return r.rows[0] ?? null;
}

export async function syncKnownGroupsFromActivity(): Promise<void> {
  await query(
    `INSERT INTO bot_known_groups (group_jid, subject, last_seen_at, first_seen_at)
     SELECT DISTINCT chat_jid, NULL, NOW(), NOW()
     FROM ai_conversation_threads
     WHERE kind = 'group' AND chat_jid LIKE '%@g.us'
     ON CONFLICT (group_jid) DO UPDATE SET last_seen_at = GREATEST(bot_known_groups.last_seen_at, EXCLUDED.last_seen_at)`,
  );
}
