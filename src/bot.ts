import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import type { Contact, WAMessage, WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config, projectPath } from './config.js';
import { logError } from './lib/logger.js';
import { getDisconnectStatusCode, getErrorMessage } from './lib/errors.js';
import { parse } from './lib/message.js';
import { handle, handleReaction } from './router.js';
import {
  startAuthMessageProcessor,
  registerSocket,
  clearSocket,
} from './services/authMessageSender.js';
import {
  clearTrucoSocket,
  registerTrucoSocket,
  restoreOpenMatches,
} from './games/truco/service.js';
import type { ReactionEvent } from './types/bot.js';

const AUTH_DIR = projectPath('auth_info');

export type ContactsCache = Record<string, Partial<Contact>>;

const contactsCache: ContactsCache = {};

export async function connect(): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({
    version: config.baileys.version,
  }));

  const sock = makeWASocket({
    printQRInTerminal: false,
    version,
    auth: state,
    browser: config.baileys.browser,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.update', (list) => mergeContacts(list, false));
  sock.ev.on('contacts.upsert', (list) => mergeContacts(list, true));

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('Escaneie o QR Code:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      clearSocket();
      clearTrucoSocket();
      const code = getDisconnectStatusCode(lastDisconnect?.error);
      const streamErr = lastDisconnect?.error
        ? getErrorMessage(lastDisconnect.error).includes('Stream Errored')
        : false;
      console.log(`Conexão fechada (code=${code}, stream=${streamErr})`);

      if (code !== 401 || streamErr) {
        console.log('Reconectando...');
        void connect();
      } else {
        console.log('Sessão inválida. Delete auth_info e reconecte via QR.');
      }
    }

    if (connection === 'open') {
      console.log('Bot conectado!');
      registerSocket(sock);
      registerTrucoSocket(sock);
      startAuthMessageProcessor();
      void restoreOpenMatches()
        .then((n) => n > 0 && console.log(`[TRUCO] ${n} partida(s) em aberto restaurada(s).`))
        .catch((err) => console.error('[TRUCO] Falha ao restaurar partidas:', err));
    }
  });

  sock.ev.on('messages.upsert', (evt) => {
    for (const m of evt.messages) {
      enqueue(sock, m);
    }
  });

  sock.ev.on('messages.reaction', (events: ReactionEvent[]) => {
    for (const item of events) {
      handleReaction(sock, item);
    }
  });

  return sock;
}

// --- Contacts ---

function mergeContacts(list: Partial<Contact>[], replace: boolean): void {
  for (const c of list) {
    if (!c.id) continue;
    contactsCache[c.id] = replace ? c : Object.assign(contactsCache[c.id] ?? {}, c);
  }
}

export function getContacts(): ContactsCache {
  return contactsCache;
}

// --- Message queue (serial) ---

interface QueueItem {
  sock: WASocket;
  rawMsg: WAMessage;
}

const queue: QueueItem[] = [];
let processing = false;

function enqueue(sock: WASocket, rawMsg: WAMessage): void {
  queue.push({ sock, rawMsg });
  void drain();
}

async function drain(): Promise<void> {
  if (processing || queue.length === 0) return;
  processing = true;

  const item = queue.shift();
  if (!item) {
    processing = false;
    return;
  }

  try {
    const msg = parse(item.rawMsg);
    if (msg) await handle(item.sock, msg);
  } catch (err) {
    console.error('Erro ao processar mensagem:', err);
    logError(err);
  } finally {
    processing = false;
    if (queue.length > 0) setImmediate(() => void drain());
  }
}
