import type { Command } from '../types/bot.js';

/**
 * O router monta a lista de comandos e a publica aqui. O `!menu` lê deste módulo
 * em vez de importar o router, o que evitaria um ciclo de imports (o router
 * importa o próprio módulo que serve o menu).
 */
let registered: readonly Command[] = [];

export function setCommands(commands: readonly Command[]): void {
  registered = commands;
}

export function getCommands(): readonly Command[] {
  return registered;
}
