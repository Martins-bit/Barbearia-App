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
- A solicitação de confirmação exige sessão e usa somente o e-mail do usuário
  autenticado; os limites por IP são complementados por uma cota persistida por
  usuário. A confirmação não exige sessão e responde genericamente para tokens
  inválidos, expirados ou reutilizados.
- Tokens de confirmação são aleatórios, armazenados como hash e consumidos na
  mesma transação que marca o endereço verificado. Mudança de e-mail invalida
  tokens pendentes e remove a confirmação anterior.
- O provedor de envio ainda não está configurado. A solicitação retorna `503`
  sem criar token nem afirmar que o e-mail foi enviado; nenhuma credencial de
  e-mail está configurada nesta etapa.
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
O runner remove variáveis herdadas `DATABASE_URL`, `DIRECT_URL`, URLs Prisma e
variáveis `PG*` antes de iniciar processos filhos, e fornece a URL já
validada. O teste não cria nem limpa bancos. `npm run test:e2e:guard` cobre
essas regras com processos simulados, sem conectar ao PostgreSQL.

O caminho oficial para migrations E2E é `npm run db:e2e:migrate`, que fixa
`prisma.e2e.config.ts`, `test/.env.e2e.migrate` e a role específica de
migration. O wrapper rejeita uma tentativa de substituir o config com
`--config`; o config dedicado também valida destino e credenciais antes de o
Prisma abrir conexão. `E2E_MIGRATION_RUNNER_AUTH=1` é uma confirmação explícita
de execução, não uma autenticação nem prova de que o wrapper foi usado: o valor
pode ser definido manualmente.

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
- `backend/src/auth/auth.controller.ts` — `@Throttle` em login/register.
- `backend/src/messages/messages.controller.ts` — `@Throttle` (por usuário) no envio REST.
- `backend/src/messages/messages.gateway.ts` — CORS do handshake + limite do `message:send`.
- `backend/.env.example` — nomes de variáveis e exemplos seguros (sem segredos).
- Testes: `cors.config.spec.ts`, `sliding-window-rate-limiter.spec.ts`,
  `security-infra.spec.ts` (integração: headers, CORS autorizado/negado/preflight, `429`).

## 7. Configuração de variáveis (resumo)

| Variável | Dev | Produção |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | opcional (padrão localhost 5173/5174) | **obrigatório**, domínio(s) real(is), sem `*` |
| `TRUST_PROXY` | desligado | definir nº de hops do proxy/CDN (ex.: `1` p/ Cloudflare) |
| `NODE_ENV` | `development` | `production` (ativa exigências de CORS) |

Consulte `backend/.env.example` para os nomes exatos e o `.env` local para os
valores do seu ambiente (o conteúdo do `.env` **não** é versionado).
