const repo = require('../database/repository');

// --- Config ---

const MISSION_IDS = ['messages_500', 'reactions_500', 'duel_win', 'survive_attack', 'send_media', 'help_someone'];

const MISSIONS = {
  messages_500:   { target: 50, reward: 1000, label: 'Mande 50 mensagens',             key: 'messages' },
  reactions_500:  { target: 20, reward: 2000, label: 'Reaja 20x com 💀 ou ☠️',         key: 'reactions' },
  duel_win:       { target: 1,  reward: 1000, label: 'Vença 1 duelo (!mog)',            key: 'duelWin' },
  survive_attack: { target: 1,  reward: 2000, label: 'Sobreviva a um ataque (!mognow)', key: 'surviveAttack' },
  send_media:     { target: 1,  reward: 200,  label: 'Envie mídia (figurinha/vídeo/imagem/doc)', key: 'media' },
  help_someone:   { target: 1,  reward: 100,  label: 'Ajude alguém (!respeito)',        key: 'helpSomeone' },
};

const MISSION_CONFIG = Object.fromEntries(
  Object.entries(MISSIONS).map(([id, m]) => [id, { target: m.target, reward: m.reward, label: m.label }]),
);

const TIERS = [
  { min: 50000, name: 'Deus do chat' },
  { min: 10000, name: 'Entidade' },
  { min: 5000,  name: 'Sigma' },
  { min: 2000,  name: 'Dominante' },
  { min: 500,   name: 'Presença' },
  { min: 0,     name: 'NPC' },
  { min: -Infinity, name: 'Sugador de aura ☠️' },
];

