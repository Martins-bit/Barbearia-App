# ARQUITETURA DO SISTEMA

## 1. OBJETIVO

Este documento define a arquitetura técnica do aplicativo de gerenciamento e agendamento da barbearia.

A arquitetura deverá priorizar:

- Organização;
- Segurança;
- Manutenção;
- Escalabilidade;
- Facilidade de testes;
- Separação de responsabilidades;
- Boa experiência de desenvolvimento.

A implementação deverá seguir a documentação existente antes de adicionar novas funcionalidades.

---

## 2. VISÃO GERAL

O sistema será dividido principalmente em três partes:

- Frontend;
- Backend;
- Banco de dados.

O fluxo principal será:

USUÁRIO
↓
FRONTEND
↓
API / BACKEND
↓
BANCO DE DADOS

O frontend será responsável pela interface e experiência do usuário.

O backend será responsável pelas regras de negócio, segurança e comunicação com o banco.

O banco de dados será responsável pelo armazenamento persistente das informações.

---

## 3. FRONTEND

O frontend será responsável por apresentar a interface do aplicativo.

Suas responsabilidades incluem:

- Exibir telas;
- Navegação;
- Formulários;
- Validações para melhorar a experiência;
- Exibição de agendamentos;
- Exibição de serviços;
- Exibição de horários;
- Exibição de notificações;
- Comunicação com a API;
- Tratamento visual de erros;
- Estados de carregamento;
- Responsividade.

O frontend NÃO deverá:

- Acessar diretamente o banco de dados;
- Armazenar senhas;
- Decidir permissões de segurança;
- Ser responsável pela integridade dos agendamentos;
- Criar regras financeiras.

### Aplicativo web progressivo (PWA)

O frontend é publicado como uma única PWA para clientes e barbeiros. A
instalação é opcional: clientes continuam acessando pelo navegador, enquanto
barbeiros autenticados têm uma opção de instalação na área operacional. Quando
o navegador oferece `beforeinstallprompt`, a opção abre o fluxo nativo; em
navegadores sem esse evento, apresenta instruções do navegador, incluindo o
fluxo de compartilhamento do Safari no iOS. Clientes e administradores não
recebem a opção. O navegador pode oferecer sua própria instalação
independentemente do perfil.

A detecção de instalação usa `display-mode: standalone` e, no iOS, o sinal
`navigator.standalone` quando disponível. O Safari em uma aba normal não expõe
de forma confiável se o usuário já adicionou o site à tela inicial; nesse
contexto, essa condição não pode ser detectada pelo aplicativo.

O Service Worker pré-armazena somente o shell estático versionado do build
(HTML, JavaScript, CSS, ícones e manifest). Não deve armazenar respostas da
API, dados pessoais, respostas autenticadas ou tráfego Socket.IO. Atualizações
aguardam a confirmação do usuário; caches antigos do shell são removidos na
ativação da versão substituta.

`frontend/public/manifest.webmanifest` é a fonte do manifest consumida pelo
Vite. Os ícones nele declarados são copiados do diretório público e incluídos
explicitamente no precache do Service Worker.

O backend aplica centralmente `Cache-Control: no-store` e `Pragma: no-cache`
às respostas de rotas protegidas por JWT, aos fluxos de autenticação e a
requisições que enviem `Authorization`. Endpoints públicos sem autenticação e
recursos estáticos não recebem essa política automaticamente; cabeçalhos
específicos já existentes, como os de exportação de dados, são preservados.

A hospedagem Netlify publica `frontend/dist` e configura fallback de navegação
SPA para `index.html`, preservando rotas diretas do React Router. REST e
Socket.IO usam a origem absoluta `VITE_API_URL` do backend Render, portanto as
requisições não passam pelo fallback do domínio do frontend. A aplicação deve
ser servida por HTTPS.

O frontend usa `VITE_API_URL` como origem-base única para REST e Socket.IO.
Desenvolvimento pode omiti-la e usar o backend local; builds de produção exigem
uma origem HTTPS absoluta, sem credenciais, caminho, query ou fragmento. O
backend mantém uma allowlist explícita em `CORS_ALLOWED_ORIGINS`; produção exige
origens HTTPS reais do frontend. O proxy da hospedagem deve encaminhar API e
Socket.IO ao backend e permitir WebSocket Upgrade em `/socket.io` (namespace
`/messages`). Como as rotas REST são expostas na raiz, um prefixo externo só
pode ser usado se o proxy o remover antes de encaminhar as requisições. O
backend lê a porta `PORT` da hospedagem e faz bind em `0.0.0.0`. `GET /health`
verifica PostgreSQL e Redis, retorna `200` quando disponíveis e `503` genérico
quando algum serviço obrigatório falha.

