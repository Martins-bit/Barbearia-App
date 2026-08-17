# TELAS DO APLICATIVO

## 1. ÁREA DO CLIENTE

### 1.1. Tela Inicial
### Objetivo

A Tela Inicial será a principal área de acesso do cliente após entrar no aplicativo.

Ela deverá permitir que o cliente encontre rapidamente as principais funções da barbearia, principalmente a realização de um novo agendamento.

### Informações principais

A tela deverá apresentar de forma clara:

- Nome ou identidade visual da barbearia;
- Saudação ao cliente;
- Acesso rápido para realizar um agendamento;
- Resumo do próximo agendamento, quando existir;
- Acesso aos serviços;
- Acesso aos agendamentos do cliente;
- Acesso às notificações;
- Acesso ao perfil.

### Ação principal

A ação mais importante da tela deverá ser:

**Agendar horário**

O botão deverá possuir destaque visual e ser facilmente identificado.

Ao selecionar essa opção, o cliente deverá ser encaminhado para o fluxo de agendamento.

### Próximo agendamento

Caso o cliente possua um agendamento futuro, a tela deverá apresentar um resumo contendo:

- Serviço;
- Data;
- Horário;
- Status do agendamento.

Deverá existir uma opção para visualizar os detalhes do agendamento.

Caso o cliente não possua nenhum agendamento futuro, deverá ser apresentada uma mensagem informando que não existem agendamentos próximos e um botão para realizar um novo agendamento.

### Serviços

A tela poderá apresentar um acesso rápido para os serviços disponíveis na barbearia.

O cliente deverá conseguir visualizar:

- Nome do serviço;
- Descrição, quando disponível;
- Duração;
- Preço, somente como informação.

Nenhum botão ou elemento relacionado a pagamento deverá existir nessa área.

### Navegação

A navegação deverá ser simples e permitir acesso às principais áreas do aplicativo.

As áreas principais serão definidas na documentação conforme o desenvolvimento do projeto.

### Responsividade

A tela deverá funcionar corretamente em:

- celular;
- tablet;
- computador.

A interface deverá se adaptar ao tamanho da tela sem perder informações ou funcionalidades.

### Estados da tela

A tela deverá possuir estados apropriados para diferentes situações:

#### Cliente sem agendamento

Exibir uma mensagem informando que o cliente ainda não possui um próximo agendamento e disponibilizar o botão para realizar um novo agendamento.

#### Cliente com agendamento

Exibir o próximo agendamento de forma destacada.

#### Carregamento

Enquanto os dados estiverem sendo carregados, apresentar um estado de carregamento adequado.

#### Erro

Caso não seja possível carregar as informações, apresentar uma mensagem clara ao usuário e uma opção para tentar novamente.

## 1.2. Tela de Serviços

### Objetivo

A Tela de Serviços permitirá que o cliente conheça os serviços oferecidos pela barbearia antes de realizar um agendamento.

### Informações de cada serviço

Cada serviço deverá apresentar:

- Nome do serviço;
- Descrição, quando disponível;
- Duração estimada;
- Preço, somente como informação.

### Visualização

Os serviços deverão ser apresentados de maneira organizada e fácil de comparar.

Cada serviço poderá ser apresentado em um card contendo suas principais informações.

O design deverá destacar o nome do serviço e permitir que o cliente compreenda rapidamente o que está sendo oferecido.

### Seleção do serviço

O cliente deverá conseguir selecionar um serviço para iniciar o processo de agendamento.

Ao selecionar um serviço, o sistema deverá encaminhar o cliente para a etapa correspondente do agendamento.

### Regra financeira

O preço apresentado nesta tela é exclusivamente informativo.

Não deverá existir:

- botão de pagamento;
- PIX;
- cartão;
- checkout;
- cobrança;
- qualquer tipo de transação financeira.

### Serviço indisponível

Caso um serviço esteja temporariamente indisponível, ele deverá ser identificado visualmente como indisponível.

O cliente não deverá conseguir selecionar um serviço que esteja indisponível para agendamento.

