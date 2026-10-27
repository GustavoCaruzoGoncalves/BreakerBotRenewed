import { describe, expect, it, vi } from 'vitest';
import {
  beginChatTyping,
  endChatTyping,
  resetChatTypingState,
  withChatTyping,
} from '../src/services/ai/typingIndicator.js';
import type { WASocket } from '../src/types/bot.js';

function mockSock() {
  const sendPresenceUpdate = vi.fn().mockResolvedValue(undefined);
  return { sendPresenceUpdate } as unknown as WASocket;
}

describe('typingIndicator', () => {
  it('envia composing e paused', async () => {
    resetChatTypingState();
    const sock = mockSock();
    const jid = '120363@g.us';

    await withChatTyping(sock, jid, async () => {
      expect(sock.sendPresenceUpdate).toHaveBeenCalledWith('composing', jid);
    });

    expect(sock.sendPresenceUpdate).toHaveBeenCalledWith('paused', jid);
  });

  it('aninha refcount sem pausar cedo demais', async () => {
    resetChatTypingState();
    const sock = mockSock();
    const jid = '5511@s.whatsapp.net';

    await beginChatTyping(sock, jid);
    await beginChatTyping(sock, jid);
    await endChatTyping(sock, jid);
    expect(sock.sendPresenceUpdate).not.toHaveBeenCalledWith('paused', jid);
    await endChatTyping(sock, jid);
    expect(sock.sendPresenceUpdate).toHaveBeenCalledWith('paused', jid);
  });
});
