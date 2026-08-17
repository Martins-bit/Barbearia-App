Perfeito. Vamos começar **oficialmente a documentação do projeto**. Vou usar o documento que você enviou como base e já aplicar a decisão nova de **eliminar completamente qualquer transação financeira**. O documento original define cadastro, agenda, serviços, lista de espera, WhatsApp, mensagens, faltas, emergência e configurações do barbeiro; também tinha pagamentos e relatórios financeiros, que serão excluídos. 

# DOCUMENTAÇÃO TÉCNICA E FUNCIONAL

## Sistema de Gestão e Agendamento de Barbearia

**Versão:** 1.0
**Status:** Em desenvolvimento da especificação

---

# 1. VISÃO GERAL DO PROJETO

O projeto consiste em um aplicativo/web app para gerenciamento de uma barbearia e realização de agendamentos entre clientes e barbeiro.

O sistema terá como objetivo principal facilitar a organização dos horários de atendimento, permitir que os clientes consultem os serviços e horários disponíveis e realizem seus próprios agendamentos, além de fornecer ao barbeiro ferramentas para administrar sua agenda, serviços, horários de funcionamento, clientes e situações excepcionais.

O sistema deverá priorizar:

* facilidade de uso;
* organização;
* rapidez para realizar um agendamento;
* visualização clara dos horários disponíveis;
* controle da agenda do barbeiro;
* comunicação entre barbeiro e clientes;
* gerenciamento de lista de espera;
* notificações e lembretes;
* funcionamento adequado em dispositivos móveis e computadores.

---

# 2. REGRA FUNDAMENTAL DO PROJETO

## 2.1. O sistema NÃO possui transações financeiras

Esta é uma regra obrigatória do projeto.

O aplicativo **não deverá possuir nenhum mecanismo de pagamento ou transação financeira**.

Não deverão ser implementados:

* PIX;
* cartão de crédito;
* cartão de débito;
* pagamento em dinheiro pelo aplicativo;
* pagamento antecipado;
* checkout;
* gateway de pagamento;
* cobrança;
* estorno;
* carteira digital;
* saldo;
* dados bancários;
* transferência financeira;
* confirmação de pagamento;
* histórico de pagamentos;
* qualquer integração com instituições financeiras.

O aplicativo não deverá solicitar dados bancários ou dados de cartão dos usuários.

### 2.2. Preço dos serviços

O barbeiro poderá cadastrar o preço de cada serviço.

O preço terá finalidade **exclusivamente informativa**, permitindo que o cliente saiba quanto custa determinado serviço.

O sistema não deverá interpretar o preço como uma cobrança nem deverá criar qualquer etapa de pagamento após o cliente selecionar o serviço.

### 2.3. Finalidade do aplicativo

O aplicativo será focado em:

**Barbeiro + Clientes + Serviços + Agenda + Agendamentos + Lista de espera + Comunicação + Notificações + Gerenciamento da barbearia.**

---

# 3. USUÁRIOS DO SISTEMA

O sistema terá inicialmente dois tipos principais de usuários:

## 3.1. Cliente

É a pessoa que utiliza o aplicativo para consultar os serviços da barbearia e realizar agendamentos.

O cliente deverá poder:

* criar uma conta;
* entrar na própria conta;
* visualizar seu perfil;
* visualizar os serviços oferecidos;
* visualizar preços dos serviços;
* visualizar a duração dos serviços;
* consultar os dias disponíveis;
* consultar horários disponíveis;
* realizar agendamentos;
* visualizar seus agendamentos;
* cancelar agendamentos de acordo com as regras do sistema;
* entrar em uma lista de espera quando não houver horário disponível;
* receber notificações;
* receber lembretes;
* receber avisos relacionados aos seus agendamentos;
* enviar uma mensagem ao barbeiro;
* sair da conta.

O documento original também determina que a área do cliente deve ser simples e limitada às principais ações, incluindo agendar cortes, configurar o perfil e sair da conta. 

---

# 4. BARBEIRO

O barbeiro será o administrador operacional da barbearia dentro do sistema.

Ele terá uma área própria, diferente da área do cliente.

O barbeiro deverá poder:

* cadastrar seus dados;
* acessar sua conta;
* configurar os dias de funcionamento;
* configurar os horários de funcionamento;
* cadastrar serviços;
* editar serviços;
* definir o preço informativo dos serviços;
* definir a duração de cada serviço;
* visualizar sua agenda;
* visualizar os agendamentos;
* administrar os horários disponíveis;
* identificar clientes que não compareceram;
* administrar a lista de espera;
* enviar avisos aos clientes;
* criar promoções informativas;
* utilizar o sistema de emergência;
* visualizar relatórios operacionais.

