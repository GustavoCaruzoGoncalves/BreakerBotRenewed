/**
 * Descarta o ruído de sessão do Signal/Baileys escrito direto no stdout.
 *
 * Vive num módulo separado porque, em ESM, os imports são avaliados antes do corpo
 * do módulo: o patch precisa ser o primeiro import do entrypoint para valer.
 */
const NOISE = ['Closing session', '_chains'];

const originalWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = ((chunk: Uint8Array | string, ...rest: unknown[]): boolean => {
  if (typeof chunk === 'string' && NOISE.some((n) => chunk.includes(n))) return true;
  return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;