### Nenhum serviço cadastrado

Caso a barbearia ainda não possua serviços cadastrados, deverá ser apresentada uma mensagem informando que não existem serviços disponíveis no momento.

### Carregamento

Enquanto os serviços estiverem sendo carregados, deverá existir um estado visual de carregamento.

### Erro

Caso não seja possível carregar os serviços, deverá ser apresentada uma mensagem clara informando que ocorreu um problema.

Deverá existir uma opção para tentar carregar os serviços novamente.

### Responsividade

A tela deverá funcionar corretamente em:

- celular;
- tablet;
- computador.

A disposição dos cards deverá se adaptar ao tamanho da tela.

## 1.3. Tela de Agendamento

### Objetivo

A Tela de Agendamento permitirá que o cliente escolha o serviço, a data e o horário desejados para realizar seu atendimento.

O processo deverá ser simples e exigir o menor número possível de etapas.

### Etapa 1 — Escolha do serviço

O cliente deverá selecionar o serviço que deseja realizar.

Deverão ser exibidos:

- Nome do serviço;
- Duração;
- Preço, somente como informação.

A duração do serviço deverá ser utilizada pelo sistema para calcular a disponibilidade dos horários.

### Etapa 2 — Escolha da data

Após escolher o serviço, o cliente deverá selecionar o dia desejado.

O calendário deverá indicar visualmente a disponibilidade de cada dia.

A indicação de disponibilidade deverá seguir:

- Verde: muitos horários disponíveis;
- Amarelo: alguns horários disponíveis;
- Laranja: poucos horários disponíveis;
- Vermelho: nenhum horário disponível.

### Etapa 3 — Escolha do horário

Depois de escolher a data, o sistema deverá apresentar somente os horários compatíveis com:

- dia de funcionamento;
- horário de funcionamento;
- serviço selecionado;
- duração do serviço;
- agendamentos existentes;
- demais regras de disponibilidade.

Horários já ocupados não deverão aparecer como disponíveis.

### Confirmação

Antes de finalizar, o cliente deverá visualizar um resumo contendo:

- Serviço escolhido;
- Duração;
- Data;
- Horário;
- Preço, somente como informação.

O cliente deverá possuir uma ação clara para confirmar o agendamento.

### Regra fundamental

Ao confirmar o agendamento:

1. O sistema deverá verificar novamente se o horário continua disponível;
2. O sistema deverá verificar possíveis conflitos;
3. O sistema deverá criar o agendamento;
4. O horário deverá ficar reservado;
5. O cliente deverá receber uma confirmação.

Essa verificação deverá acontecer novamente no momento da confirmação para evitar que dois clientes consigam reservar o mesmo horário simultaneamente.

### Pagamentos

A Tela de Agendamento NÃO deverá possuir qualquer etapa de pagamento.

Não deverá existir:

- PIX;
- cartão;
- checkout;
- pagamento antecipado;
- cobrança;
- estorno;
- gateway;
- qualquer outro tipo de transação financeira.

O cliente apenas realiza o agendamento.

### Horário indisponível

Caso o horário selecionado fique indisponível antes da confirmação, o sistema deverá informar o cliente e solicitar que ele escolha outro horário.

### Nenhum horário disponível

Caso não existam horários disponíveis para a data escolhida, o sistema deverá informar o cliente e oferecer a possibilidade de entrar na lista de espera.

### Agendamento realizado

Após o sucesso do agendamento, deverá ser apresentada uma confirmação contendo:

- serviço;
- data;
- horário;
- status do agendamento.

Também deverá existir uma opção para visualizar os detalhes do agendamento.

### Erro

Caso ocorra um erro durante o processo, o sistema deverá apresentar uma mensagem clara e permitir que o cliente tente novamente sem perder informações desnecessariamente.

### Responsividade

O fluxo de agendamento deverá funcionar corretamente em:

- celular;
- tablet;
- computador.

A interface deverá ser especialmente otimizada para celulares, considerando que o agendamento será uma das principais ações do aplicativo.

