import { describe, expect, it } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';
import {
  getLidJid,
  shouldPersistJidUpdate,
  storedJidForUser,
} from '../src/services/users.js';

const PN = '5516996421595@s.whatsapp.net';
const LID = '190546341540031@lid';

function groupMessage(participant?: string, participantAlt?: string): WAMessage {
  return {
    key: {
      remoteJid: '120363342938049353@g.us',
      participant,
      participantAlt,
    },
  } as WAMessage;
}

describe('storedJidForUser', () => {
  it('guarda só LID na coluna jid', () => {
    expect(storedJidForUser(PN, LID)).toBe(LID);
    expect(storedJidForUser(PN, PN)).toBeNull();
    expect(storedJidForUser(PN, null)).toBeNull();
  });
});

describe('shouldPersistJidUpdate', () => {
  it('corrige PN gravado erroneamente na coluna jid', () => {
    expect(shouldPersistJidUpdate(PN, PN, LID)).toBe(true);
    expect(shouldPersistJidUpdate(PN, null, LID)).toBe(true);
  });

  it('não sobrescreve LID existente por PN', () => {
    expect(shouldPersistJidUpdate(PN, LID, PN)).toBe(false);
    expect(shouldPersistJidUpdate(PN, LID, LID)).toBe(false);
  });
});

describe('getLidJid', () => {
  it('lê LID de participant ou participantAlt em grupos', () => {
    expect(getLidJid(groupMessage(LID))).toBe(LID);
    expect(getLidJid(groupMessage(PN, LID))).toBe(LID);
    expect(getLidJid(groupMessage(PN))).toBeNull();
  });
});
