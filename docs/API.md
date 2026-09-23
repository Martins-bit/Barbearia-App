# API DO SISTEMA

## 1. OBJETIVO

A API será responsável pela comunicação entre o frontend, o backend e o banco de dados.

O frontend não deverá acessar diretamente o banco de dados.

A comunicação deverá seguir o fluxo:

Frontend → API → Backend → Banco de Dados

O backend será responsável por:

- Autenticação;
- Autorização;
- Validação;
- Regras de negócio;
- Processamento dos agendamentos;
- Controle de disponibilidade;
- Comunicação com o banco de dados;
- Segurança;
- Tratamento de erros.

---

## 2. PRINCÍPIOS DA API

A API deverá:

- Validar todas as informações recebidas;
- Verificar as permissões do usuário;
- Aplicar as regras de negócio;
- Evitar acesso direto ao banco pelo frontend;
- Retornar respostas consistentes;
- Utilizar códigos HTTP adequados;
- Não expor informações sensíveis;
- Impedir operações não autorizadas.

---

## 3. AUTENTICAÇÃO

As áreas privadas do sistema deverão exigir autenticação.

O usuário deverá realizar login para receber uma sessão ou mecanismo de autenticação seguro.

As credenciais nunca deverão ser retornadas pela API.

A senha nunca deverá ser armazenada ou transmitida em texto puro de forma inadequada.

---

## 4. AUTORIZAÇÃO

A API deverá verificar o tipo de usuário antes de executar operações protegidas.

### Cliente

O cliente poderá acessar somente recursos permitidos para sua própria conta.

### Barbeiro

O barbeiro poderá acessar recursos administrativos permitidos para sua conta.

### Regra

O backend nunca deverá confiar apenas no frontend para determinar permissões.

Toda autorização deverá ser validada no servidor.

---

# 5. PADRÃO DE RESPOSTA

As respostas da API deverão possuir uma estrutura consistente.

### Sucesso

Uma resposta de sucesso deverá retornar:

- Status HTTP apropriado;
- Dados solicitados ou resultado da operação;
- Informações necessárias para o frontend.

### Erro

Uma resposta de erro deverá retornar:

- Código HTTP apropriado;
- Código interno do erro, quando necessário;
- Mensagem clara;
- Informações adicionais somente quando forem seguras.

A API não deverá revelar detalhes internos do servidor, banco de dados ou código-fonte.

---

# 6. AUTENTICAÇÃO E CONTA

## 6.1. Cadastro

Endpoint conceitual:

`POST /api/auth/register`

### Objetivo

Criar uma nova conta de cliente.

### Dados esperados

- Nome;
- Telefone;
- Senha;
- Outros campos definidos posteriormente.

### Validações

O backend deverá verificar:

- Campos obrigatórios;
- Formato dos dados;
- Regras de senha;
- Existência de conta duplicada.

### Resultado

Em caso de sucesso, a conta deverá ser criada.

---

## 6.2. Login

Endpoint conceitual:

`POST /api/auth/login`

### Objetivo

Autenticar um usuário.

### Dados esperados

- Telefone ou identificador definido;
- Senha.

### Resultado

Em caso de sucesso, o sistema deverá criar uma sessão ou fornecer o mecanismo de autenticação definido na implementação.

---

## 6.3. Logout

Endpoint conceitual:

`POST /api/auth/logout`

### Objetivo

Encerrar a sessão atual do usuário.

---

## 6.4. Usuário atual

Endpoint conceitual:

`GET /api/auth/me`

### Objetivo

Retornar as informações básicas do usuário autenticado.

A resposta não deverá conter:

- Senha;
- Hash da senha;
- Dados sensíveis desnecessários.

---

# 7. SERVIÇOS

## 7.0. Listar barbeiros

Endpoint conceitual:

`GET /api/barbers`

### Objetivo

Retornar os barbeiros **elegíveis para escolha** pelo cliente — o primeiro passo do fluxo de agendamento (escolher barbeiro → serviços do barbeiro → disponibilidade → agendamento).

### Autenticação e autorização

