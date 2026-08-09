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
