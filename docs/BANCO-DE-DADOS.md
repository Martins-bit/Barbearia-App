# BANCO DE DADOS

## 1. OBJETIVO

O banco de dados será responsável por armazenar as informações necessárias para o funcionamento do aplicativo de gerenciamento e agendamento da barbearia.

O banco deverá garantir:

- Integridade dos dados;
- Segurança;
- Relacionamento entre as informações;
- Controle de acesso;
- Consistência dos agendamentos;
- Histórico operacional.

---

## 2. PRINCIPAIS ENTIDADES

O sistema deverá possuir, inicialmente, as seguintes entidades:

- Usuários;
- Clientes;
- Barbeiros;
- Serviços;
- Agendamentos;
- Lista de espera;
- Notificações;
- Mensagens;
- Solicitações de titulares;
- Horários de funcionamento;
- Bloqueios de agenda;
- Registros de emergência.

A estrutura definitiva deverá ser validada durante a implementação do backend.

---

## 3. USUÁRIOS

A entidade de usuários será responsável pelas informações necessárias para autenticação e controle de acesso.

### Campos principais

- `id`
- `nome`
- `telefone`
- `email`, quando aplicável
- `email_verificado_em`
- `email_confirmacao_obrigatoria`, booleano com padrão `false`
- `senha_hash`
- `tipo_usuario`
- `ativo`
- `data_criacao`
- `data_atualizacao`

### Tipo de usuário

O sistema deverá diferenciar pelo menos:

- `CLIENTE`
- `BARBEIRO`

O tipo de usuário será utilizado para controlar permissões.

### Segurança

A senha nunca deverá ser armazenada em texto puro.

Deverá ser armazenado somente um hash seguro da senha.

O marcador `email_confirmacao_obrigatoria` será ativado apenas para novas
contas criadas pelo fluxo de cadastro e ao definir um novo e-mail. Seu padrão
falso preserva o acesso das contas existentes; a confirmação válida o
desativa. Remover o e-mail invalida a confirmação anterior, mas não deixa a
conta bloqueada sem um endereço confirmável.
Limites públicos de reenvio devem guardar somente HMAC do endereço, contador,
início da janela e instante da última solicitação.

---

## 4. CLIENTES

A entidade de clientes deverá representar os usuários que utilizam o aplicativo para realizar agendamentos.

### Campos principais

- `id`
- `usuario_id`
- informações adicionais permitidas
- `data_criacao`
- `data_atualizacao`

### Relacionamento

Um cliente deverá estar associado a um usuário.

Um cliente poderá possuir vários:

- Agendamentos;
- Entradas na lista de espera;
- Notificações;
- Mensagens.

---

## 5. BARBEIROS

A entidade de barbeiros deverá representar os profissionais que administram a agenda e realizam os atendimentos.

### Campos principais

- `id`
- `usuario_id`
- informações profissionais necessárias
- `ativo`
- `data_criacao`
- `data_atualizacao`

### Relacionamento

Um barbeiro poderá possuir:

- Agendamentos;
- Serviços;
- Horários de funcionamento;
- Bloqueios;
- Notificações;
- Mensagens;
- Registros de emergência.

---

## 6. SERVIÇOS

A entidade de serviços armazenará os serviços oferecidos pela barbearia.

### Campos principais

- `id`
- `barbeiro_id`, quando aplicável
- `nome`
- `descricao`
- `duracao_minutos`
- `preco`
- `ativo`
- `data_criacao`
- `data_atualizacao`

### Regras

`duracao_minutos` deverá representar a duração prevista do serviço.

O preço será armazenado somente para exibição informativa.

O sistema NÃO deverá utilizar esse campo para realizar qualquer transação financeira.

---

## 7. AGENDAMENTOS

A entidade de agendamentos será uma das principais entidades do sistema.

### Campos principais

- `id`
- `cliente_id`
- `barbeiro_id`
- `servico_id`
- `data`
- `hora_inicio`
- `hora_fim`
- `status`
- `observacoes`, quando aplicável
- `data_criacao`
- `data_atualizacao`

