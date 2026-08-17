# TECNOLOGIAS DO PROJETO

## 1. OBJETIVO

Este documento define as principais tecnologias que deverão ser utilizadas no desenvolvimento do aplicativo de gerenciamento e agendamento da barbearia.

A stack deverá priorizar:

- Segurança;
- Organização;
- Manutenção;
- Desempenho;
- Facilidade de desenvolvimento;
- Facilidade de testes;
- Boa documentação;
- Integração entre frontend e backend.

---

# 2. FRONTEND

## React

O frontend será desenvolvido utilizando React.

Responsabilidades:

- Interface;
- Componentes;
- Navegação;
- Formulários;
- Estados da aplicação;
- Comunicação com a API.

---

## TypeScript

TypeScript será utilizado no frontend para fornecer tipagem estática.

Objetivos:

- Reduzir erros;
- Melhorar manutenção;
- Facilitar refatoração;
- Melhorar autocomplete;
- Tornar o código mais previsível.

---

## Vite

Vite será utilizado como ferramenta de desenvolvimento e build do frontend.

---

## Tailwind CSS

Tailwind CSS será utilizado para construção da interface.

Deverá ser utilizado para:

- Layout;
- Responsividade;
- Espaçamento;
- Tipografia;
- Componentes visuais;
- Estados visuais.

A interface deverá seguir o padrão visual definido em `TELAS.md`.

---

# 3. BACKEND

## Node.js

Node.js será utilizado como ambiente de execução do backend.

---

## TypeScript

O backend também deverá utilizar TypeScript.

Isso permitirá manter uma linguagem principal entre frontend e backend.

---

## NestJS

NestJS será utilizado como framework principal do backend.

Responsabilidades:

- API;
- Controllers;
- Services;
- Regras de negócio;
- Autenticação;
- Autorização;
- Validação;
- Integração com banco de dados;
- Tratamento de erros.

A arquitetura deverá manter separação adequada entre responsabilidades.

---

# 4. BANCO DE DADOS

## PostgreSQL

PostgreSQL será utilizado como banco de dados principal.

O banco deverá armazenar:

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

A estrutura deverá respeitar `BANCO-DE-DADOS.md`.

---

# 5. ORM

## Prisma

Prisma será utilizado como ORM para comunicação entre o backend e o PostgreSQL.

Responsabilidades:

- Modelagem;
- Consultas;
- Migrações;
- Relacionamentos;
- Tipagem;
- Acesso ao banco.

O frontend nunca deverá acessar o Prisma diretamente.

---

# 6. TESTES

## Vitest

Vitest será utilizado principalmente para testes automatizados de:

- Funções;
- Serviços;
- Regras de negócio;
- Validações;
- Componentes, quando aplicável.

---

## Playwright

Playwright será utilizado para testes de fluxo completo.

Exemplos:

- Cadastro;
- Login;
- Agendamento;
- Cancelamento;
- Consulta de horários;
- Lista de espera;
- Fluxos administrativos.

---

# 7. DOCUMENTAÇÃO DA API

## OpenAPI / Swagger

A API deverá possuir documentação utilizando OpenAPI/Swagger.

A documentação deverá apresentar:

- Endpoints;
- Métodos HTTP;
- Parâmetros;
- Autenticação;
- Respostas;
- Erros;
- Schemas.

---

# 8. CONTROLE DE VERSÃO

O projeto deverá utilizar Git para controle de versão.

O código deverá ser organizado em commits claros e relacionados às alterações realizadas.

---

# 9. INTELIGÊNCIA ARTIFICIAL

Ferramentas de inteligência artificial poderão ser utilizadas durante o desenvolvimento.

A IA poderá auxiliar em:

- Desenvolvimento;
- Refatoração;
- Debug;
- Testes;
- Documentação;
- Revisão;
- Análise de erros;
- Melhorias de código.

A IA integrada ao VS Code poderá ser utilizada como principal ferramenta de assistência durante a implementação.

Entretanto, o código gerado deverá sempre respeitar:

- `DOCUMENTACAO.md`;
- `REGRAS-OBRIGATORIAS.md`;
- `TELAS.md`;
- `REGRAS-DE-NEGOCIO.md`;
- `BANCO-DE-DADOS.md`;
- `API.md`;
- `ARQUITETURA.md`.

A IA não deverá criar funcionalidades que não estejam previstas ou que contradigam a documentação.

---

# 10. PADRÃO DE CÓDIGO

O código deverá priorizar:

- Clareza;
- Organização;
- Reutilização;
- Baixo acoplamento;
- Tipagem;
- Nomes descritivos;
- Funções com responsabilidades bem definidas;
- Componentes reutilizáveis.

Código duplicado deverá ser evitado quando houver uma solução mais organizada.

---

# 11. VARIÁVEIS DE AMBIENTE

Informações sensíveis deverão ser armazenadas através de variáveis de ambiente.

Exemplos:

- Credenciais do banco;
- Chaves secretas;
- Configurações privadas;
- Informações de autenticação.

Essas informações não deverão ser inseridas diretamente no código.

Arquivos contendo informações sensíveis não deverão ser enviados para o controle de versão.

---

# 12. SEGURANÇA

As tecnologias escolhidas deverão ser utilizadas seguindo boas práticas de segurança.

O sistema deverá proteger:

- Senhas;
- Sessões;
- Dados pessoais;
- Endpoints;
- Banco de dados;
- Permissões.

---

# 13. RESPONSABILIDADE DAS TECNOLOGIAS

Cada tecnologia deverá possuir uma função clara.

Frontend:

React + TypeScript + Vite + Tailwind CSS

Backend:

Node.js + TypeScript + NestJS

Banco:

PostgreSQL + Prisma

Testes:

Vitest + Playwright

Documentação:

OpenAPI / Swagger

Controle de versão:

Git

---

# 14. REGRA FINANCEIRA

Nenhuma tecnologia relacionada a pagamentos deverá ser adicionada ao projeto.

Não serão utilizados:

- Gateway de pagamento;
- PIX;
- Checkout;
- Carteira digital;
- Sistema de cobrança;
- Processamento de cartões;
- Estorno;
- Transferência financeira.

O campo de preço dos serviços possui somente finalidade informativa.

---

# 15. ALTERAÇÕES FUTURAS

Caso seja necessário alterar alguma tecnologia:

1. A alteração deverá ser justificada;
2. A documentação deverá ser atualizada;
3. A compatibilidade deverá ser analisada;
4. Os testes deverão ser executados;
5. A mudança deverá ser registrada.

Nenhuma tecnologia deverá ser adicionada simplesmente porque uma ferramenta de IA sugeriu.

---

# 16. STACK OFICIAL

A stack inicialmente definida é:

Frontend:
React + TypeScript + Vite + Tailwind CSS

Backend:
Node.js + TypeScript + NestJS

Banco de dados:
PostgreSQL + Prisma

Testes:
Vitest + Playwright

API:
OpenAPI / Swagger

Controle de versão:
Git

Assistência de desenvolvimento:
IA integrada ao VS Code

Esta é a stack oficial do projeto até que uma alteração seja documentada.