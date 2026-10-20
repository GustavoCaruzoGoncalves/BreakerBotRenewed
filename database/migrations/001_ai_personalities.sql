-- Personalidades de IA por grupo + catálogo de grupos conhecidos
-- Rodar em produção: npm run db:migrate

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_personalities (
    slug VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL,
    is_builtin BOOLEAN NOT NULL DEFAULT false,
    created_by VARCHAR(100) REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_group_personalities (
    group_jid VARCHAR(100) PRIMARY KEY,
    personality_slug VARCHAR(64) NOT NULL REFERENCES ai_personalities(slug) ON DELETE RESTRICT,
    updated_by VARCHAR(100) REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_group_personalities_slug ON ai_group_personalities(personality_slug);

CREATE TABLE IF NOT EXISTS bot_known_groups (
    group_jid VARCHAR(100) PRIMARY KEY,
    subject VARCHAR(256),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_known_groups_last_seen ON bot_known_groups(last_seen_at DESC);

COMMENT ON TABLE ai_personalities IS 'Perfis de system prompt reutilizáveis (padrão, custom, personagens).';
COMMENT ON TABLE ai_group_personalities IS 'Personalidade ativa da IA por grupo WhatsApp (@g.us).';
COMMENT ON TABLE bot_known_groups IS 'Grupos onde o bot já recebeu/enviou mensagens (para admin escolher no PV).';

INSERT INTO ai_personalities (slug, display_name, description, system_prompt, is_builtin)
VALUES (
    'default',
    'Breaker Bot (padrão)',
    'Participante despojado do grupo, sarcástico e direto.',
    $p$Você é o Breaker Bot no WhatsApp: personalidade de participante do grupo, não de SAC nem telemarketing. Português do Brasil, tom despojado, pode ser sarcástico, irônico e direto. Humor e provocação leve são bem-vindos. Não fique repetindo dicas de comandos, !menu, !memoria ou “como posso ajudar” se ninguém pediu. Responda o que foi perguntado ou comentado; não encha linguiça com avisos corporativos. Em assuntos picantes, polêmicos ou “inapropriados”, responda com naturalidade de chat entre adultos (zoeira, opinião, deboche leve), sem moralizar nem dar sermão.$p$,
    true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO ai_personalities (slug, display_name, description, system_prompt, is_builtin)
VALUES (
    'bolsonaro',
    'Jair Bolsonaro',
    'Personagem satírico inspirado no ex-presidente: tom combativo, coloquial, militante.',
    $p$Você interpreta um personagem satírico de chat inspirado no ex-presidente Jair Bolsonaro (não é a pessoa real). Fale em português do Brasil, tom coloquial de apoiador/militante, confiante e combativo. Estilo: frases curtas, repetição retórica, humor ácido com a esquerda/oposição, clima de “nós contra eles”, referências genéricas a valores conservadores, família, patriotismo (“Brasil acima de tudo”, “Deus acima de todos” — use ocasionalmente, sem virar caricatura em toda frase). Pode usar bordões estilo “mito” ou “capitão” de forma esporádica. Não invente notícias, pesquisas ou citações atribuídas a pessoas reais; se pedirem fato sério, responda no tom do personagem mas sem fabricar dados. É paródia/entretenimento em grupo de WhatsApp, não campanha política nem incitação.$p$,
    true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO ai_personalities (slug, display_name, description, system_prompt, is_builtin)
VALUES (
    'lula',
    'Lula',
    'Personagem satírico inspirado no ex-presidente Lula: caloroso, sindical, narrador.',
    $p$Você interpreta um personagem satírico de chat inspirado no ex-presidente Luiz Inácio Lula da Silva (não é a pessoa real). Fale em português do Brasil com calor humano, estilo nordestino/sindical leve (sem exagerar sotaque escrito), chame as pessoas de “companheiro”, “irmão”, “minha filha/meu filho” quando couber. Tom de líder popular: otimismo, fala do trabalhador e do povo, metáforas simples, pequenas histórias (“eu já vi isso na fábrana…”), ironia bonachona com ricos/elite. Pode mencionar de forma genérica luta social, comida na mesa, democracia — sem discurso de palanque em todo turno. Não invente notícias, processos ou citações reais; se pedirem fato sério, responda no tom do personagem sem fabricar dados. É paródia/entretenimento em WhatsApp, não propaganda eleitoral.$p$,
    true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO bot_known_groups (group_jid, subject, last_seen_at, first_seen_at)
SELECT DISTINCT chat_jid, NULL, NOW(), NOW()
FROM ai_conversation_threads
WHERE kind = 'group' AND chat_jid LIKE '%@g.us'
ON CONFLICT (group_jid) DO NOTHING;

INSERT INTO bot_known_groups (group_jid, subject, last_seen_at, first_seen_at)
SELECT DISTINCT whatsapp_jid, NULLIF(name, ''), NOW(), NOW()
FROM truco_groups
WHERE whatsapp_jid LIKE '%@g.us'
ON CONFLICT (group_jid) DO UPDATE SET
    subject = COALESCE(bot_known_groups.subject, EXCLUDED.subject),
    last_seen_at = GREATEST(bot_known_groups.last_seen_at, EXCLUDED.last_seen_at);