O documento original prevê que o barbeiro possa configurar nome, telefone, e-mail e senha, além de editar horários, dias, serviços, preços, promoções, duração dos serviços e visualizar relatórios. 

---

# 5. CADASTRO DO CLIENTE

O cliente deverá realizar um cadastro para utilizar o sistema de agendamento.

O cadastro originalmente definido contém:

* nome;
* número de telefone;
* senha.

Após o cadastro, o cliente poderá utilizar suas credenciais para acessar sua conta. 

### Regra

Cada conta deverá estar associada a um cliente específico.

O cliente deverá permanecer autenticado enquanto estiver utilizando sua conta, podendo encerrar a sessão por meio da opção de sair.

---

# 6. SERVIÇOS DA BARBEARIA

O barbeiro deverá possuir uma área para cadastrar e administrar os serviços oferecidos.

Cada serviço deverá possuir, no mínimo:

* nome;
* descrição, caso necessário;
* preço informativo;
* duração;
* disponibilidade.

Exemplos de serviços:

* Corte de cabelo;
* Cabelo + sobrancelha;
* Cabelo + barba;
* Outros serviços definidos pelo barbeiro.

O sistema deverá utilizar a duração configurada para cada serviço para calcular corretamente os horários ocupados na agenda.

### Exemplos de duração definidos no projeto original:

* Corte de cabelo: 30 minutos;
* Cabelo + sobrancelha: 40 minutos;
* Cabelo + barba: 1 hora.

Esses valores são exemplos da especificação original e deverão poder ser alterados pelo barbeiro. 

---

# 7. SISTEMA DE AGENDAMENTO

O sistema de agendamento será uma das principais funcionalidades do aplicativo.

O cliente deverá:

1. escolher o serviço;
2. escolher o dia;
3. visualizar os horários disponíveis;
4. selecionar um horário;
5. confirmar o agendamento.

Após a confirmação, o horário deverá ficar reservado para aquele cliente.

O sistema deverá impedir que dois clientes ocupem simultaneamente o mesmo horário.

---

# 8. CALENDÁRIO

O sistema deverá possuir um calendário mensal para facilitar a escolha do dia do atendimento.

Os dias deverão possuir uma indicação visual da quantidade de horários disponíveis.

A especificação original define:

* **Verde:** muitos horários disponíveis;
* **Amarelo:** alguns horários disponíveis;
* **Laranja:** poucos horários disponíveis;
* **Vermelho:** nenhum horário disponível. 

Essas cores deverão ser utilizadas como orientação visual para facilitar a escolha do cliente.

---

# 9. DURAÇÃO DOS SERVIÇOS E DISPONIBILIDADE

A duração do serviço deverá afetar diretamente a disponibilidade da agenda.

Exemplo:

Se o barbeiro estiver disponível das 08:00 às 12:00 e um serviço possuir duração de 1 hora, um agendamento iniciado às 10:00 ocupará:

**10:00 → 11:00**

O sistema deverá considerar essa duração para impedir conflitos entre agendamentos.

A disponibilidade deverá ser calculada automaticamente de acordo com:

* horário de funcionamento;
* dia de funcionamento;
* duração do serviço;
* agendamentos existentes;
* horários bloqueados, caso essa funcionalidade seja definida posteriormente.

---

# 10. LISTA DE ESPERA

Caso o cliente queira agendar em um dia sem horários disponíveis, deverá existir a possibilidade de entrar em uma lista de espera.

O funcionamento previsto originalmente é:

1. o cliente escolhe o dia desejado;
2. não existem horários disponíveis;
3. o cliente informa que deseja aguardar uma vaga;
4. seu nome fica registrado na lista de espera;
5. caso ocorra um cancelamento, o sistema identifica a vaga;
6. o cliente da lista de espera deverá ser avisado;
7. ele terá a oportunidade de realizar o agendamento;
8. caso não utilize a vaga dentro do período determinado, ela poderá ser oferecida a outro cliente.

A especificação original estabelece prioridade para quem entrou primeiro na lista de espera. 

### Regra de prioridade

A lista deverá utilizar o princípio:

**Primeiro a entrar → primeiro a ser avisado.**

---

# 11. CANCELAMENTO

O cliente deverá poder cancelar um agendamento.

A especificação original estabelece como regra um prazo de até **um dia antes do horário marcado** para o cancelamento. 

Essa regra será mantida como base do projeto, mas qualquer consequência relacionada a pagamento será removida.

Quando um cancelamento válido ocorrer:

* o agendamento deverá ser cancelado;
* o horário deverá voltar a ficar disponível;
* clientes da lista de espera poderão ser considerados;
* notificações poderão ser enviadas.

---

# 12. FALTAS / NÃO COMPARECIMENTO

O barbeiro deverá possuir uma opção para registrar que um cliente não compareceu ao atendimento.

O sistema deverá registrar a ocorrência de falta.

A regra originalmente relacionada à cobrança de um atendimento perdido será **removida**, pois o aplicativo não terá qualquer sistema financeiro.

Portanto, o controle de faltas será utilizado exclusivamente para **gerenciamento da agenda e histórico operacional do cliente**.

As regras exatas para consequências de reincidência de faltas serão definidas posteriormente.

---

# 13. NOTIFICAÇÕES E LEMBRETES

O sistema deverá possuir notificações relacionadas aos agendamentos.

A especificação original prevê:

* confirmação do agendamento;
* aviso ao cliente;
* aviso ao barbeiro;
* lembrete uma hora antes do corte;
* aviso de cancelamento;
* aviso relacionado à lista de espera. 

As notificações deverão ser claras e indicar:

* o que aconteceu;
* data;
* horário;
* serviço, quando aplicável;
* ação que o usuário pode realizar.

---

# 14. COMUNICAÇÃO COM O BARBEIRO

O sistema deverá possuir uma área simples para o cliente enviar um recado ao barbeiro.

A especificação original determina uma caixa de mensagens com limite máximo de **50 caracteres**. 

Essa funcionalidade deverá ser simples e objetiva.

---

# 15. SISTEMA DE EMERGÊNCIA DO BARBEIRO

O barbeiro deverá possuir uma funcionalidade para situações em que não consiga atender em determinado dia.

Exemplos:

* doença;
* problema pessoal;
* impossibilidade inesperada de trabalhar.

Ao acionar o sistema de emergência, o sistema deverá:

1. identificar os agendamentos afetados;
2. avisar os clientes envolvidos;
3. informar que o barbeiro não poderá atender naquele período;
4. cancelar ou marcar os agendamentos como afetados;
5. liberar a agenda conforme a situação;
6. permitir que o barbeiro gerencie a situação.

O documento original também previa estorno para clientes que já tivessem pago. **Essa parte será completamente removida.** 

Não haverá qualquer operação financeira decorrente do sistema de emergência.

---

# 16. PRINCÍPIO DE DESIGN

A interface deverá ser construída pensando principalmente em:

* simplicidade;
* aparência profissional;
* navegação intuitiva;
* poucos passos para realizar um agendamento;
* boa visualização da agenda;
* informações organizadas;
* excelente experiência em celular;
* adaptação para computador;
* diferenciação clara entre área do cliente e área do barbeiro.

A interface deverá evitar excesso de elementos desnecessários.

---

# 17. FUNCIONALIDADES FORA DO ESCOPO

Para evitar que futuras IAs adicionem funcionalidades que não fazem parte do projeto, os seguintes itens estão oficialmente **fora do escopo**:

### Financeiro

* pagamentos;
* PIX;
* cartão;
* dinheiro;
* checkout;
* cobrança;
* estorno;
* gateway;
* carteira;
* saldo;
* dados bancários.

### Outros

Nenhuma funcionalidade adicional deverá ser criada automaticamente apenas porque é comum em aplicativos de barbearia.

Caso uma nova funcionalidade seja desejada, ela deverá ser adicionada à documentação antes de ser implementada.

---

# 18. PRINCÍPIO DE IMPLEMENTAÇÃO

Qualquer IA utilizada no desenvolvimento do projeto deverá seguir esta documentação como fonte de requisitos.

A IA não deverá:

* inventar funcionalidades;
* adicionar pagamentos;
* modificar regras de agendamento sem autorização;
* alterar permissões dos usuários;
* criar telas desnecessárias;
* remover funcionalidades especificadas;
* criar integrações externas sem autorização.

Quando existir alguma informação ainda não definida, a implementação deverá ser considerada **pendente de especificação**, e não deverá ser inventada automaticamente.

---

# 19. PRÓXIMA ETAPA

A próxima parte da documentação deverá detalhar **todas as telas do aplicativo**, começando pela experiência do cliente.

Cada tela será especificada com:

* nome da tela;
* objetivo;
* elementos visuais;
* botões;
* informações exibidas;
* ações possíveis;
* comportamento;
* mensagens de erro;
* estados vazios;
* regras de navegação;
* comportamento em celular;
* comportamento em computador.

Isso permitirá que a IA responsável pelo frontend tenha uma especificação muito mais precisa para construir a interface.
