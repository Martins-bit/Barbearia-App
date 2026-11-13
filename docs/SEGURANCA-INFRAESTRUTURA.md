# Segurança de Infraestrutura — Helmet, CORS e Rate Limiting

Documento complementar às [Regras Obrigatórias](./REGRAS-OBRIGATORIAS.md) e à
[Arquitetura](./ARQUITETURA.md). Descreve a camada de proteção HTTP/socket
adicionada à API (Etapa 2), como configurá-la por ambiente e o que ainda precisa
ser definido ao publicar atrás de um proxy/CDN.

> **Escopo:** apenas endurecimento de infraestrutura. **Não** substitui a
> autenticação JWT nem as regras de autorização por papel — ver seção
> "CORS × Autenticação × Rate limiting".

## 1. Três camadas distintas (não se confundem)

| Camada | O que faz | Onde vive | O que **não** faz |
|---|---|---|---|
| **CORS** | Controla **qual origem** (domínio do navegador) pode chamar a API e usar credenciais. | `common/config/cors.config.ts` (REST + handshake Socket.IO) | Não autentica ninguém; não limita volume. |
| **Autenticação JWT** | Prova **quem** é o usuário (identidade e papel) a cada requisição/handshake. | `auth/` (guard REST) + middleware do gateway (socket) | Não valida a origem nem limita volume. |
| **Rate limiting** | Limita **quantas** requisições por janela de tempo por cliente/usuário. | `@nestjs/throttler` (REST) + janela deslizante (socket) | Não identifica origem nem autentica. |

Uma camada **não** substitui a outra. Desligar CORS não concede acesso (o JWT
exige token válido); passar do limite gera `429`, não `401/403`.

## 2. Helmet (cabeçalhos de segurança)

- Aplicado em `backend/src/main.ts` com `app.use(helmet())`.
- Usa os **defaults seguros** do Helmet. A API é **JSON-only** (não serve HTML e
  não define CSP própria), portanto os defaults não quebram o consumo.
- Inclui cabeçalhos como `X-Content-Type-Options`, `X-Frame-Options`,
  `Strict-Transport-Security`, `Content-Security-Policy`, entre outros.
- **Sem efeito** sobre Socket.IO (não responde HTTP normal) nem sobre o JWT
  (enviado no header `Authorization`).
- Verificado por teste de integração em `security-infra.spec.ts`.

O Helmet aplica também os defaults de CSP, proteção contra framing,
`X-Content-Type-Options` e `Referrer-Policy` às respostas da API. Isso não
configura cabeçalhos do servidor estático do frontend; o host/CDN que serve o
frontend e sua CSP efetiva ainda precisam ser verificados operacionalmente.
Não foi adicionada CSP via `<meta>`: a aplicação usa fontes do Google e uma
origem de API configurável, e uma política estática poderia bloquear chamadas
REST/WebSocket ou recursos legítimos.

## 3. CORS por ambiente

A lista de origens autorizadas vem de **uma única fonte**: `buildCorsOptions()`
em `backend/src/common/config/cors.config.ts`, usada tanto pelo CORS REST
(`main.ts`) quanto pelo handshake do Socket.IO (`messages.gateway.ts`) — as duas
camadas aceitam **exatamente as mesmas origens**.

Variável: **`CORS_ALLOWED_ORIGINS`** (lista separada por vírgulas).

### Desenvolvimento
- Se `CORS_ALLOWED_ORIGINS` **não** estiver definida, valem as origens locais
  padrão: `http://localhost:5173` e `http://localhost:5174`.
- Para customizar, defina no `backend/.env`:
  ```
  CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
  ```

### Produção (`NODE_ENV=production`)
- **Obrigatório** definir `CORS_ALLOWED_ORIGINS` com o(s) domínio(s) real(is) do
  frontend. Exemplo (trocar pelo domínio verdadeiro):
  ```
  CORS_ALLOWED_ORIGINS=https://app.seudominio.com,https://www.seudominio.com
  ```
- Se estiver **ausente, vazia ou inválida**, a API **não inicia** — falha rápida
  com mensagem clara (sem revelar segredos).
- **Nunca** combina `credentials: true` com `Access-Control-Allow-Origin: *`
  (proibido por especificação e por regra do projeto). Origens `*` em produção
  são rejeitadas na validação.

### Normalização e validação
- Cada entrada é normalizada (sem barra final, sem espaços) e validada como URL
  absoluta `http(s)`.
- Entradas vazias ou inválidas **não** são aceitas silenciosamente: em produção,
  qualquer item inválido **interrompe** o boot.

## 4. Rate limiting (somente rotas sensíveis)

Implementado com `@nestjs/throttler` **sem guard global** — o `ThrottlerGuard` é
aplicado pontualmente via `@UseGuards(ThrottlerGuard)` + `@Throttle(...)` apenas
nas operações sensíveis. Leituras e demais rotas legítimas **não** são limitadas.

