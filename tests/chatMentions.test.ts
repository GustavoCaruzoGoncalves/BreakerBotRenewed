import { describe, expect, it } from 'vitest';
import { extractTextMentionTags } from '../src/services/ai/chatMentions.js';
import { buildGroupPeerThreadId, buildAiContextKey } from '../src/services/memory/logic.js';

describe('extractTextMentionTags', () => {
  it('extrai @apelido e ignora bot', () => {
    expect(extractTextMentionTags('Você conhece meu amigo @Banshee?')).toEqual(['Banshee']);
    expect(extractTextMentionTags('@Breaker Bot oi')).toEqual([]);
  });

  it('ignora menção numérica (WhatsApp já manda JID)', () => {
    expect(extractTextMentionTags('@5516996242810 e aí')).toEqual([]);
  });
});

describe('peer thread ids', () => {
  const G = '120363@g.us';
  const A = '5511111111111@s.whatsapp.net';
  const B = '5522222222222@s.whatsapp.net';

  it('separa sessão por usuário no grupo', () => {
    expect(buildGroupPeerThreadId(G, A)).not.toBe(buildGroupPeerThreadId(G, B));
    expect(buildAiContextKey(G, A)).toBe(buildGroupPeerThreadId(G, A));
  });
});
