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

## 7.1. Listar serviços

Endpoint conceitual:

`GET /api/services`

### Objetivo

Retornar os serviços disponíveis para visualização e agendamento.

### Regra

Somente serviços ativos deverão aparecer para novos agendamentos.

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

## 12.1. Enviar mensagem

Endpoint conceitual:

`POST /api/messages`

### Permissão

Cliente ou barbeiro autorizado.

### Regra

A mensagem deverá possuir no máximo:

50 caracteres.

O backend deverá validar esse limite.

---

## 12.2. Listar mensagens

Endpoint conceitual:

`GET /api/messages`

### Regra

O usuário somente poderá visualizar conversas das quais participa.

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