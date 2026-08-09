import type { WASocket } from '@whiskeysockets/baileys';
import * as users from '../../services/users.js';
import * as trucoRepo from '../../games/truco/repository.js';
import * as truco from '../../games/truco/service.js';
import { handleDebug } from '../../games/truco/debug.js';
import { ensureTrucoUser, resolveMentionUserId } from '../../games/truco/users.js';
import type { TrucoContext, TrucoResponse } from '../../games/truco/service.js';
import type { GameMode } from '../../games/truco/types.js';
import type { BotMessage, Command } from '../../types/bot.js';

const GROUP_NAME_TTL_MS = 5 * 60 * 1000;
const groupNameCache = new Map<string, { name: string; expiresAt: number }>();

async function getGroupName(sock: WASocket, groupJid: string): Promise<string> {
  const cached = groupNameCache.get(groupJid);
  if (cached && cached.expiresAt > Date.now()) return cached.name;

  try {
    const meta = await sock.groupMetadata(groupJid);
    groupNameCache.set(groupJid, { name: meta.subject, expiresAt: Date.now() + GROUP_NAME_TTL_MS });
    return meta.subject;
  } catch {
    return cached?.name ?? 'Grupo';
  }
}

function parseMode(arg: string | undefined): GameMode | null {
  const n = (arg ?? '1v1').toLowerCase();
  if (n === '1v1' || n === 'solo' || n === '1x1') return '1v1';
  if (n === '2v2' || n === 'dupla' || n === '2x2') return '2v2';
  return null;
}

/** Aceita apenas slot fixo 1, 2 ou 3 (nunca interpreta parcialmente nem fallback). */
function parseCardSlot(args: string[]): number | null {
  const raw = args[0]?.trim();
  if (!raw || !/^[1-3]$/.test(raw)) return null;
  return Number(raw);
}

function helpText(): string {
  return (
    `📖 Comandos do Truco Paulista\n\n` +
    `!truco 1v1 — sala livre 1x1\n` +
    `!truco 1v1 @oponente — desafio direto\n` +
    `!truco 2v2 — sala livre 2x2\n` +
    `!truco 2v2 @parceiro — dupla com parceiro\n` +
    `!truco 2v2 @parceiro @adv1 @adv2 — times definidos\n` +
    `!entrar / !sair / !iniciar / !cancelar\n` +
    `!jogar N — jogar carta N (no grupo)\n` +
    `!esconder N — esconder carta N (2ª/3ª jogada)\n` +
    `!truco / !seis / !nove / !doze\n` +
    `!aceitar (!descer) / !correr\n` +
    `!confirmar — confirmar Mão de Onze (2×2)\n` +
    `!cartas parceiro — ver cartas do parceiro (Mão de Onze)\n` +
    `!mesa / !historico\n` +
    `!trucostatus / !trucostatus grupo\n` +
    `!rankingtruco / !rankingtruco grupo\n` +
    `!regras`
  );
}

function rulesText(): string {
  return (
    `📜 Regras — Truco Paulista\n\n` +
    `• Baralho de 40 cartas, 3 por jogador + vira\n` +
    `• Ordem: 3>2>A>K>J>Q>7>6>5>4\n` +
    `• Manilha = carta após a vira (vira 2 → manilha 4)\n` +
    `• Manilhas: ♣>♥>♠>♦ (Zap = manilha de paus)\n` +
    `• Melhor de 3 rodadas por mão\n` +
    `• Pontuação: 1→3→6→9→12\n` +
    `• Correr: 1/3/6/9 conforme aposta anterior\n` +
    `• Mão de Onze: vale 3, parceiros consultam cartas\n` +
    `• Mão de Ferro (11×11): cartas cobertas, vencedor leva tudo\n` +
    `• Partida até 12 pontos`
  );
}

/**
 * `!entrar` e `!aceitar` também disparam eventos aleatórios de aura. O Truco só
 * consome esses gatilhos quando a partida realmente espera por eles; nos demais
 * casos o comando segue adiante no router e a aura o trata.
 */
const SHARED_TRIGGERS = new Set(['entrar', 'aceitar']);

async function trucoNeedsTrigger(command: string, groupJid: string): Promise<boolean> {
  const group = await trucoRepo.findGroupByJid(groupJid);
  if (!group) return false;

  const match = await trucoRepo.findOpenMatchByGroupId(group.id);
  if (!match) return false;

  if (command === 'entrar') return match.status === 'waiting';

  const phase = match.state_json?.phase;
  return match.status === 'active' && (phase === 'raise_pending' || phase === 'mao_onze_decision');
}

async function buildContext(
  sock: WASocket,
  msg: BotMessage,
  userId: string,
): Promise<TrucoContext | null> {
  const groupJid = msg.jid;
  const groupName = await getGroupName(sock, groupJid);
  const group = await trucoRepo.upsertGroup(groupJid, groupName);

  const self = await ensureTrucoUser(userId, msg.raw.pushName ?? undefined);

  const mentionedJids = msg.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
  const mentionedUserIds: string[] = [];
  for (const jid of mentionedJids) {
    const resolved = await resolveMentionUserId(jid);
    if (resolved) mentionedUserIds.push(resolved);
  }

  return {
    groupJid,
    groupId: group.id,
    userId: self.userId,
    mentionJid: self.mentionJid,
    dmJid: self.dmJid,
    displayName: self.displayName,
    mentionedUserIds,
  };
}

