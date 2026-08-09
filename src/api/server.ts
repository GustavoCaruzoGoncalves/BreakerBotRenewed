import express from 'express';
import type { Request, Response } from 'express';
import http from 'node:http';
import cors from 'cors';
import type { CorsOptions } from 'cors';

import { config, getAdminJids, getAdminNumbers, getAllowedOrigins } from '../config.js';
import { initDatabase } from '../database/init.js';
import * as repo from '../database/repository.js';
import * as level from '../services/level.js';
import * as auraSvc from '../services/aura.js';
import * as skullService from '../games/skullcards/service.js';
import { setupSkullcardsSockets } from '../games/skullcards/socket.js';
import * as trucoRepo from '../games/truco/repository.js';
import * as trucoService from '../games/truco/service.js';
import { parseWebAction, setupTrucoSockets } from '../games/truco/socket.js';
import { getErrorMessage } from '../lib/errors.js';
import type { Aura, AuthSession, User, UsersMap } from '../database/types.js';

const {
  MISSION_IDS,
  MISSION_CONFIG,
  RANDOM_EVENTS,
  EVENT_COOLDOWN_MS,
  EVENT_SPAWN_CHANCE,
  EVENT_CHANCE_MAX,
  MOG_DURATION_MS,
  MOGNOW_COUNTDOWN_SEC,
  MOGNOW_WINDOW_MS,
  TIERS,
} = auraSvc;

const app = express();
const PORT = config.api.port;
const HOST = config.api.host;

interface AuraTierResponse {
  minPoints: number;
  name: string;
}

/** `-Infinity` não sobrevive ao JSON, então o tier de fundo vira um piso numérico. */
const AURA_TIERS: AuraTierResponse[] = [...TIERS]
  .map((t) => ({
    minPoints: t.min === -Infinity ? -999999999 : t.min,
    name: t.name,
  }))
  .sort((a, b) => b.minPoints - a.minPoints);

