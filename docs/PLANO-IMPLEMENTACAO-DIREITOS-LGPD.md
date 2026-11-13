# Plano de Implementação Técnica dos Direitos dos Titulares — Barbearia-App

**Status:** implementação parcial concluída e validada por testes unitários e
builds. A exportação JSON autenticada dos dados próprios, o registro e a
consulta autenticados de solicitações dos titulares e ajustes de minimização de
logs foram implementados; este documento registra os itens ainda bloqueados ou
pendentes de validação operacional.

**Base da análise:** leitura do código e dos documentos existentes em
12/11/2026, incluindo [Inventário de Dados](./INVENTARIO-DE-DADOS-LGPD.md),
[Aviso de Privacidade — Rascunho](./AVISO-DE-PRIVACIDADE-RASCUNHO.md),
[Regras de Negócio](./REGRAS-DE-NEGOCIO.md), [Banco de Dados](./BANCO-DE-DADOS.md)
e [API](./API.md), além da auditoria LGPD registrada anteriormente na conversa.

Este plano não determina base legal, prazo de retenção ou resultado jurídico de
um pedido. Essas decisões pertencem ao controlador, após confirmação de seu
papel e avaliação jurídica. Não é declaração de conformidade com a LGPD.

## 1. Objetivo e princípios de implementação

Planejar mecanismos para que titulares possam consultar, corrigir e solicitar
tratamento de dados relacionados às suas contas, com proteção contra acesso
indevido e com tratamento consistente dos dados relacionados.

Princípios técnicos a preservar:

- Toda operação sobre dados da conta deve derivar a identidade do usuário da
  sessão autenticada, não de um `usuarioId` livremente informado pelo cliente.
- Operações devem verificar autorização por registro e relação, não apenas por
  papel ou identificador.
- Exportações devem conter somente dados do titular e informações necessárias,
  sem segredo, tokens ativos ou dados de terceiros não autorizados.
- Pedidos de exclusão devem ser avaliados com os registros vinculados, sem
  assumir exclusão em cascata nem apagar dados cuja conservação venha a ser
  definida como necessária e válida.
- Prazo de atendimento, prazo de retenção e base legal não serão codificados
  antes da decisão do controlador.
- Toda mudança deverá ser transacional quando envolver várias entidades, ter
  resultado auditável sem copiar indevidamente o conteúdo dos dados e tratar
  concorrência e repetição idempotente.

## 2. Situação de código relevante

- `GET /users/me` e `GET /auth/me` retornam o perfil do próprio usuário;
  `PATCH /users/me` permite atualizar nome, telefone e e-mail. Veja
  [users.controller.ts](../backend/src/users/users.controller.ts),
  [users.service.ts](../backend/src/users/users.service.ts) e
  [auth.controller.ts](../backend/src/auth/auth.controller.ts).
- O DTO de perfil aceita campos limitados e rejeita campos internos. Alteração
  de e-mail invalida tokens de confirmação e redefinição e redefine o estado
  de confirmação.
- Foi implementado `GET /users/me/export`, autenticado para clientes e
  barbeiros; deriva o titular da sessão, devolve JSON para download e informa
  suas limitações. Não é uma exportação integral.
- Agendamentos são consultados por cliente ou barbeiro e cancelados por mudança
  de estado; não foi encontrado mecanismo de eliminação geral do histórico.
  Veja [appointments.controller.ts](../backend/src/appointments/appointments.controller.ts)
  e [appointments.service.ts](../backend/src/appointments/appointments.service.ts).
- Lista de espera pode ser consultada e cancelada pelo cliente; claims,
  notificações e outbox são relacionados. Veja
  [waitlist.controller.ts](../backend/src/waitlist/waitlist.controller.ts),
  [waitlist.service.ts](../backend/src/waitlist/waitlist.service.ts) e
  [schema.prisma](../backend/prisma/schema.prisma).
- Mensagens possuem “apagar para mim” e “apagar para todos”, mas o código
  mantém o conteúdo no banco e controla visibilidade por flags; ambas as
  operações não concluídas estão sujeitas à janela funcional de 60 minutos
  (repetições idempotentes concluídas retornam sucesso). Veja
  [messages.controller.ts](../backend/src/messages/messages.controller.ts),
  [messages.service.ts](../backend/src/messages/messages.service.ts) e
  [DeleteMessageDto](../backend/src/messages/dto/delete-message.dto.ts).
- Notificações podem ser limpas pelo usuário, porém a ação altera o marcador
  `limpa` em vez de apagar fisicamente os registros. Veja
  [notifications.controller.ts](../backend/src/notifications/notifications.controller.ts)
  e [notifications.service.ts](../backend/src/notifications/notifications.service.ts).
