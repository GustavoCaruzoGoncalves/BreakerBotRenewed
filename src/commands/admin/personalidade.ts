import { config } from '../../config.js';
import * as personalityRepo from '../../database/personalityRepository.js';
import { invalidateGroupPersonalityCache } from '../../services/ai/personality.js';
import * as users from '../../services/users.js';
import type { BotMessage, Command, CommandHandler, WASocket } from '../../types/bot.js';

const PREFIX = '!personalidade';
const PAGE_SIZE = 15;

async function resolveAdminSender(sock: WASocket, msg: BotMessage): Promise<string | null> {
  const { jid, raw } = msg;
  const sender =
    (await users.resolveSender(raw)) ??
    (jid.endsWith('@g.us') ? raw.key.participantAlt || raw.key.participant || jid : jid);
  if (!config.admins.includes(sender)) return null;
  return sender;
}

function helpText(): string {
  return (
    '🎭 *Personalidades da IA* _(admins do bot)_\n\n' +
    'No *PV*: configure sem ninguém do grupo ver.\n' +
    'No *grupo*: `usar` pode avisar todo mundo (use `quieto` para mudar em silêncio).\n\n' +
    '*Listar / consultar*\n' +
    '• `!personalidade listar` — perfis disponíveis\n' +
    '• `!personalidade grupos` — grupos numerados (PV ou grupo)\n' +
    '• `!personalidade grupos 2` — página 2\n' +
    '• `!personalidade ver` — personalidade deste grupo\n' +
    '• `!personalidade ver 3` — no PV, personalidade do grupo #3\n' +
    '• `!personalidade info <slug>` — detalhes de um perfil\n\n' +
    '*Criar / editar*\n' +
    '• `!personalidade criar <slug> "<nome>" <prompt...>`\n' +
    '• `!personalidade descricao <slug> "<texto>"`\n' +
    '• `!personalidade editar <slug> <novo prompt...>`\n' +
    '• `!personalidade apagar <slug>`\n\n' +
    '*Ativar por grupo*\n' +
    '• No grupo: `!personalidade usar <slug>` ou `... quieto`\n' +
    '• No PV: `!personalidade usar <nº> <slug>` _(só você vê)_\n' +
    '• No PV: `!personalidade usar jid 120363...@g.us <slug>`\n' +
    '• `!personalidade reset` / `!personalidade reset <nº>` — volta ao padrão\n\n' +
    '_Embutidas:_ `default`, `bolsonaro`, `lula`'
  );
}

function formatGroupLabel(row: personalityRepo.KnownGroupRow, index: number): string {
  const name = row.subject?.trim() || '(sem nome)';
  const id = row.group_jid.split('@')[0] ?? row.group_jid;
  return `${index}. ${name} — \`${id}\``;
}

async function resolveGroupFromArg(
  arg: string,
  isDm: boolean,
): Promise<personalityRepo.KnownGroupRow | null> {
  const trimmed = arg.trim();
  if (/^\d+$/.test(trimmed)) {
    return personalityRepo.getKnownGroupByIndex(Number(trimmed));
  }
  if (trimmed.includes('@g.us')) {
    return {
      group_jid: trimmed,
      subject: null,
      last_seen_at: new Date(),
      first_seen_at: new Date(),
    };
  }
  if (isDm) return null;
  return null;
}