### Status possíveis

Inicialmente:

- `CONFIRMADO`
- `CANCELADO`
- `CONCLUIDO`
- `NAO_COMPARECEU`

### Regras

Um agendamento deverá possuir:

- Cliente válido;
- Barbeiro válido;
- Serviço válido;
- Data válida;
- Horário válido.

A duração do serviço deverá ser utilizada para determinar `hora_fim`.

---

## 8. CONTROLE DE CONFLITOS

O backend deverá impedir que existam agendamentos conflitantes para o mesmo barbeiro.

Antes de criar um agendamento, deverá verificar:

- Data;
- Hora de início;
- Hora de término;
- Outros agendamentos ativos;
- Bloqueios;
- Horário de funcionamento.

Essa verificação deverá ocorrer no backend.

O frontend não deverá ser considerado responsável pela proteção contra conflitos.

---

## 9. LISTA DE ESPERA

A entidade de lista de espera armazenará solicitações de clientes interessados em horários que não estão disponíveis.

### Campos principais

- `id`
- `cliente_id`
- `servico_id`
- `data_desejada`
- `status`
- `data_entrada`
- `data_atualizacao`

### Status possíveis

- `ATIVA`
- `NOTIFICADA`
- `ATENDIDA`
- `CANCELADA`
- `EXPIRADA`, quando aplicável

### Prioridade

A prioridade deverá considerar a ordem de entrada.

A informação `data_entrada` poderá ser utilizada para determinar essa ordem.
Ela permanece como `TIMESTAMP(3)` sem fuso e é gerada pelo PostgreSQL no
momento da inserção, com `clock_timestamp()` convertido explicitamente para
UTC. O ID crescente desempata timestamps iguais de forma determinística, mas
não representa, por si só, a ordem cronológica de commit das transações.

### Claims temporários de vaga

O sistema poderá persistir claims temporários associados a uma entrada da lista
de espera. Um claim identifica o slot exato por `barbeiro_id`, `servico_id`,
`data`, `hora_inicio` e `hora_fim`, além de armazenar `expira_em` e seu status.

Os claims não são agendamentos e não alteram o status da entrada da lista. A
validade de um claim `ATIVO` é determinada por `expira_em`; claims expirados
permanecem no histórico e não bloqueiam novos claims. Não existe unicidade
permanente por slot, pois o histórico pode conter claims expirados.

### OUTBOX de reofertas

`WaitlistReofferOutbox` persiste cada evento que libera uma janela e precisa
ser avaliado pela lista de espera. A origem e uma chave idempotente identificam
a transição que gerou o evento; os campos do barbeiro, data e intervalo
preservam a janela a reprocessar.

O estado é `PENDENTE`, `PROCESSANDO`, `CONCLUIDA` ou `FALHA_FINAL`. A tabela
mantém quantidade de tentativas, próxima tentativa, prazo de lease, último
erro, resultado e timestamps. Os índices por estado/data de tentativa e
estado/lease permitem localizar trabalho pronto e recuperar processamento
abandonado. `chaveIdempotencia` é única. Erros permanentes vão diretamente para
`FALHA_FINAL`; falhas transitórias são tentadas no máximo 10 vezes. Se a décima
execução for abandonada, o registro só é encerrado depois do vencimento do
lease, preservando o último erro (ou registrando que o lease expirou no limite).
A investigação operacional deve consultar o registro e os logs do worker por
ID/origem; após corrigir a causa, qualquer reabertura para `PENDENTE` exige uma
operação administrativa controlada. Não existe endpoint ou tela de retry nesta
fase. A consulta inicial pode filtrar `status = 'FALHA_FINAL'` e inspecionar
`id`, `chaveIdempotencia`, `origem`, `origemId`, `tentativas` e `ultimoErro`;
nenhuma alteração manual de estado deve ser feita sem revisar a causa e a
idempotência do evento.

