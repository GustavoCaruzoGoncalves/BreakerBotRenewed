import { describe, expect, it } from 'vitest';
import {
  buildMultimodalParts,
  messageHasVisionMedia,
} from '../src/services/ai/visionMedia.js';
import type { BotMessage } from '../src/types/bot.js';

describe('visionMedia', () => {
  it('detecta imagem anexa', () => {
    const msg = {
      media: { type: 'imageMessage', content: {}, key: {} },
    } as BotMessage;
    expect(messageHasVisionMedia(msg)).toBe(true);
  });

  it('detecta vídeo anexo', () => {
    const msg = {
      media: { type: 'videoMessage', content: { mimetype: 'video/mp4' }, key: {} },
    } as BotMessage;
    expect(messageHasVisionMedia(msg)).toBe(true);
  });

  it('monta parts texto + arquivo', () => {
    const parts = buildMultimodalParts('o que é isso?', [
      {
        kind: 'video',
        mime: 'video/mp4',
        filename: 'video.mp4',
        dataUrl: 'data:video/mp4;base64,abc',
        byteLength: 3,
      },
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.type).toBe('text');
    expect(parts[1]?.type).toBe('file');
    if (parts[1]?.type === 'file') expect(parts[1].mime).toBe('video/mp4');
  });
});
