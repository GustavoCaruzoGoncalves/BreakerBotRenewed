import { describe, expect, it } from 'vitest';
import { withMatchLock } from '../src/games/truco/lock.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('withMatchLock', () => {
  it('serializa ações concorrentes da mesma partida', async () => {
    const order: string[] = [];

    async function criticalSection(tag: string): Promise<void> {
      order.push(`${tag}:start`);
      await delay(10);
      order.push(`${tag}:end`);
    }

    await Promise.all([
      withMatchLock('m1', () => criticalSection('a')),
      withMatchLock('m1', () => criticalSection('b')),
      withMatchLock('m1', () => criticalSection('c')),
    ]);

    expect(order).toEqual([
      'a:start',
      'a:end',
      'b:start',
      'b:end',
      'c:start',
      'c:end',
    ]);
  });

  it('não bloqueia partidas diferentes', async () => {
    let running = 0;
    let maxConcurrent = 0;

    await Promise.all(
      ['m1', 'm2', 'm3'].map((id) =>
        withMatchLock(id, async () => {
          running++;
          maxConcurrent = Math.max(maxConcurrent, running);
          await delay(10);
          running--;
        }),
      ),
    );

    expect(maxConcurrent).toBe(3);
  });

  it('libera o lock quando a ação falha', async () => {
    await expect(
      withMatchLock('m1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(withMatchLock('m1', async () => 'ok')).resolves.toBe('ok');
  });
});
