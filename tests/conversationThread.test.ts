import { describe, expect, it, beforeEach } from 'vitest';
import {
  hasActiveAiConversationThread,
  resetAiConversationThreads,
  touchAiConversationThread,
} from '../src/services/ai/conversationThread.js';

const GROUP = '120363342938049353@g.us';
const PN = '5516996421595@s.whatsapp.net';

describe('conversationThread', () => {
  beforeEach(() => {
    resetAiConversationThreads();
  });

  it('marca thread ativa após interação', () => {
    expect(hasActiveAiConversationThread(GROUP, PN)).toBe(false);
    touchAiConversationThread(GROUP, PN);
    expect(hasActiveAiConversationThread(GROUP, PN)).toBe(true);
  });

  it('isola usuários no mesmo grupo', () => {
    touchAiConversationThread(GROUP, PN);
    expect(hasActiveAiConversationThread(GROUP, '5511888888888@s.whatsapp.net')).toBe(false);
  });
});