Requer autenticação (JWT) e é acessível a CLIENTE ativo ou BARBEIRO ativo com perfil de barbeiro ativo (mesmo `JwtGuard`/`RolesGuard` do restante do sistema; o estado atual do usuário é revalidado no banco, não apenas o JWT). Usuário inativo recebe `401`; BARBEIRO sem perfil ativo recebe `403`.

### Regras de elegibilidade

Aparecem somente barbeiros com **perfil de barbeiro ativo** e **usuário ativo**. Barbeiro inativo (perfil ou usuário) nunca é listado. Não há filtros arbitrários e o cliente não escolhe quem aparece.

### Resposta

Lista de objetos com o mínimo público necessário para identificar o barbeiro e usar o seu id:

- `id` — identificador do barbeiro (usado em `GET /api/services?barbeiroId=` e em `POST /api/appointments`);
- `nome` — nome público do barbeiro.

Sem telefone, e-mail, `senhaHash`, `tipoUsuario`, timestamps, tokens ou qualquer dado administrativo. Lista vazia (`[]`) quando não houver barbeiros elegíveis.

---

## 7.1. Listar serviços

Endpoint conceitual:

`GET /api/services?barbeiroId=<id>`

### Objetivo

Retornar os serviços **ativos de um barbeiro específico**, para visualização e agendamento.

### Regra

Serviços pertencem a um barbeiro: **não** existe catálogo global. O `barbeiroId` é obrigatório; o barbeiro alvo precisa existir e estar ativo (perfil de barbeiro ativo), caso contrário a resposta é `404`. Somente serviços ativos do barbeiro informado aparecem.

Fluxo esperado do cliente: escolher barbeiro → receber os serviços ativos daquele barbeiro → escolher o serviço → consultar disponibilidade → criar agendamento.

Requer autenticação de CLIENTE ativo ou BARBEIRO ativo com perfil ativo (o estado atual do usuário é revalidado, não apenas o JWT).

---

## 7.2. Visualizar serviço

Endpoint conceitual:

`GET /api/services/:id`

### Objetivo

Retornar informações de um serviço específico.

### Informações

Poderão incluir:

- Nome;
- Descrição;
- Duração;
- Preço informativo;
- Status.

---

## 7.3. Criar serviço

Endpoint conceitual:

`POST /api/services`

### Permissão

Somente barbeiros autorizados.

### Dados

- Nome;
- Descrição;
- Duração;
- Preço informativo.

---

## 7.4. Atualizar serviço

Endpoint conceitual:

`PUT /api/services/:id`

### Permissão

Somente barbeiros autorizados.

---

## 7.5. Desativar serviço

Endpoint conceitual:

`PATCH /api/services/:id/status`

### Permissão

Somente barbeiros autorizados.

### Regra

A desativação não deverá apagar automaticamente o histórico de agendamentos relacionados ao serviço.

---

# 8. DISPONIBILIDADE

## 8.1. Consultar horários disponíveis

Endpoint conceitual:

`GET /api/availability`

### Parâmetros

Poderão incluir:

- Data;
- Serviço;
- Barbeiro, quando aplicável.

### O backend deverá considerar

- Horário de funcionamento;
- Duração do serviço;
- Agendamentos existentes;
- Bloqueios;
- Serviços ativos;
- Regras de negócio.

### Resultado

A API deverá retornar somente horários que possam realmente ser utilizados para novos agendamentos.

### Regra de horários passados

A disponibilidade nunca oferece um horário que a criação de agendamento rejeitaria por já ter passado (a comparação usa o fuso `America/Sao_Paulo`):

- data consultada **igual a hoje** → somente slots cujo início ainda seja futuro (um slot exatamente no horário atual já não é oferecido);
- data consultada **anterior a hoje** → nenhum horário (lista vazia);
- data consultada **posterior a hoje** → grade completa conforme as demais regras.

---

# 9. AGENDAMENTOS

## 9.1. Criar agendamento

Endpoint conceitual:

`POST /api/appointments`

### Permissão

Cliente autenticado.

### Dados

- Serviço;
- Barbeiro, quando aplicável;
- Data;
- Horário;
- Observações, quando permitido.

### Validações

O backend deverá verificar:

- Usuário autenticado;
- Serviço existente;
- Serviço ativo;
- Barbeiro válido;
- Data válida;
- Horário válido;
- Horário de funcionamento;
- Duração do serviço;
- Conflitos;
- Bloqueios.

### Regra crítica

A disponibilidade deverá ser verificada novamente no momento da criação.

O frontend nunca deverá ser considerado suficiente para garantir que o horário está disponível.

---

## 9.2. Listar meus agendamentos

Endpoint conceitual:

`GET /api/appointments/my`

### Permissão

Cliente autenticado.

### Regra

O cliente somente poderá visualizar seus próprios agendamentos.

---

## 9.3. Visualizar agendamento

Endpoint conceitual:

`GET /api/appointments/:id`

### Permissão

Somente usuários autorizados relacionados ao agendamento.

---

## 9.4. Cancelar agendamento

Endpoint conceitual:

`PATCH /api/appointments/:id/cancel`

### Permissão

Cliente ou barbeiro, conforme as regras de negócio.

### Regra

O cancelamento realizado pelo cliente deverá respeitar o prazo definido:

Até um dia antes do atendimento.

### Resultado

Após um cancelamento válido:

- O status deverá ser atualizado;
- O horário deverá ser liberado;
- A disponibilidade deverá ser recalculada;
- A lista de espera poderá ser acionada;
- Notificações apropriadas deverão ser geradas.

---

## 9.5. Concluir atendimento

Endpoint conceitual:

`PATCH /api/appointments/:id/complete`

### Permissão

Barbeiro autorizado.

### Resultado

O agendamento deverá passar para o status:

`CONCLUIDO`

---

## 9.6. Registrar não comparecimento

Endpoint conceitual:

`PATCH /api/appointments/:id/no-show`

### Permissão

Barbeiro autorizado.

### Resultado

O agendamento deverá passar para:

`NAO_COMPARECEU`

---

# 10. LISTA DE ESPERA

## 10.1. Entrar na lista de espera

Endpoint conceitual:

`POST /api/waitlist`

### Permissão

Cliente autenticado.

### Dados

- Serviço;
- Data desejada.

### Validações

O backend deverá verificar:

- Cliente autenticado;
- Serviço válido;
- Serviço ativo;
- Data válida;
- Existência de solicitação duplicada, quando aplicável.

---

## 10.2. Visualizar minha lista de espera

Endpoint conceitual:

`GET /api/waitlist/my`

### Permissão

Cliente autenticado.

O cliente somente poderá visualizar suas próprias solicitações.

---

## 10.3. Cancelar entrada na lista

Endpoint conceitual:

`PATCH /api/waitlist/:id/cancel`

### Permissão

Cliente proprietário da solicitação.

---

## 10.4. Lista de espera do barbeiro

Endpoint conceitual:

`GET /api/waitlist`

### Permissão

Barbeiro autorizado.

### Resultado

A API deverá retornar solicitações compatíveis com a agenda e respeitar a ordem de prioridade.

## 10.5. Aceitar claim de vaga

Endpoint:

`POST /api/waitlist/claims/:id/accept`

Cliente autenticado e proprietário do claim. O backend revalida o claim e a
agenda dentro de uma transação, cria um agendamento `CONFIRMADO`, altera o
claim para `ACEITO` e a entrada da lista para `ATENDIDA`.

Claims expirados ou em estado terminal retornam conflito. Um claim de outro
cliente retorna 404 genérico.

## 10.6. Recusar claim de vaga

Endpoint:

`POST /api/waitlist/claims/:id/reject`

Cliente autenticado e proprietário do claim. Um claim ativo e vigente passa
para `RECUSADO`; a entrada da lista permanece `ATIVA` e nenhum agendamento é
criado. Claims expirados ou terminais retornam conflito, e claims de outro
cliente retornam 404 genérico.

---

# 11. NOTIFICAÇÕES

## 11.1. Listar notificações

Endpoint conceitual:

`GET /api/notifications`

### Regra

O usuário somente poderá receber suas próprias notificações.

As notificações são ordenadas da mais recente para a mais antiga e não expõem
`usuario_id`.

Notificações vinculadas a um agendamento (confirmação e cancelamento) retornam
`agendamento_id` opcional no corpo da resposta.