### Versões e comandos de hospedagem

`frontend/.nvmrc` e `backend/.nvmrc` selecionam a major Node.js 24,
independentemente do diretório-base configurado para cada hospedagem. O patch
fica a cargo do gerenciador da plataforma dentro da linha 24.x.

No Netlify:

- Diretório-base: `frontend`;
- Build: `npm ci --include=dev && npm run build`;
- Publicação: `dist`;
- Variável de build `VITE_API_URL`: origem HTTPS real do backend. O valor do
  arquivo local `.env.local` não é versionado nem transferido para a hospedagem.

No Render:

- Diretório-base: `backend`;
- Build: `npm ci --include=dev && npm run build`;
- Inicialização: `npm run start:prod`.

O build executa `prisma generate` e depois NestJS; `start:prod` inicia
`dist/main`. Os comandos correspondem aos scripts reais do
`backend/package.json`; Prisma CLI e Nest CLI são dependências de
desenvolvimento e precisam estar disponíveis durante o build.

Configure no Render, sem versionar valores:

- `NODE_ENV=production`;
- `DATABASE_URL`, com a conexão PostgreSQL do Supabase;
- `REDIS_URL`, com a conexão Redis do Upstash usando `rediss://` quando TLS
  estiver habilitado;
- `JWT_SECRET`, com pelo menos 32 caracteres;
- `CORS_ALLOWED_ORIGINS`, contendo a origem HTTPS final do frontend, sem
  curingas;
- `PORT`, fornecida pela plataforma, que o backend já lê.

`TRUST_PROXY` deve permanecer ausente até a topologia ser confirmada. Se for
necessário configurá-la, use somente hops ou endereços confiáveis verificados;
não habilite confiança indiscriminada. O envio de e-mail é opcional: o padrão
é `EMAIL_PROVIDER=disabled`. Se o provedor Brevo for habilitado, configure
`BREVO_API_KEY`, `BREVO_SENDER_EMAIL` e `PUBLIC_APP_URL` com a origem HTTPS
real do frontend; `BREVO_SENDER_NAME` e `EMAIL_TIMEOUT_MS` são opcionais.

Build e inicialização não executam migrations. Uma migration de produção é
uma operação separada, manual e sujeita a autorização explícita, revisão e
procedimento de backup. A proteção atual em `prisma.config.ts` não deve ser
contornada; não há comando de migration incluído no build ou no start.

`TRUST_PROXY` permanece desligado quando não configurado. Quando a topologia
final estiver definida, pode representar booleano, número de hops ou lista de
IPs/sub-redes confiáveis no formato Express. A quantidade ou a lista não deve
ser presumida antes de conhecer os proxies e restringir o acesso direto à
origem.

Auditoria de dependências identificou um finding alto para `picomatch@4.0.5`,
transitivo de Vite e da cadeia de build do PWA. No momento da auditoria, o
registry consultado não oferecia versão fora do intervalo afetado (`<=4.0.7`).
O pacote é usado em tempo de desenvolvimento/build, não no Service Worker
gerado; os padrões Workbox atuais são constantes confiáveis, sem entrada de
usuário. O finding permanece aberto: não considerar a árvore de dependências
limpa e reavaliar quando houver versão corrigida, antes da publicação.

---

## 4. BACKEND

O backend será o núcleo responsável pelas regras e segurança do sistema.

Suas responsabilidades incluem:

- API;
- Autenticação;
- Autorização;
- Validação;
- Regras de negócio;
- Agendamentos;
- Disponibilidade;
- Lista de espera;
- Notificações;
- Mensagens;
- Controle de horários;
- Bloqueios;
- Emergências;
- Comunicação com o banco;
- Tratamento de erros;
- Segurança.

O backend deverá ser considerado a autoridade final sobre as regras do sistema.

### Módulo de Mensagens
O módulo `messages` é a autoridade sobre a comunicação CLIENTE ↔ BARBEIRO.

Responsabilidades:

