import { describe, expect, it } from 'vitest';
import {
  PROACTIVE_SKIP_TOKEN,
  buildPersonalityPrompt,
  shouldSkipProactiveReply,
} from '../src/services/ai/personality.js';
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

describe('proactiveChat', () => {
  it('rejeita mensagens curtas', () => {
    resetProactiveCooldowns();
    expect(isProactiveCandidate('oi')).toBe(false);
  });
});
