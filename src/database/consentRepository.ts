import { query } from './pool.js';
import type { ConsentScope } from '../services/agentDb/types.js';

const DEFAULT_TTL_HOURS = 24;

export async function hasActiveConsent(
  ownerUserId: string,
  grantedToUserId: string,
  scope: ConsentScope,
): Promise<boolean> {
  const r = await query<{ id: string }>(
    `SELECT id FROM ai_data_consent_grants
     WHERE owner_user_id = $1 AND granted_to_user_id = $2 AND scope = $3
       AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [ownerUserId, grantedToUserId, scope],
  );
  return r.rows.length > 0;
}

export async function createConsentRequest(
  ownerUserId: string,
  requesterUserId: string,
  scope: ConsentScope,
  chatJid: string,
  ttlHours = DEFAULT_TTL_HOURS,
): Promise<string> {
  await query(
    `UPDATE ai_data_consent_requests SET status = 'expired', resolved_at = NOW()
     WHERE owner_user_id = $1 AND requester_user_id = $2 AND scope = $3 AND status = 'pending'`,
    [ownerUserId, requesterUserId, scope],
  );
  const r = await query<{ id: string }>(
    `INSERT INTO ai_data_consent_requests (owner_user_id, requester_user_id, scope, chat_jid, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' hours')::interval)
     RETURNING id`,
    [ownerUserId, requesterUserId, scope, chatJid, String(ttlHours)],
  );
  return r.rows[0]!.id;
}

export async function approveConsentRequest(requestId: string, ownerUserId: string): Promise<boolean> {
  const r = await query<{ requester_user_id: string; scope: string }>(
    `UPDATE ai_data_consent_requests
     SET status = 'approved', resolved_at = NOW()
     WHERE id = $1 AND owner_user_id = $2 AND status = 'pending' AND expires_at > NOW()
     RETURNING requester_user_id, scope`,
    [requestId, ownerUserId],
  );
  const row = r.rows[0];
  if (!row) return false;

  await query(
    `UPDATE ai_data_consent_grants SET revoked_at = NOW()
     WHERE owner_user_id = $1 AND granted_to_user_id = $2 AND scope = $3 AND revoked_at IS NULL`,
    [ownerUserId, row.requester_user_id, row.scope],
  );
  await query(
    `INSERT INTO ai_data_consent_grants (owner_user_id, granted_to_user_id, scope, purpose, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + interval '24 hours')`,
    [ownerUserId, row.requester_user_id, row.scope, 'Aprovado via !consentir'],
  );
  return true;
}

export async function denyConsentRequest(requestId: string, ownerUserId: string): Promise<boolean> {
  const r = await query(
    `UPDATE ai_data_consent_requests
     SET status = 'denied', resolved_at = NOW()
     WHERE id = $1 AND owner_user_id = $2 AND status = 'pending'
     RETURNING id`,
    [requestId, ownerUserId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function revokeConsent(
  ownerUserId: string,
  grantedToUserId: string,
  scope: ConsentScope,
): Promise<void> {
  await query(
    `UPDATE ai_data_consent_grants SET revoked_at = NOW()
     WHERE owner_user_id = $1 AND granted_to_user_id = $2 AND scope = $3 AND revoked_at IS NULL`,
    [ownerUserId, grantedToUserId, scope],
  );
}

export async function getLatestPendingRequestForOwner(
  ownerUserId: string,
): Promise<{ id: string; requesterUserId: string; scope: string } | null> {
  const r = await query<{ id: string; requester_user_id: string; scope: string }>(
    `SELECT id, requester_user_id, scope FROM ai_data_consent_requests
     WHERE owner_user_id = $1 AND status = 'pending' AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [ownerUserId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, requesterUserId: row.requester_user_id, scope: row.scope };
}
