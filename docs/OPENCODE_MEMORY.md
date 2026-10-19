# OpenCode + memória persistente (BreakerBot)

## Visão geral

- **WhatsApp (Baileys)** → `router` → memória PostgreSQL + **`!opencode` / `!gpt`** → **OpenCode Server** (HTTP).
- A memória da aplicação fica no **PostgreSQL** (`ai_*`). A sessão OpenCode é apenas transporte reutilizável (`ai_opencode_sessions`).
- Histórico de **DM** e de cada **grupo** ficam isolados; memórias pessoais usam o **`user_id` canônico**.

## OpenCode Server

1. Instale o CLI OpenCode: [opencode.ai](https://opencode.ai/docs/server/)
2. Inicie o servidor (processo separado do bot):

```bash
OPENCODE_SERVER_PASSWORD=sua-senha-segura opencode serve --hostname 127.0.0.1 --port 4096
```

3. Se o bot rodar em outro host/container, use o IP/hostname alcançável em `OPENCODE_BASE_URL` (não use `localhost` do container do bot se o OpenCode estiver na máquina host).

4. Valide:

```bash
curl -u opencode:sua-senha-segura http://127.0.0.1:4096/global/health
```

## Variáveis de ambiente

| Variável | Descrição | Default |
| --- | --- | --- |
| `OPENCODE_ENABLED` | Habilita `!opencode` | `false` |
| `OPENCODE_BASE_URL` | URL do servidor | `http://127.0.0.1:4096` |
| `OPENCODE_SERVER_USERNAME` | Basic auth user | `opencode` |
| `OPENCODE_SERVER_PASSWORD` | Basic auth password | _(vazio)_ |
| `OPENCODE_AGENT` | Agente OpenCode | `general` |
| `OPENCODE_MODEL_PROVIDER` | Provider ID (opcional) | _(vazio)_ |
| `OPENCODE_MODEL` | Model ID (opcional) | _(vazio)_ |
| `OPENCODE_TIMEOUT_MS` | Timeout das requisições | `120000` |
| `OPENCODE_PUBLIC_TOOLS` | Ferramentas para usuários comuns (csv, prefixo `!` desliga) | websearch, webfetch, read |
| `OPENCODE_ADMIN_TOOLS` | Ferramentas para ADMINS | inclui bash/edit/write |
| `AI_MEMORY_ENABLED` | Persistência de mensagens/memórias | `true` |
| `AI_MEMORY_IN_GPT` | Injeta memória no `!gpt` | `true` |
| `AI_MEMORY_SHORT_TERM_LIMIT` | Mensagens recentes por thread | `40` |
| `AI_MEMORY_PERSONAL_LIMIT` | Memórias pessoais no prompt | `20` |

## Pesquisa na web

Depende das **ferramentas/agente** configurados no OpenCode (ex.: `websearch`, `webfetch`). Ajuste `OPENCODE_PUBLIC_TOOLS` e o agente em `OPENCODE_AGENT` conforme a instalação (`GET /experimental/tool/ids` no servidor).

## Ferramentas de banco (Agent DB)

Com `AI_AGENT_DB_ENABLED=true`, o OpenCode usa um plano estruturado em duas etapas:

1. Decide quais ferramentas de leitura chamar (`get_my_level_stats`, rankings, etc.).
2. O **backend** executa SQL parametrizado com autorização (DM/grupo, consentimento, menções).

Ferramentas disponíveis: `get_my_level_stats`, `get_my_badges`, `get_my_aura`, `get_my_missions`, `get_my_preferences`, `get_my_level_history`, `get_my_truco_stats`, `get_level_ranking`, `get_aura_ranking`, `get_truco_ranking`, `get_mentioned_user_public_stats`, `lookup_users_public`, `get_user_extended_stats`.

Consentimento: `!consentir aprovar` / `negar` / `revogar`.

Comandos diretos (mesma camada): `!meusdados`, `!meunivel`, `!minhasaura`, `!meuranking`.

| Variável | Default |
| --- | --- |
| `AI_AGENT_DB_ENABLED` | `true` |

## Comandos

- `!opencode` / `!oc` — agente OpenCode com memória + web (requer `OPENCODE_ENABLED=true`).
- `!resetOpencode` — reset da sessão OpenCode do chat (admin).
- `!memoria` — ajuda e listagem das memórias pessoais.
- `!memoria off` / `!memoria on`
- `!esquecer` — apaga memórias pessoais do solicitante.
- `!gpt` — continua usando OpenAI; com `AI_MEMORY_IN_GPT=true` inclui memória PostgreSQL no system prompt.

## Segurança

- Mantenha o OpenCode em rede privada ou protegido por senha.
- Usuários comuns recebem apenas ferramentas de leitura/pesquisa (`OPENCODE_PUBLIC_TOOLS`).
- ADMINS (`ADMINS` no `.env`) podem usar ferramentas adicionais (`OPENCODE_ADMIN_TOOLS`).
- Não exponha tokens em logs.

## Banco de dados

As tabelas `ai_*` são criadas automaticamente via `database/schema.sql` na inicialização (`initDatabase`).