function textResponse(text: string): TrucoResponse {
  return { groupMessages: [{ text }], privateMessages: [] };
}

async function statsResponse(ctx: TrucoContext, scope: string | undefined): Promise<TrucoResponse> {
  const aura = await trucoRepo.getAuraPoints(ctx.userId);

  if (scope?.toLowerCase() === 'grupo') {
    const s = await trucoRepo.getGroupStats(ctx.userId, ctx.groupId);
    return textResponse(
      `📊 Suas estatísticas neste grupo\n\n` +
        `✨ Aura: ${aura}\n` +
        `🎮 Partidas: ${s.matches_played}\n` +
        `🏆 Vitórias: ${s.wins} | ❌ Derrotas: ${s.losses}\n` +
        `🔥 Sequência: ${s.win_streak} (recorde: ${s.best_win_streak})`,
    );
  }

  const s = await trucoRepo.getUserStats(ctx.userId);
  return textResponse(
    `📊 Suas estatísticas globais\n\n` +
      `✨ Aura: ${aura}\n` +
      `🎮 Partidas: ${s.matches_played}\n` +
      `🏆 Vitórias: ${s.wins} | ❌ Derrotas: ${s.losses}\n` +
      `1v1: ${s.wins_1v1}/${s.matches_1v1} | 2v2: ${s.wins_2v2}/${s.matches_2v2}\n` +
      `🔥 Sequência: ${s.win_streak} (recorde: ${s.best_win_streak})`,
  );
}

async function rankingResponse(
  ctx: TrucoContext,
  scope: string | undefined,
): Promise<TrucoResponse> {
  const isGroup = scope?.toLowerCase() === 'grupo';
  const rows = isGroup
    ? await trucoRepo.getGroupRanking(ctx.groupId)
    : await trucoRepo.getGlobalRanking();

  const lines = rows.map(
    (r, i) => `${i + 1}. ${r.display_name} — ${r.wins}V/${r.losses}D (✨${r.aura_points})`,
  );
  const title = isGroup ? '🏆 Ranking do Truco no grupo' : '🏆 Ranking global do Truco';
  return textResponse(`${title}\n\n${lines.join('\n') || 'Nenhum jogador ainda.'}`);
}

async function dispatch(
  ctx: TrucoContext,
  command: string,
  args: string[],
): Promise<TrucoResponse | null> {
  switch (command) {
    case 'truco': {
      const open = await trucoRepo.findOpenMatchByGroupId(ctx.groupId);
      if (open?.status === 'active') return truco.truco(ctx);

      const mode = parseMode(args[0]);
      if (!mode) return textResponse('❌ Modo inválido. Use: !truco 1v1 ou !truco 2v2');

      if (mode === '1v1') {
        return truco.createLobby(ctx, mode, null, ctx.mentionedUserIds.slice(0, 1));
      }
      return truco.createLobby(
        ctx,
        mode,
        ctx.mentionedUserIds[0] ?? null,
        ctx.mentionedUserIds.slice(1, 3),
      );
    }

    case 'entrar':
      return truco.joinLobby(ctx);
    case 'sair':
      return truco.leaveLobby(ctx);
    case 'iniciar':
      return truco.startLobby(ctx);
    case 'cancelar':
      return truco.cancelLobby(ctx);

    case 'jogar': {
      const n = parseCardSlot(args);
      if (n === null) {
        return textResponse(
          '❌ Carta inválida. Use !jogar 1, !jogar 2 ou !jogar 3 (slot fixo da rodada).',
        );
      }
      return truco.play(ctx, n, false);
    }

    case 'esconder': {
      const n = parseCardSlot(args);
      if (n === null) {
        return textResponse(
          '❌ Carta inválida. Use !esconder 1, !esconder 2 ou !esconder 3 (slot fixo da rodada).',
        );
      }
      return truco.play(ctx, n, true);
    }

    case 'seis':
      return truco.seis(ctx);
    case 'nove':
      return truco.nove(ctx);
    case 'doze':
      return truco.doze(ctx);
    case 'aceitar':
    case 'descer':
      return truco.aceitar(ctx);
    case 'correr':
      return truco.correr(ctx);
    case 'confirmar':
      return truco.confirmar(ctx);

    case 'cartas':
      if (args[0]?.toLowerCase() === 'parceiro') return truco.cartasParceiro(ctx);
      return textResponse('❌ Use: !cartas parceiro');

    case 'mesa':
      return truco.getMesa(ctx);
    case 'historico':
      return truco.getHistorico(ctx);

    case 'trucostatus':
      return statsResponse(ctx, args[0]);
    case 'rankingtruco':
      return rankingResponse(ctx, args[0]);

    case 'regras':
      return textResponse(rulesText());
    case 'trucoajuda':
      return textResponse(helpText());

    case 'debugtruco':
      return handleDebug(ctx, args);

    default:
      return null;
  }
}