- Tokens de confirmação e recuperação têm validade e marca de uso; não foi
  localizada rotina geral para apagar tokens expirados/usados. Veja
  [email-verification.service.ts](../backend/src/auth/email-verification.service.ts)
  e [password-recovery.service.ts](../backend/src/auth/password-recovery.service.ts).
- Registros de rate limit e a outbox de reofertas têm dados persistidos. O
  processamento revisado grava categoria genérica ou código/status técnico em
  `ultimoErro` e usa mensagens de log genéricas; valores históricos, demais
  logs externos e backups não foram verificados.

## 3. Consulta e exportação dos dados do próprio usuário

### Implementado

- `GET /users/me/export` gera resposta JSON a partir do identificador autenticado
  obtido pelo controller; não aceita ID de titular fornecido pelo cliente.
- Inclui dados de conta/perfil, dados relacionados ao perfil de barbeiro,
  agendamentos, lista de espera/claims, metadados visíveis de mensagens e
  notificações não limpas, limitados ao usuário e às relações consultáveis.
- Exclui credenciais, hashes, tokens, conteúdo de mensagens, dados do outro
  participante, registros de mensagem apagados para todos/ocultados para o
  titular e textos livres (incluindo observações, motivos e textos de
  notificações). O JSON informa essas limitações. A resposta usa cabeçalhos
  anti-cache e `nosniff`, nome de download fixo e o throttler existente limita
  três requisições por usuário/minuto. O frontend baixa o JSON sem criar arquivo
  persistente no servidor.
- Os perfis de cliente e barbeiro oferecem a ação de download. Testes cobrem
  escopo por titular, omissão de campos/conteúdo sensível e identidade derivada
  da sessão.

### Falta ou permanece pendente

- A exportação é deliberadamente limitada, não cobre conteúdo de mensagens,
  observações livres, notificações limpas ou solicitações que não são
  armazenadas; não deve ser apresentada como abrangente.
- Escopo final, necessidade de incluir dados de terceiros e procedimento para
  titulares sem conta ou representantes dependem de avaliação/decisão.
- O registro persistente e a API autenticada para criar e consultar solicitações
  próprias já existem; isso registra o pedido e permite ao titular consultá-lo,
  mas não fornece canal operacional, triagem, atendimento ou conclusão. Ver a
  seção 12. A aplicação da migration nos ambientes não foi verificada.
- Autenticação recente, limites operacionais e processo formal de entrega
  precisam ser avaliados antes de ampliar o escopo.

### Arquivos/superfícies envolvidos

- Backend: [users.controller.ts](../backend/src/users/users.controller.ts),
  [users.service.ts](../backend/src/users/users.service.ts),
  [appointments.controller.ts](../backend/src/appointments/appointments.controller.ts),
  [appointments.service.ts](../backend/src/appointments/appointments.service.ts),
  [waitlist.controller.ts](../backend/src/waitlist/waitlist.controller.ts),
  [waitlist.service.ts](../backend/src/waitlist/waitlist.service.ts),
  [messages.controller.ts](../backend/src/messages/messages.controller.ts),
  [messages.service.ts](../backend/src/messages/messages.service.ts),
  [notifications.controller.ts](../backend/src/notifications/notifications.controller.ts),
  [notifications.service.ts](../backend/src/notifications/notifications.service.ts).
- Frontend: [authService.ts](../frontend/src/services/api/authService.ts),
  páginas de perfil em
  [ClientePerfilPage.tsx](../frontend/src/pages/cliente/ClientePerfilPage.tsx)
  e [BarbeiroPerfilPage.tsx](../frontend/src/pages/barbeiro/BarbeiroPerfilPage.tsx),
  [downloadJson.ts](../frontend/src/utils/downloadJson.ts).
- Contrato: [API.md](./API.md), [TELAS.md](./TELAS.md) e
  [GUIA-DA-INTERFACE.md](./GUIA-DA-INTERFACE.md).

### Próximos passos

1. Manter a exportação limitada até decisão documentada sobre mensagens,
   observações livres e dados de terceiros; não afirmar cobertura integral.
2. Executar e revisar os testes direcionados e builds; corrigir somente
   problemas diretamente relacionados à implementação.
3. Após confirmação do controlador, avaliar necessidade de autenticação
   recente, limites adicionais e ampliação segura do conjunto de dados.
4. Não armazenar cópia adicional da exportação nem criar processamento
   assíncrono sem necessidade operacional comprovada.
5. O registro persistente das solicitações já existe nesta primeira fase.
   Qualquer ampliação de schema ou migration depende de nova justificativa,
   revisão e autorização; não aplicar mudanças de banco como parte deste plano.

## 4. Correção dos dados pessoais

### Já existe

- `PATCH /users/me` permite corrigir nome, telefone e e-mail do próprio usuário.
- Validação de formato, conflitos de unicidade e whitelist de campos.
- Mudança efetiva de e-mail invalida confirmação e tokens pendentes,
  incrementa `authVersion` e revoga sessões/JWTs existentes. Após confirmar o
  endereço novo, o usuário precisa fazer login novamente.
