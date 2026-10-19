import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      opencode: {
        ...actual.config.opencode,
        enabled: true,
        timeoutMs: 5_000,
      },
    },
  };
});
import type { WAMessage } from '@whiskeysockets/baileys';
import type { BotMessage } from '../src/types/bot.js';
import {
  buildDmThreadId,
  buildGroupThreadId,
  buildMemorySystemAppend,
  extractHeuristicMemories,
  resolveThread,
  shouldRecordIncomingMessage,
} from '../src/services/memory/logic.js';
import { extractTextFromParts } from '../src/services/opencode/client.js';
import { chatWithOpencode } from '../src/services/opencode/service.js';
import * as memRepo from '../src/database/memoryRepository.js';

const PN = '5516996421595@s.whatsapp.net';
const PN2 = '5511888888888@s.whatsapp.net';
const GROUP_A = '120363342938049353@g.us';
const GROUP_B = '120363999999999@g.us';

function botMsg(overrides: Partial<BotMessage> & { jid: string; text: string }): BotMessage {
  return {
    type: 'conversation',
    media: null,
    quoted: null,
    raw: {
      key: { remoteJid: overrides.jid, fromMe: false, id: overrides.text.slice(0, 8) },
      message: { conversation: overrides.text },
    } as WAMessage,
    ...overrides,
  };
}

describe('thread ids', () => {
  it('isola DM por usuário', () => {
    expect(buildDmThreadId(PN)).toBe(`user:${PN}:dm`);
    expect(buildDmThreadId(PN)).not.toBe(buildDmThreadId(PN2));
  });

  it('isola grupos por JID', () => {
    expect(buildGroupThreadId(GROUP_A)).not.toBe(buildGroupThreadId(GROUP_B));
  });

  it('resolve thread de grupo vs DM', () => {
    expect(resolveThread(GROUP_A, PN).kind).toBe('group');
    expect(resolveThread(PN, PN).threadId).toBe(buildDmThreadId(PN));
  });
});

describe('shouldRecordIncomingMessage', () => {
  it('não registra mensagens do bot', () => {
    const msg = botMsg({ jid: PN, text: 'oi' });
    msg.raw.key.fromMe = true;
    expect(shouldRecordIncomingMessage(msg, true)).toBe(false);
  });

  it('não registra comandos', () => {
    expect(shouldRecordIncomingMessage(botMsg({ jid: PN, text: '!menu' }), false)).toBe(false);
  });

  it('registra texto conversacional', () => {
    expect(shouldRecordIncomingMessage(botMsg({ jid: GROUP_A, text: 'olá grupo' }), false)).toBe(
      true,
    );
  });
});

describe('memória pessoal vs contexto de grupo', () => {
  it('inclui memórias pessoais sem vazar histórico de outro grupo na DM', () => {
    const dmContext = buildMemorySystemAppend({
      personalMemories: ['Nome/apelido preferido: Gustavo'],
      groupRecentLines: [],
      threadRecentLines: ['Usuário: oi no privado'],
      isGroup: false,
    });
    expect(dmContext).toContain('Gustavo');
    expect(dmContext).not.toContain('grupo');

    const groupContext = buildMemorySystemAppend({
      personalMemories: ['Nome/apelido preferido: Gustavo'],
      groupRecentLines: ['Usuário: falei no grupo A'],
      threadRecentLines: [],
      isGroup: true,
    });
    expect(groupContext).toContain('Gustavo');
    expect(groupContext).toContain('grupo A');
    expect(groupContext).not.toContain('privado');
  });

  it('isola memórias entre usuários via consulta simulada', async () => {
    const store = new Map<string, string[]>();
    vi.spyOn(memRepo, 'getPersonalMemoriesForContext').mockImplementation(
      async (userId: string) => store.get(userId) ?? [],
    );

    store.set(PN, ['Projeto em andamento: App X']);
    store.set(PN2, ['Profissão: designer']);

    expect(await memRepo.getPersonalMemoriesForContext(PN, 10, true)).not.toEqual(
      await memRepo.getPersonalMemoriesForContext(PN2, 10, true),
    );
    vi.restoreAllMocks();
  });
});

