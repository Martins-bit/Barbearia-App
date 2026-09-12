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

### Claims temporários de vaga

O sistema poderá persistir claims temporários associados a uma entrada da lista
de espera. Um claim identifica o slot exato por `barbeiro_id`, `servico_id`,
`data`, `hora_inicio` e `hora_fim`, além de armazenar `expira_em` e seu status.

Os claims não são agendamentos e não alteram o status da entrada da lista. A
validade de um claim `ATIVO` é determinada por `expira_em`; claims expirados
permanecem no histórico e não bloqueiam novos claims. Não existe unicidade
permanente por slot, pois o histórico pode conter claims expirados.

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

A entidade de mensagens armazenará a comunicação entre cliente e barbeiro.

### Campos principais

- `id`
- `remetente_id`
- `destinatario_id`
- `conteudo`
- `data_criacao`
- `lida`

### Regra de tamanho

A mensagem deverá respeitar o limite definido na documentação de regras de negócio.

Atualmente:

Máximo de 50 caracteres.

O backend deverá validar esse limite.

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

## 23. REGRA FINAL

A estrutura do banco de dados deverá sempre respeitar:

- `REGRAS-OBRIGATORIAS.md`;
- `REGRAS-DE-NEGOCIO.md`;
- `TELAS.md`;
- `DOCUMENTACAO.md`.

Nenhuma tabela, campo ou relacionamento relacionado a pagamentos deverá ser criado.

Caso uma nova necessidade seja identificada durante o desenvolvimento, ela deverá ser documentada antes de ser implementada.