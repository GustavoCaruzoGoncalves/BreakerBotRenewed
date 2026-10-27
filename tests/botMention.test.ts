import { describe, expect, it } from 'vitest';
import {
  extractPromptFromMentionText,
  isPersonaIdentityQuestion,
} from '../src/services/ai/botMention.js';

describe('extractPromptFromMentionText', () => {
  it('remove menção @Breaker Bot no início', () => {
    expect(extractPromptFromMentionText('@Breaker Bot quem é você?')).toBe('quem é você?');
  });

  it('remove menção numérica', () => {
    expect(extractPromptFromMentionText('@5516996242810 e aí')).toBe('e aí');
  });
});

describe('isPersonaIdentityQuestion', () => {
  it('detecta quem é você', () => {
    expect(isPersonaIdentityQuestion('quem é você?')).toBe(true);
    expect(isPersonaIdentityQuestion('Quem é vc')).toBe(true);
  });

  it('ignora perguntas de dados', () => {
    expect(isPersonaIdentityQuestion('qual meu nível')).toBe(false);
  });
});