## 11.2. Contar notificações não lidas

Endpoint conceitual:

`GET /api/notifications/unread-count`

Retorna a quantidade de notificações não lidas do usuário autenticado.

---

## 11.3. Marcar notificação como lida

Endpoint conceitual:

`PATCH /api/notifications/:id/read`

### Permissão

Somente o usuário proprietário da notificação.

Operação idempotente. Define `lida = true` e preenche `data_leitura`. Uma
notificação inexistente ou pertencente a outro usuário retorna 404 genérico.

## 11.4. Marcar todas como lidas

Endpoint conceitual:

`PATCH /api/notifications/read-all`

Atualiza somente as notificações não lidas do usuário autenticado e retorna a
quantidade alterada.

---

# 12. MENSAGENS
Comunicação persistente entre CLIENTE e BARBEIRO. Esta etapa implementa apenas a
fundação persistente: **não há WebSocket, chat em tempo real, anexos, edição,
exclusão nem notificação de mensagem**.

O identificador do remetente é **sempre derivado do JWT** (`sub`). O frontend
nunca informa quem envia; informa apenas o destinatário e o conteúdo.

## 12.1. Enviar mensagem
`POST /api/messages`

### Permissão
CLIENTE ou BARBEIRO autenticado e ativo. O barbeiro precisa possuir perfil ativo.

### Dados esperados
- `destinatarioId` — inteiro positivo;
- `conteudo` — texto.

O `remetenteUsuarioId` **não é aceito** no corpo da requisição (é derivado do JWT).

### Regra
Somente CLIENTE ↔ BARBEIRO. São rejeitados:

- CLIENTE → CLIENTE;
- BARBEIRO → BARBEIRO;
- mensagem para si mesmo;
- destinatário inexistente ou inativo;
- barbeiro sem perfil ativo.

O conteúdo é trimado e deve possuir de **1 a 500 caracteres**.

### Resultado
Retorna a mensagem criada com `remetenteUsuarioId`, `destinatarioUsuarioId`,
`conteudo`, `lida`, `dataCriacao` e `dataLeitura`. Nenhum dado sensível
(senha, telefone, e-mail) é retornado.

---

## 12.2. Listar conversa com um usuário
`GET /api/messages/:userId`

### Regra
Somente as mensagens trocadas entre o usuário autenticado e o participante
informado — conversa isolada por par de participantes. Um terceiro usuário nunca
aparece no resultado.

Conversa consigo mesmo é inválida; participante de perfil igual (ou inexistente)
retorna 404, sem revelar a existência do recurso.

### Ordem
Ordem cronológica **crescente** (`dataCriacao`, com `id` como desempate).

---

## 12.3. Listar conversas
`GET /api/messages/conversations`

### Regra
Retorna somente as conversas das quais o usuário autenticado participa, sempre
CLIENTE ↔ BARBEIRO e com o outro participante ativo. Não são criadas conversas
artificiais: usuário com quem nunca houve mensagem não aparece.

### Resposta
Cada conversa retorna:
- `usuarioId` — identificador do outro participante;
- `nome` — nome do outro participante;
- `tipoUsuario` — `CLIENTE` ou `BARBEIRO`;
- `ultimaMensagem` — conteúdo da mensagem mais recente da conversa;
- `ultimaMensagemDataCriacao` — data/hora da última mensagem;
- `naoLidas` — quantidade de mensagens da conversa não lidas pelo usuário
  autenticado (mensagens enviadas pelo próprio usuário não contam).

### Ordenação
A conversa com a mensagem mais recente aparece primeiro (desempate pelo `id`
da mensagem). Nenhum dado sensível (telefone, e-mail, senha/hash) é exposto.

---

## 12.4. Contar mensagens não lidas
`GET /api/messages/unread-count`

Retorna `{ "count": n }`, a quantidade total de mensagens não lidas destinadas
ao usuário autenticado. A identidade vem sempre do JWT; `usuarioId` vindo do
frontend nunca é considerado. Contam somente mensagens com `destinatarioId` do
usuário autenticado e `lida = false`.

---

## 12.5. Marcar mensagem como lida
`PATCH /api/messages/:id/read`

