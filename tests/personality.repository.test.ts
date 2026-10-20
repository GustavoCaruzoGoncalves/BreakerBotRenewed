import { describe, expect, it } from 'vitest';
import { isValidPersonalitySlug } from '../src/database/personalityRepository.js';

describe('isValidPersonalitySlug', () => {
  it('aceita slugs customizados', () => {
    expect(isValidPersonalitySlug('meu-bot')).toBe(true);
    expect(isValidPersonalitySlug('bolsonaro')).toBe(true);
  });

  it('rejeita default e caracteres inválidos', () => {
    expect(isValidPersonalitySlug('default')).toBe(false);
    expect(isValidPersonalitySlug('')).toBe(false);
    expect(isValidPersonalitySlug('MAIUSCULO')).toBe(false);
  });
});
