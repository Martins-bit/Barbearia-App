# GUIA DE TESTES

## 1. OBJETIVO

Este documento define como o sistema deverá ser testado durante o desenvolvimento.

Os testes deverão verificar:

- Funcionamento;
- Segurança;
- Regras de negócio;
- Integração;
- Interface;
- API;
- Banco de dados;
- Tratamento de erros;
- Experiência dos principais fluxos.

O objetivo não é apenas verificar se o sistema funciona em situações normais.

Também deverão ser testadas situações inesperadas e tentativas de utilização incorreta.

---

# 2. PRINCÍPIO DOS TESTES

Todo recurso importante deverá possuir testes.

Os testes deverão verificar tanto:

- Casos de sucesso;
- Casos de erro.

Exemplo:

Não basta testar se um cliente consegue criar um agendamento.

Também deverá ser testado se:

- O horário já está ocupado;
- O serviço não existe;
- O serviço está desativado;
- O horário está fora do funcionamento;
- Existe um bloqueio;
- O usuário não está autenticado;
- Outro usuário tenta acessar o agendamento.

---

# 3. TIPOS DE TESTE

O projeto deverá utilizar diferentes níveis de teste.

## 3.1. Testes unitários

Testarão pequenas partes isoladas do sistema.

Exemplos:

- Funções;
- Validações;
- Regras;
- Serviços.

Tecnologia principal:

Vitest.

---

## 3.2. Testes de integração

Verificarão a comunicação entre diferentes partes do sistema.

Exemplos:

- Backend + banco;
- API + serviços;
- Autenticação + banco;
- Agendamento + disponibilidade.

Decisões temporais unitárias podem simular os resultados de consultas com
`clock_timestamp()` e verificar os predicados SQL, inclusive com o relógio da
aplicação adiantado ou atrasado. Isso não comprova o comportamento do PostgreSQL.
Devem ser validados em PostgreSQL isolado a conversão de fuso e calendário,
fronteiras de data/hora, concorrência entre transações, locks, fencing de lease
e rollback atômico de agendamento/claim, notificação e OUTBOX.

---

## 3.3. Testes end-to-end

Verificarão fluxos completos do ponto de vista do usuário.

Tecnologia principal:

Playwright.

Exemplos:

- Cadastro;
- Login;
- Escolha de serviço;
- Escolha de horário;
- Agendamento;
- Cancelamento.

### Isolamento obrigatório do banco E2E

No backend, configure `backend/test/.env.e2e` a partir de
`backend/test/.env.e2e.example`, com PostgreSQL em `127.0.0.1` ou `::1`, porta
explícita `5432`, banco `barbearia_app_e2e`, usuário `barbearia_e2e_test`,
`schema=public`, `JWT_SECRET` exclusivo (mínimo 32 caracteres) e
`NODE_ENV=test`. A role de testes não deve ser dona do schema nem possuir
privilégios administrativos; precisa apenas conectar, usar o schema, manipular
os dados de teste e usar sequences.

Migrations E2E usam uma configuração separada:
`backend/test/.env.e2e.migrate`, criada a partir de
`backend/test/.env.e2e.migrate.example`, com a role não-superusuária
`barbearia_e2e_migrator`. Essa role deve ter somente os privilégios de DDL
necessários no banco isolado. Não reutilize credenciais de `backend/.env`; as
roles precisam ser provisionadas administrativamente.

Execute primeiro `npm run test:e2e:guard` dentro de `backend`; ele testa as
proteções sem conexão. `npm run test:e2e` valida a configuração antes do Jest,
e o setup Jest repete a checagem. A URL é validada por protocolo, host literal
de loopback, porta, banco, role e parâmetros permitidos. Variáveis de conexão
herdadas são removidas do ambiente dos processos filhos. O runner não cria nem
limpa banco.

Depois que um administrador confirmar a finalidade e o isolamento de
`barbearia_app_e2e`, o caminho oficial para aplicar migrations é
`npm run db:e2e:migrate`, que chama `prisma migrate deploy` com
`backend/prisma.e2e.config.ts` fixa. O wrapper rejeita `--config` alternativo.
`E2E_MIGRATION_RUNNER_AUTH=1` é uma confirmação explícita, não prova de que o
runner foi usado; o valor pode ser definido manualmente. A URL, banco, host,
porta e role continuam validados pelo config dedicado.

