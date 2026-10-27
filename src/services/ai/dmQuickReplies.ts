import { config } from '../../config.js';
import { renderMenu } from '../../lib/menu.js';
import { getCommands } from '../../commands/registry.js';
import * as users from '../users.js';
import type { BotMessage, WASocket } from '../../types/bot.js';

const PERSONALIDADE_HINT =
  '🎭 *Personalidade por grupo* (admins do bot)\n\n' +
  '1. No PV: `!personalidade grupos` (lista numerada)\n' +
  '2. No PV: `!personalidade usar <nº> bolsonaro` _(só você vê)_\n' +
  '3. Ou no grupo: `!personalidade usar bolsonaro`\n\n' +
  'Ajuda completa: `!personalidade`\n' +
  'Perfis: `!personalidade listar` _(default, bolsonaro, lula…)_';

/** Respostas instantâneas no PV — não passam pela fila lenta do OpenCode. */
export async function tryQuickDmBeforeAi(sock: WASocket, msg: BotMessage): Promise<boolean> {
  if (msg.jid.endsWith('@g.us') || msg.raw.key.fromMe) return false;

  const text = msg.text?.trim();
  if (!text) return false;

  const lower = text.toLowerCase();
  const sender = (await users.resolveSender(msg.raw)) ?? msg.jid;
  const isAdmin = config.admins.includes(sender);

  if (lower === 'menu' || lower === 'ajuda' || lower === 'help') {
    const menu = renderMenu(getCommands(), isAdmin);
    await sock.sendMessage(msg.jid, { text: menu }, { quoted: msg.raw });
    return true;
  }

  if (
    isAdmin &&
    lower.includes('personalidade') &&
    (lower.includes('como') ||
      lower.includes('usa') ||
      lower.includes('usar') ||
      lower.includes('bolsonaro') ||
      lower.includes('lula') ||
      lower.includes('grupo'))
  ) {
    await sock.sendMessage(msg.jid, { text: PERSONALIDADE_HINT }, { quoted: msg.raw });
    return true;
  }

  return false;
}
