import { config } from '../../config.js';
import * as memRepo from '../../database/memoryRepository.js';
import * as users from '../../services/users.js';
import type { BotMessage, Command, CommandHandler, WASocket } from '../../types/bot.js';

async function resolveSenderOnly(sock: WASocket, msg: BotMessage): Promise<string | null> {
  const sender = await users.resolveSender(msg.raw);
  if (!sender || users.isGroupUserId(sender) || users.isBotUser(sock, sender)) return null;
  return sender;
}

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (raw.key.fromMe) return false;

  const lower = text.trim().toLowerCase();
  if (!lower.startsWith('!memoria') && lower !== '!esquecer') return false;

  const sender = await resolveSenderOnly(sock, msg);
  if (!sender) {
    await sock.sendMessage(jid, { text: '❌ Não foi possível identificar você para gerenciar memória.' });
    return true;
  }

  if (lower === '!esquecer' || lower.startsWith('!esquecer ')) {
    await memRepo.purgeUserMemory(sender);
    await sock.sendMessage(jid, {
      text:
        '🧹 Suas memórias pessoais foram apagadas. O histórico de conversas pode permanecer por contexto técnico, ' +
        'mas não serão reextraídas automaticamente enquanto a memorização estiver desativada ou após purge.',
    });
    return true;
  }

  if (lower === '!memoria off' || lower === '!memoria desligar') {
    await memRepo.setMemoryEnabled(sender, false);
    await sock.sendMessage(jid, { text: '🔕 Memorização futura desativada para você. Use `!memoria on` para reativar.' });
    return true;
  }

  if (lower === '!memoria on' || lower === '!memoria ligar') {
    await memRepo.setMemoryEnabled(sender, true);
    await sock.sendMessage(jid, { text: '✅ Memorização reativada.' });
    return true;
  }

  if (lower === '!memoria' || lower.startsWith('!memoria ')) {
    const enabled = await memRepo.isMemoryEnabledForUser(sender);
    const memories = await memRepo.listActiveMemories(sender, config.memory.personalMemoryLimit);

    let body =
      '🧠 *Memória do BreakerBot*\n\n' +
      'Guardo contexto recente por chat (DM ou grupo) e memórias pessoais ligadas ao seu perfil, ' +
      'para reconhecer você em DM e em grupos diferentes.\n\n' +
      `Status: ${enabled ? '✅ ativa' : '🔕 desativada'}\n\n` +
      'Comandos:\n' +
      '• `!memoria` — esta ajuda e lista resumida\n' +
      '• `!memoria off` / `!memoria on`\n' +
      '• `!esquecer` — apaga memórias pessoais\n\n';

    if (memories.length === 0) {
      body += '_Nenhuma memória pessoal salva no momento._';
    } else {
      body += '*Memórias pessoais:*\n';
      for (const m of memories.slice(0, 15)) {
        body += `• (${m.category}) ${m.content}\n`;
      }
      if (memories.length > 15) body += `\n_…e mais ${memories.length - 15}._`;
    }

    await sock.sendMessage(jid, { text: body });
    return true;
  }

  return false;
};

const memoriaCommand: Command = {
  meta: {
    category: 'Preferências',
    entries: [
      {
        trigger: '!memoria',
        description: 'Explica a memória do bot e lista memórias pessoais',
        usages: [
          { syntax: '!memoria', description: 'Ajuda e listagem' },
          { syntax: '!memoria off', description: 'Desativa memorização' },
          { syntax: '!memoria on', description: 'Reativa memorização' },
        ],
      },
      { trigger: '!esquecer', description: 'Apaga memórias pessoais do solicitante' },
    ],
  },
  handle,
};

export default memoriaCommand;