| Operação | Limite | Janela | Rastreador |
|---|---|---|---|
| `POST /auth/login` | 10 | 60 s | IP do cliente |
| `POST /auth/register` | 5 | 60 s | IP do cliente |
| `POST /auth/email/verification/request` | 3 | 60 s | IP do cliente; também 3 por usuário/hora |
| `POST /auth/email/verification/resend` | 3 | 60 s | IP do cliente; além de intervalo de 60 s e 3 por endereço/hora |
| `POST /auth/email/verification/confirm` | 5 | 60 s | IP do cliente |
| `POST /auth/password-recovery` | 5 | 60 s | IP do cliente; também 3 tentativas por identificador normalizado/hora |
| `POST /auth/password-reset` | 10 | 60 s | IP do cliente |
| `POST /messages` (REST) | 30 | 60 s | **usuário autenticado** (`sub` do JWT) |
| Socket.IO `message:send` | 30 | 60 s | usuário autenticado (`sub`) |

- O limite de mensagens é por **usuário autenticado** (não por IP), o que é mais
  justo atrás de NAT/proxy e evita que um IP compartilhado derrube vários
  usuários.
- O excesso retorna **`429`** (REST) ou um erro de limitação equivalente no
  socket, respeitando o formato de erro já usado no projeto.
- O `ThrottlerGuard` HTTP usa storage Redis compartilhado para que os limites
  sejam agregados entre instâncias da API. `REDIS_URL` é obrigatório; a API
  falha no boot se não estiver definido ou se não conseguir conectar ao Redis.
  Falhas posteriores no storage não recorrem a contadores locais, evitando
  enfraquecer os limites silenciosamente. O Redis deve ser operado com acesso
  restrito e TLS/autenticação conforme a topologia de produção.
- A solicitação de confirmação do Perfil exige sessão e usa somente o e-mail do
  usuário autenticado. O reenvio público exige uma ação explícita, usa resposta
  idêntica para endereços existentes e inexistentes e aplica cota persistida
  por HMAC do endereço: no máximo três envios por hora e um por minuto. A cota
  existente por usuário também continua aplicada.
- Tokens de confirmação são aleatórios, armazenados como hash e consumidos na
  mesma transação que marca o endereço verificado. Mudança de e-mail invalida
  tokens pendentes e remove a confirmação anterior.
- O envio transacional é selecionado por `EMAIL_PROVIDER` e permanece
  desabilitado por padrão. Com `disabled`, solicitações de confirmação e
  recuperação retornam `503` antes de iniciar o envio e sem criar token.
- Com `EMAIL_PROVIDER=brevo`, a API usa o endpoint transacional oficial. API key
  e remetente são obrigatórios; chamadas possuem timeout explícito, não fazem
  retries automáticos e não registram credenciais, tokens, endereços ou respostas
  do provedor nos logs.
- O cadastro faz apenas uma tentativa automática de confirmação. Login e
  abertura da tela nunca enviam e-mail; novos envios exigem ação explícita.
  Confirmações e redefinições usam a mesma cota transacional da conta Brevo:
  cada fluxo conserva sua proteção por IP/identificador e nenhum deles faz
  retries automáticos. A cota global do plano deve ser monitorada no Brevo,
  pois seu valor depende do plano contratado.
- Se o envio de confirmação falhar, o token é invalidado e a rota retorna `503`.
  Se uma tentativa de recuperação falhar após a criação do token, ele é
  invalidado e a rota mantém a resposta `202` genérica para evitar enumeração.
- A janela de tempo do socket usa o utilitário
  `common/utils/sliding-window-rate-limiter.ts` (janela deslizante, em memória,
  por processo).

### Testes automatizados e o limite
- Cada suíte e2e sobe uma aplicação isolada, com estado de throttling próprio;
- os volumes por suíte ficam **abaixo** dos limites (login ≤ 2, register 0,
  `POST /messages` ≤ 2), portanto não há falso `429` nos testes existentes.

## 5. Confiança no proxy (Cloudflare) — atenção ao publicar

A API poderá rodar atrás do **Cloudflare**. Pontos obrigatórios:

1. **Não confiar cegamente em `X-Forwarded-For` / `X-Real-IP`.** Esses cabeçalhos
   podem ser forjados pelo cliente se não houver proxy de verdade na frente.
2. **`trust proxy` é OPT-IN e desligado por padrão.** Só é ativado quando a
   variável **`TRUST_PROXY`** estiver explicitamente definida em `main.ts`
   (ex.: `TRUST_PROXY=1` para um único hop do Cloudflare).
3. **Antes de publicar**, defina `TRUST_PROXY` com o número correto de hops do
   seu proxy/CDN. Sem isso, o `req.ip` (base do rate limit por IP) aponta para o
   proxy, e não para o cliente real.
