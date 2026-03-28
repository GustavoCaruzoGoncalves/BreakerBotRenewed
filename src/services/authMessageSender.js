const repo = require('../database/repository');

const MAX_RETRIES = 3;
const MESSAGE_EXPIRY_MS = 5 * 60 * 1000;
const FIRST_RUN_MS = 3000;
const POLL_MS = 2000;

let busy = false;

function socketReady(sock) {
  try {
    return !!(sock?.user && typeof sock.sendMessage === 'function');
  } catch {
    return false;
  }
}

async function processPendingAuthMessages(sock) {
  if (busy) return;
  busy = true;
  try {
    if (!socketReady(sock)) return;

    const pending = await repo.getPendingMessages();
    if (!pending?.length) return;

    const now = Date.now();
    const kept = [];

    for (const msg of pending) {
      if (now - new Date(msg.createdAt).getTime() > MESSAGE_EXPIRY_MS) {
        console.log(`[Auth] Mensagem para ${msg.to} expirada, removendo...`);
        continue;
      }
      try {
        await sock.sendMessage(msg.to, { text: msg.message });
        console.log(`[Auth] Código enviado para ${msg.to}`);
      } catch (err) {
        console.error(`[Auth] Erro ao enviar mensagem para ${msg.to}:`, err.message);
        const retries = (msg.retries || 0) + 1;
        if (retries < MAX_RETRIES) {
          kept.push({
            to: msg.to,
            message: msg.message,
            retries,
            lastError: err.message,
            lastAttempt: new Date().toISOString(),
          });
          console.log(`[Auth] Tentativa ${retries}/${MAX_RETRIES} falhou para ${msg.to}, tentará novamente...`);
        } else {
          console.error(`[Auth] Máximo de tentativas atingido para ${msg.to}, removendo mensagem.`);
        }
      }
    }

    await repo.setPendingMessages(kept);
  } catch (e) {
    console.error('[Auth] Erro ao processar mensagens pendentes:', e);
  } finally {
    busy = false;
  }
}

function startAuthMessageProcessor(sock) {
  setTimeout(() => processPendingAuthMessages(sock), FIRST_RUN_MS);
  setInterval(() => processPendingAuthMessages(sock), POLL_MS);
  console.log('[Auth] Processador de mensagens de autenticação iniciado');
}

module.exports = { startAuthMessageProcessor, processPendingAuthMessages };