const TRIGGERS = new Set([
  'truco',
  'entrar',
  'sair',
  'iniciar',
  'cancelar',
  'jogar',
  'esconder',
  'seis',
  'nove',
  'doze',
  'aceitar',
  'descer',
  'correr',
  'confirmar',
  'cartas',
  'mesa',
  'historico',
  'trucostatus',
  'rankingtruco',
  'regras',
  'trucoajuda',
  'debugtruco',
]);

const trucoCommand: Command = {
  meta: {
    category: 'Truco',
    entries: [
      {
        trigger: '!truco',
        description: 'Cria uma sala de Truco Paulista ou pede Truco na partida em andamento',
        groupOnly: true,
        usages: [
          { syntax: '!truco 1v1 [@oponente]', description: 'Sala 1×1, opcionalmente desafiando' },
          {
            syntax: '!truco 2v2 [@parceiro @adv1 @adv2]',
            description: 'Sala 2×2 com times opcionais',
          },
        ],
      },
      {
        trigger: '!entrar',
        description: 'Entra na sala de Truco aberta no grupo',
        groupOnly: true,
      },
      { trigger: '!sair', description: 'Sai da sala ou abandona a partida', groupOnly: true },
      { trigger: '!iniciar', description: 'Inicia a partida quando a sala está cheia', groupOnly: true },
      { trigger: '!cancelar', description: 'Cancela a sala ou a partida', groupOnly: true },
      {
        trigger: '!jogar',
        description: 'Joga a carta do slot 1, 2 ou 3',
        groupOnly: true,
        usages: [{ syntax: '!jogar N', description: 'Slot fixo da rodada' }],
      },
      {
        trigger: '!esconder',
        description: 'Joga a carta coberta (2ª/3ª jogada)',
        groupOnly: true,
        usages: [{ syntax: '!esconder N', description: 'Slot fixo da rodada' }],
      },
      { trigger: '!seis', description: 'Pede seis (ou contra-ataca um pedido)', groupOnly: true },
      { trigger: '!nove', description: 'Pede nove (ou contra-ataca um pedido)', groupOnly: true },
      { trigger: '!doze', description: 'Pede doze (ou contra-ataca um pedido)', groupOnly: true },
      {
        trigger: '!aceitar',
        aliases: ['!descer'],
        description: 'Aceita a aposta ou a Mão de Onze',
        groupOnly: true,
      },
      { trigger: '!correr', description: 'Recusa a aposta ou corre na Mão de Onze', groupOnly: true },
      { trigger: '!confirmar', description: 'Confirma a decisão da Mão de Onze (2×2)', groupOnly: true },
      {
        trigger: '!cartas',
        description: 'Mostra as cartas do parceiro na Mão de Onze',
        groupOnly: true,
        usages: [{ syntax: '!cartas parceiro', description: 'Enviado no privado' }],
      },
      { trigger: '!mesa', description: 'Mostra o estado da sala ou da mesa', groupOnly: true },
      { trigger: '!historico', description: 'Jogadas da mão atual', groupOnly: true },
      {
        trigger: '!trucostatus',
        description: 'Suas estatísticas de Truco',
        groupOnly: true,
        usages: [{ syntax: '!trucostatus grupo', description: 'Estatísticas apenas neste grupo' }],
      },
      {
        trigger: '!rankingtruco',
        description: 'Top 10 do Truco',
        groupOnly: true,
        usages: [{ syntax: '!rankingtruco grupo', description: 'Ranking apenas deste grupo' }],
      },
      { trigger: '!regras', description: 'Regras do Truco Paulista', groupOnly: true },
      { trigger: '!trucoajuda', description: 'Lista os comandos do Truco', groupOnly: true },
      {
        trigger: '!debugTruco',
        description: 'Cenários de teste do Truco (admin)',
        admin: true,
        groupOnly: true,
        usages: [{ syntax: '!debugTruco help', description: 'Lista os cenários disponíveis' }],
      },
    ],
  },

  async handle(sock, msg) {
    const text = msg.text?.trim();
    if (!text?.startsWith('!')) return false;
    if (!msg.jid.endsWith('@g.us')) return false;

    const parts = text.slice(1).trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    if (!command || !TRIGGERS.has(command)) return false;

    if (SHARED_TRIGGERS.has(command) && !(await trucoNeedsTrigger(command, msg.jid))) {
      return false;
    }

    const userId = await users.resolveSender(msg.raw);
    if (!userId || users.isGroupUserId(userId) || users.isBotUser(sock, userId)) return false;

    const ctx = await buildContext(sock, msg, userId);
    if (!ctx) return false;

    const response = await dispatch(ctx, command, parts.slice(1));
    if (!response) return false;

    await truco.deliverResponse(ctx.groupJid, response, sock);
    return true;
  },
};

export default trucoCommand;