const RANDOM_EVENTS = [
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

const EVENT_COOLDOWN_MS = 2 * 60 * 1000;
const EVENT_SPAWN_CHANCE = 0.012;
const EVENT_CHANCE_MAX = 0.30;
const MOG_DURATION_MS = 15000;
const MOGNOW_COUNTDOWN_SEC = 5;
const MOGNOW_WINDOW_MS = 15000;

// --- Helpers ---

function formatAura(value) {
  return (Number(value) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function getTier(points) {
  const p = Number(points) || 0;
  return TIERS.find(t => p >= t.min) || TIERS[TIERS.length - 1];
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toDateStr(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  const d = new Date(val);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function drawMissions() {
  return [...MISSION_IDS].sort(() => Math.random() - 0.5).slice(0, 3);
}

// --- Aura points ---

async function addPoints(userId, amount) {
  return repo.incrementAuraPointsDirect(userId, amount);
}

async function getPoints(userId) {
  return repo.getAuraPointsDirect(userId);
}

async function transfer(fromId, toId, amount) {
  return repo.transferAura(fromId, toId, amount);
}

// --- Daily missions ---

async function getAuraData(userId) {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return null;
  const aura = user.aura;
  resetMissionsIfNeeded(aura);
  return aura;
}

function resetMissionsIfNeeded(aura) {
  const today = todayStr();
  const dm = aura.dailyMissions;

  if (!dm || !dm.lastResetDate) {
    aura.dailyMissions = { lastResetDate: today, drawnMissions: drawMissions(), completedMissionIds: [], progress: {} };
    return;
  }

  const lastDate = toDateStr(dm.lastResetDate);
  if (lastDate !== today) {
    aura.dailyMissions = { lastResetDate: today, drawnMissions: drawMissions(), completedMissionIds: [], progress: {} };
  }
}

async function hasMission(userId, missionId) {
  const aura = await getAuraData(userId);
  if (!aura) return false;
  const { drawnMissions = [], completedMissionIds = [] } = aura.dailyMissions;
  return drawnMissions.includes(missionId) && !completedMissionIds.includes(missionId);
}

async function incrementProgress(userId, missionId, amount = 1) {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return null;

  const aura = user.aura;
  resetMissionsIfNeeded(aura);
  const dm = aura.dailyMissions;
  const cfg = MISSIONS[missionId];
  if (!cfg) return null;

  const progress = dm.progress || {};
  progress[cfg.key] = (progress[cfg.key] || 0) + amount;
  dm.progress = progress;

  if (progress[cfg.key] >= cfg.target && !(dm.completedMissionIds || []).includes(missionId)) {
    dm.completedMissionIds = [...(dm.completedMissionIds || []), missionId];
    aura.auraPoints = (aura.auraPoints || 0) + cfg.reward;
    await repo.updateAura(userId, aura);
    return { completed: missionId, reward: cfg.reward };
  }

  await repo.updateAura(userId, aura);
  return null;
}

async function completeMission(userId, missionId) {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return 0;

  const aura = user.aura;
  resetMissionsIfNeeded(aura);
  const dm = aura.dailyMissions;
  const cfg = MISSIONS[missionId];
  if (!cfg) return 0;

  if ((dm.completedMissionIds || []).includes(missionId)) return 0;

  dm.completedMissionIds = [...(dm.completedMissionIds || []), missionId];
  aura.auraPoints = (aura.auraPoints || 0) + cfg.reward;
  await repo.updateAura(userId, aura);
  return cfg.reward;
}

// --- Sticker / character ---

async function setStickerData(userId, hash, dataUrl) {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return;
  user.aura.stickerHash = hash;
  user.aura.stickerDataUrl = dataUrl || null;
  await repo.updateAura(userId, user.aura);
}

async function setCharacter(userId, character) {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return;
  user.aura.character = character;
  await repo.updateAura(userId, user.aura);
}

// --- Cooldowns ---

async function getCooldown(userId, key) {
  const aura = await getAuraData(userId);
  return aura?.[key] ?? null;
}

async function setCooldown(userId, key, value) {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return;
  user.aura[key] = value;
  await repo.updateAura(userId, user.aura);
}

async function setNegativeFarmPunished(userId, value) {
  const user = await repo.getUserById(userId);
  if (!user?.aura) return;
  user.aura.negativeFarmPunished = value;
  await repo.updateAura(userId, user.aura);
}

// --- Random events ---

const activeEvents = new Map();
const lastEventAt = new Map();

function pickRandomEvent() {
  const total = RANDOM_EVENTS.reduce((s, e) => s + (e.chance || 0), 0);
  let r = Math.random() * total;
  for (const event of RANDOM_EVENTS) {
    r -= (event.chance || 0);
    if (r <= 0) return event;
  }
  return RANDOM_EVENTS[RANDOM_EVENTS.length - 1];
}

function clearEvent(chatId) {
  const state = activeEvents.get(chatId);
  if (state?.timeoutId) clearTimeout(state.timeoutId);
  activeEvents.delete(chatId);
}

async function trySpawnEvent(sock, chatId) {
  if (!chatId.endsWith('@g.us')) return;
  if (activeEvents.has(chatId)) return;
  const last = lastEventAt.get(chatId) || 0;
  if (Date.now() - last < EVENT_COOLDOWN_MS) return;
  if (Math.random() >= EVENT_SPAWN_CHANCE) return;

  const event = pickRandomEvent();
  lastEventAt.set(chatId, Date.now());

  const state = {
    ...event,
    endsAt: Date.now() + event.durationMs,
    winnerKey: null,
    participants: event.type === 'all' ? new Set() : null,
    timeoutId: setTimeout(() => clearEvent(chatId), event.durationMs + 500),
  };
  activeEvents.set(chatId, state);
  await sock.sendMessage(chatId, { text: event.message });
}

async function applyEffect(effect, userId) {
  const amount = effect.type === 'random'
    ? effect.options[Math.floor(Math.random() * effect.options.length)]
    : effect.amount;
  const newTotal = await addPoints(userId, amount);
  return { amount, newTotal };
}

// --- Sticker hash from message ---

function getStickerHash(raw) {
  const sticker = raw?.message?.stickerMessage || raw?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
  if (!sticker) return null;
  const buf = sticker.fileSha256 || sticker.fileEncSha256;
  if (!buf) return null;
  const bytes = Buffer.isBuffer(buf) ? buf : (buf instanceof Uint8Array ? Buffer.from(buf) : null);
  return bytes ? bytes.toString('base64') : null;
}

function getStickerMsg(raw) {
  return raw?.message?.stickerMessage || raw?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
}

// --- Ranking ---

async function getRanking(limit = 10) {
  const rows = await repo.getAuraRanking(limit);
  return rows.map(r => ({ ...r, tierName: getTier(r.auraPoints).name }));
}

module.exports = {
  MISSION_IDS, MISSION_CONFIG, MISSIONS, TIERS, RANDOM_EVENTS,
  EVENT_COOLDOWN_MS, EVENT_SPAWN_CHANCE, EVENT_CHANCE_MAX,
  MOG_DURATION_MS, MOGNOW_COUNTDOWN_SEC, MOGNOW_WINDOW_MS,
  formatAura, getTier, todayStr,
  addPoints, getPoints, transfer,
  getAuraData, hasMission, incrementProgress, completeMission,
  setStickerData, setCharacter,
  getCooldown, setCooldown, setNegativeFarmPunished,
  activeEvents, clearEvent, trySpawnEvent, applyEffect,
  getStickerHash, getStickerMsg,
  getRanking,
};