## 1.4. Tela Meus Agendamentos

### Objetivo

A Tela Meus Agendamentos permitirá que o cliente visualize e gerencie seus agendamentos realizados na barbearia.

### Organização

Os agendamentos deverão ser organizados de forma clara, priorizando os próximos atendimentos.

Cada agendamento deverá apresentar:

- Serviço;
- Data;
- Horário;
- Duração;
- Status.

### Status do agendamento

O sistema poderá utilizar estados como:

- Confirmado;
- Cancelado;
- Concluído;
- Não compareceu.

Cada status deverá possuir uma identificação visual clara.

### Próximo agendamento

O próximo atendimento do cliente deverá receber maior destaque visual, facilitando sua localização.

### Detalhes

O cliente deverá conseguir abrir um agendamento para visualizar seus detalhes.

Os detalhes deverão apresentar:

- Serviço;
- Data;
- Horário;
- Duração;
- Status;
- Demais informações relevantes do atendimento.

### Cancelamento

Quando permitido pelas regras do sistema, o cliente deverá possuir uma opção para cancelar o agendamento.

Antes de concluir o cancelamento, o sistema deverá apresentar uma confirmação para evitar cancelamentos acidentais.

Após o cancelamento:

1. O agendamento deverá ser atualizado;
2. O horário poderá voltar a ficar disponível;
3. A lista de espera deverá ser analisada, quando aplicável;
4. O cliente deverá receber uma confirmação do cancelamento.

### Regra de prazo

O cancelamento deverá respeitar o prazo definido nas regras de negócio do projeto.

Nenhuma regra relacionada a pagamento ou cobrança deverá ser aplicada ao cancelamento.

### Nenhum agendamento

Caso o cliente ainda não tenha realizado nenhum agendamento, deverá ser apresentada uma mensagem informando que não existem agendamentos.

Deverá existir uma ação para realizar um novo agendamento.

### Carregamento

Enquanto os agendamentos estiverem sendo carregados, deverá ser apresentado um estado de carregamento.

### Erro

Caso não seja possível carregar os agendamentos, deverá ser apresentada uma mensagem clara e uma opção para tentar novamente.

### Responsividade

A tela deverá funcionar corretamente em:

- celular;
- tablet;
- computador.

A visualização deverá continuar organizada mesmo quando o cliente possuir muitos agendamentos.

## 1.5. Tela de Lista de Espera

### Objetivo

A Tela de Lista de Espera permitirá que o cliente solicite uma vaga em um dia que esteja sem horários disponíveis.

### Entrada na lista de espera

Quando não houver horários disponíveis para o dia desejado, o cliente deverá ter a opção de entrar na lista de espera.

Para entrar na lista, o sistema deverá registrar:

- Cliente;
- Serviço desejado;
- Data desejada;
- Data e hora em que entrou na lista;
- Status da solicitação.

### Ordem de prioridade

A lista de espera deverá respeitar a ordem de entrada.

O cliente que entrar primeiro deverá possuir prioridade sobre clientes que entrarem posteriormente.

### Surgimento de uma vaga

Quando um horário for liberado por causa de um cancelamento ou outra alteração na agenda:

1. O sistema deverá identificar os clientes que estão aguardando aquele dia;
2. Deverá respeitar a ordem de prioridade;
3. O primeiro cliente elegível deverá ser notificado;
4. O cliente deverá receber as informações da vaga;
5. O cliente poderá realizar o agendamento.

### Notificação

A notificação deverá informar, quando aplicável:

- Que surgiu uma vaga;
- Data;
- Horário;
- Serviço;
- Prazo para aproveitar a oportunidade.

### Vaga ocupada

Caso outro cliente ocupe a vaga antes da confirmação, o sistema deverá informar que o horário não está mais disponível.

O cliente poderá continuar na lista de espera ou escolher outra opção, de acordo com as regras do sistema.

### Visualização da lista

O cliente deverá conseguir visualizar suas solicitações de lista de espera.

Cada solicitação poderá apresentar:

- Serviço;
- Data desejada;
- Status;
- Data de entrada na lista.

### Cancelamento da espera

O cliente deverá poder retirar uma solicitação da lista de espera enquanto ela ainda estiver ativa.

Após a retirada, a solicitação deverá deixar de participar da ordem de prioridade.

### Nenhuma solicitação

Caso o cliente não possua nenhuma solicitação ativa, deverá ser apresentada uma mensagem informativa e uma opção para procurar horários ou realizar um novo agendamento.

### Erro

Caso ocorra um erro ao carregar ou atualizar a lista de espera, o sistema deverá apresentar uma mensagem clara e permitir uma nova tentativa.

### Regra financeira

A lista de espera não possui qualquer relação com pagamentos.

Não deverá existir:

- pagamento;
- PIX;
- cobrança;
- reserva mediante pagamento;
- qualquer transação financeira.

### Responsividade

A tela deverá funcionar corretamente em:

- celular;
- tablet;
- computador.

## 1.6. Tela de Notificações

### Objetivo

A Tela de Notificações permitirá que o cliente visualize avisos e informações importantes relacionados à sua conta e aos seus agendamentos.

### Tipos de notificações

O sistema poderá gerar notificações relacionadas a:

- Confirmação de agendamento;
- Cancelamento de agendamento;
- Lembrete de atendimento;
- Alteração de horário;
- Surgimento de vaga na lista de espera;
- Avisos enviados pelo barbeiro;
- Alterações relacionadas ao funcionamento da barbearia;
- Situações de emergência.

### Estrutura da notificação

Cada notificação deverá apresentar:

- Título;
- Mensagem;
- Data e horário;
- Indicador de leitura;
- Ação relacionada, quando aplicável.

### Notificações não lidas

As notificações que ainda não foram visualizadas deverão possuir uma identificação visual diferente das notificações já lidas.

A interface poderá apresentar um indicador no ícone de notificações quando existirem novas mensagens.

### Abrir uma notificação

Ao selecionar uma notificação, o cliente deverá conseguir visualizar seu conteúdo completo.

Quando aplicável, a notificação poderá encaminhar o cliente diretamente para a área relacionada.

Exemplo:

Uma notificação informando que surgiu uma vaga poderá encaminhar o cliente para o processo de agendamento.

### Marcar como lida

Ao visualizar uma notificação, ela deverá ser marcada como lida.

O sistema poderá também disponibilizar uma opção para marcar notificações manualmente como lidas.

### Nenhuma notificação

Caso não existam notificações, deverá ser apresentada uma mensagem informando que não existem novos avisos.

### Notificações antigas

Notificações antigas poderão permanecer disponíveis para consulta, respeitando as regras de armazenamento definidas posteriormente no projeto.

### Erro

Caso não seja possível carregar as notificações, deverá ser apresentada uma mensagem clara e uma opção para tentar novamente.

### Responsividade

A tela deverá funcionar corretamente em:

- celular;
- tablet;
- computador.

As notificações deverão permanecer fáceis de ler mesmo em telas pequenas.

## 1.7. Tela de Perfil do Cliente

### Objetivo

A Tela de Perfil permitirá que o cliente visualize e altere suas informações pessoais utilizadas pelo aplicativo.

### Informações

O perfil deverá apresentar:

- Nome;
- Número de telefone;
- Outras informações de conta definidas posteriormente.

### Ações

O cliente deverá poder:

- Editar informações permitidas;
- Salvar alterações;
- Sair da conta.

### Validação

O sistema deverá validar as informações antes de salvar alterações.

Caso exista algum dado inválido, deverá apresentar uma mensagem clara informando o problema.

### Segurança

O cliente somente poderá visualizar e alterar as informações pertencentes à própria conta.

### Responsividade

A tela deverá funcionar corretamente em:

- celular;
- tablet;
- computador.


## 1.8. Tela de Configurações do Cliente

### Objetivo

A Tela de Configurações permitirá que o cliente controle determinadas preferências da sua conta e do aplicativo.