### Permissão
Somente o **destinatário** da mensagem. O remetente não pode marcar a própria
mensagem como lida. Mensagem inexistente, de terceiros ou enviada pelo próprio
remetente retorna 404 genérico.

### Idempotência
Operação idempotente: define `lida = true` e preenche `dataLeitura`. Repetir a
operação retorna sucesso **preservando o primeiro `dataLeitura`** — a segunda
leitura nunca sobrescreve o horário original.

---

## 12.6. Erros do módulo
| Situação | HTTP |
| --- | --- |
| Sem token, token inválido, usuário inativo | 401 |
| Barbeiro sem perfil ativo (como remetente) | 403 |
| CLIENTE → CLIENTE, BARBEIRO → BARBEIRO, mensagem para si mesmo | 400 |
| Conteúdo vazio ou acima de 500 caracteres; payload inválido | 400 |
| Destinatário inexistente/inativo; conversa ou mensagem não acessível | 404 |

---

## 12.7. WebSocket — fundação autenticada (ETAPA 7C.1)

Namespace dedicado:

`/messages` (Socket.IO)

### Autenticação no handshake
- A conexão exige **JWT válido**, informado em `auth.token` (com ou sem o
  prefixo `Bearer`) ou no header `Authorization`.
- O JWT é validado com o mesmo serviço/configuração de autenticação do REST
  (`JwtService` do módulo de autenticação — mesmo segredo e expiração).
- O usuário é revalidado no banco a cada conexão: inexistente, inativo ou
  BARBEIRO sem perfil ativo é **rejeitado** (mesmas regras do `RolesGuard`).
- A identidade (`usuarioId`/`tipoUsuario`) vem **exclusivamente do JWT**;
  nada informado pelo cliente pode defini-la.
- Falhas de autenticação retornam `connect_error` com a mensagem genérica
  `Não autorizado.` (sem expor o motivo).

### Comportamento implementado
- Registro da conexão/desconexão **em memória** (mapeamento usuário →
  sockets), para permitir localizar as conexões de um usuário;
  conexões **não são persistidas** no PostgreSQL (nenhuma tabela/migration).
- Cada socket entra também em uma **sala por usuário** (`usuario:<id>`), o que
  permite entregar um evento a todas as conexões do usuário de uma vez.
- Evento de handshake: o cliente envia `ping` e recebe o evento `pong` com a
  identidade validada:
  ```json
  { "usuarioId": 10, "tipoUsuario": "CLIENTE" }
  ```

---

## 12.8. WebSocket — envio de mensagens em tempo real (ETAPA 7C.2)

### Enviar mensagem (cliente → servidor)
Evento: `message:send`

Payload:
```json
{ "destinatarioId": 123, "conteudo": "Olá!" }
```

O remetente **não** é informado: vem exclusivamente da identidade validada no
handshake JWT. Campos de identidade no payload (`remetenteId`,
`remetenteUsuarioId`, `usuarioId`, `tipoUsuario`) são **rejeitados**.

### Confirmação ao remetente (servidor → remetente)
Evento: `message:sent`

Payload: a mensagem persistida, no mesmo formato seguro do REST
(`id`, `remetenteUsuarioId`, `destinatarioUsuarioId`, `conteudo`, `lida`,
`dataCriacao`, `dataLeitura`). Nunca inclui senha/hash/JWT ou dados internos.

### Entrega ao destinatário (servidor → destinatário)
Evento: `message:received`

O mesmo payload de `message:sent`, entregue a **todas as conexões ativas** do
destinatário (um dispositivo, várias abas ou vários dispositivos recebem a
mesma mensagem).

### Regras aplicadas
São exatamente as mesmas do `POST /api/messages`, pois o gateway delega ao
`MessagesService`: somente CLIENTE ↔ BARBEIRO (sem CLIENTE→CLIENTE,
BARBEIRO→BARBEIRO ou autoenvio), destinatário existente e ativo, remetente
ativo, BARBEIRO com perfil ativo e conteúdo de 1 a 500 caracteres após trim.

### Ordem de execução
1. autenticar o socket (handshake);
2. validar o payload;
3. **persistir** a mensagem no PostgreSQL;
4. somente após o sucesso, emitir `message:sent` ao remetente;
5. somente após o sucesso, emitir `message:received` ao destinatário.

