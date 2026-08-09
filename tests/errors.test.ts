import { describe, expect, it } from 'vitest';
import { getDisconnectStatusCode, getErrorMessage, getPostgresErrorCode } from '../src/lib/errors.js';

describe('getErrorMessage', () => {
  it('lê a mensagem de um Error', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('aceita valores que não são Error', () => {
    expect(getErrorMessage('texto cru')).toBe('texto cru');
    expect(getErrorMessage({ message: 'objeto com message' })).toBe('objeto com message');
    expect(getErrorMessage(42)).toBe('42');
  });

  it('revela o motivo real escondido em cause', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND mmg.whatsapp.net'), {
      code: 'ENOTFOUND',
    });
    const error = new Error('fetch failed', { cause });

    expect(getErrorMessage(error)).toBe(
      'fetch failed (getaddrinfo ENOTFOUND mmg.whatsapp.net)',
    );
  });

  it('prefixa o código quando ele não aparece na mensagem', () => {
    const cause = Object.assign(new Error('Client network socket disconnected'), {
      code: 'ECONNRESET',
    });
    expect(getErrorMessage(new Error('fetch failed', { cause }))).toBe(
      'fetch failed (ECONNRESET: Client network socket disconnected)',
    );
  });

  it('não repete o código quando já aparece na mensagem', () => {
    const cause = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(getErrorMessage(new Error('fetch failed', { cause }))).toBe(
      'fetch failed (ECONNREFUSED)',
    );
  });

  it('percorre causas aninhadas e para na profundidade máxima', () => {
    const level5 = new Error('nível 5');
    const level4 = new Error('nível 4', { cause: level5 });
    const level3 = new Error('nível 3', { cause: level4 });
    const level2 = new Error('nível 2', { cause: level3 });
    const top = new Error('nível 1', { cause: level2 });

    expect(getErrorMessage(top)).toBe('nível 1 (nível 2 (nível 3 (nível 4)))');
  });
});

describe('getPostgresErrorCode', () => {
  it('extrai o SQLSTATE', () => {
    expect(getPostgresErrorCode({ code: '42P07' })).toBe('42P07');
    expect(getPostgresErrorCode(new Error('sem code'))).toBeUndefined();
  });
});

describe('getDisconnectStatusCode', () => {
  it('extrai o statusCode do Boom do Baileys', () => {
    expect(getDisconnectStatusCode({ output: { statusCode: 401 } })).toBe(401);
    expect(getDisconnectStatusCode(new Error('sem output'))).toBeUndefined();
  });
});