- Barbeiros e clientes usam os formulários de perfil existentes.

### Falta

- Processo claro para corrigir dados não editáveis diretamente no perfil, como
  atributos derivados ou dados vinculados a registros históricos.
- Definir como pedidos de correção afetam mensagens, notificações, agendamentos
  já concluídos e registros de auditoria.
- Registrar atendimento sem criar histórico excessivo de dados antigos.

### Arquivos envolvidos

- [users.controller.ts](../backend/src/users/users.controller.ts),
  [users.service.ts](../backend/src/users/users.service.ts),
  [update-user.dto.ts](../backend/src/users/dto/update-user.dto.ts),
  [ClientePerfilPage.tsx](../frontend/src/pages/cliente/ClientePerfilPage.tsx),
  [BarbeiroPerfilPage.tsx](../frontend/src/pages/barbeiro/BarbeiroPerfilPage.tsx),
  [authService.ts](../frontend/src/services/api/authService.ts),
  [API.md](./API.md) e [TELAS.md](./TELAS.md).

### Proposta

1. Manter a correção ordinária de nome, telefone e e-mail pelo perfil, com
   validação no backend.
2. Definir processo de atendimento para dados fora do formulário e para
   correções que repercutam em registros históricos ou de terceiros.
3. Não sobrescrever ou reescrever registros históricos sem decisão documentada
   sobre consistência, rastreabilidade e necessidade de conservação.
4. O registro de solicitações implementado armazena somente titular, categoria,
   status, data e chave interna de idempotência; não guardar cópias dos dados
   corrigidos nem adicionar contexto sem necessidade aprovada.
5. Manter testes para alteração própria, tentativa de alterar outro usuário,
   e-mail conflitante, invalidação de tokens pendentes e rejeição dos JWTs
   anteriores após a confirmação do novo endereço.

## 5. Solicitação de exclusão ou anonimização da conta

### Já existe

- É possível atualizar nome, telefone e e-mail e remover o e-mail do perfil.
- Há desativação de usuários em modelos/fluxos, mas não foi identificado um
  endpoint para o titular solicitar exclusão ou anonimização abrangente.
- Não se deve confundir desativar uma conta ou limpar notificações com apagar
  todos os dados pessoais.

### Falta

- Decisão sobre elegibilidade e verificação de identidade para o pedido,
  confirmação, cancelamento e comunicação do resultado.
- Definir o que significa encerramento da conta, anonimização e exclusão em
  cada entidade relacionada.
- Definir tratamento de solicitações pendentes, atendimentos futuros,
  obrigações eventualmente aplicáveis e dados que não possam ser removidos
  naquele momento.
- Estratégia para relações obrigatórias, mensagens compartilhadas, identificadores
  históricos, integrações, tokens e backups.
- Registro e acompanhamento do pedido com controle de acesso e trilha mínima.

### Arquivos envolvidos

- [users.controller.ts](../backend/src/users/users.controller.ts),
  [users.service.ts](../backend/src/users/users.service.ts),
  [schema.prisma](../backend/prisma/schema.prisma),
  [RolesGuard](../backend/src/auth/guards/roles.guard.ts),
  [jwt.strategy.ts](../backend/src/auth/strategies/jwt.strategy.ts),
  [messages.gateway.ts](../backend/src/messages/messages.gateway.ts),
  [authService.ts](../frontend/src/services/api/authService.ts),
  páginas de perfil, DTOs/serviços de solicitação a criar,
  [API.md](./API.md), [BANCO-DE-DADOS.md](./BANCO-DE-DADOS.md) e
  [TELAS.md](./TELAS.md).

### Proposta

1. **Não implementar exclusão em cascata antes de mapear dependências.** As
   relações em [schema.prisma](../backend/prisma/schema.prisma) conectam
   `Usuario` a cliente/barbeiro, agenda, mensagens, notificações e tokens; os
   agendamentos, lista de espera, claims e notificações também se relacionam
   entre si.
2. Definir previamente pelo controlador cenários de exclusão, anonimização,
   restrição/bloqueio de acesso ou conservação parcial. Nenhuma alternativa
   deve ser escolhida como padrão legal sem essa decisão.
3. Especificar o ciclo de pedido: autenticar/validar titular, registrar
   solicitação, avaliar dependências e pendências, aplicar ações transacionais,
   invalidar sessões/credenciais quando adequado, comunicar resultado e manter
   apenas registro mínimo da decisão.
4. Considerar workflow em duas fases para pedidos que exijam revisão: conta
   fica com estado controlado e a execução só ocorre após as verificações
   decididas pelo controlador. Evitar estado irreversível sem confirmação
   explícita quando operacionalmente aplicável.
