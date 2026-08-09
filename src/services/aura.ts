import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import * as repo from '../database/repository.js';
import type {
  Aura,
  AuraCooldownKey,
  AuraRankingEntry,
  AuraTransferResult,
  MissionDefinition,
  MissionId,
  MissionProgress,
} from '../database/types.js';
import { MISSION_IDS } from '../database/types.js';

export { MISSION_IDS };
export type { MissionId };

// --- Config ---

export const MISSIONS: Record<MissionId, MissionDefinition> = {
  messages_500: { target: 50, reward: 1000, label: 'Mande 50 mensagens', key: 'messages' },
  reactions_500: { target: 20, reward: 2000, label: 'Reaja 20x com 💀 ou ☠️', key: 'reactions' },
  duel_win: { target: 1, reward: 1000, label: 'Vença 1 duelo (!mog)', key: 'duelWin' },
  survive_attack: {
    target: 1,
    reward: 2000,
    label: 'Sobreviva a um ataque (!mognow)',
    key: 'surviveAttack',
  },
  send_media: {
    target: 1,
    reward: 200,
    label: 'Envie mídia (figurinha/vídeo/imagem/doc)',
    key: 'media',
  },
  help_someone: { target: 1, reward: 100, label: 'Ajude alguém (!respeito)', key: 'helpSomeone' },
};

export type MissionPublicConfig = Omit<MissionDefinition, 'key'>;

export const MISSION_CONFIG: Record<MissionId, MissionPublicConfig> = Object.fromEntries(
  Object.entries(MISSIONS).map(([id, m]) => [id, { target: m.target, reward: m.reward, label: m.label }]),
) as Record<MissionId, MissionPublicConfig>;

export interface Tier {
  min: number;
  name: string;
}

export const TIERS: readonly Tier[] = [
  { min: 50000, name: 'Deus do chat' },
  { min: 10000, name: 'Entidade' },
  { min: 5000, name: 'Sigma' },
  { min: 2000, name: 'Dominante' },
  { min: 500, name: 'Presença' },
  { min: 0, name: 'NPC' },
  { min: -Infinity, name: 'Sugador de aura ☠️' },
];

const LAST_TIER = TIERS[TIERS.length - 1] as Tier;

export type EventTargeting = 'first' | 'all';

export type RandomEventEffect =
  | { type: 'aura'; amount: number }
  | { type: 'random'; options: number[] };

export interface RandomEvent {
  id: string;
  chance: number;
  message: string;
  command: string;
  type: EventTargeting;
  durationMs: number;
  effect: RandomEventEffect;
}

