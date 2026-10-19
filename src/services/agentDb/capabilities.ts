import { config } from '../../config.js';
import { getCommands } from '../../commands/registry.js';
import { TOOL_CATALOG } from './tools.js';

/** Resumo das funcionalidades do bot para o agente (não substitui !menu). */
export function buildBotCapabilitiesPrompt(): string {
  const commands = getCommands();
  const lines: string[] = [
    '## Capacidades do BreakerBot (WhatsApp)',
    '- Para ver todos os comandos: `!menu`',
    '- Níveis/XP: mensagens ganham XP, `!level`, `!ranking`, prestígio',
    '- Aura: missões diárias, duelos (!mog), ranking de aura' + (config.aura.enabled ? ' (ativo)' : ' (desativado no servidor)'),
    '- Truco paulista em grupos: comandos do módulo Truco (!truco etc.)',
    '- Mídia: figurinhas, áudio',
    '- Zueiras: trivia, amigo secreto, piadas, etc.',
    '- IA: mencione o bot no grupo; no privado basta conversar',
    '- Memória pessoal: `!memoria`, `!esquecer`',
    '- Preferências: menções, nome customizado',
  ];

  const ia = commands.flatMap((c) => c.meta.entries).filter((e) => e.trigger.includes('gpt') || e.description.includes('IA'));
  if (ia.length > 0) {
    lines.push('- Outros comandos de IA: `!gpt`, `!grok`, etc. (com prefixo !)');
  }

  lines.push('\n## Ferramentas de dados (somente estes nomes existem)');
  for (const t of TOOL_CATALOG) {
    lines.push(`- ${t.name}: ${t.description}`);
  }
  lines.push(
    '\nNunca invente nomes de ferramentas (ex.: get_my_aura_summary não existe; use get_my_aura). ' +
      'Nunca envie JSON de plano ao usuário; fale em português natural.',
  );

  return lines.join('\n');
}