5. Avaliar uma entidade persistente de solicitações se o acompanhamento precisar
   sobreviver a sessões e processos. A escolha de armazenar no banco ou em
   ferramenta operacional segura depende do processo definido; qualquer
   alteração de schema exigirá migration aditiva revisada, não incluída neste
   plano.
6. Desenhar idempotência, concorrência, falha parcial e reprocessamento; testar
   relações e restrições do banco sem executar operações destrutivas em dados
   reais.

## 6. Agendamentos e históricos após encerramento de conta

### Já existe

- Cliente e barbeiro consultam agendamentos conforme papel e vínculo.
- Cancelamento, conclusão e falta alteram estados; o histórico permanece no
  modelo relacional.
- A documentação diz para não apagar histórico simplesmente por desativação de
  serviço, inatividade do cliente ou mudança de configuração do barbeiro, mas
  informa que a estratégia definitiva deve ser definida.

### Falta

- Decisão para agendamentos futuros, cancelados e concluídos quando uma conta é
  encerrada.
- Regras para minimizar/anonimizar a referência do cliente sem quebrar a agenda
  ou registros que o controlador decida conservar.
- Definir se barbeiros continuarão vendo dados históricos e em que forma.
- Definir retenção e eventual base legal para cada estado; este plano não fixa
  prazos nem bases legais.

### Arquivos envolvidos

- [schema.prisma](../backend/prisma/schema.prisma),
  [appointments.controller.ts](../backend/src/appointments/appointments.controller.ts),
  [appointments.service.ts](../backend/src/appointments/appointments.service.ts),
  serviços de notificação relacionados e
  [BANCO-DE-DADOS.md](./BANCO-DE-DADOS.md).

### Proposta

1. Inventariar campos e relações do agendamento, notificações e serviços antes
   de definir qualquer exclusão.
2. Obter decisão do controlador para cada estado de agendamento e avaliar com
   orientação jurídica a retenção aplicável.
3. Se houver conservação, implementar minimização/anonimização quando aprovada,
   mantendo integridade relacional e reduzindo identificação direta; especificar
   o impacto para agenda do barbeiro, notificações e exportações.
4. Se houver exclusão física em algum cenário, executar transacionalmente,
   tratar relações dependentes e registrar resultado mínimo sem reter
   desnecessariamente os dados apagados.
5. Criar testes para cliente/barbeiro relacionados e não relacionados, estados
   futuros/encerrados, notificações e integridade de relações.

## 7. Exclusão de mensagens: “para mim” e “para todos”

### Já existe

- “Apagar para mim” define uma flag distinta por participante e remove a
  mensagem da visualização daquele usuário.
- “Apagar para todos” pode ser solicitada somente pelo remetente, dentro de
  janela de 60 minutos, e substitui o conteúdo apresentado na resposta/evento.
  “Apagar para mim” também está sujeita à mesma janela quando ainda não foi
  concluída; operações idempotentes já concluídas retornam sem reaplicar a ação.
- O conteúdo original não é apagado do banco; “para todos” grava `apagadaParaTodos`
  e `dataExclusao`, e “para mim” grava uma flag individual.
- O serviço valida participação na conversa e usa atualização condicional em
  transação.

### Falta

- Definição pelo controlador do que “apagar para mim” significa em relação à
  retenção global: atualmente é somente ocultar para aquele usuário.
- Definição de como um pedido de eliminação relativo a uma mensagem enviada
  afeta cópias/visibilidade para o outro participante e eventuais motivos de
  conservação.
- Eliminação ou anonimização do conteúdo original e dos conteúdos replicados,
  logs, exportações e backups, caso determinada pelo controlador.
- Alinhar a documentação da API, que na auditoria anterior estava inconsistente
  com a rota existente de exclusão.

### Arquivos envolvidos

- [messages.controller.ts](../backend/src/messages/messages.controller.ts),
  [messages.service.ts](../backend/src/messages/messages.service.ts),
  [delete-message.dto.ts](../backend/src/messages/dto/delete-message.dto.ts),
  [message-response.dto.ts](../backend/src/messages/dto/message-response.dto.ts),
  [messages.gateway.ts](../backend/src/messages/messages.gateway.ts),
  testes de serviço/gateway, telas e componentes de mensagens,
  [schema.prisma](../backend/prisma/schema.prisma) e [API.md](./API.md).

### Proposta

1. Preservar a diferença atual entre esconder uma mensagem só para quem pede e
   remover/ocultar para os participantes, sem rotular as flags atuais como
   eliminação física.
2. Antes de alterar a janela de 60 minutos ou semântica de `PARA_MIM`/
   `PARA_TODOS`, obter decisão do controlador e avaliar impactos de conversas,
   notificações e direitos do outro participante.
