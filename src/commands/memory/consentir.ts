import * as consentRepo from '../../database/consentRepository.js';
import * as repo from '../../database/repository.js';
import * as users from '../../services/users.js';
import type { ConsentScope } from '../../services/agentDb/types.js';
import type { BotMessage, Command, CommandHandler, WASocket } from '../../types/bot.js';

const SCOPES: ConsentScope[] = [
  'profile_extended',
  'aura_detail',
  'mission_progress',
  'preferences',
  'level_history',
];

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (!text.toLowerCase().startsWith('!consentir')) return false;

  const sender = await users.resolveSender(raw);
  if (!sender) {
    await sock.sendMessage(jid, { text: '❌ Não foi possível identificar você.' });
    return true;
  }

  const parts = text.trim().split(/\s+/);
  const action = (parts[1] ?? '').toLowerCase();

  if (action === 'aprovar' || action === 'sim') {
    const pending = await consentRepo.getLatestPendingRequestForOwner(sender);
    if (!pending) {
      await sock.sendMessage(jid, { text: 'ℹ️ Não há pedidos de consentimento pendentes para você.' });
      return true;
    }
    const ok = await consentRepo.approveConsentRequest(pending.id, sender);
    await sock.sendMessage(jid, {
      text: ok
        ? `✅ Consentimento aprovado (escopo: ${pending.scope}). Válido por 24h.`
        : '❌ Não foi possível aprovar o pedido (expirado ou inválido).',
    });
    return true;
  }

  if (action === 'negar' || action === 'nao' || action === 'não') {
    const pending = await consentRepo.getLatestPendingRequestForOwner(sender);
    if (!pending) {
      await sock.sendMessage(jid, { text: 'ℹ️ Nenhum pedido pendente.' });
      return true;
    }
    await consentRepo.denyConsentRequest(pending.id, sender);
    await sock.sendMessage(jid, { text: '🚫 Pedido de consentimento negado.' });
    return true;
  }

  if (action === 'revogar') {
    const scope = (parts[2] ?? 'profile_extended') as ConsentScope;
    const target = parts[3];
    if (!target) {
      await sock.sendMessage(jid, {
        text: '❌ Use `!consentir revogar <escopo> @usuario` mencionando quem perde o acesso.',
      });
      return true;
    }
    const mentions = raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    const grantee = mentions[0] ? await repo.resolveMentionJid(mentions[0]) : null;
    if (!grantee) {
      await sock.sendMessage(jid, { text: '❌ Mencione o usuário cujo acesso será revogado.' });
      return true;
    }
    if (!SCOPES.includes(scope)) {
      await sock.sendMessage(jid, { text: `❌ Escopo inválido. Opções: ${SCOPES.join(', ')}` });
      return true;
    }
    await consentRepo.revokeConsent(sender, grantee, scope);
    await sock.sendMessage(jid, { text: '✅ Consentimento revogado.' });
    return true;
  }

  await sock.sendMessage(jid, {
    text:
      '📋 *Consentimento de dados*\n\n' +
      '`!consentir aprovar` — aprova o último pedido pendiente\n' +
      '`!consentir negar` — nega o pedido\n' +
      '`!consentir revogar <escopo> @usuario` — revoga acesso concedido',
  });
  return true;
};

const consentirCommand: Command = {
  meta: {
    category: 'Preferências',
    entries: [{ trigger: '!consentir', description: 'Gerencia consentimento para compartilhar dados pessoais' }],
  },
  handle,
};

export default consentirCommand;
