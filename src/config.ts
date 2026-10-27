import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WABrowserDescription, WAVersion } from '@whiskeysockets/baileys';

/**
 * Raiz do projeto: `src/` em desenvolvimento (tsx) e `dist/` após o build,
 * ambos um nível abaixo da raiz.
 */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function projectPath(...segments: string[]): string {
  return path.join(PROJECT_ROOT, ...segments);
}

const TRUTHY_VALUES = ['1', 'true', 'yes', 'on', 'sim'];

function parseBoolean(value: string | undefined): boolean {
  return TRUTHY_VALUES.includes((value ?? '').trim().toLowerCase());
}

/** Converte "5511999,5511888" em JIDs completos do WhatsApp. */
function parseAdmins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => `${n}@s.whatsapp.net`);
}

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

export interface AuraConfig {
  enabled: boolean;
}

export interface BaileysConfig {
  /** Fallback caso `fetchLatestBaileysVersion` falhe; o bot busca a versão atual em runtime. */
  version: WAVersion;
  browser: WABrowserDescription;
}

export interface ApiConfig {
  port: number;
  host: string;
}

export interface OpenCodeConfig {
  enabled: boolean;
  baseUrl: string;
  username: string;
  password: string;
  agent: string;
  modelProvider: string;
  modelId: string;
  timeoutMs: number;
  /** Tempo sem @ após menção/resposta ao bot antes de expirar a thread de conversa. */
  conversationThreadTtlMs: number;
  /** Envia imagem, figurinha e vídeo curto ao modelo multimodal. */
  visionEnabled: boolean;
  visionMaxBytes: number;
  visionVideoMaxBytes: number;
  /** Ferramentas habilitadas para usuários comuns (pesquisa/leitura). */
  publicTools: Record<string, boolean>;
  /** Ferramentas extras só para administradores (ex.: shell). */
  adminTools: Record<string, boolean>;
}

export interface AgentDbConfig {
  enabled: boolean;
}

export interface MemoryConfig {
  enabled: boolean;
  shortTermLimit: number;
  groupContextLimit: number;
  personalMemoryLimit: number;
  maxMessageChars: number;
  /** Inclui memória pessoal persistida nas respostas do !gpt. */
  shareContextInGpt: boolean;
}

export interface TrucoConfig {
  /** Defaults usados quando o grupo não tem override em `truco_group_settings`. */
  turnTimeoutSeconds: number;
  lobbyTimeoutSeconds: number;
  /** Aura creditada/debitada na tabela `aura` ao fim de cada partida. */
  auraBaseWin: number;
  auraPerHandPoint: number;
  auraLoss: number;
}

export interface BotConfig {
  db: DatabaseConfig;
  admins: string[];
  aura: AuraConfig;
  baileys: BaileysConfig;
  api: ApiConfig;
  truco: TrucoConfig;
  opencode: OpenCodeConfig;
  memory: MemoryConfig;
  agentDb: AgentDbConfig;
}

function parseToolMap(value: string | undefined, fallback: Record<string, boolean>): Record<string, boolean> {
  const raw = (value ?? '').trim();
  if (!raw) return fallback;
  const out: Record<string, boolean> = {};
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;
    if (token.startsWith('!')) {
      out[token.slice(1)] = false;
    } else {
      out[token] = true;
    }
  }
  return Object.keys(out).length > 0 ? out : fallback;
}