- Derivar o remetente **sempre** do JWT (`sub`), nunca do corpo da requisição;
- Validar participantes (somente CLIENTE ↔ BARBEIRO), usuários ativos e barbeiro
  com perfil ativo;
- Trim e limite de 1 a 500 caracteres no conteúdo;
- Isolar a conversa por par de participantes e ordenar cronologicamente;
- Garantir que somente o destinatário marque a leitura, de forma idempotente;
- Listar as conversas do usuário autenticado identificando o outro participante,
  a última mensagem (conteúdo e data/hora) e as não lidas da conversa, com
  ordenação pela mensagem mais recente e sem criar conversas artificiais;
- Expor o contador global de não lidas (`GET /messages/unread-count`),
  calculado sempre a partir do JWT (`destinatarioId` do usuário autenticado e
  `lida = false`), sem confiar em `usuarioId` vindo do frontend;
- Não retornar dados sensíveis.

O módulo segue o padrão do projeto: `Controller` enxuto, regra de negócio no
`Service`, validação de entrada em DTO com `class-validator`, autorização via
`JwtGuard` + `RolesGuard`.

O módulo expõe **REST persistente** e **WebSocket autenticado**, ambos
delegação para o **mesmo `MessagesService`** — não existe caminho paralelo de
negócio ou de persistência.

### Fundação WebSocket (ETAPA 7C.1)
`MessagesGateway` no namespace dedicado `/messages`:

- handshake com JWT obrigatório, verificado pelo mesmo `JwtService` do módulo
  de autenticação;
- revalidação da conta e do perfil pelo mesmo serviço do `RolesGuard`
  (`UsersService.findAuthorizationStateById`);
- identidade anexada ao socket exclusivamente do JWT (`client.data`);
- registro de conexões/desconexões em memória (`MessagesSocketRegistry`,
  mapeamento usuário → sockets) — sem persistência no PostgreSQL;
- cada socket entra na sala `usuario:<id>`, agrupando as conexões do usuário;
- evento de handshake `ping` → `pong` ecoando apenas a identidade validada.

### Envio em tempo real (ETAPA 7C.2)
Fluxo do evento `message:send`:

1. o gateway usa a identidade já autenticada no handshake;
2. valida o payload (`SendMessageSocketDto`, whitelist estrita — campos de
   identidade enviados pelo cliente são rejeitados);
3. delega a criação ao `MessagesService.sendMessage`, que aplica as mesmas
   regras do `POST /api/messages` e **persiste no PostgreSQL**;
4. somente após o sucesso emite `message:sent` ao remetente;
5. somente após o sucesso emite `message:received` a cada socket do
   destinatário cuja autorização atual foi revalidada.

O handler **não retorna valor**: o retorno de um `@SubscribeMessage` seria
convertido pelo Nest em um segundo evento, duplicando `message:sent`. A
emissão explícita é a única origem dos eventos de sucesso.

Se o destinatário estiver offline, nada é emitido e **nenhum erro** é gerado:
a mensagem já está persistida e é recuperada via REST.

### Revalidação e revogação de autorização (ETAPA 7D.1)
O handshake autoriza a conexão, mas o socket **não fica autorizado para
sempre**. O gateway revalida ao registrar a conexão, antes de responder a
`ping`, antes/depois de processar `message:send` e antes de cada entrega
privada:

- a **expiração do JWT** — `client.data` guarda só o `exp` (epoch), nunca o
token, mantendo o socket sem qualquer credencial em memória;
- o **estado vigente da conta e do perfil**, pelo mesmo
  `UsersService.findAuthorizationStateById` que o `RolesGuard` usa.

Perdendo a autorização (JWT expirado, `authVersion` alterado, usuário
desativado ou perfil de barbeiro desativado depois da conexão), o socket é
removido do `MessagesSocketRegistry`, recebe `exception: Não autorizado.` e é
desconectado. A ordem é deliberada: **emitir o erro e só então desconectar**,
senão o motivo se perderia junto com o socket. Cada entrega privada consulta a
autorização atual e envia diretamente apenas aos sockets validados.

Uma alteração efetiva de e-mail incrementa `authVersion` junto com o perfil e
invalida tokens pendentes na mesma transação. Após o commit, `UsersService`
resolve o token `MESSAGES_GATEWAY` via `ModuleRef` (padrão já usado por
`MessagesService`) para desconectar sockets locais do titular, sem dependência
circular. Uma falha da transação não publica a revogação.

