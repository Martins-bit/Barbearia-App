# REGRAS OBRIGATÓRIAS DO PROJETO

## 1. REGRA FINANCEIRA

O aplicativo NÃO possui nenhum sistema de transação financeira.

É PROIBIDO implementar:

- PIX;
- cartão de crédito;
- cartão de débito;
- pagamento em dinheiro dentro do aplicativo;
- pagamento antecipado;
- checkout;
- gateway de pagamento;
- cobrança;
- estorno;
- carteira digital;
- saldo;
- transferência bancária;
- dados bancários;
- dados de cartão;
- confirmação de pagamento;
- histórico de pagamentos;
- qualquer integração financeira.

O aplicativo não deve processar, armazenar ou intermediar qualquer pagamento.

## 2. PREÇOS DOS SERVIÇOS

O preço dos serviços pode ser exibido ao cliente apenas como informação.

O preço NÃO representa uma cobrança realizada pelo aplicativo.

Não deve existir nenhuma etapa de pagamento após o cliente selecionar um serviço ou realizar um agendamento.

## 3. OBJETIVO DO APLICATIVO

O aplicativo tem como objetivo:

- gerenciamento da barbearia;
- gerenciamento dos serviços;
- gerenciamento dos barbeiros;
- gerenciamento dos clientes;
- gerenciamento dos horários;
- realização de agendamentos;
- cancelamento de agendamentos;
- lista de espera;
- notificações;
- lembretes;
- comunicação entre cliente e barbeiro;
- gerenciamento da agenda.

## 4. NÃO INVENTAR FUNCIONALIDADES

Nenhuma IA ou desenvolvedor deve criar automaticamente funcionalidades que não estejam especificadas na documentação.

Caso uma funcionalidade nova seja necessária, ela deve ser discutida e adicionada à documentação antes de ser implementada.

## 5. NÃO ALTERAR REGRAS SEM AUTORIZAÇÃO

Nenhuma regra de negócio definida na documentação deve ser modificada sem autorização.

## 6. SEPARAÇÃO DOS USUÁRIOS

O sistema possui diferentes níveis de acesso.

O cliente não deve acessar funcionalidades exclusivas do barbeiro.

O barbeiro possui acesso às ferramentas administrativas necessárias para gerenciamento da barbearia.

## 7. AGENDAMENTOS

Um horário que já estiver ocupado não pode ser reservado simultaneamente por outro cliente.

A disponibilidade deve considerar:

- horário de funcionamento;
- serviço escolhido;
- duração do serviço;
- agendamentos existentes;
- demais regras definidas na documentação.

## 8. RESPONSIVIDADE

A interface deve funcionar corretamente em:

- celulares;
- tablets;
- computadores.

## 9. PRINCÍPIO GERAL

Sempre seguir a documentação oficial do projeto.

Quando uma informação não estiver definida, NÃO inventar uma solução silenciosamente.

A informação deve ser considerada pendente de definição.