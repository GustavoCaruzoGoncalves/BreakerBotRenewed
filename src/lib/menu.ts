import type { Command, CommandCategory, CommandEntry } from '../types/bot.js';

const CATEGORY_TITLES: Record<CommandCategory, string> = {
  Gerais: '🎛️ *Gerais*',
  'Figurinhas e mídia': '🖼️ *Figurinhas e mídia*',
  Zueiras: '🤪 *Zueiras*',
  IA: '🤖 *IA*',
  Níveis: '📊 *Níveis*',
  Aura: '✨ *Aura*',
  Truco: '🃏 *Truco*',
  Preferências: '⚙️ *Preferências*',
  Moderação: '🛡️ *Moderação*',
};

const CATEGORY_ORDER: readonly CommandCategory[] = [
  'Gerais',
  'Figurinhas e mídia',
  'Zueiras',
  'IA',
  'Níveis',
  'Aura',
  'Truco',
  'Preferências',
  'Moderação',
];

const ADMIN_TITLE = '🔧 *Admin*';

/** Todos os gatilhos declarados, incluindo aliases e subusos. Base do teste de drift. */
export function collectTriggers(commands: readonly Command[]): Set<string> {
  const triggers = new Set<string>();

  for (const { meta } of commands) {
    for (const entry of meta.entries) {
      triggers.add(entry.trigger.toLowerCase());
      for (const alias of entry.aliases ?? []) triggers.add(alias.toLowerCase());
      for (const usage of entry.usages ?? []) {
        const first = usage.syntax.split(/\s+/)[0];
        if (first?.startsWith('!')) triggers.add(first.toLowerCase());
      }
    }
  }

  return triggers;
}

function formatEntry(entry: CommandEntry): string {
  const names = [entry.trigger, ...(entry.aliases ?? [])].map((n) => `*${n}*`).join(' / ');
  const scope = entry.groupOnly ? ' _(só em grupo)_' : '';
  const lines = [`• ${names} — ${entry.description}${scope}`];

  for (const usage of entry.usages ?? []) {
    lines.push(`   ▸ *${usage.syntax}* — ${usage.description}`);
  }

  return lines.join('\n');
}

function section(title: string, entries: readonly CommandEntry[]): string | null {
  if (entries.length === 0) return null;
  return [title, ...entries.map(formatEntry)].join('\n');
}

export function renderMenu(commands: readonly Command[], isAdmin: boolean): string {
  const byCategory = new Map<CommandCategory, CommandEntry[]>();
  const adminEntries: CommandEntry[] = [];

  for (const { meta } of commands) {
    for (const entry of meta.entries) {
      if (entry.admin) {
        adminEntries.push(entry);
        continue;
      }
      const bucket = byCategory.get(meta.category);
      if (bucket) bucket.push(entry);
      else byCategory.set(meta.category, [entry]);
    }
  }

  const sections = CATEGORY_ORDER.map((category) =>
    section(CATEGORY_TITLES[category], byCategory.get(category) ?? []),
  ).filter((s): s is string => s !== null);

  if (isAdmin) {
    const admin = section(ADMIN_TITLE, adminEntries);
    if (admin) sections.push(admin);
  }

  return ['📌 *Menu de Comandos*', ...sections].join('\n\n');
}