O registry e a desconexão são locais ao processo: o Redis configurado para
rate limiting HTTP não é um adaptador Socket.IO e não permite desconectar
imediatamente sockets mantidos por outra instância. Nessas instâncias, a
checagem do estado atual impede novas entregas privadas aos sockets revogados
quando uma mensagem for emitida; a desconexão remota imediata não é garantida.

Não há tabela de sessões, fila, heartbeat periódico nem regra de autorização
reescrita — a decisão continua centralizada em `UsersService`/`RolesGuard`.

Não há fila offline, notificações, unread-count via socket, presença ou typing
indicator nesta etapa. Quando o frontend conectar de origem cruzada, o CORS do
gateway deverá ser configurado na integração.

---

## 5. BANCO DE DADOS

O banco de dados será responsável pelo armazenamento persistente.

Deverá armazenar informações como:

- Usuários;
- Clientes;
- Barbeiros;
- Serviços;
- Agendamentos;
- Lista de espera;
- Notificações;
- Mensagens;
- Horários;
- Bloqueios;
- Emergências.

A estrutura deverá seguir `BANCO-DE-DADOS.md`.

Notificações internas são persistidas no banco e pertencem a um usuário. O
fluxo de criação de um `WaitlistClaim` cria sua notificação de oportunidade no
mesmo `TransactionClient`, sem adquirir novo advisory lock. A referência é
tipada por `claimId`; não há JSON genérico nem transporte push nesta etapa.

A criação de um agendamento `CONFIRMADO` (criação normal ou aceite de claim)
e a transição de um agendamento para `CANCELADO` também geram notificação
interna no mesmo `TransactionClient`, com referência tipada por
`agendamentoId`; nenhum advisory lock adicional é criado.

Eventos de reoferta por recusa/cancelamento/expiração de claim, cancelamento de
agendamento e remoção de bloqueio são persistidos em `WaitlistReofferOutbox`
na mesma transação da mudança que libera a janela. O worker adquire um item
com `FOR UPDATE SKIP LOCKED`, registra lease e tentativa e processa-o fora do
lock da fila, usando os advisory locks de calendário e claim já existentes.
O worker renova periodicamente seu lease; a renovação e as transições finais
exigem que a tentativa ainda seja proprietária e que o lease esteja válido pelo
relógio do PostgreSQL. A transação de criação consulta a autorização sem manter
lock na linha OUTBOX durante a validação da agenda; o heartbeat pode, assim,
renovar o lease enquanto a operação está em andamento. Depois de criar claim e
notificação, a transação aplica um fencing final condicionado à tentativa e ao
lease ainda vigente, renovando-o e mantendo o lock da linha até o commit. Se a
autorização foi perdida, a transação aborta e reverte claim, notificação e
vínculo OUTBOX juntos. Leases vencidos são recuperáveis. Erros transitórios
voltam a `PENDENTE` com backoff limitado; após 10 tentativas a pendência vai
para `FALHA_FINAL`. Ausência de candidato conclui a tentativa sem loop.
O vínculo único entre claim e OUTBOX torna idempotente a retomada após um claim
ter sido criado e antes da conclusão do evento. Novas entradas da lista de
espera não são eventos integrados por esta fase.

A expiração periódica dos claims compara `expiraEm` com `clock_timestamp()` do
PostgreSQL na própria atualização, sem usar o horário recebido da aplicação. O
prazo inicial de cinco minutos do claim também é calculado a partir do relógio
do PostgreSQL, evitando que o desvio do relógio da aplicação altere sua vigência.

O motor de lembretes (`NotificationsService.processAppointmentReminders`)
identifica agendamentos `CONFIRMADO` cujo `horaInicio` está na janela de
aproximadamente 1 hora e cria a notificação `LEMBRETE` vinculada ao
agendamento, dentro de uma transação serializada por advisory lock próprio
(namespace 5), sem duplicar lembretes. Os lembretes são processados
automaticamente a cada 5 minutos pelo `ReminderSchedulerService`
(`@nestjs/schedule`, registrado em `AppModule`), sem endpoint de disparo
manual e sem envio externo (e-mail/SMS/push) — apenas notificações internas.
Falhas do motor são logadas e não derrubam a aplicação; o motor continua
idempotente, permitindo múltiplas instâncias simultâneas.

### Web Push — decisões aprovadas, ainda não implementadas