3. Se decidido que o conteúdo deve ser eliminado, atualizar o campo original
   em uma operação segura e transacional; definir se metadados mínimos ou
   marcador de exclusão permanecem e por quanto tempo (decisão pendente).
4. Garantir que histórico de conversa, API, Socket.IO, cache frontend,
   notificações, logs e exportação reflitam o mesmo estado.
5. Testar autoria, participação, mensagens fora da janela, idempotência,
   concorrência e ausência do conteúdo após a forma de exclusão escolhida.

## 8. Atendimento, registro e acompanhamento de solicitações

### Já existe

- A área de Privacidade e a API autenticada permitem registrar e consultar
  pedidos próprios nas categorias aprovadas. A tabela persiste somente
  titular, chave de idempotência, categoria, status e data de criação; o status
  inicial e único é `RECEBIDA`. Isso não equivale a triagem ou atendimento.
- O perfil permite operações diretas de consulta e correção de campos básicos.
- Não foi encontrado canal de privacidade confirmado na documentação ou código.

### Falta

- Canal real e controlado pelo responsável; responsáveis autorizados e
  procedimento de encaminhamento.
- Verificação proporcional da identidade e representação, triagem,
  encaminhamento, comunicação, decisão e conclusão. O registro técnico de
  abertura já existe; não há fluxo operacional de acompanhamento.
- Processo para solicitações de pessoas sem conta ou mencionadas por terceiros.
- Prazos de resposta definidos pelo controlador após avaliação aplicável;
  não fixar prazo neste plano.
- Registro de decisão suficiente para demonstrar atendimento sem duplicar
  conteúdo pessoal além do necessário.

### Arquivos envolvidos

- Backend existente: [users.controller.ts](../backend/src/users/users.controller.ts),
  [privacy-requests.service.ts](../backend/src/users/privacy-requests/privacy-requests.service.ts),
  guards e DTOs. O modelo e a migration da primeira fase já existem; qualquer
  ampliação depende de justificativa e autorização próprias.
- Frontend existente: área de Privacidade. Um canal de ajuda ou interface
  operacional adicional depende das decisões do responsável.
- Documentação: [AVISO-DE-PRIVACIDADE-RASCUNHO.md](./AVISO-DE-PRIVACIDADE-RASCUNHO.md),
  [API.md](./API.md), [TELAS.md](./TELAS.md) e guia de operação/runbook a criar.

### Proposta

1. Definir canal, responsáveis, verificação de identidade, matriz de
    encaminhamento e prazos com o controlador antes de ampliar a interface ou
    anunciar um processo de atendimento.
2. Preservar as categorias já implementadas; qualquer categoria ou estado novo
    depende de necessidade aprovada e documentação.
3. Decidir como o pedido registrado será triado e acompanhado: por procedimento
    operacional controlado ou por uma extensão autorizada da aplicação. O
    registro técnico atual não tem responsável, análise, decisão ou transição de
    status; definir acesso e retenção antes de ampliar o armazenamento.
4. Evitar registrar no ticket tokens, senha, conteúdo integral de mensagens ou
   cópias completas de exportações.
5. Testar autorização por função, não enumeração de contas, idempotência,
   rastreabilidade mínima e falhas no fluxo de atendimento.

## 9. Proteção contra acesso a dados de outros usuários

### Já existe

- Guards JWT e de papel; identidade de operações privadas normalmente é obtida
  via `@CurrentUser`.
- Consultas de agenda, lista de espera, mensagens e notificações verificam
  titular, participante ou relação correspondente.
- `RolesGuard` revalida usuário ativo e estado de confirmação obrigatória.
- WebSocket de mensagens valida autenticação/autorização durante a conexão e
  processamento.

### Implementado e falta

- A exportação atual deriva o identificador do usuário autenticado, não recebe
  `userId` no request e filtra os registros pelas relações da conta. O
  controller e service têm testes para esse limite.
- Ainda falta ampliar a revisão de testes a todas as relações indiretas e
  proteger futuros endpoints de solicitação e execução de exclusão com a mesma
  identidade autenticada e autorização por registro.
- Definir acesso operacional privilegiado, segregação e auditoria de consultas.
- Definir controle de acesso aos tickets e exportações, se forem armazenados.

### Arquivos envolvidos

- [JwtGuard](../backend/src/auth/guards/jwt.guard.ts),
  [RolesGuard](../backend/src/auth/guards/roles.guard.ts),
  [jwt.strategy.ts](../backend/src/auth/strategies/jwt.strategy.ts),
  [messages.gateway.ts](../backend/src/messages/messages.gateway.ts),
  controllers/services listados nas seções anteriores e respectivos testes.

### Proposta

- Aplicar autorização em profundidade: controlador exige autenticação; serviço
  recebe o identificador derivado do JWT; consulta e mutação incluem ownership
  no filtro; respostas não revelam se recursos de terceiros existem.