Um `WaitlistClaim` criado pelo processamento possui uma referência opcional e
única ao registro OUTBOX. A referência é gravada na mesma transação do claim e
da notificação, permitindo reconhecer um claim criado antes de uma interrupção
e concluir a pendência sem criar outro. Registros OUTBOX concluídos são
mantidos como histórico e não devem ser removidos enquanto claims referenciados
existirem.

---

## 10. NOTIFICAÇÕES

A entidade de notificações armazenará avisos destinados aos usuários.

### Campos principais

- `id`
- `usuario_id`
- `claim_id`, quando a notificação representar uma oportunidade da lista de espera
- `agendamento_id`, quando a notificação estiver vinculada a um agendamento
- `tipo`
- `titulo`
- `mensagem`
- `lida`
- `data_criacao`
- `data_leitura`, quando marcada como lida

### Tipos possíveis

- Agendamento;
- Cancelamento;
- Lembrete;
- Lista de espera;
- Emergência;
- Aviso;
- Alteração de horário.

Nesta etapa, `WAITLIST_OPPORTUNITY` referencia opcionalmente um
`WaitlistClaim`. A criação do claim e da notificação ocorre na mesma
transação. Os tipos `AGENDAMENTO` (confirmação) e `CANCELAMENTO` referenciam
opcionalmente o `Agendamento` (índice em `agendamento_id`) e são criados na
mesma transação da criação confirmada ou do cancelamento. O tipo `LEMBRETE`
também referencia opcionalmente o `Agendamento` e nunca é gerado em
duplicidade para o mesmo agendamento. Notificações são
registros internos persistentes; não representam push, e-mail, SMS ou
integração externa.

---

## 11. MENSAGENS
A entidade de mensagens armazena a comunicação persistente entre cliente e
barbeiro. O sistema oferece API REST e eventos em tempo real via
WebSocket/Socket.IO.

### Model `Mensagem` (implementado)

| Campo | Tipo | Observação |
| --- | --- | --- |
| `id` | Int (autoincrement) | PK |
| `remetenteId` | Int | FK → `Usuario.id` (relação `MensagensEnviadas`) |
| `destinatarioId` | Int | FK → `Usuario.id` (relação `MensagensRecebidas`) |
| `conteudo` | TEXT | 1 a 500 caracteres após trim |
| `lida` | Boolean | default `false` |
| `dataCriacao` | DateTime | default `now()` |
| `dataLeitura` | DateTime? | preenchido na primeira leitura |
| `apagadaParaTodos` | Boolean | default `false`; flag de exclusão lógica global |
| `excluidaPeloRemetente` | Boolean | default `false`; ocultação lógica para o remetente |
| `excluidaPeloDestinatario` | Boolean | default `false`; ocultação lógica para o destinatário |
| `dataExclusao` | DateTime? | preenchido para exclusão lógica global |

O remetente **nunca** é aceito do frontend: é derivado do JWT.

### Índices finais
| Índice | Colunas | Finalidade |
| --- | --- | --- |
| `Mensagem_remetenteId_idx` | `remetenteId` | mensagens enviadas |
| `Mensagem_destinatarioId_lida_idx` | `destinatarioId`, `lida` | não lidas do destinatário |
| `Mensagem_destinatarioId_dataCriacao_idx` | `destinatarioId`, `dataCriacao` | histórico por destinatário |
| `Mensagem_remetenteId_destinatarioId_dataCriacao_idx` | `remetenteId`, `destinatarioId`, `dataCriacao` | conversa (sentido A → B) |
| `Mensagem_destinatarioId_remetenteId_dataCriacao_idx` | `destinatarioId`, `remetenteId`, `dataCriacao` | conversa (sentido B → A) |

Os dois últimos índices suportam a consulta de conversa, que filtra pelo par de
participantes e ordena por `dataCriacao`.