O Web Push será um canal opcional adicional às notificações internas do
PostgreSQL, que permanecem o registro principal. O escopo está limitado aos
seis eventos aprovados em `REGRAS-DE-NEGOCIO.md`. A permissão depende de ação
consciente; clientes não precisam instalar a PWA para continuar usando o
aplicativo pelo link.

O fluxo futuro deverá persistir a notificação interna e o trabalho de entrega
na transação de negócio, mas enviar ao serviço push somente depois do commit,
por worker/outbox idempotente. Falhas, timeouts ou indisponibilidade do serviço
push nunca poderão reverter a operação de negócio. Inscrições inválidas serão
revogadas. Endpoint e chaves devem ser protegidos contra exposição e o envio
deve validar os destinos para evitar SSRF. O conteúdo enviado será genérico,
sem dados pessoais, tokens ou detalhes de agendamento.

Logout explícito revogará a inscrição do dispositivo atual e cancelará a
inscrição local quando possível. Sem conexão, o cancelamento local ocorre
imediatamente e a revogação no servidor fica pendente de nova tentativa quando
houver conexão. Um novo login exige nova autorização; não se transfere uma
inscrição entre contas. JWT, autenticação, autorização e Socket.IO permanecem
fora do fluxo push.

Na implementação atual, ainda sem cadastro push no frontend, o logout tenta
cancelar a inscrição do Service Worker local e a autenticação local é encerrada
mesmo se esse cancelamento falhar. Antes de um novo login, o frontend também
tenta limpar qualquer inscrição local pendente; se não conseguir, impede a
autenticação para não reutilizar a inscrição na nova sessão. A revogação remota
específica do dispositivo ainda não é feita: o contrato de listagem retorna
somente IDs e não permite correlacioná-los com segurança à inscrição local. A
implementação remota permanece pendente até haver essa associação segura; esta
etapa não altera tabelas ou migrations.

O frontend atualmente usa o Service Worker gerado por `vite-plugin-pwa`; não
há handlers de eventos push implementados. O schema e uma migration para
inscrições e fingerprints foram criados, mas a migration ainda não foi aplicada.
A outbox específica de push e os handlers de push e clique do Service Worker
continuam pendentes. A outbox de reoferta da lista de espera existente é
específica daquele fluxo e não equivale a uma outbox de entrega push.

A API inicial implementa `GET /api/push/public-key`,
`POST /api/push/subscriptions`, `GET /api/push/subscriptions` e
`DELETE /api/push/subscriptions/:id`. A chave pública só é retornada quando o
par VAPID e o subject estão configurados e validados. Listagem e revogação
retornam/alteram somente metadados e inscrições do titular autenticado. A
revogação é lógica. O cadastro responde `503` sem persistir enquanto não houver
providers reais de proteção e recuperação de DEK e de chave HMAC; nenhum
provider simulado foi registrado.

A validação de endpoints no cadastro rejeita HTTPS inválido, hosts internos
óbvios e faixas IP privadas/reservadas conhecidas. Isso não substitui validação
DNS e controles de saída no futuro serviço de envio, que ainda não existe.
Nenhum endpoint de envio push ou outbox foi implementado nesta etapa.

#### Runtime e biblioteca candidatos

Na verificação de 25/11/2026, o runtime disponível é Node.js `v24.21.0`
(npm `11.19.0`). As dependências instaladas aceitam essa versão: Vite
`8.2.4` e `@vitejs/plugin-react` `6.0.5` exigem `^20.19.0 || >=22.12.0`;
Prisma e `@prisma/client` `7.10.1` exigem `^20.19 || ^22.12 || >=24.0`;
NestJS Core `11.2.1` exige Node `>=20` e Nest CLI `12.0.13` exige `>=20.11`.
Os arquivos `.nvmrc` fixam a major 24 nos diretórios-base do frontend e
backend, sem escolher um patch específico. A plataforma ainda precisa honrar
essa seleção. `backend/tsconfig.json` usa TypeScript `6.0.3`, `module` e
`moduleResolution` `nodenext`, target `ES2023`; o `backend/package.json` não
declara `"type": "module"`.

