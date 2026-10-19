const MAX_IDS = 80;

const recentBotIdsByChat = new Map<string, string[]>();

export function trackBotOutgoingMessage(chatJid: string, waMessageId: string | null | undefined): void {
  if (!waMessageId) return;
  const list = recentBotIdsByChat.get(chatJid) ?? [];
  list.push(waMessageId);
  if (list.length > MAX_IDS) list.splice(0, list.length - MAX_IDS);
  recentBotIdsByChat.set(chatJid, list);
}

export function isTrackedBotMessage(chatJid: string, waMessageId: string): boolean {
  return recentBotIdsByChat.get(chatJid)?.includes(waMessageId) ?? false;
}

export function resetBotReplyIndexForTests(): void {
  recentBotIdsByChat.clear();
}
