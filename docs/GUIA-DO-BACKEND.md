# GUIA DO BACKEND

## 1. OBJETIVO

Este documento define as regras técnicas que deverão ser seguidas durante o desenvolvimento do backend do aplicativo de gerenciamento e agendamento da barbearia.

O backend deverá ser:

- Seguro;
- Organizado;
- Testável;
- Previsível;
- Manutenível;
- Responsável pelas regras de negócio;
- Integrado corretamente ao banco de dados;
- Preparado para lidar com erros e situações inesperadas.

---

# 2. TECNOLOGIAS

O backend deverá utilizar a stack definida em `TECNOLOGIAS.md`.

### Tecnologias principais

- Node.js;
- TypeScript;
- NestJS;
- PostgreSQL;
- Prisma;
- Vitest;
- OpenAPI / Swagger.

Não deverão ser adicionadas tecnologias desnecessárias sem justificativa.

---

# 3. PRINCÍPIO FUNDAMENTAL

O backend é a autoridade final do sistema.

O frontend poderá realizar validações para melhorar a experiência do usuário.

Entretanto, o backend deverá validar novamente todas as informações recebidas.

Nunca deverá existir uma regra de segurança que dependa exclusivamente do frontend.

---

# 4. ORGANIZAÇÃO

O backend deverá ser organizado por responsabilidades.

Uma estrutura possível:

backend
|
+-- src
|   |
|   +-- auth
|   +-- users
|   +-- clients
|   +-- barbers
|   +-- services
|   +-- appointments
|   +-- availability
|   +-- waitlist
|   +-- notifications
|   +-- messages
|   +-- business-hours
|   +-- schedule-blocks
|   +-- emergencies
|   +-- reports
|   +-- database
|   +-- common
|   +-- config
|
+-- test
|
+-- prisma
|
+-- .env
+-- package.json

A estrutura poderá ser ajustada durante a implementação quando existir justificativa técnica.

---

# 5. CONTROLLERS

Controllers deverão ser responsáveis por:

- Receber requisições;
- Validar a estrutura básica dos dados;
- Encaminhar as operações para os serviços;
- Retornar respostas apropriadas.

Controllers não deverão concentrar regras de negócio complexas.

---

# 6. SERVICES

Services deverão concentrar a lógica de negócio.

Exemplos:

- Criar agendamento;
- Cancelar agendamento;
- Verificar disponibilidade;
- Criar serviço;
- Atualizar horário;
- Processar lista de espera;
- Criar notificações.

As regras deverão permanecer organizadas e reutilizáveis.

---

# 7. BANCO DE DADOS

O acesso ao banco deverá ser realizado pelo backend através do Prisma.

O frontend nunca deverá acessar o PostgreSQL diretamente.

A estrutura deverá respeitar:

`BANCO-DE-DADOS.md`

---

# 8. AUTENTICAÇÃO

O backend deverá implementar autenticação segura.

Deverá ser possível:

- Criar conta;
- Fazer login;
- Encerrar sessão;
- Identificar usuário autenticado;
- Proteger rotas privadas.

Senhas nunca deverão ser armazenadas em texto puro.

---

# 9. AUTORIZAÇÃO

Cada operação protegida deverá verificar as permissões do usuário.

### Cliente

Poderá acessar recursos relacionados à própria conta.

### Barbeiro

Poderá acessar recursos administrativos permitidos.

O backend deverá impedir que um cliente utilize diretamente uma rota administrativa.

---

# 10. PROTEÇÃO DE RECURSOS

Sempre que uma requisição utilizar um identificador, o backend deverá verificar se o usuário possui autorização para acessar aquele recurso.

Exemplo:

Um cliente não poderá consultar ou modificar o agendamento pertencente a outro cliente apenas alterando o ID na URL.

---

# 11. VALIDAÇÃO

Todos os dados recebidos deverão ser validados.

A validação deverá verificar:

- Tipo;
- Formato;
- Campos obrigatórios;
- Limites;
- Valores permitidos;
- Relacionamentos;
- Regras de negócio.

---

# 12. AGENDAMENTOS

O sistema de agendamento deverá ser tratado como uma funcionalidade crítica.

Ao criar um agendamento, o backend deverá verificar:

1. Usuário autenticado;
2. Permissão;
3. Cliente válido;
4. Barbeiro válido;
5. Serviço válido;
6. Serviço ativo;
7. Data válida;
8. Horário válido;
9. Horário de funcionamento;
10. Bloqueios;
11. Conflitos;
12. Duração do serviço.

---

# 13. CONFLITO DE HORÁRIOS

O backend deverá impedir conflitos.

Exemplo:

Se um barbeiro possui um atendimento das 14:00 às 15:00, outro atendimento que ocupe qualquer parte desse período não poderá ser confirmado.