Quando selecionada, a configuração Prisma padrão exige
`PRISMA_MIGRATION_TARGET=development` e restringe operações de schema a
`barbearia_app` local. Esse guard não se aplica a um arquivo `--config`
arbitrário fornecido diretamente ao Prisma, que pode contornar os controles
locais. O projeto não afirma bloquear universalmente essas configurações; o
limite definitivo depende de roles PostgreSQL com privilégio mínimo.

Os arquivos de diagnóstico `_diag-*` não fazem parte da seleção E2E normal e
não são executados automaticamente. A execução manual também exige a
configuração isolada.

---

## 3.4. Testes da interface

Deverão verificar:

- Responsividade;
- Navegação;
- Formulários;
- Estados;
- Mensagens;
- Botões;
- Componentes;
- Fluxos principais.

---

# 4. AUTENTICAÇÃO

Deverão existir testes para:

- Cadastro válido;
- Cadastro inválido;
- Login válido;
- Login inválido;
- Senha incorreta;
- Usuário inexistente;
- Logout;
- Acesso a rota protegida sem autenticação;
- Sessão inválida;
- Sessão expirada, quando aplicável.

---

# 5. AUTORIZAÇÃO

Deverão existir testes garantindo que:

- Cliente não acessa área administrativa;
- Cliente não acessa dados de outro cliente;
- Cliente não modifica dados de outro cliente;
- Barbeiro acessa somente recursos permitidos;
- Rotas administrativas exigem autorização adequada.

---

# 6. USUÁRIOS

Testar:

- Criação;
- Atualização;
- Consulta;
- Dados inválidos;
- Dados duplicados;
- Usuário desativado;
- Acesso indevido.

---

# 7. SERVIÇOS

Testar:

- Criar serviço;
- Consultar serviço;
- Atualizar serviço;
- Ativar serviço;
- Desativar serviço;
- Serviço inexistente;
- Duração inválida;
- Dados obrigatórios ausentes;
- Serviço desativado não aparecer para novos agendamentos.

---

# 8. DISPONIBILIDADE

Testar:

- Horários disponíveis;
- Horários ocupados;
- Horários parcialmente ocupados;
- Horário fora do funcionamento;
- Horário bloqueado;
- Serviço com duração diferente;
- Data inválida;
- Nenhum horário disponível.

---

# 9. AGENDAMENTOS

Testar:

- Criar agendamento válido;
- Consultar agendamento;
- Listar agendamentos;
- Cancelar;
- Concluir;
- Registrar não comparecimento.

Também testar:

- Serviço inexistente;
- Barbeiro inexistente;
- Cliente inexistente;
- Data inválida;
- Horário inválido;
- Serviço desativado;
- Horário ocupado;
- Horário bloqueado;
- Fora do funcionamento.

## 9.1. OUTBOX de reofertas da lista de espera

Testes unitários devem cobrir persistência da pendência, conclusão com claim,
conclusão sem candidato, retry com backoff, erro permanente, retomada quando o
claim já foi criado, falha isolada por item, renovação de lease, fencing das
transições finais e encerramento após 10 tentativas. Mocks podem verificar a
comparação estrita do prazo com `clock_timestamp()` e simular relógios da
aplicação adiantado/atrasado, além de simular operação demorada e perda de lease;
esses testes não comprovam o comportamento concorrente do PostgreSQL.

As consultas de disponibilidade, confirmação de agendamento e projeção de
notificações que dependem da validade de claims também devem comparar
`expiraEm` com `clock_timestamp()` no PostgreSQL. Seus testes unitários devem
verificar o predicado SQL e cobrir relógios da aplicação adiantado/atrasado;
para confirmar a semântica temporal e de concorrência, usar somente PostgreSQL
isolado.

Testes de integração com PostgreSQL isolado devem verificar:

- elegibilidade de claim ativo usando o relógio real do PostgreSQL;
- retomada da pendência por uma nova instância do worker;
- recuperação de lease vencido;
- aquisição concorrente com `SKIP LOCKED`;
- ausência de claims duplicados em retries concorrentes;
- perda da autorização enquanto a transação de claim/notificação está em curso;
- rollback atômico do claim e da notificação quando o fencing final falha;
- atomicidade entre cada transição de origem e o registro OUTBOX.

