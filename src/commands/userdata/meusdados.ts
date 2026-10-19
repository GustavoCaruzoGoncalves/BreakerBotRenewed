import { config } from '../../config.js';
import { buildToolContextFromSender } from '../../services/agentDb/context.js';
import { executeTool } from '../../services/agentDb/tools.js';
import type { Command, CommandHandler, WASocket } from '../../types/bot.js';
import type { BotMessage } from '../../types/bot.js';

async function runSelfTools(
  sock: WASocket,
  msg: BotMessage,
  tools: Array<'get_my_level_stats' | 'get_my_badges' | 'get_my_aura'>,
  formatter: (data: Record<string, unknown>) => string,
): Promise<boolean> {
  if (!config.agentDb.enabled) {
    await sock.sendMessage(msg.jid, { text: 'Consultas ao banco via agente estão desabilitadas.' });
    return true;
  }
  const ctx = await buildToolContextFromSender(msg);
  if (!ctx) {
    await sock.sendMessage(msg.jid, { text: '❌ Não foi possível identificar você.' });
    return true;
  }

  const chunks: Record<string, unknown> = {};
  for (const tool of tools) {
    const res = await executeTool({ tool, args: {} }, ctx);
    if (res.ok) {
      const data = res.data as Record<string, unknown>;
      if (tool === 'get_my_badges' && data.badges) chunks.badges = data.badges;
      else Object.assign(chunks, data);
    }
  }
  await sock.sendMessage(msg.jid, { text: formatter(chunks) });
  return true;
}

const handle: CommandHandler = async (sock, msg) => {
  const lower = msg.text.trim().toLowerCase();
  if (lower === '!meusdados') {
    return runSelfTools(sock, msg, ['get_my_level_stats', 'get_my_badges', 'get_my_aura'], (d) => {
      return (
        '📊 *Seus dados no BreakerBot*\n\n' +
        `Nível: ${d.level ?? '?'}\n` +
        `XP: ${d.xp ?? '?'}\n` +
        `Prestígio: ${d.prestige ?? '?'}\n` +
        `Elo: ${d.rankName ?? '?'}\n` +
        `Aura: ${d.auraPoints ?? d.tier ?? '?'}\n` +
        `Badges: ${Array.isArray(d.badges) && d.badges.length ? d.badges.join(', ') : 'nenhuma'}`
      );
    });
  }
  if (lower === '!meunivel') {
    return runSelfTools(sock, msg, ['get_my_level_stats'], (d) =>
      `📊 Nível ${d.level} | XP ${d.xp} | Prestígio ${d.prestige} | Elo ${d.rankName}`,
    );
  }
  if (lower === '!minhasaura') {
    return runSelfTools(sock, msg, ['get_my_aura'], (d) =>
      `✨ Aura: ${d.auraPoints} (${d.tier})` + (d.character ? `\nPersonagem: ${d.character}` : ''),
    );
  }
  if (lower === '!meuranking') {
    const ctx = await buildToolContextFromSender(msg);
    if (!ctx) {
      await sock.sendMessage(msg.jid, { text: '❌ Não foi possível identificar você.' });
      return true;
    }
    const res = await executeTool({ tool: 'get_level_ranking', args: { limit: 5 } }, ctx);
    if (!res.ok || !res.data) {
      await sock.sendMessage(msg.jid, { text: '❌ Não foi possível carregar o ranking.' });
      return true;
    }
    const rows = res.data as Array<Record<string, unknown>>;
    let text = '🏆 *Ranking de nível (top 5)*\n\n';
    rows.forEach((r, i) => {
      text += `${i + 1}. ${r.displayName} — nv.${r.level} (${r.xp} XP)\n`;
    });
    await sock.sendMessage(msg.jid, { text });
    return true;
  }
  return false;
};

const meusdadosCommand: Command = {
  meta: {
    category: 'Níveis',
    entries: [
      { trigger: '!meusdados', description: 'Resumo dos seus dados no bot' },
      { trigger: '!meunivel', description: 'Seu nível e XP' },
      { trigger: '!minhasaura', description: 'Seu saldo de Aura' },
      { trigger: '!meuranking', description: 'Top 5 de nível via camada Agent DB (público)' },
    ],
  },
  handle,
};

export default meusdadosCommand;
