/**
 * Mutex em memória por partida. O bot roda em processo único (PM2 `instances: 1`),
 * então serializar por `matchId` basta para impedir que duas ações concorrentes
 * leiam o mesmo estado e gravem por cima uma da outra.
 */
const locks = new Map<string, Promise<void>>();

export async function withMatchLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(matchId) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  // `gate` nunca rejeita, então a cadeia sobrevive a falhas de `fn`.
  const tail = previous.then(() => gate);
  locks.set(matchId, tail);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(matchId) === tail) locks.delete(matchId);
  }
}
