import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAdminJids, getAdminNumbers, getAllowedOrigins, projectPath } from '../src/config.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.ADMINS;
  delete process.env.CORS_ORIGINS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('admins', () => {
  it('converte números em JIDs completos e ignora espaços', () => {
    process.env.ADMINS = '5511999999999, 5511888888888 ,';
    expect(getAdminJids()).toEqual([
      '5511999999999@s.whatsapp.net',
      '5511888888888@s.whatsapp.net',
    ]);
    expect(getAdminNumbers()).toEqual(['5511999999999', '5511888888888']);
  });

  it('devolve lista vazia sem ADMINS configurado', () => {
    expect(getAdminJids()).toEqual([]);
    expect(getAdminNumbers()).toEqual([]);
  });
});

describe('getAllowedOrigins', () => {
  it('usa CORS_ORIGINS quando definido', () => {
    process.env.CORS_ORIGINS = 'https://a.com, https://b.com';
    expect(getAllowedOrigins()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('cai no localhost por padrão', () => {
    expect(getAllowedOrigins()).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });
});

describe('projectPath', () => {
  it('resolve a partir da raiz do projeto', () => {
    expect(projectPath('assets')).toMatch(/assets$/);
  });
});