Esses testes devem usar exclusivamente o banco E2E isolado descrito neste guia;
testes unitários ou mocks não comprovam concorrência real do PostgreSQL.

---

# 10. CONFLITOS

Testar especialmente:

### Caso 1

Cliente A tenta reservar um horário disponível.

Resultado esperado:

Agendamento criado.

### Caso 2

Cliente B tenta reservar o mesmo horário depois.

Resultado esperado:

Agendamento rejeitado.

### Caso 3

Cliente A e Cliente B tentam reservar o mesmo horário praticamente ao mesmo tempo.

Resultado esperado:

Somente um agendamento deverá ser confirmado.

O sistema não deverá criar dois agendamentos conflitantes.

---

# 11. CANCELAMENTO

Testar:

- Cancelamento dentro do prazo;
- Cancelamento fora do prazo;
- Cancelamento de agendamento inexistente;
- Cancelamento por usuário não autorizado;
- Cancelamento de agendamento já cancelado;
- Cancelamento de agendamento concluído.

Regra atual:

- **CLIENTE:** pode cancelar até o dia anterior ao atendimento e **não** pode cancelar no mesmo dia.
- **BARBEIRO:** pode cancelar no mesmo dia.

---

# 12. LISTA DE ESPERA

Testar:

- Entrada na lista;
- Consulta;
- Cancelamento;
- Serviço inválido;
- Data inválida;
- Entrada duplicada, quando proibida;
- Alteração de disponibilidade;
- Identificação de clientes compatíveis.

---

# 13. NOTIFICAÇÕES

Testar:

- Criação;
- Listagem;
- Marcação como lida;
- Notificação não lida;
- Acesso indevido;
- Notificações relacionadas a agendamento;
- Notificações relacionadas a cancelamento;
- Notificações de emergência.

---

# 14. MENSAGENS

Testar:

- Envio;
- Recebimento;
- Listagem;
- Mensagem vazia;
- Mensagem acima do limite;
- Usuário não autorizado;
- Conversa inexistente.

Regra:

A mensagem deverá possuir de 1 a 500 caracteres (após trim).

---

# 15. HORÁRIOS DE FUNCIONAMENTO

Testar:

- Criação;
- Atualização;
- Consulta;
- Horário válido;
- Horário inválido;
- Início posterior ao fim;
- Alterações que afetem a agenda.

---

# 16. BLOQUEIOS

Testar:

- Criar bloqueio;
- Consultar bloqueio;
- Remover bloqueio;
- Bloqueio inválido;
- Conflito com agendamento;
- Acesso não autorizado.

---

# 17. EMERGÊNCIAS

Testar:

- Criar emergência;
- Consultar emergência;
- Identificar agendamentos afetados;
- Atualizar informações necessárias;
- Criar notificações;
- Acesso não autorizado.

---

# 18. BANCO DE DADOS

Deverão ser testados:

- Relacionamentos;
- Chaves;
- Restrições;
- Dados obrigatórios;
- Integridade referencial;
- Transações;
- Consistência.

O sistema não deverá permitir registros que violem os relacionamentos definidos em `BANCO-DE-DADOS.md`.

---

# 19. API

Cada endpoint importante deverá possuir testes.

Os testes deverão verificar:

- Método HTTP;
- Autenticação;
- Autorização;
- Dados enviados;
- Resposta;
- Status HTTP;
- Erros;
- Dados retornados.

---

# 20. TESTES DE ERRO

A IA responsável pelos testes deverá procurar ativamente por erros.

Não deverá testar somente o caminho esperado.

Deverá tentar encontrar situações como:

- Dados vazios;
- Dados incorretos;
- IDs inexistentes;
- IDs de outros usuários;
- Horários inválidos;
- Requisições duplicadas;
- Operações fora de ordem;
- Acesso sem autenticação;
- Acesso sem permissão.

---

# 21. TESTES DE SEGURANÇA

Deverão ser verificadas tentativas de:

- Acessar dados de outro usuário;
- Modificar recursos de outro usuário;
- Acessar endpoints administrativos;
- Manipular IDs;
- Enviar dados inválidos;
- Utilizar rotas protegidas sem autenticação;
- Expor informações sensíveis.

O objetivo é garantir que o backend não confie no frontend.

---

# 22. TESTES DE INTERFACE

A interface deverá ser testada em diferentes tamanhos de tela.