### Possíveis configurações

A tela poderá conter:

- Preferências de notificações;
- Preferências de lembretes;
- Configurações da conta;
- Sair da conta.

As opções deverão ser definidas de acordo com as regras gerais do projeto.

### Sair da conta

Deverá existir uma opção para encerrar a sessão.

Ao sair:

1. A sessão atual deverá ser encerrada;
2. O cliente deverá ser direcionado para a tela de login;
3. Dados privados da conta não deverão permanecer acessíveis.

### Responsividade

A tela deverá funcionar corretamente em:

- celular;
- tablet;
- computador.


# 2. ÁREA DO BARBEIRO

## 2.1. Tela Inicial do Barbeiro

### Objetivo

A Tela Inicial do Barbeiro será o painel principal de gerenciamento da barbearia.

Ela deverá apresentar um resumo das informações mais importantes do dia e fornecer acesso rápido às principais funcionalidades administrativas.

### Informações principais

A tela poderá apresentar:

- Data atual;
- Quantidade de agendamentos do dia;
- Próximos atendimentos;
- Horários ocupados;
- Horários disponíveis;
- Lista de espera;
- Avisos importantes;
- Situações que necessitam de atenção.

### Próximos atendimentos

Deverá existir uma visualização dos próximos clientes agendados.

Cada atendimento poderá apresentar:

- Nome do cliente;
- Serviço;
- Horário;
- Duração;
- Status.

### Ações rápidas

A tela deverá permitir acesso rápido a funcionalidades como:

- Visualizar agenda;
- Gerenciar serviços;
- Gerenciar horários;
- Visualizar clientes;
- Lista de espera;
- Notificações;
- Configurações.

### Responsividade

O painel deverá funcionar corretamente em:

- celular;
- tablet;
- computador.

A versão para computador poderá utilizar uma estrutura de painel administrativo mais ampla.


## 2.2. Tela de Agenda do Barbeiro

### Objetivo

A Tela de Agenda permitirá que o barbeiro visualize e administre os horários de atendimento da barbearia.

### Visualização

A agenda deverá permitir visualizar:

- Dia;
- Horários;
- Clientes;
- Serviços;
- Duração;
- Status dos atendimentos.

### Agendamentos

Cada agendamento deverá apresentar informações suficientes para que o barbeiro identifique rapidamente:

- Cliente;
- Serviço;
- Horário de início;
- Horário de término;
- Status.

### Seleção de agendamento

Ao selecionar um agendamento, o barbeiro deverá conseguir visualizar seus detalhes.

### Ações

De acordo com suas permissões, o barbeiro poderá:

- Visualizar detalhes;
- Alterar informações permitidas;
- Cancelar um atendimento;
- Registrar falta;
- Marcar atendimento como concluído;
- Gerenciar situações relacionadas ao horário.

### Conflitos

O sistema deverá impedir a criação de horários conflitantes.

### Responsividade

A agenda deverá ser especialmente otimizada para telas pequenas, mantendo os horários fáceis de visualizar.


## 2.3. Tela de Detalhes do Agendamento

### Objetivo

Permitir que o barbeiro visualize todas as informações relevantes de um atendimento específico.

### Informações

Deverão ser apresentados:

- Nome do cliente;
- Serviço;
- Data;
- Horário;
- Duração;
- Status;
- Observações, quando existentes.

### Ações

O barbeiro poderá realizar ações permitidas pelas regras do sistema, como:

- Marcar como concluído;
- Registrar não comparecimento;
- Cancelar quando aplicável;
- Visualizar informações do cliente.

### Regra financeira

Não deverá existir nenhuma informação relacionada a pagamentos.


## 2.4. Tela de Serviços do Barbeiro

### Objetivo

Permitir que o barbeiro cadastre e gerencie os serviços oferecidos pela barbearia.

### Informações do serviço

Cada serviço deverá possuir:

- Nome;
- Descrição;
- Duração;
- Preço informativo;
- Status de disponibilidade.

### Ações