const LOWEST_TIER = AURA_TIERS[AURA_TIERS.length - 1] as AuraTierResponse;

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = getAllowedOrigins();
    if (allowed.includes('*')) return callback(null, true);
    callback(null, allowed.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-User-Id'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

function formatUserId(id: unknown): string {
  const s = String(id).trim();
  return s.includes('@') ? s : `${s}@s.whatsapp.net`;
}

const isUserKey = (k: string): boolean => k.includes('@');

type EnrichedUserResponse = level.EnrichedUser<User> & { progressPercent: number };

function enrichUserData(user: User | null): User | EnrichedUserResponse | null {
  if (!user?.level) return user;
  const e = level.enrichUserInfo(user);
  const nl = e.nextLevelXP || 1;
  return {
    ...e,
    progressPercent: Math.min(100, Math.round((e.progressXP / nl) * 100)),
  };
}

function getAuraTier(auraPoints: number | string | null | undefined): AuraTierResponse {
  const points = Number(auraPoints) || 0;
  for (const tier of AURA_TIERS) {
    if (points >= tier.minPoints) return tier;
  }
  return LOWEST_TIER;
}

async function findAuraUserAndBalance(requestedId: unknown) {
  return repo.getAuraUserBasicByIdOrJid(formatUserId(requestedId));
}

/** Responde 401 e devolve `null` quando a sessão do corpo é inválida. */
async function requireSession(req: Request, res: Response): Promise<AuthSession | null> {
  const token = asString(req.body?.token);
  if (!token) {
    res.status(401).json({ success: false, message: 'Token é obrigatório' });
    return null;
  }
  const session = await repo.getSession(token);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    res.status(401).json({ success: false, message: 'Sessão inválida ou expirada' });
    return null;
  }
  return session;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isAdminRequest(req: Request): boolean {
  const header = req.headers['x-user-id'];
  const raw = Array.isArray(header) ? header[0] : (header ?? req.query.adminUserId);
  if (typeof raw !== 'string' || !raw) return false;
  const admins = getAdminJids();
  if (admins.length === 0) return false;
  const normalized = raw.includes('@') ? raw : `${raw}@s.whatsapp.net`;
  return admins.includes(normalized);
}

function generateAuthCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateSessionToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

async function cleanOldBackups(): Promise<void> {
  try {
    const removed = await repo.cleanOldDeletedUsers(30);
    if (removed > 0) console.log(`[Backup Cleanup] Removidos ${removed} backups antigos`);
  } catch (e) {
    console.error('Erro ao limpar backups antigos:', e);
  }
}

void cleanOldBackups();
setInterval(() => void cleanOldBackups(), 24 * 60 * 60 * 1000);

async function cleanExpiredCodes(): Promise<void> {
  try {
    await repo.cleanExpiredAuthCodes();
  } catch (e) {
    console.error('Erro ao limpar códigos expirados:', e);
  }
}

setInterval(() => void cleanExpiredCodes(), 60 * 1000);

// --- Auth ---

app.post('/api/auth/getCode', async (req, res) => {
  try {
    const number = asString(req.body?.number);
    if (!number) {
      return res.status(400).json({ success: false, message: 'Número é obrigatório' });
    }
    const userId = formatUserId(number);
    const user = await repo.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado na base de dados',
        userId,
        exists: false,
      });
    }
    const code = generateAuthCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await repo.setAuthCode(userId, { code, expiresAt, attempts: 0 });
    const msg = `*BreakerBot - Código de Verificação*\n\nSeu código de acesso é: *${code}*\n\nEste código expira em 5 minutos.\n\n_Se você não solicitou este código, ignore esta mensagem._`;
    await repo.addPendingMessage(userId, msg);
    res.json({
      success: true,
      message: 'Código enviado para o WhatsApp',
      userId,
      expiresAt,
    });
  } catch (e) {
    console.error('Erro ao gerar código:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const number = asString(req.body?.number);
    const code = asString(req.body?.code);
    if (!number || !code) {
      return res.status(400).json({ success: false, message: 'Número e código são obrigatórios' });
    }
    const userId = formatUserId(number);
    const authData = await repo.getAuthCode(userId);
    if (!authData) {
      return res.status(404).json({
        success: false,
        message: 'Nenhum código encontrado para este número. Solicite um novo código.',
      });
    }
    if (new Date(authData.expiresAt).getTime() < Date.now()) {
      await repo.deleteAuthCode(userId);
      return res
        .status(401)
        .json({ success: false, message: 'Código expirado. Solicite um novo código.' });
    }
    if (authData.attempts >= 3) {
      await repo.deleteAuthCode(userId);
      return res.status(429).json({
        success: false,
        message: 'Muitas tentativas incorretas. Solicite um novo código.',
      });
    }
    if (authData.code !== code) {
      const updated = await repo.incrementAuthCodeAttempts(userId);
      return res.status(401).json({
        success: false,
        message: 'Código incorreto',
        attemptsRemaining: 3 - (updated?.attempts ?? 3),
      });
    }
    await repo.deleteAuthCode(userId);
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await repo.setSession(sessionToken, { userId, expiresAt });
    const user = await repo.getUserById(userId);
    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      token: sessionToken,
      userId,
      user: enrichUserData(user),
      expiresAt,
    });
  } catch (e) {
    console.error('Erro ao fazer login:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const token = asString(req.body?.token);
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token é obrigatório' });
    }
    const session = await repo.getSession(token);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Token inválido' });
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await repo.deleteSession(token);
      return res.status(401).json({ success: false, message: 'Sessão expirada' });
    }
    const user = await repo.getUserById(session.userId);
    res.json({
      success: true,
      valid: true,
      userId: session.userId,
      user: enrichUserData(user),
      expiresAt: session.expiresAt,
    });
  } catch (e) {
    console.error('Erro ao verificar token:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = asString(req.body?.token);
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token é obrigatório' });
    }
    await repo.deleteSession(token);
    res.json({ success: true, message: 'Logout realizado com sucesso' });
  } catch (e) {
    console.error('Erro ao fazer logout:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// --- Users ---

app.get('/api/users', async (_req, res) => {
  try {
    const users = await repo.getAllUsers();
    const usersArray = Object.entries(users)
      .filter(([id]) => isUserKey(id))
      .map(([id, data]) => ({ id, ...enrichUserData(data) }));
    res.json({ success: true, count: usersArray.length, users: usersArray });
  } catch (e) {
    console.error('Erro ao listar usuários:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const userId = formatUserId(req.params.id);
    const user = await repo.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado',
        userId,
        exists: false,
      });
    }
    res.json({ success: true, userId, user: enrichUserData(user) });
  } catch (e) {
    console.error('Erro ao buscar usuário:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { id, ...userData } = (req.body ?? {}) as { id?: unknown } & Record<string, unknown>;
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID do usuário é obrigatório' });
    }
    const userId = formatUserId(id);
    const existing = await repo.getUserById(userId);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Usuário já existe na base de dados',
        userId,
        existingUser: existing,
      });
    }
    const newUser = await repo.createUser(userId, userData);
    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso',
      userId,
      user: enrichUserData(newUser),
    });
  } catch (e) {
    console.error('Erro ao criar usuário:', e);
    res.status(500).json({ success: false, message: getErrorMessage(e) || 'Erro interno do servidor' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const userId = formatUserId(req.params.id);
    const existing = await repo.getUserById(userId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado', userId });
    }
    const user = await repo.updateUser(userId, req.body ?? {});
    res.json({
      success: true,
      message: 'Usuário atualizado com sucesso',
      userId,
      user: enrichUserData(user),
    });
  } catch (e) {
    console.error('Erro ao atualizar usuário:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.patch('/api/users/:id', async (req, res) => {
  try {
    const userId = formatUserId(req.params.id ?? '');
    const { aura, ...userUpdates } = (req.body ?? {}) as { aura?: unknown } & Record<
      string,
      unknown
    >;
    const user = await repo.patchUser(userId, userUpdates);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado', userId });
    }
    if (aura && typeof aura === 'object') {
      const existing = await repo.getUserById(userId);
      await repo.updateAura(userId, {
        ...(existing?.aura ?? {}),
        ...(aura as Partial<Aura>),
      } as Aura);
    }
    const updatedUser = await repo.getUserById(userId);
    res.json({
      success: true,
      message: 'Usuário atualizado parcialmente com sucesso',
      userId,
      user: enrichUserData(updatedUser),
    });
  } catch (e) {
    console.error('Erro ao atualizar usuário:', e);
    res.status(500).json({ success: false, message: getErrorMessage(e) || 'Erro interno do servidor' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const userId = formatUserId(req.params.id);
    const user = await repo.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado', userId });
    }
    const deletedUser = await repo.addDeletedUser(userId, user);
    await repo.deleteUser(userId);
    res.json({
      success: true,
      message: 'Usuário removido com sucesso. Backup criado por 30 dias.',
      userId,
      deletedUser: user,
      backupExpiresAt: deletedUser.expiresAt,
    });
  } catch (e) {
    console.error('Erro ao remover usuário:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// --- Admin / backup ---

/** Chaves reservadas que nunca representam um usuário real. */
const RESERVED_KEYS = new Set(['__auraGlobal', 'pendingMogByChat']);

function pickRealUsers(source: Record<string, unknown>): UsersMap {
  const result: UsersMap = {};
  for (const [key, val] of Object.entries(source)) {
    if (RESERVED_KEYS.has(key) || !key.includes('@')) continue;
    if (val && typeof val === 'object') result[key] = val as User;
  }
  return result;
}

app.get('/api/admin/users/export', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res
      .status(403)
      .json({ success: false, message: 'Acesso negado. Apenas administradores.' });
  }
  try {
    const users = await repo.getAllUsers();
    const exportData = pickRealUsers(users);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="users-export.json"');
    res.send(JSON.stringify(exportData, null, 2));
  } catch (e) {
    console.error('Erro ao exportar usuários:', e);
    res.status(500).json({ success: false, message: getErrorMessage(e) || 'Erro ao exportar' });
  }
});

app.post('/api/admin/users/import', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res
      .status(403)
      .json({ success: false, message: 'Acesso negado. Apenas administradores.' });
  }
  try {
    const data: unknown = req.body;
    if (!data || typeof data !== 'object') {
      return res
        .status(400)
        .json({ success: false, message: 'JSON inválido. Envie um objeto com usuários.' });
    }
    const usersData = pickRealUsers(data as Record<string, unknown>);
    await repo.saveAllUsers(usersData, { writeScope: 'all' });
    res.json({
      success: true,
      message: 'Importação concluída com sucesso',
      imported: Object.keys(usersData).length,
    });
  } catch (e) {
    console.error('Erro ao importar usuários:', e);
    res.status(500).json({ success: false, message: getErrorMessage(e) || 'Erro ao importar' });
  }
});

app.get('/api/backup/users', async (_req, res) => {
  try {
    const backups = await repo.getDeletedUsers();
    res.json({ success: true, count: backups.length, backups });
  } catch (e) {
    console.error('Erro ao listar backups:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.post('/api/backup/restore/:id', async (req, res) => {
  try {
    const userId = formatUserId(req.params.id);
    const backups = await repo.getDeletedUsers();
    const backupEntry = backups.find((u) => u.id === userId);
    if (!backupEntry) {
      return res
        .status(404)
        .json({ success: false, message: 'Usuário não encontrado no backup', userId });
    }
    const existing = await repo.getUserById(userId);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Usuário já existe na base de dados. Delete-o primeiro se quiser restaurar.',
        userId,
      });
    }
    await repo.restoreUser(userId, (backupEntry.data ?? {}) as Partial<User>);
    await repo.removeDeletedUser(userId);
    const user = await repo.getUserById(userId);
    res.json({
      success: true,
      message: 'Usuário restaurado com sucesso',
      userId,
      user,
    });
  } catch (e) {
    console.error('Erro ao restaurar usuário:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// --- Daily bonus, mentions, admins ---

app.get('/api/daily-bonus', async (_req, res) => {
  try {
    const dailyBonus = await repo.getDailyBonus();
    res.json({ success: true, dailyBonus });
  } catch (e) {
    console.error('Erro ao buscar bônus diário:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/mentions', async (_req, res) => {
  try {
    const mentions = await repo.getMentionsPreferences();
    res.json({ success: true, mentions });
  } catch (e) {
    console.error('Erro ao buscar menções:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.put('/api/mentions', async (req, res) => {
  try {
    const mentions = await repo.updateMentionsPreferences(req.body ?? {});
    res.json({ success: true, message: 'Preferências de menções atualizadas', mentions });
  } catch (e) {
    console.error('Erro ao atualizar menções:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/admins', (_req, res) => {
  try {
    const numbers = getAdminNumbers();
    if (numbers.length === 0) {
      return res.json({
        success: true,
        count: 0,
        admins: [],
        message: 'Nenhum administrador configurado no .env',
      });
    }
    const admins = numbers.map((num) => ({
      number: num,
      fullId: `${num}@s.whatsapp.net`,
    }));
    res.json({ success: true, count: admins.length, admins });
  } catch (e) {
    console.error('Erro ao buscar admins:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// --- Amigo secreto ---

app.get('/api/amigo-secreto', async (_req, res) => {
  try {
    const amigoSecreto = await repo.getAmigoSecretoAll();
    const groups = Object.entries(amigoSecreto).map(([groupId, data]) => ({
      groupId,
      groupName: data.groupName,
      participantes: data.participantes || [],
      presentes: data.presentes || {},
      nomes: data.nomes || {},
      sorteio: data.sorteio || null,
      sorteioData: data.sorteioData || null,
      totalParticipantes: (data.participantes || []).length,
      sorteioRealizado: !!data.sorteio,
    }));
    res.json({ success: true, count: groups.length, groups });
  } catch (e) {
    console.error('Erro ao buscar amigo secreto:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/amigo-secreto/user/:id', async (req, res) => {
  try {
    let searchId = (req.params.id ?? '').trim();
    if (!searchId.includes('@')) searchId = `${searchId}@s.whatsapp.net`;

    const amigoSecreto = await repo.getAmigoSecretoAll();
    const users = await repo.getAllUsers();

    const userIds = [searchId];
    const direct = users[searchId];
    if (searchId.includes('@s.whatsapp.net') && direct?.jid) {
      userIds.push(direct.jid);
    }
    for (const [otherId, userData] of Object.entries(users)) {
      if (userData.jid === searchId) userIds.push(otherId);
    }

    const userGroups = [];
    for (const [groupId, data] of Object.entries(amigoSecreto)) {
      const userIdInGroup = data.participantes?.find((p) => userIds.includes(p));
      if (!userIdInGroup) continue;

      let amigoSorteado: string | null = null;
      let presenteDoAmigo: string | null = null;
      let nomeDoAmigo: string | null = null;
      const sorteado = data.sorteio?.[userIdInGroup];
      if (sorteado) {
        amigoSorteado = sorteado;
        presenteDoAmigo = data.presentes?.[sorteado] || null;
        nomeDoAmigo = data.nomes?.[sorteado] || sorteado.split('@')[0] || sorteado;
      }

      const participantesDetalhados = (data.participantes || []).map((p) => ({
        id: p,
        nome: data.nomes?.[p] || p.split('@')[0],
        presente: data.presentes?.[p] || null,
      }));

      userGroups.push({
        groupId,
        groupName: data.groupName,
        participantes: participantesDetalhados,
        totalParticipantes: participantesDetalhados.length,
        userIdInGroup,
        meuNome: data.nomes?.[userIdInGroup] || userIdInGroup.split('@')[0],
        meuPresente: data.presentes?.[userIdInGroup] || null,
        sorteioRealizado: !!data.sorteio,
        sorteioData: data.sorteioData || null,
        amigoSorteado: amigoSorteado
          ? { id: amigoSorteado, nome: nomeDoAmigo, presente: presenteDoAmigo }
          : null,
      });
    }

    if (userGroups.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado em nenhum grupo de amigo secreto',
        searchedIds: userIds,
      });
    }
    res.json({ success: true, count: userGroups.length, searchedIds: userIds, groups: userGroups });
  } catch (e) {
    console.error('Erro ao buscar grupos do usuário:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.patch('/api/amigo-secreto/:groupId/presente', async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const { odI, presente } = (req.body ?? {}) as { odI?: unknown; presente?: unknown };
    if (!odI || presente === undefined) {
      return res
        .status(400)
        .json({ success: false, message: 'userId e presente são obrigatórios' });
    }
    let userIdFormatado = String(odI).trim();
    if (!userIdFormatado.includes('@')) userIdFormatado = `${userIdFormatado}@s.whatsapp.net`;

    const amigoSecreto = await repo.getAmigoSecretoAll();
    const group = amigoSecreto[groupId];
    if (!group) {
      return res.status(404).json({ success: false, message: 'Grupo não encontrado' });
    }
    const users = await repo.getAllUsers();

    let participantId: string | null = null;
    if (group.participantes.includes(userIdFormatado)) {
      participantId = userIdFormatado;
    } else {
      for (const pId of group.participantes) {
        if (users[pId]?.jid === userIdFormatado || users[userIdFormatado]?.jid === pId) {
          participantId = pId;
          break;
        }
      }
    }
    if (!participantId) {
      return res
        .status(404)
        .json({ success: false, message: 'Usuário não é participante deste grupo' });
    }

    const presenteText = String(presente).trim();
    await repo.updateAmigoSecretoPresente(groupId, participantId, presenteText);
    res.json({
      success: true,
      message: 'Presente atualizado com sucesso',
      groupId,
      odI: participantId,
      presente: presenteText || null,
    });
  } catch (e) {
    console.error('Erro ao atualizar presente:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// --- Aura ---

app.get('/api/aura/ranking', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? ''), 10) || 10, 100);
    const rows = await repo.getAuraRanking(limit, { onlyWithMessages: false });
    const users = await repo.getAllUsers();
    const ranking = rows.map((row) => {
      const data = users[row.userId];
      const fallbackName = row.userId.split('@')[0] ?? row.userId;
      return {
        userId: row.userId,
        auraPoints: row.auraPoints,
        tierName: getAuraTier(row.auraPoints).name,
        displayName:
          (data && (data.customNameEnabled && data.customName
            ? data.customName
            : data.pushName || fallbackName)) || fallbackName,
        character: data?.aura?.character ?? null,
      };
    });
    res.json({ success: true, limit, ranking, tiers: AURA_TIERS });
  } catch (e) {
    console.error('Erro ao buscar ranking de aura:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

const EMPTY_AURA: Aura = {
  auraPoints: 0,
  stickerHash: null,
  stickerDataUrl: null,
  character: null,
  dailyMissions: {
    lastResetDate: null,
    drawnMissions: [],
    completedMissionIds: [],
    progress: { messages: 0, reactions: 0, duelWin: 0, surviveAttack: 0, media: 0, helpSomeone: 0 },
  },
  lastRitualDate: null,
  lastTreinarAt: null,
  lastDominarAt: null,
  negativeFarmPunished: false,
};

app.get('/api/aura/users/:id', async (req, res) => {
  try {
    const { userId, user } = await findAuraUserAndBalance(req.params.id);
    if (!user || !userId) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado',
        userId: formatUserId(req.params.id),
      });
    }
    const aura = user.aura ?? EMPTY_AURA;
    const tier = getAuraTier(aura.auraPoints ?? 0);
    const displayName =
      user.customNameEnabled && user.customName
        ? user.customName
        : user.pushName || userId.split('@')[0];
    const praisedBy = await repo.getWhoPraised(userId);
    res.json({
      success: true,
      userId,
      displayName,
      aura: {
        auraPoints: aura.auraPoints ?? 0,
        stickerHash: aura.stickerHash ?? null,
        stickerDataUrl: aura.stickerDataUrl ?? null,
        character: aura.character ?? null,
        hasStickerHash: !!aura.stickerHash,
        dailyMissions: aura.dailyMissions ?? null,
        lastRitualDate: aura.lastRitualDate ?? null,
        lastTreinarAt: aura.lastTreinarAt ?? null,
        lastDominarAt: aura.lastDominarAt ?? null,
        tierName: tier.name,
        tierMinPoints: tier.minPoints,
      },
      praisedBy,
      profile: {
        pushName: user.pushName ?? null,
        customName: user.customName ?? null,
        customNameEnabled: !!user.customNameEnabled,
      },
    });
  } catch (e) {
    console.error('Erro ao buscar aura do usuário:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/aura/tiers', (_req, res) => {
  res.json({ success: true, tiers: AURA_TIERS });
});

app.get('/api/aura/config', (_req, res) => {
  res.json({
    success: true,
    tiers: AURA_TIERS,
    missionIds: MISSION_IDS,
    missionConfig: MISSION_CONFIG,
    randomEvents: RANDOM_EVENTS,
    eventSpawnChance: EVENT_SPAWN_CHANCE,
    eventCooldownMs: EVENT_COOLDOWN_MS,
    eventChanceMax: EVENT_CHANCE_MAX,
    mogDurationMs: MOG_DURATION_MS,
    mognowCountdownSec: MOGNOW_COUNTDOWN_SEC,
    mognowWindowMs: MOGNOW_WINDOW_MS,
  });
});

app.get('/api/aura/global', async (_req, res) => {
  try {
    const global = await repo.getAuraGlobal();
    res.json({ success: true, pendingMogByChat: global.pendingMogByChat ?? {} });
  } catch (e) {
    console.error('Erro ao buscar dados globais de aura:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/aura/praised', async (_req, res) => {
  try {
    const praised = await repo.getAllPraised();
    res.json({ success: true, praised });
  } catch (e) {
    console.error('Erro ao buscar praised:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

interface SlotSymbol {
  id: string;
  emoji: string;
  weight: number;
  pay: number[];
}

const SLOT_SYMBOLS: SlotSymbol[] = [
  { id: 'fire', emoji: '🔥', weight: 5, pay: [0, 1, 5, 20] },
  { id: 'crystal', emoji: '✨', weight: 4, pay: [0, 2, 3, 15] },
  { id: 'star', emoji: '🌟', weight: 3, pay: [0, 3, 4, 10] },
  { id: 'diamond', emoji: '💎', weight: 2, pay: [0, 5, 20, 50] },
  { id: 'god', emoji: '👑', weight: 1, pay: [0, 10, 50, 100] },
  { id: 'wild', emoji: '💀', weight: 2, pay: [0, 0, 0, 0] },
];

type Reel = [SlotSymbol, SlotSymbol, SlotSymbol];
type Reels = [Reel, Reel, Reel];

function pickRandomSymbol(): SlotSymbol {
  const totalWeight = SLOT_SYMBOLS.reduce((s, sym) => s + sym.weight, 0);
  let r = Math.random() * totalWeight;
  for (const sym of SLOT_SYMBOLS) {
    r -= sym.weight;
    if (r <= 0) return sym;
  }
  return SLOT_SYMBOLS[0] as SlotSymbol;
}

/** Três linhas horizontais; `wild` (💀) completa qualquer combinação e três wilds pagam 50x. */
function calcSlotWin(reels: Reels, bet: number): number {
  const [c0, c1, c2] = reels;
  let totalWin = 0;
  const lines: Reel[] = [
    [c0[0], c1[0], c2[0]],
    [c0[1], c1[1], c2[1]],
    [c0[2], c1[2], c2[2]],
  ];
  for (const [a, b, c] of lines) {
    const isWild = (s: SlotSymbol): boolean => s.id === 'wild';
    const syms = [a, b, c].filter((x) => !isWild(x));
    const wilds = [a, b, c].filter(isWild).length;
    if (syms.length === 0) {
      totalWin += bet * 50;
      continue;
    }
    const sym = syms[0] as SlotSymbol;
    const count = syms.filter((s) => s.id === sym.id).length + wilds;
    if (count === 3) totalWin += bet * (sym.pay[3] ?? 0);
  }
  return totalWin;
}

app.post('/api/aura/slot', async (req, res) => {
  try {
    const token = asString(req.body?.token);
    const bet: unknown = req.body?.bet;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token é obrigatório' });
    }
    const session = await repo.getSession(token);
    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada' });
    }
    const {
      userId: dbUserId,
      balance,
      exists,
    } = await repo.getAuraBalanceByUserIdOrJid(session.userId);
    if (!exists) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    const betAmount = Math.floor(Number(bet) || 0);
    if (betAmount < 1) {
      return res.status(400).json({ success: false, message: 'Aposta mínima: 1 aura' });
    }
    if (balance < betAmount) {
      return res.status(400).json({ success: false, message: 'Saldo insuficiente', balance });
    }
    const reels: Reels = [
      [pickRandomSymbol(), pickRandomSymbol(), pickRandomSymbol()],
      [pickRandomSymbol(), pickRandomSymbol(), pickRandomSymbol()],
      [pickRandomSymbol(), pickRandomSymbol(), pickRandomSymbol()],
    ];
    const winAmount = calcSlotWin(reels, betAmount);
    const netChange = winAmount - betAmount;
    const updateResult = await repo.applyAuraDeltaReturningBalance(dbUserId, netChange, betAmount);
    if (!updateResult.ok) {
      if (updateResult.reason === 'insufficient_balance') {
        return res.status(400).json({ success: false, message: 'Saldo insuficiente', balance });
      }
      console.error('[slot] applyAuraDeltaReturningBalance falhou', dbUserId, updateResult.reason);
      return res.status(500).json({ success: false, message: 'Erro ao atualizar aura' });
    }
    res.json({
      success: true,
      reels: reels.map((col) => col.map((s) => ({ id: s.id, emoji: s.emoji }))),
      bet: betAmount,
      win: winAmount,
      netChange,
      balance: updateResult.balance,
    });
  } catch (e) {
    console.error('Erro no slot:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.post('/api/aura/game-reward', async (req, res) => {
  try {
    const token = asString(req.body?.token);
    const game: unknown = req.body?.game;
    const score: unknown = req.body?.score;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token é obrigatório' });
    }
    if (!game) {
      return res.status(400).json({ success: false, message: 'Dados inválidos' });
    }
    const scoreNum = Number(score);
    if (Number.isNaN(scoreNum)) {
      return res.status(400).json({ success: false, message: 'Dados inválidos' });
    }
    const session = await repo.getSession(token);
    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada' });
    }
    const {
      userId: dbUserId,
      user,
      balance: initialBalance,
    } = await repo.getAuraUserBasicByIdOrJid(session.userId);
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: 'Usuário não encontrado no sistema de aura' });
    }
    const reward = Math.floor(scoreNum);
    let finalBalance: number | null = initialBalance;
    if (reward !== 0) {
      const result = await repo.applyAuraDeltaReturningBalance(dbUserId, reward, 0);
      if (!result.ok) {
        console.error('[game-reward] applyAuraDeltaReturningBalance falhou', dbUserId, result.reason);
        return res.status(500).json({ success: false, message: 'Erro ao atualizar aura' });
      }
      finalBalance = result.balance;
    }
    res.json({ success: true, reward, balance: finalBalance });
  } catch (e) {
    console.error('Erro no game-reward:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// --- Health & docs ---

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    status: 'online',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'BreakerBot API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/getCode': 'Solicita código de verificação (body: { number })',
        'POST /api/auth/login': 'Faz login com código (body: { number, code })',
        'POST /api/auth/verify': 'Verifica se token é válido (body: { token })',
        'POST /api/auth/logout': 'Encerra sessão (body: { token })',
      },
      users: {
        'GET /api/users': 'Lista todos os usuários',
        'GET /api/users/:id': 'Busca usuário específico',
        'POST /api/users': 'Cria novo usuário',
        'PUT /api/users/:id': 'Atualiza usuário (completo)',
        'PATCH /api/users/:id': 'Atualiza usuário (parcial)',
        'DELETE /api/users/:id': 'Remove usuário (com backup)',
      },
      backup: {
        'GET /api/backup/users': 'Lista usuários deletados',
        'POST /api/backup/restore/:id': 'Restaura usuário do backup',
      },
      dailyBonus: { 'GET /api/daily-bonus': 'Retorna dados do bônus diário' },
      mentions: {
        'GET /api/mentions': 'Retorna preferências de menções',
        'PUT /api/mentions': 'Atualiza preferências de menções',
      },
      admins: { 'GET /api/admins': 'Lista administradores' },
      amigoSecreto: {
        'GET /api/amigo-secreto': 'Lista todos os grupos de amigo secreto',
        'GET /api/amigo-secreto/user/:id':
          'Lista grupos do usuário (aceita @s.whatsapp.net ou @lid)',
        'PATCH /api/amigo-secreto/:groupId/presente':
          'Atualiza presente desejado do usuário no grupo',
      },
      aura: {
        'GET /api/aura/ranking': 'Ranking de aura (query: limit, default 10)',
        'GET /api/aura/users/:id': 'Dados de aura do usuário',
        'GET /api/aura/tiers': 'Lista níveis de aura',
        'GET /api/aura/config': 'Config completa (missões, eventos, mog)',
        'GET /api/aura/global': 'Dados globais de aura (pendingMogByChat)',
        'GET /api/aura/praised': 'Mapa de elogios',
        'POST /api/aura/slot': 'Slot machine (body: { token, bet })',
        'POST /api/aura/game-reward': 'Recompensa de jogo (body: { token, game, score })',
      },
      skullcards: {
        'POST /api/skullcards/rooms': 'Cria sala (body: { token, isPublic? })',
        'POST /api/skullcards/rooms/:roomId/join': 'Entra na sala',
        'GET /api/skullcards/rooms-public': 'Lista salas públicas',
        'POST /api/skullcards/rooms/:roomId/start': 'Inicia partida',
        'GET /api/skullcards/rooms/:roomId': 'Detalhes da sala',
        'GET /api/skullcards/matches/:matchId/state': 'Estado da partida',
      },
      truco: {
        'GET /api/truco/ranking': 'Ranking global (query: limit)',
        'GET /api/truco/groups': 'Grupos com Truco habilitado',
        'GET /api/truco/groups/:groupId/ranking': 'Ranking do grupo (query: limit)',
        'GET /api/truco/groups/:groupId/match': 'Partida em aberto do grupo',
        'GET /api/truco/stats/:userId': 'Estatísticas do jogador',
        'GET /api/truco/matches/:matchId': 'Estado público da partida',
        'POST /api/truco/matches/:matchId/state': 'Estado com a própria mão (body: { token })',
        'POST /api/truco/matches/:matchId/action':
          'Executa ação (body: { token, action, cardSlot?, level? })',
      },
      health: { 'GET /api/health': 'Status da API' },
    },
  });
});

// --- Skullcards ---

app.post('/api/skullcards/rooms', async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;
    const isPublic = Boolean((req.body ?? {}).isPublic);
    const room = await skullService.createRoomForUser(session.userId, isPublic);
    res.status(201).json({ success: true, room });
  } catch (e) {
    console.error('[SkullCards] criar sala:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.post('/api/skullcards/rooms/:roomId/join', async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;
    const resolvedRoomId = await skullService.resolveRoomIdFromCodeOrId(req.params.roomId);
    if (!resolvedRoomId) {
      return res.status(404).json({ success: false, message: 'Sala não encontrada' });
    }
    const room = await skullService.joinRoom(resolvedRoomId, session.userId);
    res.json({ success: true, room });
  } catch (e) {
    console.error('[SkullCards] entrar:', e);
    const reason = getErrorMessage(e);
    if (reason === 'room_not_found') {
      return res.status(404).json({ success: false, message: 'Sala não encontrada' });
    }
    if (reason === 'room_not_in_lobby') {
      return res.status(400).json({ success: false, message: 'Sala já iniciou uma partida' });
    }
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/skullcards/rooms-public', async (_req, res) => {
  try {
    const rooms = await skullService.listPublicRooms();
    res.json({ success: true, rooms });
  } catch (e) {
    console.error('[SkullCards] salas públicas:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.post('/api/skullcards/rooms/:roomId/start', async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;
    const roomId = req.params.roomId;
    const room = await skullService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Sala não encontrada' });
    }
    if (room.host_user_id !== session.userId) {
      return res
        .status(403)
        .json({ success: false, message: 'Apenas o host pode iniciar a partida' });
    }
    const matchInfo = await skullService.startMatch(roomId);
    res.json({ success: true, match: matchInfo });
  } catch (e) {
    console.error('[SkullCards] iniciar:', e);
    const reason = getErrorMessage(e);
    if (reason === 'room_not_found') {
      return res.status(404).json({ success: false, message: 'Sala não encontrada' });
    }
    if (reason === 'room_not_in_lobby') {
      return res.status(400).json({ success: false, message: 'Sala já iniciou uma partida' });
    }
    if (reason === 'not_enough_players') {
      return res.status(400).json({ success: false, message: 'É necessário pelo menos 2 jogadores' });
    }
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/skullcards/rooms/:roomId', async (req, res) => {
  try {
    const room = await skullService.getRoom(req.params.roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Sala não encontrada' });
    }
    res.json({ success: true, room });
  } catch (e) {
    console.error('[SkullCards] buscar sala:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

app.get('/api/skullcards/matches/:matchId/state', async (req, res) => {
  try {
    const state = await skullService.getMatchState(req.params.matchId);
    if (!state) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }
    res.json({ success: true, state });
  } catch (e) {
    console.error('[SkullCards] estado:', e);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// --- Truco ---

function trucoError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, message });
}

function parsedLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : fallback;
}

app.get('/api/truco/ranking', async (req, res) => {
  try {
    const ranking = await trucoRepo.getGlobalRanking(parsedLimit(req.query.limit, 10));
    res.json({ success: true, ranking });
  } catch (e) {
    console.error('[Truco] ranking global:', e);
    trucoError(res, 500, 'Erro interno do servidor');
  }
});

app.get('/api/truco/groups', async (_req, res) => {
  try {
    res.json({ success: true, groups: await trucoRepo.listGroups() });
  } catch (e) {
    console.error('[Truco] grupos:', e);
    trucoError(res, 500, 'Erro interno do servidor');
  }
});

app.get('/api/truco/groups/:groupId/ranking', async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!Number.isInteger(groupId)) return trucoError(res, 400, 'groupId inválido');
    const ranking = await trucoRepo.getGroupRanking(groupId, parsedLimit(req.query.limit, 10));
    res.json({ success: true, ranking });
  } catch (e) {
    console.error('[Truco] ranking do grupo:', e);
    trucoError(res, 500, 'Erro interno do servidor');
  }
});

app.get('/api/truco/groups/:groupId/match', async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!Number.isInteger(groupId)) return trucoError(res, 400, 'groupId inválido');

    const match = await trucoRepo.findOpenMatchByGroupId(groupId);
    if (!match) return trucoError(res, 404, 'Nenhuma partida em aberto');

    res.json({
      success: true,
      match: {
        matchId: match.match_id,
        status: match.status,
        mode: match.mode,
        lobby: match.lobby_json,
        state: match.state_json ? trucoService.redactStateForUser(match.state_json, null) : null,
      },
    });
  } catch (e) {
    console.error('[Truco] partida do grupo:', e);
    trucoError(res, 500, 'Erro interno do servidor');
  }
});

app.get('/api/truco/stats/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const [global, aura] = await Promise.all([
      trucoRepo.getUserStats(userId),
      trucoRepo.getAuraPoints(userId),
    ]);
    res.json({ success: true, stats: { ...global, aura_points: aura } });
  } catch (e) {
    console.error('[Truco] estatísticas:', e);
    trucoError(res, 500, 'Erro interno do servidor');
  }
});

app.get('/api/truco/matches/:matchId', async (req, res) => {
  try {
    const match = await trucoRepo.findMatchById(req.params.matchId);
    if (!match) return trucoError(res, 404, 'Partida não encontrada');
    res.json({
      success: true,
      match: {
        matchId: match.match_id,
        status: match.status,
        mode: match.mode,
        winnerTeam: match.winner_team,
        lobby: match.lobby_json,
        state: match.state_json ? trucoService.redactStateForUser(match.state_json, null) : null,
      },
    });
  } catch (e) {
    console.error('[Truco] partida:', e);
    trucoError(res, 500, 'Erro interno do servidor');
  }
});

app.post('/api/truco/matches/:matchId/state', async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const match = await trucoRepo.findMatchById(req.params.matchId);
    if (!match) return trucoError(res, 404, 'Partida não encontrada');

    res.json({
      success: true,
      match: {
        matchId: match.match_id,
        status: match.status,
        mode: match.mode,
        winnerTeam: match.winner_team,
        lobby: match.lobby_json,
        state: match.state_json
          ? trucoService.redactStateForUser(match.state_json, session.userId)
          : null,
      },
    });
  } catch (e) {
    console.error('[Truco] estado da partida:', e);
    trucoError(res, 500, 'Erro interno do servidor');
  }
});

app.post('/api/truco/matches/:matchId/action', async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const action = parseWebAction(req.body ?? {});
    if (!action) return trucoError(res, 400, 'Ação inválida');

    const result = await trucoService.applyWebAction(
      req.params.matchId,
      session.userId,
      action,
    );
    if (!result.ok) return trucoError(res, result.status, result.error);

    res.json({
      success: true,
      state: trucoService.redactStateForUser(result.state, session.userId),
    });
  } catch (e) {
    console.error('[Truco] ação:', e);
    trucoError(res, 500, 'Erro interno do servidor');
  }
});

async function start(): Promise<void> {
  const ok = await initDatabase();
  if (!ok) console.warn('[DB] Init falhou — recursos que dependem do banco podem falhar.');

  const server = http.createServer(app);
  const io = setupSkullcardsSockets(server, getAllowedOrigins());
  setupTrucoSockets(io);

  server.listen(PORT, HOST, () => {
    console.log(`[API] http://${HOST}:${PORT}  (BreakerBot)`);
  });
}

void start();

export default app;