### Lista de conversas e não lidas (ETAPA 7B)
A lista de conversas consulta as mensagens do usuário autenticado por
`remetenteId` ou `destinatarioId` e agrega em aplicação a última mensagem e as
não lidas por parceiro; o contador global de não lidas filtra por
`destinatarioId + lida`. Os índices existentes (`remetenteId`,
`destinatarioId, lida` e `destinatarioId, dataCriacao`) são suficientes para
essas consultas: nenhuma migration adicional foi necessária e a modelagem de
`Mensagem` permanece inalterada.

### Regra de tamanho
A mensagem é trimada e deve possuir de **1 a 500 caracteres**. O backend valida
esse limite (ver `REGRAS-DE-NEGOCIO.md`).

O campo `conteudo` é `TEXT` no banco; o limite de 500 é aplicado na camada de
aplicação.

### Exclusão lógica

`PARA_MIM` altera a flag de visibilidade do participante que solicitou a
operação. `PARA_TODOS`, permitido ao remetente, atualiza
`apagadaParaTodos` e `dataExclusao`. Em ambos os modos, o campo `conteudo`
permanece armazenado; as flags não representam remoção física imediata do
banco nem descrevem o descarte de backups. As regras e a janela de 60 minutos
estão descritas em `API.md`.

---

## 12. HORÁRIOS DE FUNCIONAMENTO

A entidade de horários de funcionamento deverá armazenar os períodos em que o barbeiro está disponível.

### Campos principais

- `id`
- `barbeiro_id`
- `dia_semana`
- `hora_inicio`
- `hora_fim`
- `ativo`

### Objetivo

Essas informações serão utilizadas no cálculo de disponibilidade dos horários.

---

## 13. BLOQUEIOS DE AGENDA

A entidade de bloqueios permitirá impedir agendamentos em determinados períodos.

### Campos principais

- `id`
- `barbeiro_id`
- `data`
- `hora_inicio`
- `hora_fim`
- `motivo`
- `ativo`
- `data_criacao`

### Exemplos

Um bloqueio poderá representar:

- Compromisso pessoal;
- Intervalo;
- Manutenção;
- Horário indisponível;
- Situação excepcional.

---

## 14. EMERGÊNCIAS

A entidade de emergências deverá registrar situações que afetem a agenda do barbeiro.

### Campos principais

- `id`
- `barbeiro_id`
- `data_inicio`
- `data_fim`
- `motivo`
- `status`
- `data_criacao`

### Objetivo

Permitir registrar e controlar períodos em que o barbeiro não poderá realizar os atendimentos normalmente.

---

## 15. RELACIONAMENTOS PRINCIPAIS

A estrutura deverá possuir relacionamentos semelhantes aos seguintes:

USUARIO
|
+-- CLIENTE
|   |
|   +-- AGENDAMENTOS
|   +-- LISTA DE ESPERA
|   +-- NOTIFICAÇÕES
|   +-- MENSAGENS
|
+-- BARBEIRO
    |
    +-- SERVIÇOS
    +-- AGENDAMENTOS
    +-- HORÁRIOS
    +-- BLOQUEIOS
    +-- NOTIFICAÇÕES
    +-- MENSAGENS
    +-- EMERGÊNCIAS

---

## 16. INTEGRIDADE REFERENCIAL

O banco deverá impedir referências inválidas.

Exemplos:

Um agendamento não poderá apontar para:

- Cliente inexistente;
- Barbeiro inexistente;
- Serviço inexistente.

Uma notificação não poderá apontar para um usuário inexistente.

Uma entrada da lista de espera não poderá apontar para um cliente ou serviço inexistente.

---

## 17. EXCLUSÃO DE DADOS

Dados relacionados ao histórico de agendamentos deverão ser tratados com cuidado.

Não deverão ser apagados registros históricos simplesmente porque:

- Um serviço foi desativado;
- Um cliente deixou de utilizar o aplicativo;
- Um barbeiro alterou sua configuração.

Quando necessário, deverá ser utilizada uma estratégia de desativação em vez de exclusão física.

A estratégia definitiva deverá ser definida durante a implementação.

---

## 18. DATAS E HORÁRIOS

