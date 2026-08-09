import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { collectTriggers, renderMenu } from '../src/lib/menu.js';
import { getCommands } from '../src/commands/registry.js';
import type { Command } from '../src/types/bot.js';

const COMMANDS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'commands',
);

/**
 * Literais que começam com `!` mas não são gatilhos de comando. Só entram aqui
 * casos comprovadamente inofensivos; a intenção do teste é justamente incomodar.
 */
const NOT_COMMANDS = new Set<string>();

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function isCommand(value: unknown): value is Command {
  return (
    typeof value === 'object' &&
    value !== null &&
    'meta' in value &&
    'handle' in value &&
    typeof (value as Command).handle === 'function'
  );
}

/**
 * Descobre os comandos pelos arquivos, e não pelo registro do router, para que
 * módulos atrás de feature flag (como a aura) também sejam cobrados.
 */
async function discoverCommands(): Promise<Command[]> {
  const found: Command[] = [];

  for (const file of sourceFiles(COMMANDS_DIR)) {
    const module: unknown = await import(pathToFileURL(file).href);
    const exported = (module as { default?: unknown }).default;
    if (isCommand(exported)) found.push(exported);
  }

  return found;
}

/** Um literal iniciado por `!` logo após a aspa é, na prática, um gatilho. */
function triggersInSource(): Map<string, string> {
  const found = new Map<string, string>();

  for (const file of sourceFiles(COMMANDS_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`]!([\p{L}\d]+)/gu)) {
      const trigger = `!${match[1]}`.toLowerCase();
      if (!NOT_COMMANDS.has(trigger) && !found.has(trigger)) {
        found.set(trigger, path.relative(COMMANDS_DIR, file));
      }
    }
  }

  return found;
}

describe('registro de comandos', () => {
  let commands: Command[];

  beforeAll(async () => {
    // Chaves fictícias apenas para os SDKs que validam a credencial no construtor.
    process.env.XAI_API_KEY ??= 'test';
    process.env.OPENAI_API_KEY ??= 'test';
    process.env.ZHIPU_API_KEY ??= 'test';
    commands = await discoverCommands();
  });

  it('encontra os comandos e o router publica os que estão ativos', async () => {
    expect(commands.length).toBeGreaterThan(0);

    await import('../src/router.js');
    const registered = getCommands();

    expect(registered.length).toBeGreaterThan(0);
    for (const command of registered) {
      expect(commands, 'comando registrado sem módulo correspondente').toContain(command);
    }
  });

  it('exige descrição em toda entrada', () => {
    for (const { meta } of commands) {
      for (const entry of meta.entries) {
        expect(entry.trigger, `${meta.category}: gatilho vazio`).toMatch(/^!/);
        expect(entry.description.trim(), `${entry.trigger} sem descrição`).not.toBe('');
        for (const usage of entry.usages ?? []) {
          expect(usage.description.trim(), `${usage.syntax} sem descrição`).not.toBe('');
        }
      }
    }
  });

  it('não repete o mesmo gatilho em comandos diferentes', () => {
    const seen = new Set<string>();
    const duplicated: string[] = [];

    for (const { meta } of commands) {
      for (const entry of meta.entries) {
        const trigger = entry.trigger.toLowerCase();
        if (seen.has(trigger)) duplicated.push(trigger);
        seen.add(trigger);
      }
    }

    expect(duplicated).toEqual([]);
  });

  it('documenta no !menu todo gatilho que existe no código', () => {
    const documented = collectTriggers(commands);
    const undocumented = [...triggersInSource()]
      .filter(([trigger]) => !documented.has(trigger))
      .map(([trigger, file]) => `${trigger} (${file})`);

    expect(
      undocumented,
      'Comandos sem entrada no meta. Descreva-os no módulo correspondente.',
    ).toEqual([]);
  });
});

describe('renderMenu', () => {
  const sample: Command[] = [
    {
      meta: {
        category: 'Gerais',
        entries: [
          { trigger: '!menu', aliases: ['!ajuda'], description: 'Lista' },
          { trigger: '!sendJson', description: 'Exporta', admin: true },
        ],
      },
      handle: async () => undefined,
    },
    {
      meta: {
        category: 'Moderação',
        entries: [
          {
            trigger: '!ban',
            description: 'Remove alguém',
            groupOnly: true,
            usages: [{ syntax: '!ban @usuario', description: 'Marque a pessoa' }],
          },
        ],
      },
      handle: async () => undefined,
    },
  ];

  it('junta aliases, subusos e marca comandos de grupo', () => {
    const menu = renderMenu(sample, false);

    expect(menu).toContain('• *!menu* / *!ajuda* — Lista');
    expect(menu).toContain('_(só em grupo)_');
    expect(menu).toContain('   ▸ *!ban @usuario* — Marque a pessoa');
  });

  it('esconde a seção admin de quem não é admin', () => {
    expect(renderMenu(sample, false)).not.toContain('!sendJson');
    expect(renderMenu(sample, true)).toContain('🔧 *Admin*');
    expect(renderMenu(sample, true)).toContain('!sendJson');
  });

  it('omite categorias sem nenhuma entrada visível', () => {
    expect(renderMenu(sample, false)).not.toContain('🤖 *IA*');
  });
});
