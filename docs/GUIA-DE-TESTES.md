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

O cliente poderá cancelar até um dia antes do atendimento.

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

A mensagem deverá possuir no máximo 50 caracteres.

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