import * as personalityRepo from '../../database/personalityRepository.js';

export type AiInteractionMode = 'direct' | 'proactive';

export const PROACTIVE_SKIP_TOKEN = '[SKIP]';

export const SHARED_GUARDRAILS =
  'Ainda assim não incentive crime, violência real, autolesão ou exposição de dados privados de terceiros. ' +
  'Nunca responda com JSON ou nomes de ferramentas internas. ' +
  'Escreva como mensagem de WhatsApp: frases curtas, linguagem coloquial, sem travessão longo (—), sem bullet points, sem tom de redação ou assistente virtual.';

const DEFAULT_CHARACTER =
  'Você é o Breaker Bot no WhatsApp: personalidade de participante do grupo, não de SAC nem telemarketing. ' +
  'Português do Brasil, tom despojado, pode ser sarcástico, irônico e direto. Humor e provocação leve são bem-vindos. ' +
  'Não fique repetindo dicas de comandos, !menu, !memoria ou “como posso ajudar” se ninguém pediu. ' +
  'Responda o que foi perguntado ou comentado; não encha linguiça com avisos corporativos. ' +
  'Em assuntos picantes, polêmicos ou “inapropriados”, responda com naturalidade de chat entre adultos (zoeira, opinião, deboche leve), ' +
  'sem moralizar nem dar sermão.';

const characterCache = new Map<string, { text: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function buildModeAppend(mode: AiInteractionMode): string {
  if (mode === 'proactive') {
    return (
      '\n\nModo espontâneo: você está só ouvindo o grupo. Só fale se tiver uma resposta curta e genuinamente engraçada, útil ou opinativa. ' +
      'Mensagens curtas (1 a 3 frases). Pode citar quem falou pelo nome do histórico. ' +
      `Se não tiver nada bom a acrescentar, responda exatamente só ${PROACTIVE_SKIP_TOKEN} (sem mais nada).`
    );
  }

  return (
    '\n\nModo direto: alguém te chamou ou te mandou mensagem no privado. Responda à pessoa, usando o histórico do chat quando fizer sentido. ' +
    'Se pedirem menu, figurinha, ranking ou qualquer função do bot, execute via run_bot_command; não mande a pessoa digitar !comando manualmente.'
  );
}

function composePersonality(character: string, mode: AiInteractionMode): string {
  return `${character}\n\n${SHARED_GUARDRAILS}${buildModeAppend(mode)}`;
}

async function resolveCharacterForChat(chatJid: string): Promise<string> {
  if (!chatJid.endsWith('@g.us')) {
    return DEFAULT_CHARACTER;
  }

  const cached = characterCache.get(chatJid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.text;
  }

  const assignedSlug = await personalityRepo.getGroupPersonalitySlug(chatJid);
  const slug = assignedSlug ?? 'default';
  const row = await personalityRepo.getPersonality(slug);
  const character = row?.system_prompt?.trim() || DEFAULT_CHARACTER;
  characterCache.set(chatJid, { text: character, expiresAt: Date.now() + CACHE_TTL_MS });
  return character;
}

export function invalidateGroupPersonalityCache(groupJid?: string): void {
  if (groupJid) characterCache.delete(groupJid);
  else characterCache.clear();
}

/** Personalidade efetiva (grupo customizado ou padrão). */
export async function buildPersonalityPromptForChat(
  chatJid: string,
  mode: AiInteractionMode,
): Promise<string> {
  const character = await resolveCharacterForChat(chatJid);
  return composePersonality(character, mode);
}

/** Padrão fixo (sem lookup de grupo); usado em testes e fallback. */
export function buildPersonalityPrompt(mode: AiInteractionMode): string {
  return composePersonality(DEFAULT_CHARACTER, mode);
}

export function shouldSkipProactiveReply(text: string): boolean {
  return text.trim() === PROACTIVE_SKIP_TOKEN || text.trim().startsWith(PROACTIVE_SKIP_TOKEN);
}

/** Pós-processamento para soar menos “IA” no WhatsApp. */
export function humanizeAiText(text: string): string {
  let out = text.trim();
  out = out.replace(/\s*\u2014\s*/g, ', ');
  out = out.replace(/\s*—\s*/g, ', ');
  out = out.replace(/\s*–\s*/g, ', ');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/^[\s]*[-•*]\s+/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/,\s*,/g, ',');
  return out.trim();
}
