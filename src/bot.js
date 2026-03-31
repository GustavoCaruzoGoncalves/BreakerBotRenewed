const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');
const config = require('./config');
const { logError } = require('./lib/logger');
const { parse } = require('./lib/message');
const { handle, handleReaction } = require('./router');
const { startAuthMessageProcessor, registerSocket, clearSocket } = require('./services/authMessageSender');

const AUTH_DIR = path.resolve(__dirname, '..', 'auth_info');

const contactsCache = {};

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    printQRInTerminal: false,
    version: config.baileys.version,
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
      const code = lastDisconnect?.error?.output?.statusCode;
      const streamErr = lastDisconnect?.error?.message?.includes('Stream Errored');
      console.log(`Conexão fechada (code=${code}, stream=${streamErr})`);

      if (code !== 401 || streamErr) {
        console.log('Reconectando...');
        connect();
      } else {
        console.log('Sessão inválida. Delete auth_info e reconecte via QR.');
      }
    }

    if (connection === 'open') {
      console.log('Bot conectado!');
      registerSocket(sock);
      startAuthMessageProcessor();
    }
  });

  sock.ev.on('messages.upsert', (evt) => {
    const messages = evt?.messages || (Array.isArray(evt) ? evt : [evt]);
    for (const m of messages) {
      enqueue(sock, m);
    }
  });

  sock.ev.on('messages.reaction', (events) => {
    for (const item of events) {
      handleReaction(sock, item);
    }
  });

  return sock;
}

// --- Contacts ---

function mergeContacts(list, replace) {
  for (const c of list) {
    if (!c.id) continue;
    contactsCache[c.id] = replace ? c : Object.assign(contactsCache[c.id] || {}, c);
  }
}

function getContacts() {
  return contactsCache;
}

// --- Message queue (serial) ---

const queue = [];
let processing = false;

function enqueue(sock, rawMsg) {
  queue.push({ sock, rawMsg });
  drain();
}

async function drain() {
  if (processing || queue.length === 0) return;
  processing = true;

  const { sock, rawMsg } = queue.shift();
  try {
    const msg = parse(rawMsg);
    if (msg) await handle(sock, msg);
  } catch (err) {
    console.error('Erro ao processar mensagem:', err);
    logError(err);
  } finally {
    processing = false;
    if (queue.length > 0) setImmediate(drain);
  }
}

module.exports = { connect, getContacts };
