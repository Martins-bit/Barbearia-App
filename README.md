# Barbearia do Bruno — Sistema de Agendamento

Sistema de gerenciamento e agendamento desenvolvido para a Barbearia do Bruno.

O objetivo principal do projeto é facilitar o gerenciamento da barbearia e permitir que clientes realizem agendamentos de forma simples, organizada e intuitiva.

---

## Objetivo do projeto

O sistema será desenvolvido para centralizar o gerenciamento da barbearia e seus agendamentos.

Entre as principais funcionalidades estão:

- Cadastro e autenticação de usuários;
- Gerenciamento de clientes;
- Gerenciamento de barbeiros;
- Gerenciamento de serviços;
- Consulta de horários disponíveis;
- Agendamento de serviços;
- Cancelamento de agendamentos;
- Gerenciamento da agenda;
- Lista de espera;
- Notificações;
- Mensagens;
- Horários de funcionamento;
- Bloqueios de agenda;
- Gerenciamento de situações de emergência;
- Relatórios operacionais.

---

## REGRA FUNDAMENTAL — SEM TRANSAÇÕES FINANCEIRAS

Este sistema NÃO possui qualquer tipo de transação financeira.

Não deverá existir no aplicativo:

- PIX;
- Pagamento;
- Checkout;
- Pagamento por cartão;
- Gateway de pagamento;
- Cobrança;
- Carteira digital;
- Saldo;
- Transferência;
- Estorno;
- Assinatura;
- Sistema financeiro.

Os preços dos serviços poderão ser exibidos apenas como informação.

O aplicativo existe exclusivamente para:

- Gerenciamento da barbearia;
- Serviços;
- Clientes;
- Barbeiros;
- Agenda;
- Horários;
- Agendamentos;
- Lista de espera;
- Notificações;
- Comunicação.

---

## Área do cliente

O cliente deverá poder:

- Criar uma conta;
- Fazer login;
- Visualizar serviços;
- Visualizar informações dos serviços;
- Consultar barbeiros;
- Consultar datas disponíveis;
- Consultar horários disponíveis;
- Realizar agendamentos;
- Visualizar seus agendamentos;
- Cancelar agendamentos de acordo com as regras;
- Utilizar a lista de espera;
- Receber notificações;
- Utilizar mensagens;
- Gerenciar seu perfil.

---

## Área do barbeiro

O barbeiro deverá possuir uma área administrativa para:

- Visualizar a agenda;
- Gerenciar agendamentos;
- Gerenciar serviços;
- Gerenciar clientes;
- Gerenciar horários de funcionamento;
- Criar bloqueios;
- Gerenciar lista de espera;
- Visualizar notificações;
- Gerenciar situações de emergência;
- Consultar relatórios operacionais.

Os relatórios não deverão possuir funcionalidades financeiras.

---

## Arquitetura

O sistema será dividido principalmente em:

Frontend
↓
API / Backend
↓
Banco de dados

O frontend será responsável pela interface.

O backend será responsável pelas regras de negócio, segurança e comunicação com o banco.

O banco de dados será responsável pelo armazenamento das informações.

O frontend não deverá acessar diretamente o banco de dados.

---

## Tecnologias

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS

### Backend

- Node.js
- TypeScript
- NestJS

### Banco de dados

- PostgreSQL
- Prisma

### Testes

- Vitest
- Playwright

### API

- OpenAPI / Swagger

### Controle de versão

- Git

---

## Documentação

Toda a documentação detalhada do projeto está localizada na pasta `docs`.

### `DOCUMENTACAO.md`

Visão geral do projeto.

### `REGRAS-OBRIGATORIAS.md`

Regras fundamentais que não devem ser quebradas.

### `TELAS.md`

Definição das telas e dos fluxos da interface.

### `REGRAS-DE-NEGOCIO.md`

Regras que determinam o funcionamento do sistema.

### `BANCO-DE-DADOS.md`

Estrutura e relacionamentos do banco de dados.

### `API.md`

Definição da API e comunicação entre frontend e backend.

### `ARQUITETURA.md`

Arquitetura técnica do sistema.

### `TECNOLOGIAS.md`

Stack oficial utilizada no projeto.

### `GUIA-DA-INTERFACE.md`

Diretrizes para desenvolvimento da interface.

### `GUIA-DO-BACKEND.md`

Diretrizes para desenvolvimento do backend.

### `GUIA-DE-TESTES.md`

Estratégia e regras de testes.

### `INSTRUCOES-PARA-IA.md`

Manual de instruções para ferramentas de inteligência artificial utilizadas no desenvolvimento.

---

## Uso de Inteligência Artificial

A inteligência artificial poderá auxiliar no desenvolvimento do projeto.

Ela poderá ser utilizada para:

- Criar código;
- Criar componentes;
- Desenvolver funcionalidades;
- Criar testes;
- Encontrar erros;
- Corrigir bugs;
- Refatorar código;
- Revisar código;
- Criar documentação;
- Analisar problemas.

A IA deverá obrigatoriamente seguir as instruções presentes em:

`docs/INSTRUCOES-PARA-IA.md`

A documentação existente deverá ser considerada a fonte de verdade do projeto.

A IA não deverá inventar funcionalidades nem alterar regras importantes por conta própria.

---

## Estrutura inicial

Barbearia-App
│
├── docs
│   ├── DOCUMENTACAO.md
│   ├── REGRAS-OBRIGATORIAS.md
│   ├── TELAS.md
│   ├── REGRAS-DE-NEGOCIO.md
│   ├── BANCO-DE-DADOS.md
│   ├── API.md
│   ├── ARQUITETURA.md
│   ├── TECNOLOGIAS.md
│   ├── GUIA-DA-INTERFACE.md
│   ├── GUIA-DO-BACKEND.md
│   ├── GUIA-DE-TESTES.md
│   └── INSTRUCOES-PARA-IA.md
│
├── frontend
├── backend
├── tests
│
└── README.md

---

## Qualidade

O projeto deverá ser testado durante todo o desenvolvimento.

Os testes deverão verificar:

- Funcionamento;
- Regras de negócio;
- Segurança;
- Autenticação;
- Autorização;
- Agendamentos;
- Conflitos de horários;
- Cancelamentos;
- Lista de espera;
- API;
- Banco de dados;
- Interface;
- Responsividade;
- Tratamento de erros.

A IA deverá procurar ativamente por possíveis erros e não apenas testar os casos de sucesso.

---

## Segurança

O sistema deverá priorizar:

- Autenticação segura;
- Autorização;
- Proteção de dados;
- Validação de informações;
- Controle de acesso;
- Proteção do banco;
- Tratamento seguro de erros;
- Uso correto de variáveis de ambiente.

Informações sensíveis não deverão ser armazenadas diretamente no código.

---

## Regra de desenvolvimento

Antes de implementar uma funcionalidade importante:

1. Consultar a documentação;
2. Verificar as regras de negócio;
3. Verificar a arquitetura;
4. Implementar;
5. Criar ou atualizar os testes;
6. Executar os testes;
7. Corrigir possíveis problemas;
8. Atualizar a documentação quando necessário.

---

## Status do projeto

**Em desenvolvimento.**

A documentação está sendo estruturada antes do início da implementação completa do sistema.

---

## Barbearia do Bruno

Sistema desenvolvido exclusivamente para gerenciamento e agendamento da barbearia.

**Sem transações financeiras.**