export const RANDOM_EVENTS: readonly RandomEvent[] = [
  { id: 'energia_rara', chance: 0.30, message: '💠 *Uma energia rara apareceu no chat!* Primeiro a digitar *!absorver* ganha *200* de aura.', command: '!absorver', type: 'first', durationMs: 60000, effect: { type: 'aura', amount: 200 } },
  { id: 'fenda', chance: 0.14, message: '⚡ *Uma fenda dimensional abriu!* Todos que digitarem *!entrar* nos próximos 45 segundos ganham *50* de aura.', command: '!entrar', type: 'all', durationMs: 45000, effect: { type: 'aura', amount: 50 } },
  { id: 'cristal', chance: 0.11, message: '💎 *Um cristal de aura surgiu!* O primeiro a digitar *!pegar* recebe *150* de aura.', command: '!pegar', type: 'first', durationMs: 50000, effect: { type: 'aura', amount: 150 } },
  { id: 'vento', chance: 0.10, message: '🌬️ *Um vento favorável passa pelo grupo!* Primeiro a digitar *!aproveitar* ganha *100* de aura.', command: '!aproveitar', type: 'first', durationMs: 55000, effect: { type: 'aura', amount: 100 } },
  { id: 'oferenda', chance: 0.08, message: '👑 *Os deuses deixaram uma oferenda!* Quem digitar *!aceitar* primeiro ganha *300* de aura.', command: '!aceitar', type: 'first', durationMs: 60000, effect: { type: 'aura', amount: 300 } },
  { id: 'pocao', chance: 0.06, message: '🧪 *Uma poção brilhante apareceu!* Primeiro a digitar *!beber* ganha *80* de aura.', command: '!beber', type: 'first', durationMs: 40000, effect: { type: 'aura', amount: 80 } },
  { id: 'espirito', chance: 0.05, message: '👻 *O espírito do grupo se manifesta!* Todos que digitarem *!invocar* em 1 minuto ganham *30* de aura.', command: '!invocar', type: 'all', durationMs: 60000, effect: { type: 'aura', amount: 30 } },
  { id: 'armadilha', chance: 0.04, message: '🕳️ *Uma armadilha sombria está ativa!* O primeiro a digitar *!tocar* verá as *consequências*. Cuidado!', command: '!tocar', type: 'first', durationMs: 50000, effect: { type: 'aura', amount: -100 } },
  { id: 'fenda_maldita', chance: 0.03, message: '💀 *Uma fenda maldita se abre!* Quem digitar *!entrar* primeiro *perde* *150* de aura.', command: '!entrar', type: 'first', durationMs: 45000, effect: { type: 'aura', amount: -150 } },
  { id: 'caixa', chance: 0.03, message: '📦 *Uma caixa misteriosa apareceu!* O primeiro a digitar *!abrir* pode ganhar ou perder aura… (sorte ou azar!)', command: '!abrir', type: 'first', durationMs: 50000, effect: { type: 'random', options: [100, 100, -80, -80, 200] } },
  { id: 'ruina', chance: 0.02, message: '🏛️ *Ruínas antigas emanam energia!* O primeiro a digitar *!explorar* arrisca: *+200* ou *-100* de aura.', command: '!explorar', type: 'first', durationMs: 55000, effect: { type: 'random', options: [200, -100] } },
  { id: 'nuvem', chance: 0.02, message: '☁️ *Uma nuvem de aura pairou no chat!* Todos que digitarem *!respirar* em 40 segundos ganham *40* de aura.', command: '!respirar', type: 'all', durationMs: 40000, effect: { type: 'aura', amount: 40 } },
  { id: 'meteoro', chance: 0.01, message: '☄️ *Um meteoro de aura está caindo!* Primeiro a digitar *!pegar* ganha *250* de aura.', command: '!pegar', type: 'first', durationMs: 45000, effect: { type: 'aura', amount: 250 } },
  { id: 'ilusao', chance: 0.01, message: '🪞 *Uma ilusão perigosa apareceu!* Quem digitar *!tocar* *perde* *50* de aura. Só o primeiro é afetado.', command: '!tocar', type: 'first', durationMs: 40000, effect: { type: 'aura', amount: -50 } },
  { id: 'emanar', chance: 0.01, message: '🌟 *Uma aura poderosa está emanando no chat!* O primeiro a digitar *!emanar* canaliza *180* de aura.', command: '!emanar', type: 'first', durationMs: 55000, effect: { type: 'aura', amount: 180 } },
  { id: 'manifestar', chance: 0.01, message: '👁️ *Uma presença quer se manifestar no grupo!* Todos que digitarem *!manifestar* nos próximos 50 segundos recebem *60* de aura.', command: '!manifestar', type: 'all', durationMs: 50000, effect: { type: 'aura', amount: 60 } },
];

export const EVENT_COOLDOWN_MS = 2 * 60 * 1000;
export const EVENT_SPAWN_CHANCE = 0.012;
export const EVENT_CHANCE_MAX = 0.30;
export const MOG_DURATION_MS = 15000;
export const MOGNOW_COUNTDOWN_SEC = 5;
export const MOGNOW_WINDOW_MS = 15000;

// --- Helpers ---