- Não aceitar `userId` como parâmetro para exportar ou eliminar dados do
  titular. Para operações administrativas excepcionais, definir papel,
  necessidade e auditoria antes da implementação.
- Cobrir testes negativos para IDs pertencentes a outro usuário, relações
  indiretas, perfil inativo, sessão revogada e conta de barbeiro inativa.

## 10. Impactos em dados relacionados e infraestrutura

| Categoria | Situação observada | Planejamento necessário |
|---|---|---|
| Lista de espera | Entradas, claims e outbox relacionam cliente/barbeiro/serviço; cancelamento é mudança de estado. | Decidir cancelamento/encerramento e tratamento de claims/outbox no pedido de conta; prevenir reoferta posterior com dados de uma solicitação encerrada. |
| Notificações | `clearAll` marca registros como limpos; há relações com usuários, agendamentos e claims. | Decidir limpeza física, anonimização ou conservação; cobrir destinatário, texto e relações em exportação/exclusão. |
| Tokens | Confirmação e recuperação armazenam hash, e-mail, usuário, expiração e uso; expiração funcional não apaga registro. | Invalidar tokens e definir política de expurgo em operação de conta; não incluir tokens em exportações. |
| Rate limits | Identificadores de e-mail ou identificadores de recuperação são armazenados como HMAC/hash e metadados de janela. | Definir retenção e consequência do encerramento da conta; evitar reidentificação e conservar somente o necessário para controle de abuso. |
| Logs/outbox | Os fluxos revisados gravam categorias genéricas/códigos técnicos e usam mensagens de log genéricas; valores históricos e logs externos não foram inspecionados. | Identificar sistemas e operadores, revisar os demais fluxos, restringir acesso e definir retenção/expurgo; não alterar dados históricos nesta etapa. |
| Backups | Configuração, conteúdo, operador, localização e ciclos não são comprováveis no repositório. | Inventariar fornecedor, acesso, criptografia, rotação e prazo; estabelecer como uma exclusão se propaga ou expira nas cópias restauráveis. |
| Brevo | E-mail e token/código de confirmação/recuperação são enviados quando configurado. Retenção no fornecedor não foi verificada. | Confirmar contrato, papéis, dados, retenção e mecanismo de solicitação/eliminação junto ao fornecedor; incluir no procedimento operacional se aplicável. |
| Mensagens compartilhadas | Flags individuais e globais controlam visibilidade; conteúdo persistido pode continuar acessível à camada de armazenamento. | Tratar conteúdo, participante remanescente, notificações/cache e exportações conforme decisão documentada; não remover dados do outro titular sem avaliar impacto. |

Nenhuma rotina de backup, acesso operacional ou configuração de terceiro deve ser
considerada existente ou segura até confirmação do responsável pelo ambiente.

## 11. Decisões necessárias antes da implementação

Esta seção separa as decisões que bloqueiam ações irreversíveis das verificações
que podem ocorrer durante o desenvolvimento e das melhorias reversíveis que
podem começar desde já. Não estabelece bases legais, prazos nem respostas em
lugar do controlador.

### 11.1 Decisões obrigatórias antes de operações irreversíveis

| Decisão a tomar | Por que importa | O que fica bloqueado sem resposta | É possível avançar? |
|---|---|---|---|
| Aprovar, com avaliação jurídica quando necessária, quais categorias de dados serão excluídas, anonimizadas, restritas ou conservadas após pedido de encerramento; definir os critérios aplicáveis, sem presumir retenção ou exclusão total. | A conta está ligada a histórico e dados de outras pessoas; uma remoção precipitada pode quebrar integridade, apagar dados que devam ser tratados de outra forma ou deixar dados identificáveis sem justificativa definida. | Execução física de exclusão/anonimização de conta e dados vinculados; automação de expurgo baseada em critérios não aprovados. | Sim. É possível mapear relações, implementar e testar autorização, preparar fluxo não destrutivo de solicitação e avançar com consulta/correção/exportação limitada. |
| Definir o tratamento de agendamentos futuros e registros históricos quando houver encerramento de conta, inclusive o que o barbeiro poderá consultar posteriormente. | O sistema relaciona agendamentos a cliente, barbeiro e serviço, e a documentação existente orienta cuidado com registros históricos sem fixar estratégia definitiva. | Cancelamento automático de atendimentos, remoção de históricos ou anonimização de vínculos. | Sim. Consultas e correções de perfil podem avançar; o workflow de encerramento pode ser preparado sem executar alterações nos agendamentos. |
| Definir se e em quais condições o conteúdo da mensagem será eliminado, além das flags atuais “apagar para mim” e “apagar para todos”. | Hoje as flags controlam a apresentação, enquanto o conteúdo original permanece armazenado; a exclusão afeta a conversa de outro titular. O comportamento existente inclui janela de 60 minutos para novas exclusões em ambos os modos. | Alterar a semântica atual, apagar conteúdo de forma irreversível ou prometer eliminação real com base nas ações existentes. | Sim. É possível reforçar testes de autorização e documentar claramente o comportamento atual sem mudar a persistência ou a janela. |
| Definir se a exportação deve ser ampliada para incluir conteúdo de mensagens, observações livres ou outros dados de terceiros, e validar o escopo final. | A inclusão pode revelar dados de outras pessoas; o escopo determina consultas e medidas de minimização. | Ampliar a exportação atual ou declará-la integral sem critérios aprovados. | Sim. A exportação limitada já implementada pode ser usada e testada; outras funcionalidades independentes continuam avançando. |

