import type { WASocket } from '../../types/bot.js';
import * as personalityRepo from '../../database/personalityRepository.js';

const lastTouch = new Map<string, number>();
const TOUCH_COOLDOWN_MS = 5 * 60_000;

/** Registra grupos onde o bot atua (para listagem admin no PV). */
export function trackGroupChatActivity(sock: WASocket, groupJid: string): void {
  if (!groupJid.endsWith('@g.us')) return;
  const now = Date.now();
  const prev = lastTouch.get(groupJid) ?? 0;
  if (now - prev < TOUCH_COOLDOWN_MS) return;
  lastTouch.set(groupJid, now);

  void (async () => {
    let subject: string | null = null;
    try {
      const meta = await sock.groupMetadata(groupJid);
      subject = meta.subject ?? null;
    } catch {
      /* metadata indisponível */
    }
    await personalityRepo.touchKnownGroup(groupJid, subject);
  })();
}

export function resetGroupTrackCooldownForTests(): void {
  lastTouch.clear();
}