`web-push` `4.0.0` é o candidato verificado no registry: declara Node.js
`>=16` e é um pacote ESM. O runtime local supera o requisito de Node e Node
24.18 oferece suporte estável para carregar módulos ESM síncronos via
`require()`. TypeScript `NodeNext` reconhece a fronteira ESM, mas o modo de
módulo do código do backend e o formato emitido precisam ser considerados na
importação. Como a biblioteca não declara tipos TypeScript no seu manifest,
`@types/web-push` `3.6.4` é uma dependência de tipos candidata, ainda sem
compatibilidade verificada com a API da versão 4.

Conclusão: compatibilidade de runtime é plausível para o Node local, mas não
está comprovada para produção nem por build/teste de integração, pois a
biblioteca não foi instalada. Antes da escolha final, confirmar o runtime de
produção e validar a importação, o build NestJS e os tipos no ambiente-alvo.
Não atualizar a major de Node, TypeScript ou módulos do projeto por
conveniência nesta etapa.

#### Decisões ainda pendentes

- Base legal, transparência, necessidade de consentimento e informações a
  apresentar sobre os serviços push externos, com validação pelo controlador;
- Prazos de retenção e expurgo separados para inscrições, entregas, tentativas,
  erros e revogações;
- Política e procedimento de rotação das chaves VAPID, incluindo revalidação
  das inscrições;
- Limite de dispositivos/inscrições ativas por usuário;
- Como persistir e limitar as tentativas de revogação após logout offline, sem
  manter ou transferir a sessão anterior;
- Runtime efetivamente usado em produção e compatibilidade final da
  dependência/tipos;
- Provedor push, configuração de segurança de saída e validação dos domínios
  dos endpoints, incluindo mitigação de SSRF.

---

## 6. SEPARAÇÃO DE RESPONSABILIDADES

Cada camada deverá possuir responsabilidades próprias.

### Frontend

Responsável pela interface.

### Backend

Responsável pela lógica e segurança.

### Banco de dados

Responsável pela persistência.

Uma camada não deverá assumir responsabilidades que pertencem a outra.

---

## 7. FLUXO DE AGENDAMENTO

O fluxo deverá seguir aproximadamente:

1. Cliente acessa os serviços;
2. Cliente escolhe um serviço;
3. Cliente escolhe uma data;
4. Frontend solicita disponibilidade à API;
5. Backend calcula os horários disponíveis;
6. Frontend apresenta os horários;
7. Cliente seleciona um horário;
8. Frontend envia a solicitação de agendamento;
9. Backend valida novamente todas as regras;
10. Backend verifica possíveis conflitos;
11. Banco registra o agendamento;
12. Backend retorna o resultado;
13. Frontend apresenta a confirmação.

A disponibilidade deverá ser verificada novamente no momento da criação do agendamento.

---

## 8. CONCORRÊNCIA

O sistema deverá proteger os agendamentos contra concorrência.

Exemplo:

Dois clientes podem tentar reservar o mesmo horário simultaneamente.

O backend e o banco deverão garantir que somente uma reserva válida seja confirmada.

O frontend não deverá ser responsável por essa proteção.

Para claims temporários da lista de espera, o backend adquire o lock do
calendário do barbeiro e um advisory lock transacional exclusivo do slot. A
revalidação da agenda, a escolha FIFO e a inserção do claim usam o mesmo
`TransactionClient`, evitando dois claims ativos válidos para a mesma
oportunidade. O namespace do claim é separado dos namespaces de barbeiro,
cliente e entrada da lista.

No aceite ou recusa, a ordem dos advisory locks é determinística: cliente
(namespace 2), barbeiro/calendário (namespace 1) e claim/slot (namespace 4).
O aceite reutiliza o núcleo transacional de criação de appointments; somente
depois da criação confirmada o claim e a entrada da lista são atualizados.
Expiração é lógica: `expiraEm <= agora` rejeita a operação sem mutar o histórico.

Cancelamento de agendamento confirmado e remoção de bloqueio disparam a
orquestração de oportunidades somente após a operação principal concluir. A
orquestração usa uma nova execução da infraestrutura de claim, revalida a
agenda e não cria transações aninhadas. Ela seleciona FIFO global entre
entradas ativas e escolhe o primeiro horário cronológico alinhado à grade de
15 minutos que caiba na janela liberada. Ausência de candidato ou perda da
vaga por concorrência são resultados normais; erros de infraestrutura são
propagados. O sistema possui processamento em background: schedulers
periódicos executam a expiração de claims e a geração de lembretes; o worker
da OUTBOX processa e recupera reofertas pendentes com lease e retentativas.

---