### 11.2 Informações operacionais que podem ser confirmadas durante a implementação

| Confirmação operacional | Por que importa | O que fica bloqueado sem resposta | É possível avançar? |
|---|---|---|---|
| Identificar hospedagem e operadores efetivos de aplicação, banco e WebSocket, suas regiões e acessos administrativos. | Define onde os dados são processados e quem pode acessá-los; essa informação não é verificável apenas no repositório. | Atualizar o aviso com fornecedores/localizações confirmados e concluir avaliação de transferências internacionais. | Sim. Desenvolvimento local, desenho das operações e testes automatizados podem avançar; confirmar antes de documentar produção ou ativar mudanças em produção. |
| Confirmar existência, escopo, localização, acesso, proteção, rotação e ciclo de vida de backups e logs, inclusive observabilidade externa. | Pedidos de eliminação precisam considerar cópias e registros fora do banco principal; conteúdo e práticas reais não foram inspecionados. | Afirmar a propagação completa de exclusão/anonimização e definir o comportamento operacional de restauração e descarte. | Sim. Implementar exportação, validações e fluxo de solicitação não destrutivo; a operação de eliminação não deve ser declarada concluída até mapear os sistemas relevantes. |
| Confirmar se o Brevo está habilitado em produção e validar contrato, papel, região, suboperadores, retenção e mecanismos operacionais aplicáveis. | O código contém integração transacional, mas não confirma habilitação, condições contratuais nem tratamento no fornecedor. | Confirmar compartilhamentos no aviso e executar/validar atendimento de pedidos que precise alcançar dados mantidos pelo fornecedor. | Sim. O desenho interno de solicitações e dados locais pode avançar; concluir a parte do fornecedor quando a conta/contrato estiver disponível, antes de afirmar cobertura completa. |
| Confirmar quem receberá, verificará, decidirá e responderá solicitações dos titulares; definir canal real, verificação de identidade/representação, fluxo de escalonamento e prazos aplicáveis. | Sem responsável e procedimento, um formulário ou endpoint não garante atendimento nem deve expor dados a pessoa não autorizada. | Colocar um canal de solicitação em produção ou anunciar instruções de contato e prazo. | Sim. É possível desenhar o modelo de estados, controles e testes; a aceitação operacional de pedidos e comunicação ao titular depende desta confirmação. |
| Confirmar como são criadas contas de barbeiro e se o processo difere do cadastro público de cliente; verificar se o escopo abrange pessoas sem conta ou terceiros mencionados. | O repositório comprova papéis e fluxos, mas não descreve integralmente os procedimentos administrativos nem a população atendida fora do cadastro revisado. | Fechar cobertura do processo de atendimento e publicar descrição completa para esses casos. | Sim. Implementar recursos autenticados para clientes e barbeiros existentes, mantendo o tratamento de exceções fora de produção até validar o processo. |

Essas verificações operacionais não devem ser convertidas em prazos ou garantias
no aviso até que o responsável confirme evidências dos ambientes e fornecedores.

### 11.3 Melhorias que podem avançar sem bloquear o projeto

| Melhoria | Por que pode avançar agora | Limite até decisões pendentes |
|---|---|---|
| Testar e manter a exportação autenticada limitada de dados próprios já implementada. | Reutiliza filtros de titular, reforça acesso aos próprios dados e não modifica retenção nem exclui registros. | Não incluir conteúdo de terceiros nem descrever a exportação atual como integral. |
| Ampliar futuramente a exportação somente após decisão sobre conteúdo de mensagens, observações livres e dados de terceiros. | O escopo adicional pode revelar dados de outras pessoas e exige critérios aprovados. | A exportação atual permanece disponível com escopo limitado; demais melhorias não dependem dessa decisão. |
| Revisar e testar os fluxos existentes de correção de perfil, autorização e isolamento entre usuários. | A correção básica já existe e testes de propriedade não exigem decisão sobre exclusão histórica. | Não alterar regras de histórico ou incluir campos novos sem escopo aprovado. |
| Preparar estrutura de acompanhamento de solicitações, modelos de status e controles de acesso, sem ativar canal público nem definir prazo de resposta. | Permite avançar desenho técnico e cobertura de testes sem receber pedidos sem responsável. | Persistência definitiva, canal, prazos, retenção do registro e operação em produção exigem confirmação operacional da seção 11.2. |
| Melhorar clareza documental sobre a diferença entre exclusão lógica e eliminação física, preservando o comportamento atual. | Reduz ambiguidade sem ação destrutiva nem mudança de regra. | Não alterar a semântica do produto ou apagar conteúdo antes da decisão da seção 11.1. |
| Mapear dependências e preparar testes de integridade e cenários de falha para encerramento de conta. | Análise e testes com dados simulados não modificam dados reais nem comprometem o histórico. | Não executar exclusões em ambientes com dados reais nem criar rotina automática antes da aprovação dos critérios. |

