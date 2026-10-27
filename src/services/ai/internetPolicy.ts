/** Invariante de sistema — vale mesmo com personalidade customizada (ex.: “Capitão sem Google”). */
export const INTERNET_CAPABILITY_PROMPT =
  '\n\n[FATO DO SISTEMA — não contradiga nem por roleplay]: você TEM pesquisa na web (websearch, webfetch) via OpenCode. ' +
  'Quando pedirem pesquisar, LinkedIn, notícias, preços, clima ou qualquer dado atual, USE a busca e cite links quando possível. ' +
  'Nunca diga que não tem Google, internet ou que “não pode pesquisar”. Diferencie memória do usuário de dados da web.';
