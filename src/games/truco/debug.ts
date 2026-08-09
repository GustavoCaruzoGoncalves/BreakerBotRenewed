import { getAdminNumbers } from '../../config.js';
import { cancelActiveMatchInGroup, startDebugMatch } from './service.js';
import type { TrucoContext, TrucoResponse } from './service.js';
import { ensureTrucoUser } from './users.js';
import type { SeatPlayer } from './types.js';
import { teamForSeat } from './types.js';

function err(text: string): TrucoResponse {
  return { groupMessages: [{ text }], privateMessages: [] };
}

function phoneOf(jid: string): string {
  return jid.split('@')[0]?.split(':')[0] ?? '';
}

export function isTrucoAdmin(ctx: TrucoContext): boolean {
  const admins = getAdminNumbers();
  if (admins.length === 0) return false;
  return [ctx.userId, ctx.mentionJid, ctx.dmJid].some((jid) => admins.includes(phoneOf(jid)));
}

async function buildSeats1v1(ctx: TrucoContext, opponentUserId: string): Promise<SeatPlayer[]> {
  const opponent = await ensureTrucoUser(opponentUserId);
  return [
    {
      seat: 0,
      userId: ctx.userId,
      whatsappJid: ctx.mentionJid,
      dmJid: ctx.dmJid,
      displayName: ctx.displayName,
      team: 0,
    },
    {
      seat: 1,
      userId: opponent.userId,
      whatsappJid: opponent.mentionJid,
      dmJid: opponent.dmJid,
      displayName: opponent.displayName || 'Jogador',
      team: 1,
    },
  ];
}

async function buildSeats2v2(
  ctx: TrucoContext,
  partnerUserId: string,
  opponentUserIds: [string, string],
): Promise<SeatPlayer[]> {
  const [partner, opp1, opp2] = await Promise.all([
    ensureTrucoUser(partnerUserId),
    ensureTrucoUser(opponentUserIds[0]),
    ensureTrucoUser(opponentUserIds[1]),
  ]);

  return [
    {
      seat: 0,
      userId: ctx.userId,
      whatsappJid: ctx.mentionJid,
      dmJid: ctx.dmJid,
      displayName: ctx.displayName,
      team: teamForSeat(0, '2v2'),
    },
    {
      seat: 1,
      userId: opp1.userId,
      whatsappJid: opp1.mentionJid,
      dmJid: opp1.dmJid,
      displayName: opp1.displayName || 'Jogador',
      team: teamForSeat(1, '2v2'),
    },
    {
      seat: 2,
      userId: partner.userId,
      whatsappJid: partner.mentionJid,
      dmJid: partner.dmJid,
      displayName: partner.displayName || 'Parceiro',
      team: teamForSeat(2, '2v2'),
    },
    {
      seat: 3,
      userId: opp2.userId,
      whatsappJid: opp2.mentionJid,
      dmJid: opp2.dmJid,
      displayName: opp2.displayName || 'Jogador',
      team: teamForSeat(3, '2v2'),
    },
  ];
}

function debugHelpText(): string {
  return (
    `🔧 Comandos de debug (admin)\n\n` +
    `!debugTruco help — esta lista\n\n` +
    `1v1 (marque @oponente):\n` +
    `• !debugTruco maodeferro — 11×11 (Mão de Ferro)\n` +
    `• !debugTruco maoonze — você com 11 pts (Mão de Onze)\n` +
    `• !debugTruco normal — 0×0\n` +
    `• !debugTruco placar 10 9 — placar customizado (0–11)\n\n` +
    `2v2 (marque @parceiro @adv1 @adv2):\n` +
    `• !debugTruco 2v2 — 0×0\n` +
    `• !debugTruco 2v2ferro — 11×11 (Mão de Ferro)\n` +
    `• !debugTruco 2v2onze — 11×8 (Mão de Onze)\n\n` +
    `• !debugTruco reset — cancela a partida de teste no grupo`
  );
}

async function start1v1(
  ctx: TrucoContext,
  scores: [number, number],
  label: string,
): Promise<TrucoResponse> {
  const mentions = ctx.mentionedUserIds;
  if (mentions.length < 1) return err('❌ Marque 1 jogador: !debugTruco ... @oponente');

  const seats = await buildSeats1v1(ctx, mentions[0]);
  return startDebugMatch(ctx, '1v1', seats, scores, label);
}

async function start2v2(
  ctx: TrucoContext,
  scores: [number, number],
  label: string,
): Promise<TrucoResponse> {
  const mentions = ctx.mentionedUserIds;
  if (mentions.length < 3) return err('❌ Marque 3 jogadores: !debugTruco 2v2 @parceiro @adv1 @adv2');

  const seats = await buildSeats2v2(ctx, mentions[0], [mentions[1], mentions[2]]);
  return startDebugMatch(ctx, '2v2', seats, scores, label);
}

export async function handleDebug(ctx: TrucoContext, args: string[]): Promise<TrucoResponse> {
  if (!isTrucoAdmin(ctx)) {
    return err('❌ Apenas administradores podem usar !debugTruco.');
  }

  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'help' || sub === 'ajuda') {
    return { groupMessages: [{ text: debugHelpText() }], privateMessages: [] };
  }

  if (sub === 'reset' || sub === 'cancelar') {
    const cancelled = await cancelActiveMatchInGroup(ctx.groupId);
    return cancelled
      ? { groupMessages: [{ text: '🔧 Debug: partida cancelada.' }], privateMessages: [] }
      : err('❌ Não há partida ativa neste grupo.');
  }

  if (sub === 'maodeferro' || sub === 'maoferro' || sub === 'ferro') {
    return start1v1(ctx, [11, 11], 'Mão de Ferro (11×11) — partida de teste iniciada.');
  }

  if (sub === 'maoonze' || sub === 'onze') {
    return start1v1(ctx, [11, 8], 'Mão de Onze (11×8) — partida de teste iniciada.');
  }

  if (sub === 'normal' || sub === 'zero') {
    return start1v1(ctx, [0, 0], 'Partida normal (0×0) — teste iniciado.');
  }

  if (sub === 'placar' || sub === 'score') {
    const a = Number(args[1]);
    const b = Number(args[2]);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 11 || b > 11) {
      return err('❌ Placar inválido. Use: !debugTruco placar 10 9 @oponente (0–11).');
    }
    return start1v1(ctx, [a, b], `Placar ${a}×${b} — partida de teste iniciada.`);
  }

  if (sub === '2v2' || sub === 'dupla') {
    return start2v2(ctx, [0, 0], '2×2 (0×0) — partida de teste iniciada.');
  }

  if (sub === '2v2ferro' || sub === 'duplaferro') {
    return start2v2(ctx, [11, 11], '2×2 Mão de Ferro (11×11) — partida de teste iniciada.');
  }

  if (sub === '2v2onze' || sub === 'duplaonze') {
    return start2v2(ctx, [11, 8], '2×2 Mão de Onze (11×8) — partida de teste iniciada.');
  }

  return err('❌ Cenário desconhecido. Use !debugTruco help');
}