A verificação deverá considerar a duração do serviço.

---

# 14. CONCORRÊNCIA

O sistema deverá proteger contra duas solicitações simultâneas para o mesmo horário.

A validação deverá ocorrer no momento da gravação.

O banco de dados deverá ser utilizado de maneira adequada para garantir consistência.

---

# 15. DISPONIBILIDADE

A disponibilidade deverá ser calculada pelo backend.

Deverão ser considerados:

- Horário de funcionamento;
- Duração do serviço;
- Agendamentos;
- Bloqueios;
- Data;
- Horário atual, quando aplicável;
- Outras regras definidas em `REGRAS-DE-NEGOCIO.md`.

O frontend não deverá calcular sozinho quais horários realmente podem ser reservados.

---

# 16. CANCELAMENTO

O cancelamento deverá respeitar as regras de negócio.

O cliente poderá cancelar somente quando estiver dentro do prazo permitido.

Regra atual:

Até um dia antes do atendimento.

Após o cancelamento:

- O status deverá ser atualizado;
- O horário deverá ser liberado;
- A disponibilidade deverá ser atualizada;
- A lista de espera poderá ser processada;
- Notificações poderão ser enviadas.

---

# 17. LISTA DE ESPERA

O backend deverá controlar a lista de espera.

Quando um horário ficar disponível, o sistema poderá identificar clientes compatíveis.

A ordem deverá respeitar as regras definidas.

O backend deverá impedir entradas inválidas ou duplicadas quando a regra determinar.

---

# 18. NOTIFICAÇÕES

Notificações deverão ser criadas pelo backend quando eventos relevantes acontecerem.

Exemplos:

- Agendamento confirmado;
- Agendamento cancelado;
- Lembrete;
- Horário liberado;
- Alteração de agenda;
- Emergência;
- Avisos importantes.

---

# 19. MENSAGENS

O backend deverá controlar o envio e recebimento das mensagens.

Cada mensagem deverá:

- Possuir remetente;
- Possuir destinatário;
- Possuir conteúdo;
- Possuir data de criação.

O limite atual é:

50 caracteres.

O backend deverá rejeitar mensagens que ultrapassem esse limite.

---

# 20. SERVIÇOS

O backend deverá permitir o gerenciamento dos serviços.

Operações possíveis:

- Criar;
- Consultar;
- Atualizar;
- Ativar;
- Desativar.

A desativação não deverá apagar automaticamente o histórico.

---

# 21. HORÁRIOS DE FUNCIONAMENTO

O backend deverá validar horários de funcionamento.

Não deverá permitir configurações logicamente inválidas.

Exemplo:

Hora inicial posterior à hora final.

Alterações de horários deverão ser tratadas cuidadosamente quando existirem agendamentos futuros.

---

# 22. BLOQUEIOS

O backend deverá permitir bloqueios de agenda.

Antes de criar um bloqueio, deverá verificar:

- Data;
- Horário;
- Barbeiro;
- Conflitos;
- Regras de negócio.

Caso o bloqueio afete agendamentos existentes, a operação deverá seguir as regras definidas para essa situação.

---

# 23. EMERGÊNCIAS

O sistema deverá permitir registrar situações de emergência.

Ao criar uma emergência, o backend deverá:

1. Registrar a situação;
2. Identificar os agendamentos afetados;
3. Aplicar as regras correspondentes;
4. Atualizar os dados necessários;
5. Criar notificações quando necessário.

---

# 24. TRANSAÇÕES DE BANCO

Operações que envolvam várias alterações relacionadas deverão utilizar transações de banco quando necessário.

Exemplo:

Cancelamento de agendamento que também precise:

- Atualizar o agendamento;
- Liberar disponibilidade;
- Criar notificação;
- Atualizar lista de espera.

O sistema deverá evitar estados parcialmente atualizados.

---

# 25. ERROS

O backend deverá possuir tratamento consistente de erros.

Erros esperados deverão retornar respostas apropriadas.

Erros inesperados deverão:

- Ser registrados;
- Não expor informações internas;
- Retornar uma mensagem segura.

---

# 26. CÓDIGOS HTTP

Deverão ser utilizados códigos HTTP apropriados.

Exemplos:

200 - Sucesso

201 - Criado

400 - Requisição inválida

401 - Não autenticado

403 - Sem permissão

404 - Não encontrado

409 - Conflito

422 - Dados inválidos

429 - Muitas requisições

500 - Erro interno

---

# 27. SEGURANÇA

O backend deverá proteger:

- Senhas;
- Sessões;
- Dados pessoais;
- Endpoints;
- Banco de dados;
- Permissões.

Deverão ser consideradas proteções contra:

- Acesso indevido;
- Manipulação de parâmetros;
- Dados inválidos;
- Exposição de informações;
- Tentativas excessivas de autenticação;
- Outros problemas de segurança relevantes.

---

# 28. VARIÁVEIS DE AMBIENTE

Informações sensíveis deverão ficar em variáveis de ambiente.

Exemplos:

- URL do banco;
- Segredos;
- Chaves;
- Configurações privadas.

Nunca colocar credenciais diretamente no código.

---

# 29. LOGS

O backend deverá possuir logs úteis para diagnóstico.

Os logs poderão registrar:

- Erros;
- Operações importantes;
- Falhas;
- Informações técnicas necessárias.

Não deverão registrar:

- Senhas;
- Tokens sensíveis;
- Dados privados desnecessários.

---

# 30. TESTES

O backend deverá possuir testes automatizados.

Deverão ser testados principalmente:

- Cadastro;
- Login;
- Autenticação;
- Autorização;
- Serviços;
- Disponibilidade;
- Agendamentos;
- Conflitos;
- Cancelamentos;
- Lista de espera;
- Notificações;
- Mensagens;
- Bloqueios;
- Emergências;
- Validações;
- Erros.

---

# 31. TESTES DE SEGURANÇA

Deverão existir testes verificando que:

- Cliente não acessa dados de outro cliente;
- Cliente não acessa funções administrativas;
- Barbeiro não acessa dados não autorizados;
- Rotas privadas exigem autenticação;
- Dados inválidos são rejeitados;
- IDs manipulados não permitem acesso indevido.

---

# 32. TESTES DE AGENDAMENTO

Os testes deverão verificar situações como:

- Horário disponível;
- Horário ocupado;
- Horário parcialmente conflitante;
- Serviço com duração diferente;
- Bloqueio;
- Fora do horário de funcionamento;
- Dois clientes tentando reservar simultaneamente;
- Cancelamento permitido;
- Cancelamento fora do prazo.

---

# 33. DOCUMENTAÇÃO DA API

Todos os endpoints deverão ser documentados.

A documentação deverá informar:

- Método;
- URL;
- Autenticação;
- Permissão;
- Dados recebidos;
- Resposta;
- Erros;
- Exemplos.

A documentação deverá ser compatível com `API.md`.

---

# 34. PADRÃO DE CÓDIGO

O código deverá:

- Ser tipado;
- Possuir nomes claros;
- Evitar duplicação;
- Possuir responsabilidades bem definidas;
- Ser fácil de testar;
- Ser fácil de manter.

Evitar soluções excessivamente complexas quando uma solução simples for suficiente.

---

# 35. IA DO VS CODE

A IA integrada ao VS Code poderá ser utilizada para:

- Implementar funcionalidades;
- Criar testes;
- Encontrar bugs;
- Corrigir erros;
- Refatorar;
- Analisar código;
- Melhorar organização;
- Criar documentação.

Antes de alterar qualquer parte importante, a IA deverá considerar os arquivos da documentação.

A IA não deverá:

- Inventar funcionalidades;
- Criar pagamentos;
- Criar PIX;
- Criar transações;
- Ignorar regras;
- Remover validações;
- Remover testes importantes.

---

# 36. REGRA FINANCEIRA

O backend NÃO deverá possuir nenhuma funcionalidade financeira.

Não deverão existir:

- PIX;
- Pagamentos;
- Checkout;
- Cartões;
- Gateway;
- Cobranças;
- Estornos;
- Carteiras;
- Saldo;
- Transferências;
- Contas bancárias.

O preço existente nos serviços possui finalidade exclusivamente informativa.

Não haverá qualquer tipo de transação dentro do aplicativo.

---

# 37. COMPATIBILIDADE COM A DOCUMENTAÇÃO

O backend deverá respeitar:

- `DOCUMENTACAO.md`;
- `REGRAS-OBRIGATORIAS.md`;
- `TELAS.md`;
- `REGRAS-DE-NEGOCIO.md`;
- `BANCO-DE-DADOS.md`;
- `API.md`;
- `ARQUITETURA.md`;
- `TECNOLOGIAS.md`;
- `GUIA-DA-INTERFACE.md`.

Em caso de conflito, a documentação deverá ser analisada antes da implementação.

---

# 38. REGRA FINAL

O backend deverá ser desenvolvido priorizando:

- Segurança;
- Integridade;
- Consistência;
- Testabilidade;
- Manutenção;
- Clareza.

Nenhuma funcionalidade deverá ser criada apenas porque parece interessante.

Toda funcionalidade deverá possuir justificativa e estar alinhada à documentação do projeto.

O sistema é exclusivamente destinado ao gerenciamento e agendamento da barbearia.

Não deverá existir qualquer fluxo financeiro.