Nunca há emissão de sucesso antes da persistência. Uma única chamada
`message:send` gera exatamente uma persistência, no máximo uma emissão
`message:sent` e uma entrega `message:received` por conexão ativa do
destinatário.

### Destinatário offline
A mensagem é **persistida normalmente** e **nenhum erro é gerado** por não
haver socket conectado. Não existe fila offline nesta etapa: a mensagem é
recuperada depois via REST (`GET /api/messages/:userId`).

### Erros
Validações e violações de regra de negócio resultam em evento `exception` com
mensagem pública e genérica (ex.: `Não autorizado.`, `Dados inválidos.` ou a
mensagem de regra já usada pelo REST). Não são expostos stack trace, SQL, JWT,
senha ou hash.

### Fora do escopo desta etapa
Leitura via WebSocket, `unread-count` via socket, sincronização de leitura em
tempo real, fila offline, presença online/offline, typing indicator, Redis,
filas, push, e-mail, WhatsApp, anexos, edição/exclusão. `PATCH
/api/messages/:id/read` continua sendo REST.

---

## 12.9. WebSocket — revalidação de autorização (ETAPA 7D.1)

Um socket **não permanece autorizado** apenas porque o handshake foi aceito.
Cada `message:send` revalida a autorização vigente **antes** de tocar no banco:

1. **Expiração do JWT** — o handshake guarda no socket apenas o instante de
expiração (`exp`), **nunca o token**. Se o JWT expirar durante a conexão, o
envio é recusado e o socket é encerrado.
2. **Estado atual da conta/perfil** — a autorização é reconferida pelo mesmo
`UsersService.findAuthorizationStateById` usado pelo `RolesGuard`: usuário
desativado após a conexão ou BARBEIRO cujo perfil foi desativado deixa de
poder enviar.

Nenhuma configuração de JWT é duplicada, nada é persistido (sem Redis, sem
sessões, sem tabelas) e nenhuma regra de autorização é reescrita.

Quando a autorização deixa de valer:
- o socket recebe o evento `exception` com `Não autorizado.`;
- o socket é **desconectado** e **removido do registro** (não recebe mais
entregas como destinatário);
- **nada é persistido** pela tentativa recusada.

A recusa é comunicada antes da desconexão, para que o motivo chegue ao
cliente. O erro é genérico — nunca inclui token, JWT, SQL ou stack trace.

### Observação de integração (futuro)
O servidor HTTP atual não configura CORS; quando o frontend (browser)
conectar de outra origem, o CORS do gateway WebSocket deverá ser habilitado
na integração do frontend.

---

# 13. PERFIL

## 13.1. Visualizar perfil

Endpoint conceitual:

`GET /api/profile`

### Permissão

Usuário autenticado.

---

## 13.2. Atualizar perfil

Endpoint conceitual:

`PUT /api/profile`

### Permissão

Usuário autenticado.

### Regra

O usuário somente poderá alterar informações permitidas da própria conta.

---

# 14. HORÁRIOS DE FUNCIONAMENTO

## 14.1. Visualizar horários

Endpoint conceitual:

`GET /api/business-hours`

### Permissão

Conforme necessidade da aplicação.

---

## 14.2. Atualizar horários

Endpoint conceitual:

`PUT /api/business-hours`

### Permissão

Barbeiro autorizado.

### Regra

Alterações não deverão criar automaticamente conflitos com agendamentos existentes.

---

# 15. BLOQUEIOS DE AGENDA

## 15.1. Criar bloqueio

Endpoint conceitual:

`POST /api/schedule-blocks`

### Permissão

Barbeiro autorizado.

### Regra

O backend deverá verificar conflitos com agendamentos existentes.

---

## 15.2. Listar bloqueios

Endpoint conceitual:

`GET /api/schedule-blocks`

### Permissão

Barbeiro autorizado.

---

## 15.3. Remover bloqueio

Endpoint conceitual:

`DELETE /api/schedule-blocks/:id`

### Permissão

Barbeiro autorizado.

---

# 16. EMERGÊNCIA