export function formatAura(value: number | string | null | undefined): string {
  return (Number(value) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export function getTier(points: number | string | null | undefined): Tier {
  const p = Number(points) || 0;
  return TIERS.find((t) => p >= t.min) ?? LAST_TIER;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toDateStr(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  const d = new Date(val);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function drawMissions(): MissionId[] {
  return [...MISSION_IDS].sort(() => Math.random() - 0.5).slice(0, 3);
}

// --- Aura points ---

export async function addPoints(userId: string | null, amount: number): Promise<number | null> {
  return repo.incrementAuraPointsDirect(userId, amount);
}

export async function getPoints(userId: string | null): Promise<number> {
  return repo.getAuraPointsDirect(userId);
}

export async function transfer(
  fromId: string,
  toId: string,
  amount: number,
): Promise<AuraTransferResult> {
  return repo.transferAura(fromId, toId, amount);
}

// --- Daily missions ---

export async function getAuraData(userId: string): Promise<Aura | null> {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return null;
  const aura = user.aura;
  if (resetMissionsIfNeeded(aura)) {
    await repo.updateAura(userId, aura);
  }
  return aura;
}

/** Retorna `true` quando as missões foram sorteadas de novo (precisa persistir). */
export function resetMissionsIfNeeded(aura: Aura): boolean {
  const today = todayStr();
  const dm = aura.dailyMissions;

  const freshMissions = () => ({
    lastResetDate: today,
    drawnMissions: drawMissions() as string[],
    completedMissionIds: [] as string[],
    progress: {} as MissionProgress,
  });

  if (!dm || !dm.lastResetDate) {
    aura.dailyMissions = freshMissions();
    return true;
  }

  if (toDateStr(dm.lastResetDate) !== today) {
    aura.dailyMissions = freshMissions();
    return true;
  }

  if (!Array.isArray(dm.drawnMissions) || dm.drawnMissions.length === 0) {
    aura.dailyMissions = freshMissions();
    return true;
  }

  return false;
}

export async function hasMission(userId: string, missionId: MissionId): Promise<boolean> {
  const aura = await getAuraData(userId);
  if (!aura) return false;
  const { drawnMissions = [], completedMissionIds = [] } = aura.dailyMissions;
  return drawnMissions.includes(missionId) && !completedMissionIds.includes(missionId);
}

export interface MissionCompletion {
  completed: MissionId;
  reward: number;
}

export async function incrementProgress(
  userId: string,
  missionId: MissionId,
  amount = 1,
): Promise<MissionCompletion | null> {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return null;

  const aura = user.aura;
  const missionsReset = resetMissionsIfNeeded(aura);
  const dm = aura.dailyMissions;
  const cfg = MISSIONS[missionId];
  if (!cfg) {
    if (missionsReset) await repo.updateAura(userId, aura);
    return null;
  }

  const progress = dm.progress ?? {};
  const current = (Number(progress[cfg.key]) || 0) + amount;
  progress[cfg.key] = current;
  dm.progress = progress;

  if (current >= cfg.target && !(dm.completedMissionIds ?? []).includes(missionId)) {
    dm.completedMissionIds = [...(dm.completedMissionIds ?? []), missionId];
    aura.auraPoints = (Number(aura.auraPoints) || 0) + cfg.reward;
    await repo.updateAura(userId, aura);
    return { completed: missionId, reward: cfg.reward };
  }

  await repo.updateAura(userId, aura);
  return null;
}

/** Retorna a recompensa concedida (0 quando a missão já estava completa ou não existe). */
export async function completeMission(userId: string, missionId: MissionId): Promise<number> {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return 0;

  const aura = user.aura;
  const missionsReset = resetMissionsIfNeeded(aura);
  const dm = aura.dailyMissions;
  const cfg = MISSIONS[missionId];
  if (!cfg) {
    if (missionsReset) await repo.updateAura(userId, aura);
    return 0;
  }

  if ((dm.completedMissionIds ?? []).includes(missionId)) {
    if (missionsReset) await repo.updateAura(userId, aura);
    return 0;
  }

  dm.completedMissionIds = [...(dm.completedMissionIds ?? []), missionId];
  aura.auraPoints = (Number(aura.auraPoints) || 0) + cfg.reward;
  await repo.updateAura(userId, aura);
  return cfg.reward;
}

// --- Sticker / character ---

export async function setStickerData(
  userId: string,
  hash: string | null,
  dataUrl: string | null,
): Promise<void> {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return;
  user.aura.stickerHash = hash;
  user.aura.stickerDataUrl = dataUrl || null;
  await repo.updateAura(userId, user.aura);
}

export async function setCharacter(userId: string, character: string | null): Promise<void> {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return;
  user.aura.character = character;
  await repo.updateAura(userId, user.aura);
}

// --- Cooldowns ---

export async function getCooldown(
  userId: string,
  key: AuraCooldownKey,
): Promise<Aura[AuraCooldownKey] | null> {
  const aura = await getAuraData(userId);
  return aura?.[key] ?? null;
}

export async function setCooldown<K extends AuraCooldownKey>(
  userId: string,
  key: K,
  value: Aura[K],
): Promise<void> {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return;
  user.aura[key] = value;
  await repo.updateAura(userId, user.aura);
}

export async function setNegativeFarmPunished(userId: string, value: boolean): Promise<void> {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return;
  user.aura.negativeFarmPunished = value;
  await repo.updateAura(userId, user.aura);
}

// --- Random events ---

export interface ActiveEvent extends RandomEvent {
  endsAt: number;
  winnerKey: string | null;
  participants: Set<string> | null;
  timeoutId: NodeJS.Timeout;
}

export const activeEvents = new Map<string, ActiveEvent>();
const lastEventAt = new Map<string, number>();

function pickRandomEvent(): RandomEvent {
  const total = RANDOM_EVENTS.reduce((s, e) => s + (e.chance || 0), 0);
  let r = Math.random() * total;
  for (const event of RANDOM_EVENTS) {
    r -= event.chance || 0;
    if (r <= 0) return event;
  }
  return RANDOM_EVENTS[RANDOM_EVENTS.length - 1] as RandomEvent;
}

export function clearEvent(chatId: string): void {
  const state = activeEvents.get(chatId);
  if (state?.timeoutId) clearTimeout(state.timeoutId);
  activeEvents.delete(chatId);
}

export async function trySpawnEvent(sock: WASocket, chatId: string): Promise<void> {
  if (!chatId.endsWith('@g.us')) return;
  if (activeEvents.has(chatId)) return;
  const last = lastEventAt.get(chatId) ?? 0;
  if (Date.now() - last < EVENT_COOLDOWN_MS) return;
  if (Math.random() >= EVENT_SPAWN_CHANCE) return;

  const event = pickRandomEvent();
  lastEventAt.set(chatId, Date.now());

  activeEvents.set(chatId, {
    ...event,
    endsAt: Date.now() + event.durationMs,
    winnerKey: null,
    participants: event.type === 'all' ? new Set<string>() : null,
    timeoutId: setTimeout(() => clearEvent(chatId), event.durationMs + 500),
  });
  await sock.sendMessage(chatId, { text: event.message });
}

export interface AppliedEffect {
  amount: number;
  newTotal: number | null;
}

export async function applyEffect(
  effect: RandomEventEffect,
  userId: string,
): Promise<AppliedEffect> {
  const amount =
    effect.type === 'random'
      ? (effect.options[Math.floor(Math.random() * effect.options.length)] ?? 0)
      : effect.amount;
  const newTotal = await addPoints(userId, amount);
  return { amount, newTotal };
}

// --- Sticker hash from message ---

type StickerMessage = NonNullable<NonNullable<WAMessage['message']>['stickerMessage']>;

export function getStickerMsg(raw: WAMessage | null | undefined): StickerMessage | null {
  return (
    raw?.message?.stickerMessage ??
    raw?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage ??
    null
  );
}

export function getStickerHash(raw: WAMessage | null | undefined): string | null {
  const sticker = getStickerMsg(raw);
  if (!sticker) return null;
  const buf = sticker.fileSha256 || sticker.fileEncSha256;
  if (!buf) return null;
  const bytes = Buffer.isBuffer(buf) ? buf : buf instanceof Uint8Array ? Buffer.from(buf) : null;
  return bytes ? bytes.toString('base64') : null;
}

// --- Ranking ---

export type AuraRankingRow = AuraRankingEntry & { tierName: string };

export async function getRanking(limit = 10): Promise<AuraRankingRow[]> {
  const rows = await repo.getAuraRanking(limit);
  return rows.map((r) => ({ ...r, tierName: getTier(r.auraPoints).name }));
}