O sistema deverá utilizar um padrão consistente para armazenar datas e horários.

A implementação deverá considerar corretamente:

- Data;
- Horário;
- Fuso horário;
- Horário de funcionamento;
- Horário do atendimento.

O backend deverá ser responsável pela validação das datas e horários recebidos.

---

## 19. SEGURANÇA

O banco deverá armazenar somente as informações necessárias para o funcionamento do sistema.

Credenciais deverão ser armazenadas de forma segura.

Dados privados não deverão ser expostos diretamente ao frontend.

O backend deverá controlar o acesso aos dados.

---

## 20. DADOS FINANCEIROS

O banco de dados NÃO deverá possuir entidades ou tabelas para:

- Pagamentos;
- PIX;
- Cartões;
- Transações;
- Cobranças;
- Estornos;
- Carteiras;
- Saldos;
- Contas bancárias.

O campo `preco` existente em serviços possui finalidade exclusivamente informativa.

Não deverá existir qualquer fluxo financeiro no sistema.

---

## 21. HISTÓRICO OPERACIONAL

O sistema deverá preservar informações necessárias para compreender o histórico dos atendimentos.

Poderão ser mantidos registros de:

- Agendamentos;
- Cancelamentos;
- Conclusões;
- Não comparecimentos;
- Alterações relevantes.

A estrutura definitiva de auditoria poderá ser criada posteriormente caso seja necessária.

---

## 22. PERFORMANCE

O banco deverá ser estruturado considerando consultas frequentes, principalmente:

- Disponibilidade de horários;
- Agendamentos por data;
- Agendamentos por cliente;
- Agendamentos por barbeiro;
- Serviços ativos;
- Lista de espera;
- Notificações não lidas.

Índices deverão ser adicionados conforme a necessidade identificada durante a implementação.

---

## 23. SOLICITAÇÕES DE TITULARES

O modelo `SolicitacaoTitular` registra pedidos do próprio usuário autenticado.
Ele não executa o direito solicitado nem representa atendimento concluído.

### Campos e valores

| Campo | Tipo/Regra |
| --- | --- |
| `id` | Inteiro autoincremental; chave primária |
| `titularId` | Inteiro obrigatório; chave estrangeira para `Usuario.id` |
| `chaveIdempotencia` | UUID obrigatório, usado com o titular para reconhecer repetição |
| `categoria` | Enum: `ACESSO_EXPORTACAO`, `CORRECAO`, `EXCLUSAO_ANONIMIZACAO` ou `OUTRA` |
| `status` | Enum com único valor `RECEBIDA`, definido por padrão no banco |
| `dataCriacao` | Data/hora, definida por padrão no banco |

Não há campo de descrição livre, atribuição ou decisão administrativa.

### Relações, índices e restrições

- `Usuario` possui várias solicitações; cada solicitação pertence a um único
  titular.
- A FK usa `ON DELETE RESTRICT` e `ON UPDATE CASCADE`. Uma conta com
  solicitações vinculadas não pode ser removida fisicamente sem procedimento
  específico autorizado; não há exclusão automática.
- A chave única composta `(titularId, chaveIdempotencia)` permite repetir a
  mesma tentativa sem criar outro registro e isola chaves entre titulares.
- O índice `(titularId, dataCriacao, id)` atende à consulta ordenada e
  paginada das solicitações próprias.

O modelo consta em `backend/prisma/schema.prisma` e a migration aditiva está no
repositório. A existência desses arquivos não confirma que a migration tenha
sido aplicada nos ambientes.

---

## 24. REGRA FINAL

A estrutura do banco de dados deverá sempre respeitar:

- `REGRAS-OBRIGATORIAS.md`;
- `REGRAS-DE-NEGOCIO.md`;
- `TELAS.md`;
- `DOCUMENTACAO.md`.

Nenhuma tabela, campo ou relacionamento relacionado a pagamentos deverá ser criado.

Caso uma nova necessidade seja identificada durante o desenvolvimento, ela deverá ser documentada antes de ser implementada.