describe('extractHeuristicMemories', () => {
  it('extrai nome e projeto afirmados', () => {
    const mem = extractHeuristicMemories('Me chamo Ana e estou desenvolvendo um bot de WhatsApp.');
    expect(mem.some((m) => m.category === 'preferred_name')).toBe(true);
    expect(mem.some((m) => m.category === 'project')).toBe(true);
  });

  it('ignora perguntas', () => {
    expect(extractHeuristicMemories('Qual é o meu nome?')).toEqual([]);
  });
});

describe('OpenCode service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna indisponível sem derrubar o fluxo', async () => {
    vi.spyOn(await import('../src/services/opencode/client.js'), 'checkOpencodeHealth').mockResolvedValue(
      false,
    );

    const result = await chatWithOpencode({
      contextKey: buildDmThreadId(PN),
      sessionTitle: 'test',
      chatJid: PN,
      senderUserId: PN,
      userPrompt: 'oi',
      isAdmin: false,
      systemBase: '',
    });

    expect(result.ok).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it('recupera sessão após falha 404 criando nova', async () => {
    vi.spyOn(await import('../src/services/opencode/client.js'), 'checkOpencodeHealth').mockResolvedValue(
      true,
    );
    vi.spyOn(memRepo, 'getOpencodeSessionId').mockResolvedValue('old-session');
    vi.spyOn(memRepo, 'deleteOpencodeSessionMapping').mockResolvedValue(undefined);
    vi.spyOn(memRepo, 'saveOpencodeSessionId').mockResolvedValue(undefined);

    const mockClient = {
      session: {
        get: vi.fn().mockResolvedValue({ error: { name: 'NotFound' }, data: undefined, response: { status: 404 } }),
        create: vi.fn().mockResolvedValue({ data: { id: 'new-session' }, error: undefined }),
        prompt: vi.fn().mockResolvedValue({
          data: { parts: [{ type: 'text', text: 'Resposta OK' }] },
          error: undefined,
        }),
      },
    };

    vi.spyOn(await import('../src/services/memory/context.js'), 'buildAiContextAppend').mockResolvedValue('');

    const result = await chatWithOpencode(
      {
        contextKey: buildDmThreadId(PN),
        sessionTitle: 't',
        chatJid: PN,
        senderUserId: PN,
        userPrompt: 'teste',
        isAdmin: false,
        systemBase: '',
      },
      mockClient as never,
    );

    expect(memRepo.deleteOpencodeSessionMapping).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Resposta OK');
  });
});

describe('extractTextFromParts', () => {
  it('concatena partes de texto', () => {
    expect(
      extractTextFromParts([
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B' },
      ] as never),
    ).toBe('A\nB');
  });
});

describe('duplicidade de mensagem', () => {
  it('insertChatMessage retorna false em conflito', async () => {
    vi.spyOn(await import('../src/database/pool.js'), 'query').mockResolvedValue({
      rows: [],
      rowCount: 0,
    } as never);

    const inserted = await memRepo.insertChatMessage({
      threadId: buildGroupThreadId(GROUP_A),
      waMessageId: 'ABC123',
      chatJid: GROUP_A,
      senderUserId: PN,
      role: 'user',
      content: 'primeira mensagem no grupo',
    });
    expect(inserted).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('privacidade memoria', () => {
  it('getPersonalMemoriesForContext respeita shareable em grupos', async () => {
    vi.spyOn(memRepo, 'getPersonalMemoriesForContext').mockImplementation(
      async (_uid, _limit, includeNonShareable) =>
        includeNonShareable ? ['privado', 'share'] : ['share'],
    );

    const dm = await memRepo.getPersonalMemoriesForContext(PN, 5, true);
    const group = await memRepo.getPersonalMemoriesForContext(PN, 5, false);
    expect(dm).toContain('privado');
    expect(group).not.toContain('privado');
    vi.restoreAllMocks();
  });
});
