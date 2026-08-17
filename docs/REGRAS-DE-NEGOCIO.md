# REGRAS DE NEGÓCIO

## 1. OBJETIVO

Este documento define as regras que determinam o comportamento do sistema de agendamento e gerenciamento da barbearia.

As regras aqui definidas deverão ser respeitadas pelo frontend, backend e banco de dados.

---

# 2. USUÁRIOS

O sistema possui dois tipos principais de usuários:

- Cliente;
- Barbeiro.

Cada tipo de usuário possui permissões específicas.

---

# 3. CLIENTE

O cliente poderá:

- Criar uma conta;
- Entrar na conta;
- Visualizar serviços;
- Visualizar preços dos serviços;
- Visualizar duração dos serviços;
- Consultar disponibilidade;
- Realizar agendamentos;
- Visualizar seus agendamentos;
- Cancelar agendamentos quando permitido;
- Entrar na lista de espera;
- Sair da lista de espera;
- Receber notificações;
- Visualizar notificações;
- Enviar mensagens ao barbeiro;
- Gerenciar informações permitidas do próprio perfil.

O cliente não poderá:

- Acessar a área administrativa do barbeiro;
- Alterar serviços;
- Alterar horários de funcionamento;
- Alterar dados de outros clientes;
- Alterar configurações administrativas.

---

# 4. BARBEIRO

O barbeiro poderá:

- Acessar o painel administrativo;
- Visualizar a agenda;
- Gerenciar agendamentos;
- Gerenciar serviços;
- Gerenciar horários de funcionamento;
- Visualizar clientes;
- Gerenciar lista de espera;
- Enviar notificações e avisos;
- Utilizar o sistema de emergência;
- Visualizar relatórios operacionais;
- Gerenciar suas próprias configurações.

---

# 5. SERVIÇOS

Cada serviço deverá possuir:

- Nome;
- Descrição;
- Duração;
- Preço informativo;
- Status.

O serviço poderá estar:

- Ativo;
- Inativo.

Serviços inativos não poderão ser selecionados para novos agendamentos.

Serviços que possuam agendamentos antigos não deverão ser excluídos de maneira que prejudique o histórico.

Quando necessário, o serviço deverá ser desativado.

---

# 6. PREÇOS

O preço de um serviço possui finalidade exclusivamente informativa.

O aplicativo não deverá:

- Processar pagamento;
- Solicitar pagamento;
- Confirmar pagamento;
- Armazenar dados financeiros;
- Criar cobranças;
- Realizar estornos.

Não existe qualquer transação financeira dentro do sistema.

---

# 7. HORÁRIOS DE FUNCIONAMENTO

O barbeiro deverá definir os dias e horários em que a barbearia estará disponível.

O sistema deverá impedir novos agendamentos fora do horário de funcionamento.

As configurações de funcionamento deverão ser consideradas no cálculo de disponibilidade.

---

# 8. DURAÇÃO DOS SERVIÇOS

A duração do serviço deverá ser considerada no cálculo da agenda.

Exemplo:

Um serviço com duração de 60 minutos iniciado às 14:00 ocupará o período:

14:00 → 15:00.

Outro cliente não poderá ocupar um horário que cause conflito com esse período.

---

# 9. DISPONIBILIDADE

Um horário somente deverá ser considerado disponível quando:

- O barbeiro estiver trabalhando naquele dia;
- O horário estiver dentro do período de funcionamento;
- O serviço estiver ativo;
- A duração do serviço couber no período disponível;
- Não existir outro agendamento conflitante;
- Não existir bloqueio válido para aquele período.

---

# 10. AGENDAMENTO

Para realizar um agendamento, o cliente deverá:

1. Estar autenticado;
2. Selecionar um serviço ativo;
3. Selecionar uma data;
4. Selecionar um horário disponível;
5. Confirmar o agendamento.

O backend deverá verificar novamente a disponibilidade no momento da confirmação.

Isso é obrigatório para evitar conflitos causados por dois usuários tentando reservar o mesmo horário simultaneamente.

---

# 11. CONFLITO DE AGENDAMENTO

O sistema nunca deverá permitir dois agendamentos conflitantes para o mesmo barbeiro.

Caso dois clientes tentem reservar o mesmo horário:

- O primeiro agendamento processado com sucesso deverá ocupar o horário;
- O segundo deverá ser recusado;
- O segundo cliente deverá receber uma mensagem informando que o horário não está mais disponível.

---

# 12. STATUS DO AGENDAMENTO

Um agendamento poderá possuir estados como:

- Confirmado;
- Cancelado;
- Concluído;
- Não compareceu.

As transições permitidas entre os estados deverão ser controladas pelo backend.

---

# 13. CANCELAMENTO

O cliente poderá cancelar um agendamento quando estiver dentro do prazo permitido.

A regra atualmente definida é:

O cancelamento deverá ser realizado até um dia antes do atendimento.