## 16.1. Criar situação de emergência

Endpoint conceitual:

`POST /api/emergencies`

### Permissão

Barbeiro autorizado.

### Funcionamento

O backend deverá:

1. Registrar a emergência;
2. Identificar os agendamentos afetados;
3. Atualizar os agendamentos conforme as regras;
4. Gerar notificações;
5. Atualizar a disponibilidade.

---

## 16.2. Visualizar emergência

Endpoint conceitual:

`GET /api/emergencies/:id`

### Permissão

Barbeiro autorizado.

---

# 17. RELATÓRIOS

## 17.1. Relatórios operacionais

Endpoint conceitual:

`GET /api/reports`

### Permissão

Barbeiro autorizado.

### Informações permitidas

- Agendamentos;
- Atendimentos concluídos;
- Cancelamentos;
- Faltas;
- Serviços mais agendados;
- Horários mais utilizados;
- Informações da lista de espera.

### Regra

A API não deverá fornecer informações financeiras.

---

# 18. ERROS HTTP

A API deverá utilizar códigos HTTP apropriados.

Exemplos:

`200`
Operação realizada com sucesso.

`201`
Recurso criado com sucesso.

`400`
Dados enviados são inválidos.

`401`
Usuário não autenticado.

`403`
Usuário autenticado, mas sem permissão.

`404`
Recurso não encontrado.

`409`
Conflito de dados ou horário.

`422`
Dados semanticamente inválidos.

`429`
Excesso de requisições, quando aplicável.

`500`
Erro interno do servidor.

---

# 19. SEGURANÇA

Todas as rotas privadas deverão possuir autenticação adequada.

O backend deverá validar:

- Identidade;
- Permissões;
- Dados recebidos;
- Recursos solicitados.

A API deverá evitar:

- Exposição de senhas;
- Exposição de hashes;
- Exposição de dados desnecessários;
- Acesso indevido a outros usuários;
- Alteração de dados sem permissão.

---

# 20. VALIDAÇÃO

Toda entrada recebida pela API deverá ser validada.

A validação deverá ocorrer no backend mesmo quando o frontend já tiver realizado validações.

O frontend melhora a experiência do usuário.

O backend garante a integridade e segurança do sistema.

---

# 21. CONCORRÊNCIA DE AGENDAMENTOS

A criação de agendamentos deverá possuir proteção contra condições de corrida.

Dois clientes não poderão confirmar o mesmo horário simultaneamente.

A implementação deverá utilizar mecanismos adequados de banco de dados e backend para garantir essa regra.

---

# 22. REGRA FINANCEIRA

A API NÃO deverá possuir endpoints relacionados a:

- PIX;
- Pagamentos;
- Cartões;
- Checkout;
- Cobranças;
- Estornos;
- Carteiras;
- Saldo;
- Transferências;
- Dados bancários;
- Gateway de pagamento.

O preço dos serviços possui finalidade exclusivamente informativa.

Não deverá existir qualquer transação financeira na API.

---

# 23. VERSIONAMENTO

A API deverá ser preparada para versionamento.

A estrutura poderá utilizar um padrão semelhante a:

`/api/v1/...`

A versão definitiva deverá ser definida durante a implementação.

---

# 24. DOCUMENTAÇÃO FUTURA

Durante a implementação, os endpoints deverão receber documentação técnica completa contendo:

- Método HTTP;
- URL;
- Autenticação necessária;
- Permissões;
- Parâmetros;
- Corpo da requisição;
- Resposta de sucesso;
- Possíveis erros;
- Exemplos.

A documentação técnica definitiva poderá utilizar uma ferramenta como OpenAPI/Swagger.

---

# 25. REGRA FINAL

A implementação da API deverá respeitar obrigatoriamente:

- `DOCUMENTACAO.md`;
- `TELAS.md`;
- `REGRAS-OBRIGATORIAS.md`;
- `REGRAS-DE-NEGOCIO.md`;
- `BANCO-DE-DADOS.md`.

Caso exista conflito entre uma implementação e essas regras, a implementação deverá ser interrompida e a documentação deverá ser revisada antes de continuar.

Nenhum endpoint financeiro deverá ser criado.