### 11.4 Sequenciamento ajustado

1. **Começar em paralelo:** autorização e testes negativos; correção de perfil;
   consulta/exportação incremental com escopo limitado; estrutura técnica
   desativada de solicitações; mapeamento e testes de relações.
2. **Durante a implementação:** confirmar responsáveis, canal, fornecedores,
   acessos, logs, backups e Brevo; completar os procedimentos operacionais e
   atualizar o aviso com fatos confirmados.
3. **Após as decisões da seção 11.1:** finalizar o escopo da exportação,
   implementar ações de exclusão/anonimização, tratar histórico e definir a
   semântica de exclusão das mensagens.
4. **Antes de ativar em produção:** validar o comportamento ponta a ponta,
   integridade das relações, propagação definida para provedores/backups,
   comunicações e processo operacional aprovado.

Os prazos de atendimento e retenção permanecem pendentes de decisão e avaliação
apropriada; não são pré-requisitos para começar melhorias reversíveis, mas devem
ser definidos antes de anunciar prazos ou automatizar expurgo.

## 12. Central informativa e API de solicitações LGPD

### Implementado nesta etapa

- Área autenticada de Privacidade disponível para CLIENTE e BARBEIRO.
- Orientações em linguagem simples sobre acesso/exportação, correção, exclusão,
  anonimização e outros pedidos.
- Ação de exportação que reutiliza `GET /users/me/export`, sem aceitar
  identificador enviado pelo frontend, sem armazenar cópia no servidor e com
  retorno visual de carregamento/sucesso/falha.
- API autenticada para criar e consultar solicitações próprias por CLIENTE e
  BARBEIRO, com titular derivado do JWT, categorias aprovadas, status inicial
  `RECEBIDA`, idempotência composta por titular/chave e paginação isolada.
- Exportação dos pedidos próprios com categoria, status e data de criação,
  sem a chave de idempotência.
- Limites por usuário autenticado de 5 criações/minuto e 30 consultas/minuto
  nas rotas de solicitações.
- Atalho para o perfil existente para correção dos campos já editáveis.
- Exibição de `RECEBIDA` com a explicação de que indica somente o registro do
  pedido, não análise ou conclusão.
- O modelo Prisma e a migration aditiva correspondentes já existem. A aplicação
  da migration nos ambientes não foi verificada nesta auditoria.

### Não implementado

- Alteração de status, análise administrativa ou atendimento; a primeira fase
  não permite ao titular alterar seu status.
- Canal de contato, prazo de resposta, verificação de identidade ou política de
  retenção para solicitações.
- Execução de exclusão ou anonimização de conta e dados vinculados.

O modelo Prisma, o SQL da migration e o estado técnico estão descritos em
[Proposta de Schema para Solicitações LGPD](./PROPOSTA-SCHEMA-SOLICITACOES-LGPD.md).

## 13. Critérios mínimos de validação futura

- Titular autenticado só exporta e altera os próprios dados; tentativas de
  acesso por ID de terceiro falham sem revelar a existência de registros.
- Exportação não inclui senha/hash, JWT, tokens ativos, segredos ou dados de
  outros titulares sem decisão e proteção apropriadas.
- Correção mantém unicidade, confirmação de e-mail e integridade dos vínculos.
- Solicitações repetidas são idempotentes e falhas parciais não deixam a conta
  em estado ambíguo.
- Agendamentos futuros e histórico recebem o tratamento definido, sem quebra de
  integridade ou liberação incorreta de horários.
- Visibilidade e retenção de mensagens são coerentes entre REST, WebSocket,
  cache e persistência.
- Lista de espera não gera reoferta indevida após encerramento; notificações,
  tokens e rate limits seguem o fluxo escolhido.
- Logs não expõem senha, tokens, conteúdo de mensagens ou detalhes pessoais
  desnecessários; backups e fornecedores têm tratamento operacional documentado.
- Testes cobrem erros, permissões, concorrência, falha de fornecedor e
  consistência; não depender apenas dos casos de sucesso.