const handle: CommandHandler = async (sock, msg) => {
  const { text, jid, raw } = msg;
  if (raw.key.fromMe || !text?.trim().toLowerCase().startsWith(PREFIX)) return false;

  const sender = await resolveAdminSender(sock, msg);
  if (!sender) {
    await sock.sendMessage(jid, { text: '❌ Somente administradores do bot podem gerenciar personalidades.' });
    return true;
  }

  const rest = text.trim().slice(PREFIX.length).trim();
  const lowerRest = rest.toLowerCase();
  const isDm = !jid.endsWith('@g.us');

  if (!rest || lowerRest === 'ajuda' || lowerRest === 'help') {
    await sock.sendMessage(jid, { text: helpText() });
    return true;
  }

  if (lowerRest === 'listar' || lowerRest.startsWith('listar ')) {
    const rows = await personalityRepo.listPersonalities();
    if (rows.length === 0) {
      await sock.sendMessage(jid, { text: '_Nenhuma personalidade cadastrada._' });
      return true;
    }
    let body = '🎭 *Personalidades*\n\n';
    for (const p of rows) {
      const tag = p.is_builtin ? ' 🔒' : '';
      body += `• \`${p.slug}\`${tag} — ${p.display_name}\n  _${p.description || 'sem descrição'}_\n`;
    }
    await sock.sendMessage(jid, { text: body.trim() });
    return true;
  }

  if (lowerRest.startsWith('grupos')) {
    await personalityRepo.syncKnownGroupsFromActivity();
    const page = Math.max(1, Number(lowerRest.split(/\s+/)[1] ?? '1') || 1);
    const total = await personalityRepo.countKnownGroups();
    const offset = (page - 1) * PAGE_SIZE;
    const rows = await personalityRepo.listKnownGroups(PAGE_SIZE, offset);
    if (rows.length === 0) {
      await sock.sendMessage(jid, {
        text: 'Nenhum grupo registrado ainda. O bot lista grupos onde já houve mensagens.',
      });
      return true;
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    let body = `📋 *Grupos conhecidos* (pág. ${page}/${pages}, total ${total})\n\n`;
    rows.forEach((g, i) => {
      body += `${formatGroupLabel(g, offset + i + 1)}\n`;
    });
    if (page < pages) body += `\nPróxima: \`!personalidade grupos ${page + 1}\``;
    body += '\n\nNo PV: `!personalidade usar <nº> <slug>`';
    await sock.sendMessage(jid, { text: body.trim() });
    return true;
  }

  if (lowerRest.startsWith('info ')) {
    const slug = rest.slice(5).trim().split(/\s+/)[0]?.toLowerCase();
    if (!slug) {
      await sock.sendMessage(jid, { text: 'Uso: `!personalidade info <slug>`' });
      return true;
    }
    const p = await personalityRepo.getPersonality(slug);
    if (!p) {
      await sock.sendMessage(jid, { text: '❌ Personalidade não encontrada.' });
      return true;
    }
    const preview =
      p.system_prompt.length > 500 ? `${p.system_prompt.slice(0, 497)}…` : p.system_prompt;
    await sock.sendMessage(jid, {
      text:
        `🎭 *${p.display_name}* (\`${p.slug}\`)\n` +
        `${p.is_builtin ? '🔒 embutida\n' : ''}` +
        `${p.description}\n\n*Prompt:*\n${preview}`,
    });
    return true;
  }

  if (lowerRest.startsWith('criar ')) {
    const m = rest.match(/^criar\s+([a-z0-9-]+)\s+"([^"]+)"\s+([\s\S]+)$/i);
    if (!m) {
      await sock.sendMessage(jid, {
        text: 'Uso: `!personalidade criar meu-bot "Nome bonito" Texto do system prompt...`',
      });
      return true;
    }
    const slug = m[1]!.toLowerCase();
    const displayName = m[2]!.trim();
    const systemPrompt = m[3]!.trim();
    if (systemPrompt.length < 20) {
      await sock.sendMessage(jid, { text: '❌ O prompt precisa ter pelo menos 20 caracteres.' });
      return true;
    }
    try {
      await personalityRepo.createPersonality({
        slug,
        displayName,
        description: '',
        systemPrompt,
        createdBy: sender,
      });
      await sock.sendMessage(jid, { text: `✅ Personalidade \`${slug}\` criada.` });
    } catch (err) {
      const msgErr = err instanceof Error ? err.message : 'Erro ao criar.';
      await sock.sendMessage(jid, { text: `❌ ${msgErr}` });
    }
    return true;
  }

  if (lowerRest.startsWith('descricao ')) {
    const m = rest.match(/^descricao\s+([a-z0-9-]+)\s+"([^"]+)"\s*$/i);
    if (!m) {
      await sock.sendMessage(jid, { text: 'Uso: `!personalidade descricao <slug> "descrição curta"`' });
      return true;
    }
    const ok = await personalityRepo.updatePersonality(m[1]!.toLowerCase(), {
      description: m[2]!.trim(),
    });
    await sock.sendMessage(jid, {
      text: ok ? '✅ Descrição atualizada.' : '❌ Personalidade não encontrada.',
    });
    return true;
  }

  if (lowerRest.startsWith('editar ')) {
    const m = rest.match(/^editar\s+([a-z0-9-]+)\s+([\s\S]+)$/i);
    if (!m || m[2]!.trim().length < 20) {
      await sock.sendMessage(jid, { text: 'Uso: `!personalidade editar <slug> <novo prompt...>`' });
      return true;
    }
    const slug = m[1]!.toLowerCase();
    const ok = await personalityRepo.updatePersonality(slug, { systemPrompt: m[2]!.trim() });
    invalidateGroupPersonalityCache();
    await sock.sendMessage(jid, {
      text: ok ? `✅ Prompt de \`${slug}\` atualizado.` : '❌ Personalidade não encontrada.',
    });
    return true;
  }

  if (lowerRest.startsWith('apagar ')) {
    const slug = rest.slice(7).trim().split(/\s+/)[0]?.toLowerCase();
    if (!slug) {
      await sock.sendMessage(jid, { text: 'Uso: `!personalidade apagar <slug>`' });
      return true;
    }
    const result = await personalityRepo.deletePersonality(slug);
    await sock.sendMessage(jid, {
      text: result.ok ? `🗑️ Personalidade \`${slug}\` removida.` : `❌ ${result.reason}`,
    });
    return true;
  }

  if (lowerRest.startsWith('ver')) {
    const arg = rest.slice(3).trim();
    let groupJid = jid;
    if (isDm) {
      if (!arg) {
        const assigns = await personalityRepo.listGroupAssignments(30);
        if (assigns.length === 0) {
          await sock.sendMessage(jid, { text: 'Nenhum grupo com personalidade customizada.' });
          return true;
        }
        let body = '🎭 *Atribuições atuais*\n\n';
        for (const a of assigns) {
          body += `• \`${a.group_jid.split('@')[0]}\` → *${a.display_name}* (\`${a.personality_slug}\`)\n`;
        }
        await sock.sendMessage(jid, { text: body.trim() });
        return true;
      }
      const g = await resolveGroupFromArg(arg, true);
      if (!g) {
        await sock.sendMessage(jid, { text: '❌ Grupo inválido. Use `!personalidade grupos`.' });
        return true;
      }
      groupJid = g.group_jid;
    } else if (arg) {
      await sock.sendMessage(jid, { text: 'No grupo use só `!personalidade ver` (sem número).' });
      return true;
    }

    const slug = (await personalityRepo.getGroupPersonalitySlug(groupJid)) ?? 'default';
    const p = await personalityRepo.getPersonality(slug);
    const label = p?.display_name ?? slug;
    await sock.sendMessage(jid, {
      text: `🎭 Personalidade ativa: *${label}* (\`${slug}\`)`,
    });
    return true;
  }

  if (lowerRest.startsWith('reset')) {
    const parts = rest.split(/\s+/).slice(1);
    let groupJid = jid;
    if (isDm) {
      const idx = parts[0];
      if (!idx) {
        await sock.sendMessage(jid, { text: 'No PV: `!personalidade reset <nº do grupo>`' });
        return true;
      }
      const g = await resolveGroupFromArg(idx, true);
      if (!g) {
        await sock.sendMessage(jid, { text: '❌ Grupo não encontrado.' });
        return true;
      }
      groupJid = g.group_jid;
    }
    await personalityRepo.clearGroupPersonality(groupJid);
    invalidateGroupPersonalityCache(groupJid);
    await sock.sendMessage(jid, {
      text: isDm
        ? `✅ Grupo \`${groupJid.split('@')[0]}\` voltou à personalidade padrão.`
        : '✅ Personalidade deste grupo resetada para o padrão.',
    });
    return true;
  }

  if (lowerRest.startsWith('usar ')) {
    const tokens = rest.slice(5).trim().split(/\s+/);
    const quieto = tokens[tokens.length - 1]?.toLowerCase() === 'quieto';
    if (quieto) tokens.pop();

    let groupJid = jid;
    let slug: string | undefined;

    if (isDm) {
      if (tokens[0]?.toLowerCase() === 'jid') {
        groupJid = tokens[1] ?? '';
        slug = tokens[2]?.toLowerCase();
      } else {
        const g = await resolveGroupFromArg(tokens[0] ?? '', true);
        slug = tokens[1]?.toLowerCase();
        if (g) groupJid = g.group_jid;
      }
      if (!groupJid.endsWith('@g.us') || !slug) {
        await sock.sendMessage(jid, {
          text: 'No PV: `!personalidade usar <nº> <slug>` ou `!personalidade usar jid ...@g.us <slug>`',
        });
        return true;
      }
    } else {
      slug = tokens[0]?.toLowerCase();
      if (!slug) {
        await sock.sendMessage(jid, { text: 'Uso: `!personalidade usar <slug>`' });
        return true;
      }
    }

    const personality = await personalityRepo.getPersonality(slug);
    if (!personality) {
      await sock.sendMessage(jid, { text: '❌ Personalidade não encontrada. Use `!personalidade listar`.' });
      return true;
    }

    await personalityRepo.setGroupPersonality(groupJid, slug, sender);
    await personalityRepo.touchKnownGroup(groupJid, null);
    invalidateGroupPersonalityCache(groupJid);

    if (isDm) {
      await sock.sendMessage(jid, {
        text:
          `✅ Grupo \`${groupJid.split('@')[0]}\` agora usa *${personality.display_name}* (\`${slug}\`).\n` +
          '_Só você viu esta mensagem._',
      });
      return true;
    }

    if (!quieto) {
      await sock.sendMessage(groupJid, {
        text: `🎭 Admin trocou a personalidade da IA para *${personality.display_name}* (\`${slug}\`).`,
      });
    } else {
      await sock.sendMessage(jid, {
        text: `✅ Personalidade alterada para *${personality.display_name}* (modo quieto).`,
      });
    }
    return true;
  }

  await sock.sendMessage(jid, { text: helpText() });
  return true;
};

const personalidadeCommand: Command = {
  meta: {
    category: 'Admin',
    entries: [
      {
        trigger: '!personalidade',
        description: 'Gerencia personalidades da IA por grupo (admins do bot)',
        admin: true,
        usages: [{ syntax: '!personalidade', description: 'Ajuda e subcomandos' }],
      },
    ],
  },
  handle,
};

export default personalidadeCommand;