export const config: BotConfig = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'breakerbot',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },
  admins: parseAdmins(process.env.ADMINS),
  aura: {
    enabled: parseBoolean(process.env.AURA_ENABLED),
  },
  baileys: {
    version: [2, 3000, 1035194821],
    browser: ['Mac OS', 'Safari', '18.0'],
  },
  api: {
    port: Number(process.env.API_PORT ?? 3001),
    host: process.env.API_HOST ?? '0.0.0.0',
  },
  truco: {
    turnTimeoutSeconds: Number(process.env.TRUCO_TURN_TIMEOUT_SECONDS ?? 120),
    lobbyTimeoutSeconds: Number(process.env.TRUCO_LOBBY_TIMEOUT_SECONDS ?? 60),
    auraBaseWin: 20,
    auraPerHandPoint: 2,
    auraLoss: 15,
  },
  opencode: {
    enabled: parseBoolean(process.env.OPENCODE_ENABLED),
    baseUrl: (process.env.OPENCODE_BASE_URL ?? 'http://127.0.0.1:4096').replace(/\/$/, ''),
    username: process.env.OPENCODE_SERVER_USERNAME ?? process.env.OPENCODE_USERNAME ?? 'opencode',
    password: process.env.OPENCODE_SERVER_PASSWORD ?? process.env.OPENCODE_PASSWORD ?? '',
    agent: process.env.OPENCODE_AGENT ?? 'general',
    modelProvider: process.env.OPENCODE_MODEL_PROVIDER ?? '',
    modelId: process.env.OPENCODE_MODEL ?? process.env.OPENCODE_MODEL_ID ?? '',
    timeoutMs: Number(process.env.OPENCODE_TIMEOUT_MS ?? 120_000),
    conversationThreadTtlMs: Number(process.env.OPENCODE_CONVERSATION_THREAD_TTL_MS ?? 900_000),
    visionEnabled: parseBoolean(process.env.OPENCODE_VISION_ENABLED ?? 'true'),
    visionMaxBytes: Number(process.env.OPENCODE_VISION_MAX_BYTES ?? 5 * 1024 * 1024),
    visionVideoMaxBytes: Number(process.env.OPENCODE_VISION_VIDEO_MAX_BYTES ?? 20 * 1024 * 1024),
    publicTools: parseToolMap(process.env.OPENCODE_PUBLIC_TOOLS, {
      websearch: true,
      webfetch: true,
      read: true,
    }),
    adminTools: parseToolMap(process.env.OPENCODE_ADMIN_TOOLS, {
      websearch: true,
      webfetch: true,
      read: true,
      bash: true,
      edit: true,
      write: true,
    }),
  },
  agentDb: {
    enabled: parseBoolean(process.env.AI_AGENT_DB_ENABLED ?? 'true'),
  },
  memory: {
    enabled: parseBoolean(process.env.AI_MEMORY_ENABLED ?? process.env.MEMORY_ENABLED ?? 'true'),
    shortTermLimit: Number(process.env.AI_MEMORY_SHORT_TERM_LIMIT ?? 40),
    groupContextLimit: Number(process.env.AI_MEMORY_GROUP_CONTEXT_LIMIT ?? 25),
    personalMemoryLimit: Number(process.env.AI_MEMORY_PERSONAL_LIMIT ?? 20),
    maxMessageChars: Number(process.env.AI_MEMORY_MAX_MESSAGE_CHARS ?? 4000),
    shareContextInGpt: parseBoolean(process.env.AI_MEMORY_IN_GPT ?? 'true'),
  },
};

/** Relido a cada chamada para permitir troca de admins sem reiniciar a API. */
export function getAdminJids(): string[] {
  return parseAdmins(process.env.ADMINS);
}

/** Números crus configurados em ADMINS, sem o sufixo de JID. */
export function getAdminNumbers(): string[] {
  return (process.env.ADMINS ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
}

export function getAllowedOrigins(): string[] {
  const origins = process.env.CORS_ORIGINS;
  if (origins) return origins.split(',').map((o) => o.trim());
  return ['http://localhost:3000', 'http://localhost:3001'];
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/** Chaves de API dos provedores de IA, resolvidas em runtime pelo `lib/chatai`. */
export type AiApiKeyEnv = 'OPENAI_API_KEY' | 'ZHIPU_API_KEY' | 'XAI_API_KEY';

export function getAiApiKey(name: AiApiKeyEnv): string | undefined {
  return process.env[name];
}

export const optionalEnv = {
  geniusApiKey: (): string | undefined => process.env.GENIUS_API_KEY,
  openAiApiKey: (): string | undefined => process.env.OPENAI_API_KEY,
  pedraoNumber: (): string => process.env.PEDRAO_NUMBER ?? '',
  pintoMessage: (): string | undefined => process.env.PINTO_MESSAGE,
  rankingGayMessages: (): Array<string | undefined> => [
    process.env.RANKING_GAY_MESSAGE_1,
    process.env.RANKING_GAY_MESSAGE_2,
    process.env.RANKING_GAY_MESSAGE_3,
  ],
} as const;

export default config;