O barbeiro deverá poder:

- Criar serviço;
- Editar serviço;
- Ativar serviço;
- Desativar serviço;
- Alterar duração;
- Alterar preço informativo;
- Alterar descrição.

### Exclusão

A exclusão de serviços deverá ser tratada cuidadosamente para não prejudicar históricos de agendamentos existentes.

Quando necessário, o serviço poderá ser desativado em vez de excluído.

### Regra financeira

O preço possui finalidade exclusivamente informativa.

O sistema não deverá processar pagamentos.

### Responsividade

A tela deverá funcionar corretamente em:

- celular;
- tablet;
- computador.


## 2.5. Tela de Horários e Funcionamento

### Objetivo

Permitir que o barbeiro configure os períodos em que estará disponível para atendimento.

### Configurações

O barbeiro deverá conseguir configurar:

- Dias de funcionamento;
- Horário de abertura;
- Horário de encerramento;
- Períodos sem atendimento, quando aplicável.

### Regras

Os horários disponíveis para os clientes deverão ser calculados com base nessas configurações.

O sistema não deverá permitir agendamentos fora dos períodos de funcionamento.

### Alterações

Quando o barbeiro alterar sua disponibilidade, o sistema deverá considerar possíveis agendamentos já existentes.

Alterações que afetem atendimentos existentes deverão gerar avisos apropriados e exigir tratamento adequado.

### Responsividade

A tela deverá ser simples de utilizar tanto no celular quanto no computador.


## 2.6. Tela de Clientes

### Objetivo

Permitir que o barbeiro visualize os clientes cadastrados e informações necessárias para o gerenciamento dos atendimentos.

### Informações

A lista poderá apresentar:

- Nome;
- Telefone;
- Quantidade de agendamentos;
- Informações operacionais permitidas;
- Histórico relacionado aos atendimentos.

### Busca

O barbeiro deverá conseguir pesquisar clientes.

A busca poderá utilizar informações como:

- Nome;
- Número de telefone.

### Perfil do cliente

Ao selecionar um cliente, o barbeiro poderá visualizar informações permitidas e o histórico de atendimentos.

### Privacidade

O barbeiro somente deverá acessar informações necessárias para o funcionamento da barbearia.

Dados desnecessários ou sensíveis não deverão ser exibidos.


## 2.7. Tela de Perfil do Barbeiro

### Objetivo

Permitir que o barbeiro visualize e gerencie suas próprias informações.

### Informações

Poderão ser apresentados:

- Nome;
- Telefone;
- E-mail;
- Informações da barbearia;
- Outras informações definidas posteriormente.

### Ações

O barbeiro deverá poder:

- Editar informações permitidas;
- Salvar alterações;
- Alterar configurações da conta;
- Sair da conta.


## 2.8. Tela de Lista de Espera do Barbeiro

### Objetivo

Permitir que o barbeiro visualize e gerencie clientes que estão aguardando uma oportunidade de agendamento.

### Informações

Cada solicitação deverá apresentar:

- Cliente;
- Serviço;
- Data desejada;
- Data de entrada na lista;
- Status.

### Ordem

A lista deverá respeitar a prioridade definida pelas regras de negócio.

### Vaga liberada

Quando ocorrer um cancelamento ou liberação de horário, o barbeiro deverá conseguir visualizar os clientes que estão aguardando aquela oportunidade.

O sistema deverá respeitar automaticamente a ordem de prioridade.

### Ações

O barbeiro poderá visualizar e administrar as solicitações de acordo com suas permissões.


## 2.9. Tela de Notificações do Barbeiro

### Objetivo

Permitir que o barbeiro visualize avisos importantes relacionados à agenda e ao funcionamento da barbearia.

### Tipos de notificações

Poderão existir notificações sobre:

- Novo agendamento;
- Cancelamento;
- Alteração de agendamento;
- Cliente da lista de espera;
- Avisos importantes;
- Situações de emergência;
- Alterações na agenda.

### Estrutura

Cada notificação deverá apresentar:

- Título;
- Mensagem;
- Data e horário;
- Indicador de leitura;
- Ação relacionada, quando aplicável.

### Notificações não lidas

Notificações ainda não visualizadas deverão possuir identificação visual.


## 2.10. Tela de Mensagens

### Objetivo

Permitir comunicação simples entre cliente e barbeiro.

### Cliente

O cliente poderá enviar uma mensagem ao barbeiro utilizando a funcionalidade definida para comunicação.

A especificação original estabelece limite de até 50 caracteres para a mensagem.

### Barbeiro

O barbeiro deverá conseguir visualizar as mensagens recebidas e responder quando essa funcionalidade estiver disponível.

### Organização

As mensagens deverão apresentar:

- Remetente;
- Conteúdo;
- Data e horário;
- Status, quando aplicável.

### Regra

A comunicação deverá permanecer relacionada ao funcionamento da barbearia e aos atendimentos.

Não deverá existir qualquer função financeira dentro da área de mensagens.


## 2.11. Tela de Configurações do Barbeiro

### Objetivo

Permitir que o barbeiro configure as principais características operacionais da barbearia.

### Configurações

A tela deverá permitir acesso a:

- Perfil;
- Horários de funcionamento;
- Serviços;
- Notificações;
- Preferências;
- Configurações da conta;
- Sistema de emergência.

### Organização

As configurações deverão ser organizadas por categorias para facilitar a navegação.


## 2.12. Tela de Emergência

### Objetivo

Permitir que o barbeiro comunique rapidamente aos clientes quando ocorrer uma situação inesperada que impeça o atendimento.

### Exemplos

A funcionalidade poderá ser utilizada em situações como:

- Problema pessoal;
- Doença;
- Impossibilidade inesperada de atendimento;
- Fechamento emergencial.

### Funcionamento

Ao iniciar uma situação de emergência, o sistema deverá:

1. Permitir que o barbeiro selecione o período afetado;
2. Identificar os agendamentos afetados;
3. Apresentar os clientes que serão afetados;
4. Permitir confirmação da ação;
5. Enviar notificações aos clientes;
6. Atualizar os agendamentos afetados;
7. Atualizar a disponibilidade da agenda.

### Comunicação

O aviso enviado ao cliente deverá explicar claramente que o atendimento foi afetado pela situação emergencial.

### Regra financeira

Nenhuma operação financeira deverá ocorrer como consequência de uma situação de emergência.

Não deverá existir:

- estorno;
- reembolso;
- pagamento;
- cobrança.


## 2.13. Tela de Relatórios Operacionais

### Objetivo

Permitir que o barbeiro visualize informações úteis para entender o funcionamento da agenda e da barbearia.

### Informações

Os relatórios poderão apresentar:

- Quantidade de agendamentos;
- Quantidade de atendimentos concluídos;
- Quantidade de cancelamentos;
- Quantidade de faltas;
- Horários mais ocupados;
- Serviços mais agendados;
- Utilização da agenda;
- Dados relacionados à lista de espera.

### Regra financeira

Não deverão existir relatórios de:

- lucro;
- prejuízo;
- faturamento;
- pagamentos;
- recebimentos;
- transações.

Os relatórios são exclusivamente operacionais.


# 3. TELAS DE AUTENTICAÇÃO

## 3.1. Tela de Login

### Objetivo

Permitir que usuários cadastrados acessem suas contas.

### Campos

O sistema deverá solicitar as informações necessárias para autenticação, conforme definido no cadastro.

### Ações

Deverão existir opções para:

- Entrar;
- Acessar cadastro;
- Recuperar acesso, caso essa funcionalidade seja implementada.

### Erros

Caso os dados estejam incorretos, o sistema deverá apresentar uma mensagem clara sem revelar informações desnecessárias.

### Segurança

As credenciais deverão ser tratadas de maneira segura pelo backend.


## 3.2. Tela de Cadastro

### Objetivo

Permitir que novos clientes criem uma conta.

### Campos

O cadastro deverá conter, no mínimo:

- Nome;
- Número de telefone;
- Senha.

### Validação

O sistema deverá validar:

- Campos obrigatórios;
- Formato dos dados;
- Regras de senha;
- Existência de conta associada ao telefone, quando aplicável.

### Sucesso

Após o cadastro realizado com sucesso, o cliente deverá receber confirmação e poderá ser direcionado para a área principal do aplicativo.


## 3.3. Tela de Recuperação de Acesso

### Objetivo

Permitir que o usuário recupere o acesso à conta caso esqueça suas credenciais.

### Segurança

O processo deverá utilizar um mecanismo seguro de recuperação.

Os detalhes técnicos serão definidos posteriormente na documentação do backend.

---

# 4. ESTADOS GERAIS DAS TELAS

Todas as telas deverão considerar os principais estados da aplicação.

## 4.1. Carregamento

Enquanto os dados estiverem sendo carregados, deverá existir uma indicação visual apropriada.

## 4.2. Estado vazio

Quando não existirem dados para exibir, deverá existir uma mensagem explicativa e, quando possível, uma ação para resolver a situação.

## 4.3. Erro

Quando ocorrer um erro, o usuário deverá receber uma mensagem clara e uma opção de tentar novamente quando isso fizer sentido.

## 4.4. Sucesso

Ações concluídas com sucesso deverão possuir uma confirmação visual apropriada.

## 4.5. Confirmações

Ações importantes ou potencialmente irreversíveis deverão solicitar confirmação antes de serem executadas.

Exemplos:

- Cancelamento de agendamento;
- Exclusão ou desativação de serviço;
- Encerramento de sessão;
- Ações de emergência.

---

# 5. NAVEGAÇÃO

A navegação deverá ser simples, consistente e previsível.

## 5.1. Área do cliente

O cliente deverá conseguir acessar facilmente:

- Tela inicial;
- Serviços;
- Agendamento;
- Meus agendamentos;
- Lista de espera;
- Notificações;
- Perfil;
- Configurações.

## 5.2. Área do barbeiro

O barbeiro deverá conseguir acessar facilmente:

- Painel inicial;
- Agenda;
- Agendamentos;
- Serviços;
- Horários;
- Clientes;
- Lista de espera;
- Notificações;
- Mensagens;
- Relatórios;
- Configurações;
- Emergência.

A disposição final da navegação será definida durante a especificação visual da interface.

---

# 6. RESPONSIVIDADE

Todas as telas deverão ser desenvolvidas considerando diferentes tamanhos de tela.

## 6.1. Celular

O aplicativo deverá priorizar uma experiência simples e rápida.

Os elementos deverão possuir tamanho adequado para interação por toque.

## 6.2. Tablet

A interface deverá aproveitar o espaço adicional sem prejudicar a experiência.

## 6.3. Computador

A interface poderá utilizar:

- menus laterais;
- painéis;
- tabelas;
- calendários maiores;
- múltiplas áreas de informação.

A versão para computador não deverá simplesmente ampliar a versão mobile.

---

# 7. PRINCÍPIOS VISUAIS

A interface deverá seguir uma identidade visual consistente em todas as telas.

### Princípios

- Aparência profissional;
- Interface moderna;
- Organização;
- Boa hierarquia visual;
- Legibilidade;
- Navegação intuitiva;
- Consistência entre telas;
- Feedback visual para ações;
- Responsividade.

A identidade visual definitiva da barbearia deverá ser definida antes da implementação final do frontend.

---

# 8. REGRA DE OURO DA INTERFACE

Nenhuma tela poderá criar funcionalidades financeiras.

Mesmo que uma IA de geração de interface considere comum adicionar pagamento em aplicativos de agendamento, isso NÃO deverá ser implementado neste projeto.

O aplicativo deve permanecer focado em:

**SERVIÇOS + BARBEIRO + CLIENTES + HORÁRIOS + AGENDAMENTOS + LISTA DE ESPERA + NOTIFICAÇÕES + COMUNICAÇÃO + GERENCIAMENTO.**