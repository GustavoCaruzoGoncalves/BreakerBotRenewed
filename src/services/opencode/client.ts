import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';
import type { Part } from '@opencode-ai/sdk';
import { config } from '../../config.js';

let cachedClient: OpencodeClient | null = null;

function authFetch(username: string, password: string): typeof fetch {
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (password) {
      headers.set('Authorization', `Basic ${token}`);
    }
    return fetch(input, { ...init, headers });
  };
}

export function getOpencodeClient(override?: OpencodeClient): OpencodeClient {
  if (override) return override;
  if (cachedClient) return cachedClient;

  const { opencode: oc } = config;
  cachedClient = createOpencodeClient({
    baseUrl: oc.baseUrl,
    responseStyle: 'fields',
    throwOnError: false,
    fetch: authFetch(oc.username, oc.password),
  });
  return cachedClient;
}

export function resetOpencodeClientForTests(): void {
  cachedClient = null;
}

export async function checkOpencodeHealth(): Promise<boolean> {
  const { opencode: oc } = config;
  const headers: Record<string, string> = {};
  if (oc.password) {
    const token = Buffer.from(`${oc.username}:${oc.password}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  const res = await fetch(`${oc.baseUrl}/global/health`, { headers });
  if (!res.ok) return false;
  const data = (await res.json()) as { healthy?: boolean };
  return Boolean(data.healthy);
}

export function extractTextFromParts(parts: Part[] | undefined): string {
  if (!parts?.length) return '';
  const chunks: string[] = [];
  for (const part of parts) {
    if (part && typeof part === 'object' && 'type' in part) {
      if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout após ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
