import type { WASocket } from '@whiskeysockets/baileys';
import * as repo from '../database/repository.js';
import type { PendingMessageInput } from '../database/types.js';
import { getErrorMessage } from '../lib/errors.js';

const MAX_RETRIES = 3;
const MESSAGE_EXPIRY_MS = 5 * 60 * 1000;
const FIRST_RUN_MS = 3000;
const POLL_MS = 2000;

let busy = false;
let currentSock: WASocket | null = null;
let pollStarted = false;

export function registerSocket(sock: WASocket): void {
  currentSock = sock;
  setImmediate(() => {
    processPendingAuthMessages().catch(() => {});
  });
}

export function clearSocket(): void {
  currentSock = null;
}

function socketReady(sock: WASocket | null): sock is WASocket {
  try {
    if (!sock?.user || typeof sock.sendMessage !== 'function') return false;
    if (sock.ws && typeof sock.ws.isOpen === 'boolean' && !sock.ws.isOpen) return false;
    return true;
  } catch {
    return false;
  }
}

export async function processPendingAuthMessages(): Promise<void> {
  const sock = currentSock;
  if (busy) return;
  busy = true;
  try {
    if (!socketReady(sock)) return;

    const pending = await repo.getPendingMessages();
    if (!pending.length) return;

    const now = Date.now();
    const kept: PendingMessageInput[] = [];

    for (const msg of pending) {
      if (now - new Date(msg.createdAt).getTime() > MESSAGE_EXPIRY_MS) {
        console.log(`[Auth] Mensagem para ${msg.to} expirada, removendo...`);
        continue;
      }
      try {
        await sock.sendMessage(msg.to, { text: msg.message });
        console.log(`[Auth] Código enviado para ${msg.to}`);
      } catch (err) {
        const reason = getErrorMessage(err);
        console.error(`[Auth] Erro ao enviar mensagem para ${msg.to}:`, reason);
        const retries = (msg.retries || 0) + 1;
        if (retries < MAX_RETRIES) {
          kept.push({
            to: msg.to,
            message: msg.message,
            retries,
            lastError: reason,
            lastAttempt: new Date().toISOString(),
          });
          console.log(
            `[Auth] Tentativa ${retries}/${MAX_RETRIES} falhou para ${msg.to}, tentará novamente...`,
          );
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

export function startAuthMessageProcessor(): void {
  if (pollStarted) return;
  pollStarted = true;
  setTimeout(() => {
    void processPendingAuthMessages();
  }, FIRST_RUN_MS);
  setInterval(() => {
    void processPendingAuthMessages();
  }, POLL_MS);
  console.log('[Auth] Processador de mensagens de autenticação iniciado');
}
