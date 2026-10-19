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
| `POST /messages` (REST) | 30 | 60 s | **usuário autenticado** (`sub` do JWT) |
| Socket.IO `message:send` | 30 | 60 s | usuário autenticado (`sub`) |

- O limite de mensagens é por **usuário autenticado** (não por IP), o que é mais
  justo atrás de NAT/proxy e evita que um IP compartilhado derrube vários
  usuários.
- O excesso retorna **`429`** (REST) ou um erro de limitação equivalente no
  socket, respeitando o formato de erro já usado no projeto.
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

## 6. Arquivos relacionados

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
