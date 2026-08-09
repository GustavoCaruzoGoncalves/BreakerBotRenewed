/** Narrowing de erros: `catch` entrega `unknown`, nunca `Error` garantido. */

const MAX_CAUSE_DEPTH = 3;

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message: unknown };
    if (typeof message === 'string') return message;
  }
  return String(error);
}

function readProp(error: unknown, prop: 'cause' | 'code'): unknown {
  if (error && typeof error === 'object' && prop in error) {
    return (error as Record<string, unknown>)[prop];
  }
  return undefined;
}

/** Wrappers genéricos (`fetch failed` do undici) guardam o motivo real em `cause`. */
function describeCause(cause: unknown, depth: number): string {
  if (depth <= 0 || cause === undefined || cause === null) return '';

  const message = readMessage(cause);
  const code = readProp(cause, 'code');
  const head =
    typeof code === 'string' && !message.includes(code) ? `${code}: ${message}` : message;

  const nested = describeCause(readProp(cause, 'cause'), depth - 1);
  return nested ? `${head} (${nested})` : head;
}

export function getErrorMessage(error: unknown): string {
  const message = readMessage(error);
  const detail = describeCause(readProp(error, 'cause'), MAX_CAUSE_DEPTH);
  return detail ? `${message} (${detail})` : message;
}

/** SQLSTATE do PostgreSQL (ex.: `42P07` para tabela duplicada). */
export function getPostgresErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code: unknown };
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** `statusCode` de desconexões do Baileys (`lastDisconnect.error.output.statusCode`). */
export function getDisconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { output } = error as { output?: { statusCode?: unknown } };
  return typeof output?.statusCode === 'number' ? output.statusCode : undefined;
}
