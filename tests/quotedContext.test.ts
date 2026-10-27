import { describe, expect, it } from 'vitest';
import { extractQuotedBody, syncQuotedFromRaw } from '../src/services/ai/quotedContext.js';
import type { BotMessage } from '../src/types/bot.js';

describe('quotedContext', () => {
  it('extrai texto do quote', () => {
    expect(
      extractQuotedBody({
        extendedTextMessage: { text: 'Eu sou bonzinho' },
      }),
    ).toBe('Eu sou bonzinho');
  });

  it('preenche quoted a partir do raw', () => {
    const msg: BotMessage = {
      jid: 'g@g.us',
      type: 'extendedTextMessage',
      text: '@bot e aí?',
      media: null,
      quoted: null,
      raw: {
        key: { remoteJid: 'g@g.us' },
        message: {
          extendedTextMessage: {
            text: '@bot e aí?',
            contextInfo: {
              quotedMessage: { conversation: 'contexto antigo' },
            },
          },
        },
      } as BotMessage['raw'],
    };
    const synced = syncQuotedFromRaw(msg);
    expect(synced.quoted?.conversation).toBe('contexto antigo');
  });
});