## 9. AUTENTICAÇÃO

A autenticação deverá ser realizada pelo backend.

O sistema deverá possuir mecanismos seguros para:

- Login;
- Logout com incremento de `authVersion` e rejeição dos JWTs anteriores;
- Identificação do usuário;
- Controle de sessão;
- Proteção de rotas.

As informações de autenticação deverão ser tratadas de maneira segura.
Um `401` em uma operação funcional inicia a revalidação da sessão por
`GET /auth/me`; o frontend só remove o token se esse endpoint confirmar `401`.
Um `403` indica falta de permissão e não encerra uma sessão válida.

Os registros de `EmailVerificationToken` são removidos diariamente às 03:00 UTC
por `EmailVerificationCleanupScheduler`. A limpeza conserva registros terminais
por 24 horas após a data mais recente entre `expiraEm` e `usadoEm`, usa o relógio
do PostgreSQL e exclui em lotes de até 500 com `FOR UPDATE SKIP LOCKED`. Tokens
ainda válidos não são candidatos. Cada lote usa uma transação; falhas deixam o
lote pendente para a próxima execução, sem interromper o backend nem registrar
tokens, hashes, e-mails ou IDs.

---

## 10. AUTORIZAÇÃO

O sistema deverá possuir controle baseado no tipo de usuário.

### Cliente

Acesso às funcionalidades destinadas ao cliente.

### Barbeiro

Acesso às funcionalidades administrativas destinadas ao barbeiro.

### Administrador

O papel `ADMIN` é reservado ao provisionamento operacional inicial e a
operações administrativas futuras explicitamente autorizadas. Ele não é
atribuído pelo cadastro público e não é herdado por contas existentes.

O primeiro administrador é criado somente por:

```text
cd backend
npm run admin:create:first
```

O comando exige terminal local interativo, recusando sessões remotas/CI,
argumentos e entrada não interativa. A senha é digitada sem eco e confirmada
dois vezes. O serviço usa transação, advisory lock transacional e reconsulta
de `ADMIN` antes da criação.

Contas `BARBEIRO` são provisionadas separadamente por um operador autorizado:

```text
cd backend
npm run barber:create
```

Esse comando não cria endpoints nem altera o cadastro público. A autorização
combina uma flag operacional própria, correspondência do usuário do sistema
operacional com `BARBER_PROVISIONING_OPERATOR`, terminal interativo local sem
argumentos/CI/SSH e validação de que o PostgreSQL é loopback e corresponde
exatamente a `BARBER_DATABASE_NAME`. A flag isolada não autoriza a operação;
o acesso ao ambiente e às credenciais do banco deve continuar restrito por
permissões do sistema operacional. O operador também deve digitar a frase de
confirmação que inclui o banco validado. `NODE_ENV` deve ser explicitamente
`development`; valores ausentes, vazios, `test` ou `production` são rejeitados
antes de qualquer criação. Um destino loopback, por si só, não autoriza
execução em produção.

O serviço normaliza e-mail, rejeita duplicidades sem converter contas existentes
e cria `Usuario` e o perfil `Barbeiro` ativo na mesma transação. A conta fica
com confirmação de e-mail obrigatória e não pode autenticar até a confirmação
pelo fluxo existente. A senha inicial é solicitada sem eco e nunca aceita como
argumento. Este provisionador é somente local; não autoriza nem implementa
execução em produção.

O backend deverá verificar as permissões em cada operação protegida.

---

## 11. SEGURANÇA

A arquitetura deverá considerar:

- Validação de entradas;
- Autenticação;
- Autorização;
- Proteção de dados;
- Controle de acesso;
- Tratamento seguro de erros;
- Proteção contra consultas malformadas;
- Proteção contra acesso indevido;
- Armazenamento seguro de credenciais.

O frontend nunca deverá ser considerado uma camada de segurança.

---

## 12. TRATAMENTO DE ERROS

Os erros deverão ser tratados em todas as camadas.

### Frontend

Deverá apresentar mensagens compreensíveis para o usuário.

### Backend

Deverá registrar e tratar erros de forma adequada.

### Banco

Deverá manter integridade e consistência dos dados.

Informações internas do sistema não deverão ser expostas ao usuário.

---

## 13. ESTADOS DE CARREGAMENTO

O frontend deverá possuir estados visuais para operações que dependem da API.

Exemplos:

- Carregando;
- Processando;
- Sucesso;
- Erro;
- Sem resultados.

Isso deverá evitar que o usuário pense que o aplicativo travou.

---

## 14. RESPONSIVIDADE

A interface deverá ser preparada para diferentes tamanhos de tela.

O sistema deverá funcionar adequadamente em:

- Computadores;
- Tablets;
- Celulares.

A experiência deverá permanecer consistente entre os dispositivos.

---

## 15. ORGANIZAÇÃO DO PROJETO

A estrutura inicial deverá ser semelhante a:

Barbearia-App
|
+-- docs
|   +-- DOCUMENTACAO.md
|   +-- REGRAS-OBRIGATORIAS.md
|   +-- TELAS.md
|   +-- REGRAS-DE-NEGOCIO.md
|   +-- BANCO-DE-DADOS.md
|   +-- API.md
|   +-- ARQUITETURA.md
|
+-- frontend
|
+-- backend
|
+-- tests
|
+-- README.md

A estrutura interna de cada aplicação deverá ser definida durante a implementação.

---

## 16. TESTES

O projeto deverá possuir testes para verificar:

- Autenticação;
- Permissões;
- Serviços;
- Agendamentos;
- Conflitos;
- Cancelamentos;
- Lista de espera;
- Notificações;
- Mensagens;
- Horários;
- Bloqueios;
- Emergências;
- Validações;
- Tratamento de erros.

Os testes deverão ser executados antes da disponibilização de novas versões.

---

## 17. DESENVOLVIMENTO

O desenvolvimento deverá seguir uma ordem organizada:

1. Documentação;
2. Arquitetura;
3. Banco de dados;
4. Backend;
5. API;
6. Frontend;
7. Integração;
8. Testes;
9. Correção de erros;
10. Revisão final.

A ordem poderá ser adaptada quando necessário, mas nenhuma funcionalidade importante deverá ser implementada sem definição adequada.

---

## 18. TECNOLOGIAS

As tecnologias definitivas deverão ser escolhidas antes da implementação.

A escolha deverá considerar:

- Facilidade de manutenção;
- Segurança;
- Compatibilidade;
- Desempenho;
- Comunidade;
- Documentação;
- Facilidade de testes;
- Integração entre frontend e backend.

A tecnologia escolhida deverá ser registrada posteriormente neste documento.

---

## 19. INTELIGÊNCIA ARTIFICIAL NO DESENVOLVIMENTO

Ferramentas de inteligência artificial poderão ser utilizadas durante o desenvolvimento.

A IA poderá auxiliar em:

- Geração de código;
- Refatoração;
- Testes;
- Identificação de erros;
- Documentação;
- Revisão de código;
- Sugestões de arquitetura.

Entretanto, qualquer código gerado por IA deverá respeitar toda a documentação do projeto.

A IA não deverá criar funcionalidades que contradigam as regras existentes.

---

## 20. REGRA FINANCEIRA

A arquitetura do sistema NÃO deverá possuir qualquer componente destinado a transações financeiras.

Não deverão existir:

- Gateway de pagamento;
- PIX;
- Checkout;
- Sistema de cobrança;
- Carteira;
- Saldo;
- Pagamento com cartão;
- Transferências;
- Estornos.

O preço dos serviços possui somente finalidade informativa.

O aplicativo será exclusivamente voltado para:

- Agendamento;
- Serviços;
- Barbeiros;
- Clientes;
- Horários;
- Agenda;
- Notificações;
- Lista de espera;
- Comunicação;
- Gerenciamento da barbearia.

---

## 21. REGRA DE CONSISTÊNCIA

A arquitetura deverá permanecer compatível com todos os documentos do projeto.

Os principais documentos são:

- `DOCUMENTACAO.md`;
- `REGRAS-OBRIGATORIAS.md`;
- `TELAS.md`;
- `REGRAS-DE-NEGOCIO.md`;
- `BANCO-DE-DADOS.md`;
- `API.md`.

Caso uma decisão técnica entre em conflito com algum desses documentos, a documentação deverá ser revisada antes da implementação.

---

## 22. REGRA FINAL

O objetivo da arquitetura é manter o projeto organizado, seguro, testável e fácil de manter.

Nenhuma camada deverá ignorar as regras de negócio.

Nenhuma funcionalidade financeira deverá ser adicionada.

Toda nova funcionalidade deverá ser documentada antes de ser implementada.