4. **Reavalie os limites** após definir a topologia final (Cloudflare + origem),
   especialmente os rastreadores por IP (login/register).

> Enquanto o domínio e a topologia finais não estiverem definidos, mantenha
> `TRUST_PROXY` desligado (comportamento conservador atual).

## 6. Isolamento dos testes E2E

Os E2E do backend podem criar e remover registros. A configuração de testes é
`backend/test/.env.e2e`; a configuração de migrations é
`backend/test/.env.e2e.migrate`. Ambas são arquivos locais ignorados pelo Git e
não podem reutilizar as credenciais de `backend/.env`.

O destino permitido é `barbearia_app_e2e` em `127.0.0.1` ou `::1`, porta
explícita `5432`, com somente `schema=public`. URLs remotas, hosts como
`localhost`, parâmetros repetidos/de destino, usuários não esperados e
configuração ausente são rejeitados. A role de execução
`barbearia_e2e_test` e a role de migration `barbearia_e2e_migrator` são
separadas e não podem ser superusuárias. A primeira recebe apenas privilégios
de conexão, CRUD e sequência no schema de teste; a segunda recebe somente
privilégios de DDL necessários nesse banco. A criação e concessão dessas roles
é uma tarefa administrativa separada.

`npm run test:e2e` valida antes do Jest; o setup do Jest repete a validação.
O runner aceita somente filtros por nome de teste, padrões posicionais e opções
de execução não configuráveis (`--runInBand`, `--verbose`, `--silent`); opções
desconhecidas ou que alterem configuração/setup são rejeitadas, inclusive após
um separador `--`.
O runner remove variáveis herdadas `DATABASE_URL`, `DIRECT_URL`, URLs Prisma e
variáveis `PG*` antes de iniciar processos filhos, e fornece a URL já
validada. O teste não cria nem limpa bancos. `npm run test:e2e:guard` cobre
essas regras com processos simulados, sem conectar ao PostgreSQL.

O caminho oficial para migrations E2E é `npm run db:e2e:migrate`, que fixa
`prisma.e2e.config.ts`, `test/.env.e2e.migrate` e a role específica de
migration. O wrapper rejeita uma tentativa de substituir o config com
qualquer argumento extra e fixa o config Prisma; o config dedicado também
valida destino e credenciais antes de o Prisma abrir conexão.
`E2E_MIGRATION_RUNNER_AUTH=1` é uma confirmação explícita de execução, não uma
autenticação nem prova de que o wrapper foi usado: o valor pode ser definido
manualmente.

A configuração Prisma padrão valida `migrate` e `db push` somente quando ela
própria é selecionada: exige `PRISMA_MIGRATION_TARGET=development` e uma URL
para `barbearia_app` local na porta 5432. Esses controles locais não impedem
universalmente o uso direto do Prisma com um arquivo `--config` arbitrário,
que pode não carregar os guards do projeto. Portanto, os caminhos oficiais são
protegidos, mas a proteção definitiva contra outros destinos depende de roles
PostgreSQL com privilégio mínimo e credenciais de produção indisponíveis aos
processos de teste/desenvolvimento.

O bloqueio não cria, remove ou valida o conteúdo dos bancos. Confirme
administrativamente a finalidade do banco isolado e os privilégios das roles
antes de executar o runner. Arquivos `_diag-*` são excluídos da seleção normal
e qualquer execução manual também exige validação E2E.

## 7. Arquivos relacionados

- `backend/src/main.ts` — Helmet, `trust proxy` (opt-in), CORS REST.
- `backend/src/common/config/cors.config.ts` — resolução/validação das origens.
- `backend/src/common/utils/sliding-window-rate-limiter.ts` — janela p/ socket.
- `backend/src/app.module.ts` — registro do `ThrottlerModule` (throttler `default`).
- `backend/src/common/throttling/redis-throttler-storage.ts` — storage Redis
  atômico e compartilhado do `ThrottlerGuard` HTTP.
- `backend/src/auth/auth.controller.ts` — `@Throttle` em login/register.
- `backend/src/messages/messages.controller.ts` — `@Throttle` (por usuário) no envio REST.
- `backend/src/messages/messages.gateway.ts` — CORS do handshake + limite do `message:send`.
- `backend/src/auth/email-verification-mailer.ts` — contrato e implementação desabilitada.
- `backend/src/auth/brevo-email-verification-mailer.ts` — adaptador HTTPS do Brevo e validação de configuração.
- `backend/src/auth/auth.module.ts` — seleção explícita do provider de e-mail.
- `backend/.env.example` — nomes de variáveis e exemplos seguros (sem segredos).
- Testes: `cors.config.spec.ts`, `sliding-window-rate-limiter.spec.ts`,
  `security-infra.spec.ts` (integração: headers, CORS autorizado/negado/preflight, `429`) e `brevo-email-verification-mailer.spec.ts`.

