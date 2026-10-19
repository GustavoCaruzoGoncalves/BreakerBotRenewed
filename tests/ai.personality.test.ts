import { describe, expect, it } from 'vitest';
import {
  PROACTIVE_SKIP_TOKEN,
  buildPersonalityPrompt,
  humanizeAiText,
  shouldSkipProactiveReply,
} from '../src/services/ai/personality.js';
import { isTrackedBotMessage, resetBotReplyIndexForTests, trackBotOutgoingMessage } from '../src/services/ai/botReplyIndex.js';
import { isProactiveCandidate, resetProactiveCooldowns } from '../src/services/ai/proactiveChat.js';

describe('personality', () => {
  it('modo proativo menciona SKIP', () => {
    expect(buildPersonalityPrompt('proactive')).toContain(PROACTIVE_SKIP_TOKEN);
  });

  it('detecta resposta SKIP', () => {
    expect(shouldSkipProactiveReply('[SKIP]')).toBe(true);
    expect(shouldSkipProactiveReply('kkkk boa')).toBe(false);
  });
});

describe('humanizeAiText', () => {
  it('remove travessão estilo IA', () => {
    expect(humanizeAiText('Isso é legal — mas ok')).toBe('Isso é legal, mas ok');
  });
});

describe('botReplyIndex', () => {
  it('rastreia id de mensagem do bot', () => {
    resetBotReplyIndexForTests();
    trackBotOutgoingMessage('g@g.us', 'ABC123');
    expect(isTrackedBotMessage('g@g.us', 'ABC123')).toBe(true);
  });
});

describe('proactiveChat', () => {
  it('rejeita mensagens curtas', () => {
    resetProactiveCooldowns();
    expect(isProactiveCandidate('oi')).toBe(false);
  });
});
