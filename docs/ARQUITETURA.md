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

O motor de lembretes (`NotificationsService.processAppointmentReminders`)
identifica agendamentos `CONFIRMADO` cujo `horaInicio` está na janela de
aproximadamente 1 hora e cria a notificação `LEMBRETE` vinculada ao
agendamento, dentro de uma transação serializada por advisory lock próprio
(namespace 5), sem duplicar lembretes. Nesta etapa o motor ainda NÃO possui
execução automática periódica (scheduler/cron); a automação será etapa
posterior e nenhum endpoint público o dispara.

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
propagados. Não há cron, worker ou processamento em background.

---

## 9. AUTENTICAÇÃO

A autenticação deverá ser realizada pelo backend.

O sistema deverá possuir mecanismos seguros para:

- Login;
- Logout;
- Identificação do usuário;
- Controle de sessão;
- Proteção de rotas.

As informações de autenticação deverão ser tratadas de maneira segura.

---

## 10. AUTORIZAÇÃO

O sistema deverá possuir controle baseado no tipo de usuário.

### Cliente

Acesso às funcionalidades destinadas ao cliente.

### Barbeiro

Acesso às funcionalidades administrativas destinadas ao barbeiro.

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