## 7. Configuração de variáveis (resumo)

| Variável | Dev | Produção |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | opcional (padrão localhost 5173/5174) | **obrigatório**, domínio(s) real(is), sem `*` |
| `TRUST_PROXY` | desligado | definir nº de hops do proxy/CDN (ex.: `1` p/ Cloudflare) |
| `NODE_ENV` | `development` | `production` (ativa exigências de CORS) |
| `EMAIL_PROVIDER` | `disabled` por padrão; `brevo` para ativar | selecionar explicitamente `brevo` |
| `BREVO_API_KEY` | obrigatória somente com `EMAIL_PROVIDER=brevo` | segredo do painel Brevo; não versionar |
| `BREVO_SENDER_EMAIL` | obrigatória somente com `EMAIL_PROVIDER=brevo` | remetente autorizado no Brevo |
| `BREVO_SENDER_NAME` | opcional; usa `Barbearia do Bruno` por padrão | nome exibido do remetente |
| `EMAIL_TIMEOUT_MS` | padrão `10000` ms | inteiro positivo; limita a chamada à API |

Consulte `backend/.env.example` para os nomes exatos e o `.env` local para os
valores do seu ambiente (o conteúdo do `.env` **não** é versionado).

## 8. Exportação de dados próprios e minimização de logs

- `GET /users/me/export` exige autenticação e obtém o identificador do titular
  exclusivamente do JWT. As consultas de perfil, agendamentos, lista de espera,
  mensagens e notificações são limitadas ao titular ou aos registros que ele
  pode acessar; a rota não aceita um identificador de outra conta. Apenas
  `CLIENTE` e `BARBEIRO` têm acesso, e o throttler limita a três solicitações
  por usuário autenticado por minuto.
- A resposta tem `Cache-Control: no-store`, `Pragma: no-cache` e
  `X-Content-Type-Options: nosniff`, com nome de download fixo e sem dados
  pessoais. A interface gera o arquivo localmente. Senhas, hashes, tokens,
  credenciais e dados internos de autenticação não são incluídos. Conteúdo de
  mensagens, registros apagados para todos/ocultados para o titular, dados do
  outro participante, observações e outros textos livres também são omitidos.
- Erros inesperados de geração são convertidos em resposta genérica; o log
  específico da rota registra somente uma mensagem fixa, sem exceção ou dados
  da exportação.
- O processamento atual da outbox de reoferta não escreve a mensagem de
  exceção nem a stack trace nos logs. O campo de erro persistido registra uma
  categoria genérica ou código/status técnico. Valores históricos não foram
  alterados. Isso não comprova a política de retenção nem a redação de logs de
  todos os provedores de hospedagem e ambientes operacionais, que permanecem
  pendentes de validação.

## 9. Sessões no frontend e armazenamento de JWT

- O frontend persiste somente o JWT na chave `bb.auth.token` do `localStorage`;
  não persiste o objeto de perfil, telefone, e-mail ou outros dados de conta.
  O perfil é mantido em memória e revalidado por `GET /auth/me` ao restaurar a
  sessão.
- O token é enviado à API no header `Authorization: Bearer ...`; o WebSocket o
  envia no campo `auth.token` do handshake, nunca na URL. O cliente guarda o
  token em memória para detectar troca de sessão e o servidor guarda apenas
  identidade/expiração autorizadas, não o JWT.
- Logout remove o token, desconecta o socket, limpa o usuário React e zera o
  badge derivado. Remoção/troca do token em outra aba causa revalidação e
  descarte do estado anterior. Respostas `401` autenticadas removem o token e
  notificam a aplicação; respostas de requisições explicitamente públicas não
  apagam uma sessão existente.
- A autorização continua sendo aplicada pelo backend; o JWT expira conforme
  sua configuração e `authVersion` permite invalidar tokens emitidos antes de
  uma alteração de versão. Logout local, por si só, não revoga uma cópia
  previamente furtada do token.
- **Risco residual:** `localStorage` é acessível a JavaScript da mesma origem.
  Uma vulnerabilidade XSS poderia permitir roubo do JWT até sua expiração ou
  invalidação. Não foi encontrado uso de `dangerouslySetInnerHTML`, APIs de
  injeção HTML (`innerHTML`, `document.write`) ou biblioteca de renderização de
  HTML dinâmico no frontend revisado. React escapa texto renderizado. Isso não
  substitui revisão contínua de dependências e de novas superfícies.
- A migração para cookie `HttpOnly` não foi feita: exigiria desenho CSRF,
  alteração de autenticação, CORS e handshake WebSocket, além de compatibilidade
  entre ambientes. Deve ser avaliada como mudança arquitetural própria, não
  improvisada nesta etapa.