O sistema deverá impedir cancelamentos fora das regras estabelecidas.

Quando um cancelamento válido acontecer:

1. O agendamento deverá ser atualizado;
2. O horário deverá ser liberado;
3. A disponibilidade deverá ser recalculada;
4. A lista de espera poderá ser acionada;
5. O cliente deverá receber confirmação.

Não deverá existir qualquer cobrança ou consequência financeira.

---

# 14. LISTA DE ESPERA

Quando não houver horário disponível para determinada data e serviço, o cliente poderá entrar na lista de espera.

Cada entrada deverá possuir:

- Cliente;
- Serviço;
- Data desejada;
- Data de entrada;
- Status.

A prioridade deverá respeitar a ordem de entrada.

---

# 15. VAGA LIBERADA

Quando um horário for liberado:

1. O sistema deverá identificar clientes compatíveis na lista de espera;
2. Deverá respeitar a ordem de prioridade;
3. O primeiro cliente elegível deverá ser notificado;
4. O cliente poderá tentar realizar o agendamento.

A vaga não deverá ser considerada automaticamente reservada apenas porque o cliente recebeu a notificação.

---

# 16. FALTA / NÃO COMPARECIMENTO

O barbeiro poderá registrar que o cliente não compareceu.

O sistema deverá armazenar essa informação como parte do histórico operacional.

A falta não deverá gerar:

- Cobrança;
- Pagamento;
- Estorno;
- Transação financeira.

Qualquer regra futura relacionada a reincidência deverá ser adicionada posteriormente à documentação.

---

# 17. NOTIFICAÇÕES

O sistema poderá gerar notificações relacionadas a:

- Agendamento criado;
- Cancelamento;
- Lembrete;
- Alteração;
- Lista de espera;
- Emergência;
- Avisos do barbeiro.

As notificações deverão estar vinculadas ao usuário correto.

Um cliente não poderá visualizar notificações pertencentes a outro cliente.

---

# 18. LEMBRETES

O sistema deverá poder enviar lembretes relacionados aos próximos atendimentos.

A especificação original prevê um lembrete uma hora antes do atendimento.

O mecanismo técnico utilizado para enviar o lembrete será definido posteriormente na documentação técnica.

---

# 19. MENSAGENS

O cliente poderá enviar mensagens ao barbeiro.

A especificação original define limite de até 50 caracteres para a mensagem.

O sistema deverá impedir mensagens que ultrapassem o limite definido.

---

# 20. EMERGÊNCIA

O barbeiro poderá utilizar o sistema de emergência quando não puder atender em determinado período.

O sistema deverá:

1. Identificar os agendamentos afetados;
2. Informar o barbeiro;
3. Solicitar confirmação;
4. Atualizar os agendamentos;
5. Notificar os clientes afetados;
6. Atualizar a disponibilidade.

Não deverá existir qualquer operação financeira.

---

# 21. PRIVACIDADE

O cliente somente poderá acessar informações pertencentes à sua própria conta.

O barbeiro poderá acessar somente as informações de clientes necessárias para administrar os atendimentos e a barbearia.

Usuários não poderão acessar dados de outros usuários sem autorização.

---

# 22. AUTENTICAÇÃO

Usuários deverão estar autenticados para acessar áreas privadas.

O sistema deverá diferenciar as permissões do cliente e do barbeiro.

Uma tentativa de acesso a uma área não autorizada deverá ser bloqueada.

---

# 23. INTEGRIDADE DOS AGENDAMENTOS

O sistema deverá garantir que os dados dos agendamentos permaneçam consistentes.

Não deverá existir:

- Horário negativo;
- Data inválida;
- Serviço inexistente;
- Cliente inexistente;
- Agendamento sem serviço;
- Agendamento sem cliente;
- Conflito de horários.

---

# 24. RELATÓRIOS

Os relatórios deverão ser exclusivamente operacionais.

Poderão apresentar:

- Número de agendamentos;
- Número de atendimentos;
- Cancelamentos;
- Faltas;
- Serviços mais agendados;
- Horários mais utilizados;
- Dados da lista de espera.

Não deverão existir relatórios financeiros.

---

# 25. REGRA FINANCEIRA ABSOLUTA

O sistema não possui nenhum tipo de transação financeira.

Esta regra se aplica a:

- Frontend;
- Backend;
- Banco de dados;
- APIs;
- Notificações;
- Relatórios;
- Testes;
- Integrações.

Não implementar qualquer mecanismo financeiro sem uma alteração explícita na documentação oficial do projeto.

---

# 26. ALTERAÇÕES FUTURAS

Qualquer nova funcionalidade deverá:

1. Ser definida;
2. Ser adicionada à documentação;
3. Ter suas regras especificadas;
4. Ter suas permissões definidas;
5. Ser implementada;
6. Ser testada.

Nenhuma funcionalidade deverá ser adicionada automaticamente apenas por ser comum em aplicativos semelhantes.