Deverão ser considerados:

- Desktop;
- Tablet;
- Smartphone.

Testar:

- Navegação;
- Botões;
- Formulários;
- Calendário;
- Horários;
- Modais;
- Mensagens;
- Estados vazios;
- Estados de erro;
- Estados de carregamento.

---

# 23. FLUXO COMPLETO DO CLIENTE

Deverá existir pelo menos um teste completo simulando:

1. Cadastro;
2. Login;
3. Visualização de serviços;
4. Escolha de serviço;
5. Escolha de data;
6. Consulta de horários;
7. Escolha de horário;
8. Confirmação;
9. Visualização do agendamento;
10. Cancelamento.

---

# 24. FLUXO COMPLETO DO BARBEIRO

Deverá existir pelo menos um teste completo simulando:

1. Login;
2. Acesso ao painel;
3. Visualização da agenda;
4. Gerenciamento de serviço;
5. Configuração de horário;
6. Criação de bloqueio;
7. Visualização de lista de espera;
8. Visualização de notificações;
9. Gerenciamento de agendamento.

---

# 25. TESTES DE RESPONSIVIDADE

A interface deverá ser verificada em diferentes resoluções.

Elementos importantes não deverão:

- Sair da tela;
- Sobrepor outros elementos;
- Ficar inacessíveis;
- Possuir texto cortado;
- Possuir botões impossíveis de utilizar.

---

# 26. TESTES DE REGRESSÃO

Sempre que uma funcionalidade importante for alterada, os testes relacionados deverão ser executados novamente.

Alterações em:

- Agendamentos;
- Usuários;
- Serviços;
- Autenticação;
- Disponibilidade;

não deverão quebrar funcionalidades existentes.

---

# 27. TESTES ANTES DA ENTREGA

Antes de considerar uma versão pronta, deverá ser executado:

1. Teste do backend;
2. Teste da API;
3. Teste do banco;
4. Teste da interface;
5. Teste dos fluxos principais;
6. Teste de erros;
7. Teste de segurança;
8. Teste de responsividade.

---

# 28. CRITÉRIO DE APROVAÇÃO

Uma funcionalidade somente deverá ser considerada concluída quando:

- Funcionar no caso normal;
- Possuir validações;
- Possuir tratamento de erro;
- Possuir testes;
- Não quebrar funcionalidades existentes;
- Respeitar as regras de negócio;
- Respeitar a documentação;
- Não criar vulnerabilidades conhecidas.

---

# 29. IA RESPONSÁVEL PELOS TESTES

A IA utilizada durante o desenvolvimento deverá ser orientada a:

- Procurar bugs;
- Criar testes;
- Executar testes;
- Analisar falhas;
- Corrigir problemas;
- Criar novos testes para problemas encontrados;
- Verificar possíveis regressões.

A IA não deverá simplesmente afirmar que o sistema está funcionando.

Ela deverá procurar ativamente situações que possam quebrar o sistema.

---

# 30. REGRA FINANCEIRA

Os testes NÃO deverão criar ou testar:

- PIX;
- Pagamentos;
- Checkout;
- Cartões;
- Cobranças;
- Estornos;
- Carteiras;
- Saldo;
- Transferências;
- Gateway de pagamento.

O sistema não possui transações financeiras.

O preço dos serviços possui apenas finalidade informativa.

---

# 31. DOCUMENTAÇÃO

Os testes deverão respeitar:

- `DOCUMENTACAO.md`;
- `REGRAS-OBRIGATORIAS.md`;
- `TELAS.md`;
- `REGRAS-DE-NEGOCIO.md`;
- `BANCO-DE-DADOS.md`;
- `API.md`;
- `ARQUITETURA.md`;
- `TECNOLOGIAS.md`;
- `GUIA-DA-INTERFACE.md`;
- `GUIA-DO-BACKEND.md`.

---

# 32. REGRA FINAL

O objetivo dos testes é encontrar problemas antes que eles cheguem ao usuário.

Um teste não deverá existir apenas para aumentar a quantidade de testes.

Cada teste deverá possuir uma finalidade clara.

O sistema deverá ser considerado confiável somente depois que os principais fluxos, erros, permissões, regras e situações de concorrência tiverem sido testados adequadamente.

Nenhuma funcionalidade financeira deverá existir ou ser adicionada aos testes.