import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../src/database/repository.js';
import { USER_DEFAULTS } from '../src/services/users.js';
import {
  applyMentionRules,
  createMentionRenderer,
  processSingleMention,
} from '../src/lib/mentions.js';
import type { User } from '../src/database/types.js';

vi.mock('../src/database/repository.js', () => ({
  getAllUsers: vi.fn(),
  getMentionsPreferences: vi.fn(),
  getUserById: vi.fn(),
  resolveMentionJid: vi.fn(),
}));

const USER_ID = '5516996242810@s.whatsapp.net';

function mockUser(overrides: Partial<User> = {}): User {
  return {
    ...USER_DEFAULTS,
    allowMentions: true,
    pushName: 'Gu',
    jid: USER_ID,
    ...overrides,
  } as User;
}

const REVENANT_ID = '5516996421595@s.whatsapp.net';

beforeEach(() => {
  vi.mocked(repo.getMentionsPreferences).mockResolvedValue({ globalEnabled: true });
  vi.mocked(repo.resolveMentionJid).mockResolvedValue(null);
  vi.mocked(repo.getUserById).mockResolvedValue(null);
});

describe('processSingleMention', () => {
  it('usa @ quando menções globais e do usuário estão ativas', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({ [USER_ID]: mockUser() });
    const info = await processSingleMention(USER_ID);
    expect(info.mentionText).toBe('@5516996242810');
    expect(info.mentions).toEqual([USER_ID]);
  });

  it('usa pushName sem ping quando o usuário desativou menções', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({
      [USER_ID]: mockUser({ allowMentions: false }),
    });
    const info = await processSingleMention(USER_ID);
    expect(info.mentionText).toBe('Gu');
    expect(info.mentions).toEqual([]);
  });

  it('anexa nome customizado ao @ quando configurado', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({
      [USER_ID]: mockUser({
        customName: 'GuMaster',
        customNameEnabled: true,
      }),
    });
    const info = await processSingleMention(USER_ID);
    expect(info.mentionText).toBe('@5516996242810 (GuMaster)');
    expect(info.mentions).toEqual([USER_ID]);
  });

  it('resolve usuário pelo banco quando o cache em memória não o encontra', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({});
    vi.mocked(repo.resolveMentionJid).mockResolvedValue(REVENANT_ID);
    vi.mocked(repo.getUserById).mockResolvedValue(
      mockUser({ pushName: 'Revenant', allowMentions: false, jid: REVENANT_ID }),
    );

    const info = await processSingleMention(REVENANT_ID);
    expect(info.mentionText).toBe('Revenant');
    expect(info.mentions).toEqual([]);
    expect(info.hasName).toBe(true);
  });

  it('marca com @ quando menções estão ativas mesmo vindo de LID no cache vazio', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({});
    vi.mocked(repo.resolveMentionJid).mockResolvedValue(REVENANT_ID);
    vi.mocked(repo.getUserById).mockResolvedValue(
      mockUser({ pushName: 'Revenant', allowMentions: true, jid: '12345@lid' }),
    );

    const info = await processSingleMention('12345@lid');
    expect(info.mentionText).toBe('@5516996421595');
    expect(info.mentions).toEqual([REVENANT_ID]);
  });
});

describe('createMentionRenderer', () => {
  it('mantém @ e inclui JID quando permitido', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({ [USER_ID]: mockUser() });
    const renderer = await createMentionRenderer();
    const out = renderer.render('Vez de @5516996242810', [USER_ID]);
    expect(out.text).toBe('Vez de @5516996242810');
    expect(out.mentions).toEqual([USER_ID]);
  });

  it('substitui @ por nome e remove ping quando bloqueado', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({
      [USER_ID]: mockUser({ allowMentions: false }),
    });
    const renderer = await createMentionRenderer();
    const out = renderer.render('Vez de @5516996242810', [USER_ID]);
    expect(out.text).toBe('Vez de Gu');
    expect(out.mentions).toEqual([]);
  });

  it('remove ping mesmo sem @ no texto', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({
      [USER_ID]: mockUser({ allowMentions: false }),
    });
    const renderer = await createMentionRenderer();
    const out = renderer.render('Gu entrou!', [USER_ID]);
    expect(out.text).toBe('Gu entrou!');
    expect(out.mentions).toEqual([]);
  });
});

describe('applyMentionRules', () => {
  it('funciona como atalho do renderizador', async () => {
    vi.mocked(repo.getAllUsers).mockResolvedValue({ [USER_ID]: mockUser() });
    const out = await applyMentionRules('@5516996242810 jogou', [USER_ID]);
    expect(out.mentions).toEqual([USER_ID]);
  });
});
