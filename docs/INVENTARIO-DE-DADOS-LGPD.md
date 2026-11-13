# Inventário de Dados Pessoais — Barbearia-App

**Status:** inventário técnico inicial, sujeito à validação do responsável pelo
projeto e do controlador efetivo.

**Data da revisão do código:** 12/11/2026.

## 1. Escopo, método e limites

Este documento registra tratamentos identificados por leitura estática dos
documentos e do código do Barbearia-App. Não foram consultados bancos de dados,
ambientes hospedados, contas de fornecedores, logs reais, backups ou
configurações secretas. A existência de um modelo ou integração no repositório
não comprova que esteja habilitado ou implantado em produção.

O documento não é parecer jurídico nem declaração de conformidade com a LGPD.
As bases legais abaixo são hipóteses para avaliação do controlador, por
finalidade e contexto. Consentimento não é presumido como requisito universal.

Os seguintes marcadores distinguem o grau de evidência:

- **Comprovado no código/documentação:** comportamento ou campo encontrado no
  repositório.
- **Pendente de confirmação:** decisão de negócio, configuração, operação ou
  análise jurídica que não pode ser verificada pelo repositório.

## 2. Controlador e papéis

A definição inicial do projeto é que o responsável pelo projeto será o
controlador dos dados pessoais, **sujeita à confirmação de que efetivamente
determina as finalidades e os meios do tratamento**. Este inventário não atribui
nome, CPF, endereço ou contato ao controlador, pois esses dados não foram
fornecidos.

Identidade, canal de contato do controlador, operadores e responsáveis por
segurança e atendimento aos titulares permanecem pendentes. O papel do Brevo e
dos provedores de hospedagem/infraestrutura também requer validação contratual
e operacional.

## 3. Titulares identificados

| Titular/categoria | Evidência e dados associados |
|---|---|
| Clientes com conta | Contas do tipo cliente; dados de cadastro e perfil, agendamentos, lista de espera, mensagens, notificações, tokens associados e solicitações próprias (titular, categoria, status, data e UUID interno de idempotência). |
| Barbeiros com conta | Contas do tipo barbeiro; dados de perfil e configuração profissional, agenda, mensagens, notificações, dados de acesso e solicitações próprias (titular, categoria, status, data e UUID interno de idempotência). |
| Pessoas que tentam se cadastrar ou recuperar acesso | Telefone/e-mail e demais campos enviados podem ser tratados durante solicitações, inclusive quando a operação não conclui. A retenção desses dados em logs e infraestrutura não foi verificada. |
| Pessoas mencionadas em mensagens ou observações | O conteúdo livre pode incluir dados de terceiros; o sistema não identifica separadamente esses titulares. |
| Pessoas cujos dados apareçam em registros operacionais | Logs, erros ou dados de integração podem potencialmente conter dados pessoais. Conteúdo real dos registros não foi consultado. |

O tratamento de dados de crianças ou adolescentes não foi identificado como
finalidade nem há fluxo específico comprovado; confirmar com o responsável se
isso pode ocorrer na prática e definir salvaguardas caso aplicável.

## 4. Inventário por finalidade

### 4.1 Cadastro e autenticação

- **Dados:** nome, telefone, e-mail, hash de senha, identificador interno, papel
  (cliente/barbeiro), estado ativo, versão de autenticação e datas de criação e
  atualização. O schema inclui estado/data de confirmação do e-mail.
- **Origem:** fornecidos pelo titular no cadastro; estado de conta e datas são
  gerados/geridos pelo sistema.
- **Finalidade:** criar e administrar conta, autenticar, proteger acesso e
  associar operações ao usuário.
- **Armazenamento/sistemas:** dados estruturados no PostgreSQL por Prisma,
  conforme configuração do backend; sessão do frontend mantém JWT em
  `localStorage`. O provedor, localização, criptografia em repouso e implantação
  efetiva não foram verificados.
- **Acesso:** titular à própria conta; backend e funções de aplicação conforme
  autenticação e autorização. Acesso operacional de administradores e equipe de
  suporte não está definido neste inventário.
- **Compartilhamento:** não foi identificado envio rotineiro destes dados a
  terceiros no fluxo de autenticação, exceto o endereço/token enviado ao
  provedor de e-mail quando há confirmação ou recuperação.
- **Base legal a avaliar:** execução de contrato ou procedimentos preliminares
  a pedido do titular para criação e uso da conta; interesse legítimo para
  controles de segurança e prevenção de abuso, com avaliação documentada.
- **Retenção:** pendente para conta ativa, inativa e encerrada; hashes de senha,
  histórico de autenticação, JWT no navegador e registros associados também
  requerem política. Prazo de sessão é configurado no mecanismo JWT, mas não
  substitui uma política de retenção de dados da conta.
- **Situação:** coleta, hash de senha e autenticação comprovados no código.
  Prazo de retenção, acesso operacional e segurança do ambiente de produção
  pendentes de validação.

### 4.2 Perfis

- **Dados:** nome, telefone, e-mail e dados básicos de conta; o e-mail pode ser
  nulo. O estado de confirmação é retornado ao próprio usuário pelos endpoints
  de sessão/perfil.
- **Origem:** informados ou alterados pelo titular; datas e estado de confirmação
  são atualizados pelo sistema.
- **Finalidade:** manter dados de contato e identificação da conta.
- **Armazenamento/sistemas:** banco PostgreSQL via Prisma e respostas da API
  para a interface autenticada.
- **Acesso:** titular autenticado ao próprio perfil; guards verificam identidade
  e papel. Não há evidência de acesso irrestrito de barbeiros ao perfil completo
  de outros usuários.
- **Compartilhamento:** não identificado para consulta/edição do perfil, além
  dos fluxos transacionais de e-mail descritos abaixo.
- **Base legal a avaliar:** execução de contrato para gestão da conta e
  atualização dos dados necessários; interesse legítimo pode ser avaliado para
  segurança e prevenção de fraude.
- **Retenção:** pendente, inclusive para dados alterados e e-mails anteriores
  eventualmente preservados em outros registros.
- **Situação:** leitura e edição do próprio perfil comprovadas; não foi
  encontrada exclusão de conta.

### 4.3 Agendamentos

- **Dados:** identificadores de cliente, barbeiro e serviço, data, horários de
  início e fim, status, observação opcional e datas de criação/atualização.
- **Origem:** solicitação do cliente; disponibilidade, status e transições
  também são produzidos pelo sistema e pelos fluxos de gestão da agenda.
- **Finalidade:** solicitar, administrar, alterar, cancelar e notificar sobre
  atendimentos.
- **Armazenamento/sistemas:** PostgreSQL via Prisma; API e interface do cliente
  e do barbeiro.
- **Acesso:** cliente aos próprios agendamentos; barbeiro aos registros da
  própria agenda e aos dados necessários ao atendimento, conforme consultas e
  autorização no backend.
- **Compartilhamento:** entre cliente e barbeiro envolvidos no atendimento
  dentro do aplicativo; notificações podem informar eventos relacionados.
  Nenhum compartilhamento externo de agenda foi comprovado no código
  inspecionado.
- **Base legal a avaliar:** execução de contrato ou procedimentos preliminares
  solicitados para agendamento; obrigação legal/regulatória e exercício regular
  de direitos podem justificar retenção específica, se aplicáveis e avaliados.
- **Retenção:** pendente por estado do agendamento, inclusive cancelado e
  concluído; documentação do banco recomenda cautela com histórico, mas declara
  que a estratégia definitiva deve ser definida.
- **Situação:** agendamento, consulta, atualização de status e cancelamento
  estão implementados. Retenção definitiva não está especificada.

### 4.4 Histórico de atendimentos

- **Dados:** registros de agendamento e vínculos associados, incluindo cliente,
  barbeiro, serviço, data/horário e status.
- **Origem:** registros de agendamento atualizados durante o ciclo do
  atendimento.
- **Finalidade:** consulta de agenda/histórico e administração do serviço.
- **Armazenamento/sistemas:** os próprios registros relacionais de
  `Agendamento` no PostgreSQL; não foi identificado um sistema histórico externo
  separado.
- **Acesso:** cliente e barbeiro de acordo com as permissões e relações do
  atendimento; acesso administrativo operacional precisa ser confirmado.
- **Compartilhamento:** cliente e barbeiro envolvidos, no escopo necessário à
  prestação do serviço.
- **Base legal a avaliar:** execução do contrato; obrigação legal/regulatória
  ou exercício regular de direitos para períodos de conservação específicos,
  quando aplicáveis.
- **Retenção:** pendente. A documentação diz para não apagar registros
  históricos simplesmente por desativação de serviço, inatividade do cliente
  ou mudança de configuração do barbeiro; não estabelece prazo nem uma
  estratégia definitiva.
- **Situação:** registros permanecem relacionados no modelo; política de
  conservação, anonimização e descarte não foi encontrada.

### 4.5 Lista de espera e reofertas

- **Dados:** cliente, barbeiro, serviço, data desejada, horários opcionais,
  status, prioridade/ordenação funcional e datas de entrada/atualização.
  `WaitlistClaim` guarda data, horário, estado e expiração. A outbox guarda
  origem, barbeiro, horário, tentativas, estado e último erro.
- **Origem:** solicitação do cliente; claims, reofertas e tentativas são gerados
  pelo sistema e pelos fluxos de agenda.
- **Finalidade:** administrar pedidos por horários e comunicar oportunidades
  liberadas.
- **Armazenamento/sistemas:** PostgreSQL via Prisma; serviços e tarefas
  agendadas da aplicação, incluindo outbox de reofertas.
- **Acesso:** cliente às próprias entradas; barbeiro à lista associada à sua
  agenda; backend aos dados necessários para processar reofertas. Acesso
  operacional à outbox precisa ser confirmado.
- **Compartilhamento:** notificações de oportunidade para os titulares
  envolvidos; não foi identificado fornecedor externo para a lista em si.
- **Base legal a avaliar:** execução de contrato/procedimentos preliminares ou
  solicitação do titular; interesse legítimo pode ser avaliado para operação e
  prevenção de abuso, com necessidade e balanceamento documentados.
- **Retenção:** pendente para entradas canceladas/encerradas, claims expirados,
  histórico de reoferta e registros da outbox.
- **Situação:** estados, expiração de claims e processamento de outbox
  implementados; retenção e expurgo gerais não foram identificados.

### 4.6 Mensagens entre cliente e barbeiro

- **Dados:** identificadores do remetente e destinatário, texto da mensagem,
  datas de criação/leitura, flags de leitura e exclusão lógica.
- **Origem:** conteúdo informado pelo remetente; identificadores e metadados
  gerados pelo sistema.
- **Finalidade:** comunicação relacionada ao uso do aplicativo e aos
  atendimentos.
- **Armazenamento/sistemas:** conteúdo persistido no PostgreSQL; comunicação em
  tempo real usa WebSocket/Socket.IO. A infraestrutura de rede/hospedagem não
  foi verificada operacionalmente.
- **Acesso:** remetente e destinatário na conversa autorizada; backend valida
  participantes e autenticação no REST/WebSocket.
- **Compartilhamento:** entre participantes da conversa. Nenhum terceiro de
  entrega externa de mensagens foi identificado.
- **Base legal a avaliar:** execução do serviço de comunicação solicitada e
  execução do atendimento; interesse legítimo pode ser avaliado para segurança
  e prevenção de abuso.
- **Retenção:** pendente, incluindo mensagens marcadas como apagadas,
  notificações relacionadas e backups.
- **Situação e lacuna:** a exclusão no código é lógica; as flags de exclusão são
  atualizadas, mas o campo original `conteudo` permanece no banco. A
  API documenta a rota de exclusão existente e esclarece que ela não remove
  fisicamente o conteúdo. Retenção e descarte de backups continuam pendentes.

### 4.7 Notificações

- **Dados:** usuário destinatário, tipo, título, mensagem, estado de leitura,
  limpeza e vínculos opcionais a agendamento/claim, com datas correspondentes.
- **Origem:** geradas pela aplicação a partir de eventos de agenda, lista de
  espera e outras operações do sistema.
- **Finalidade:** informar ao usuário eventos e ações relacionados à conta ou
  aos serviços solicitados.
- **Armazenamento/sistemas:** PostgreSQL via Prisma e interface autenticada.
- **Acesso:** somente usuário proprietário conforme consultas da API; o conteúdo
  pode refletir dados de agendamento ou de oportunidade.
- **Compartilhamento:** dentro da aplicação para o usuário destinatário; não foi
  identificado envio de notificações push/SMS por terceiro nesta auditoria.
- **Base legal a avaliar:** execução do serviço solicitado para notificações
  necessárias; interesse legítimo para comunicações operacionais auxiliares,
  se aplicável, com transparência.
- **Retenção:** pendente para notificações lidas, limpas e vinculadas a registros
  encerrados.
- **Situação:** leitura e limpeza estão implementadas; limpeza não comprova
  eliminação física nem prazo de retenção.

### 4.8 Confirmação de e-mail

- **Dados:** e-mail, hash do token, identificador do usuário, datas de criação,
  expiração e uso; o rate limit público armazena HMAC do e-mail e metadados de
  janela/solicitações.
- **Origem:** e-mail fornecido no cadastro ou perfil; tokens e metadados são
  gerados pelo sistema.
- **Finalidade:** verificar posse do endereço, proteger a conta e permitir o
  acesso conforme as regras de autenticação.
- **Armazenamento/sistemas:** PostgreSQL via Prisma; envio transacional via
  Brevo quando configurado.
- **Acesso:** backend de autenticação; destinatário recebe a mensagem. O token
  em texto é usado para envio e não é persistido como tal no banco, conforme
  implementação.
- **Compartilhamento:** endereço e token/código de confirmação são encaminhados
  ao Brevo para entrega.
- **Base legal a avaliar:** execução do serviço e segurança da conta; interesse
  legítimo pode ser avaliado para rate limiting/prevenção de abuso. O envio
  transacional não equivale a consentimento de marketing.
- **Retenção:** token tem validade de 30 minutos, mas a retenção dos registros
  expirados/usados e dos registros de rate limit permanece pendente; expiração
  funcional não significa eliminação física.
- **Situação:** cadastro tenta envio automático único; reenvio é explícito,
  limitado, com resposta pública genérica. A configuração efetiva do Brevo e
  retenção pelo fornecedor não foram verificadas.

### 4.9 Recuperação de senha

- **Dados:** e-mail confirmado, hash do token, identificador do usuário,
  datas de criação/expiração/uso e rate limit por identificador hash; senha
  substituída é armazenada como hash.
- **Origem:** pedido do titular; token e identificadores técnicos são gerados
  pelo sistema.
- **Finalidade:** recuperar acesso e proteger a conta.
- **Armazenamento/sistemas:** PostgreSQL via Prisma e entrega do e-mail pelo
  Brevo quando configurado.
- **Acesso:** backend de autenticação; mensagem é enviada ao endereço
  associado. Não foi identificada exposição do token em resposta pública.
- **Compartilhamento:** endereço e token de recuperação são enviados ao Brevo
  para entrega transacional.
- **Base legal a avaliar:** segurança e viabilização do serviço/conta; interesse
  legítimo pode ser avaliado para prevenção de abuso.
- **Retenção:** token tem validade definida no código; prazo de eliminação dos
  registros e rate limits, inclusive usados/expirados, está pendente. O prazo
  de validade não define retenção no banco ou no fornecedor.
- **Situação:** respostas genéricas, tokens protegidos e invalidação após uso/
  alteração de senha implementados; configuração do fornecedor e descarte
  posterior pendentes de validação.

### 4.10 Logs e registros operacionais

- **Dados:** a outbox guarda tentativas, horários, estado e campo `ultimoErro`.
  O código atual grava nesse campo uma categoria genérica ou código/status
  técnico, e não a mensagem nem a stack da exceção. Algumas rotinas revisadas
  também emitem mensagens genéricas nos logs. Não foi feita inspeção de logs
  reais, portanto não se afirma que contenham dados pessoais específicos.
- **Origem:** aplicação, workers e integrações durante processamento de
  solicitações.
- **Finalidade:** diagnóstico, operação e repetição controlada de tarefas.
- **Armazenamento/sistemas:** `WaitlistReofferOutbox` no banco; destino e
  retenção dos logs da aplicação dependem da infraestrutura não verificada.
- **Acesso:** aplicação e funções operacionais com acesso ao backend/ambiente;
  conjunto de pessoas autorizadas e auditoria de acesso pendentes de confirmação.
- **Compartilhamento:** não identificado no código; ferramentas de observabilidade
  ou hospedagem eventualmente usadas precisam ser inventariadas pelo responsável.
- **Base legal a avaliar:** interesse legítimo para segurança/diagnóstico, ou
  obrigação legal/exercício de direitos quando aplicável; definir finalidade e
  necessidade por categoria de log.
- **Retenção:** pendente para banco, logs, stacks, auditoria, rate limits e
  cópias exportadas.
- **Lacunas:** o ajuste de minimização limita-se aos fluxos de processamento
  revisados; logs anteriores, outros serviços e provedores operacionais não
  foram verificados. Controle de acesso, retenção e expurgo permanecem sem
  definição. Valores de erro históricos não foram alterados.

### 4.11 Backups e restauração

- **Dados:** potencialmente os mesmos dados mantidos no banco e sistemas
  copiados, inclusive registros marcados como excluídos. O conteúdo, escopo,
  frequência e existência de backups não foram verificados.
- **Origem/finalidade:** dependem do procedimento operacional; presumivelmente
  recuperação de serviço, mas essa finalidade e processo devem ser confirmados
  pelo responsável.
- **Armazenamento/sistemas:** não identificados no repositório; provedor,
  localização, criptografia, cópias, retenção e testes de restauração estão
  pendentes de confirmação.
- **Acesso/compartilhamento:** não verificável pelo código; identificar
  operadores e fornecedores com acesso aos backups.
- **Base legal a avaliar:** a mesma finalidade essencial que justifique cópias
  de segurança, com avaliação de necessidade, proteção e prazo; não presumir
  que backup justifique retenção indefinida.
- **Retenção:** pendente, incluindo ciclos de rotação e prazo para que dados
  excluídos deixem de constar de cópias restauráveis.

## 5. Sistemas e compartilhamentos externos

| Sistema/terceiro | Dados/finalidade identificados | Estado e verificações pendentes |
|---|---|---|
| Aplicação frontend/backend | Dados fornecidos e metadados necessários às funcionalidades descritas neste documento. | Repositório comprova a arquitetura lógica; URLs, hospedagem, controles de produção e regiões precisam ser confirmados. |
| PostgreSQL/Prisma | Contas, agenda, lista de espera, mensagens, notificações, tokens e registros operacionais definidos no schema. | PostgreSQL e Prisma são definidos pelo projeto; host, região, criptografia, operadores, backups e retenção reais não foram inspecionados. |
| Brevo | E-mail do titular e token/código transacional para confirmação e recuperação de senha. | Adaptador existente; provedor desabilitado por padrão e depende de configuração. Confirmar contrato, papel, região, transferências, suboperadores, retenção, logs e plano/cota. |
| WebSocket/Socket.IO | Eventos de mensagens em tempo real entre usuários autenticados. | Biblioteca e fluxo de aplicação presentes; hospedagem, terminação TLS, logs e retenção de tráfego precisam de validação operacional. |
| Outros provedores | Nenhum outro envio externo de dados pessoais foi comprovado nos fluxos revisados. | Hospedagem, observabilidade, e-mail de domínio, DNS, CDN e serviços de backup devem ser confirmados pelo responsável; ausência no código não prova inexistência operacional. |

## 6. Pessoas e funções com acesso

- **Titular:** acessa e edita os dados do próprio perfil e acessa os registros
  autorizados relacionados à própria conta.
- **Barbeiro:** acessa informações de clientes necessárias à gestão dos
  atendimentos e às funcionalidades da agenda, lista de espera e comunicação;
  o código aplica consultas/guards por papel e relação.
- **Backend:** processa os dados necessários às finalidades implementadas,
  incluindo autenticação, autorização, tarefas agendadas e notificações.
- **Responsáveis operacionais:** quem pode acessar banco, logs, infraestrutura,
  backups e credenciais não é identificável somente pelo código. Lista nominal,
  necessidade de acesso, segregação e revisão periódica devem ser confirmadas.
- **Brevo:** recebe dados necessários à entrega de e-mails transacionais, quando
  configurado.

Os papéis e escopos acima descrevem o comportamento funcional observado; não
substituem uma matriz organizacional de acesso nem comprovam como as permissões
de produção estão configuradas.

## 7. Bases legais a avaliar

O responsável pelo tratamento deve documentar a análise por finalidade e
categoria, incluindo necessidade, adequação, transparência, retenção e
compartilhamento. Hipóteses a avaliar, sem conclusão jurídica:

- **Execução de contrato ou procedimentos preliminares solicitados:** cadastro,
  manutenção da conta, agendamento, lista de espera, comunicação operacional,
  recuperação de acesso e recursos solicitados pelo titular.
- **Legítimo interesse:** segurança da conta, prevenção de abuso, operação e
  diagnóstico; documentar finalidade, necessidade, balanceamento e salvaguardas.
- **Obrigação legal ou regulatória:** somente para registros e prazos que uma
  obrigação aplicável efetivamente exigir, a confirmar com assessor jurídico/
  contador conforme a atividade.
- **Exercício regular de direitos:** conservação limitada de evidências quando
  necessária e aplicável, com acesso restrito e prazo definido.
- **Consentimento:** considerar apenas para tratamento cuja base apropriada
  seja consentimento, especialmente finalidades opcionais que não sejam
  necessárias ao serviço. Não foi identificado no código um fluxo de marketing
  por e-mail; não presumir que consentimento foi obtido.

## 8. Retenção: situação consolidada

| Categoria | Prazo conhecido no código/documentação | Retenção definitiva |
|---|---|---|
| Conta e perfil | Datas de criação/atualização são armazenadas. | **Pendente.** |
| Agendamentos e histórico | Documentação recomenda cautela e desativação em vez de apagar por motivos operacionais simples. | **Pendente.** |
| Lista de espera, claims e outbox | Claims podem ter expiração funcional; outbox mantém tentativas e erro. | **Pendente.** |
| Mensagens | Flags e data de exclusão lógica; conteúdo original pode permanecer. | **Pendente.** |
| Notificações | Leitura/limpeza registradas. | **Pendente.** |
| Tokens de confirmação | Expiração funcional de 30 minutos. | **Pendente** para remoção física após uso/expiração. |
| Tokens de recuperação | Validade funcional definida no serviço. | **Pendente** para remoção física após uso/expiração. |
| Rate limits | Alguns registros antigos são removidos durante solicitações. | **Pendente** para política completa, demais rate limits e prazo abrangente. |
| Logs e erro da outbox | Sem prazo global encontrado. | **Pendente.** |
| Backups | Operação não verificada. | **Pendente.** |
| Dados no Brevo | Não disponível no repositório. | **Pendente** de confirmação contratual/operacional. |

## 9. Segurança implementada e lacunas

### Evidências no código

- Hash de senha, JWT e validações de login.
- Confirmação de e-mail e recuperação com tokens aleatórios, hash persistido,
  expiração, uso único/invalidação e limites de solicitação.
- Guards de autenticação, papel e estado ativo; verificações adicionais para
  rotas privadas e WebSocket.
- Identidade das ações privadas derivada da sessão autenticada e consultas
  limitadas por usuário/contexto.
- Respostas públicas genéricas em fluxos de reenvio e recuperação para reduzir
  enumeração de contas.
- Configuração e documentação da integração de e-mail descrevem chamadas HTTPS,
  timeout e ausência de retries automáticos.

### Lacunas ou aspectos não verificados

- Configuração em produção, TLS ponta a ponta, criptografia em repouso,
  segregação de ambientes, rotação e armazenamento de segredos, controles de
  administrador e revisão de acesso.
- Proteção de JWT em `localStorage` e medidas operacionais contra XSS.
- Minimização e expurgo de tokens usados/expirados, logs e erros.
- Eliminação real de mensagem cujo conteúdo original permanece após exclusão
  lógica.
- Segurança, retenção, criptografia e acesso aos backups.
- Tratamento de incidentes, resposta a violações, continuidade e restauração.
- Evidência de análise de risco, testes de segurança e revisão periódica de
permissões.

## 10. Direitos dos titulares e atendimento atual

| Direito/solicitação | Evidência atual | Situação |
|---|---|---|
| Confirmação e acesso | Perfil permite consultar dados próprios; `GET /users/me/export` fornece JSON autenticado limitado aos dados acessíveis ao titular, incluindo categoria, status e data das solicitações próprias. | Parcial; conteúdo de mensagens e observações livres é omitido; confirmar escopo e processo geral de atendimento. |
| Correção/atualização | Perfil permite alterar nome, telefone e e-mail. | Parcial; não cobre necessariamente todos os dados derivados e registros históricos. |
| Anonimização, bloqueio ou eliminação | Não foi encontrado fluxo geral de conta ou dados; exclusões de mensagem são lógicas. | Não implementado como processo abrangente; definir exceções e impacto relacional. |
| Portabilidade | Há exportação JSON dos dados de conta/perfil, agenda/lista de espera, metadados visíveis de mensagens e notificações acessíveis e dados mínimos das solicitações próprias; a resposta declara limitações. | Implementação inicial; avaliar aplicabilidade e escopo. Não é exportação integral de todo conteúdo. |
| Informação sobre compartilhamentos e bases | Não há aviso/inventário completo publicado identificado nesta revisão. | Pendente. |
| Oposição/revisão de tratamento | API autenticada registra e lista pedidos próprios, sem análise administrativa ou alteração de status. | O registro não representa análise ou atendimento; procedimento permanece pendente. |
| Revogação de consentimento | Não foi identificado consentimento universal, nem se deve criá-lo como base universal. | Definir somente para tratamentos que usem consentimento. |
| Canal de atendimento | Não foi fornecido ou localizado como canal de privacidade neste inventário. | Pendente; não inventar contato. |

Os pedidos precisam de procedimento documentado para verificação proporcional
da identidade, registro, prazos, resposta e justificativa de eventual retenção.
Esta tabela não determina que todo dado deva ser apagado independentemente de
fundamento legítimo de conservação.

## 11. Confirmações necessárias do responsável pelo projeto

1. Quem é o controlador efetivo e quem decide finalidades e meios? Confirmar a
   definição inicial de que o responsável pelo projeto exerce esse papel.
2. Qual é a identidade e o canal de contato do controlador para titulares e
   solicitações de privacidade?
3. Há contas de barbeiro criadas por convite, administrador ou outro processo
   fora do cadastro público revisado? Quais dados são solicitados e por quem?
4. O serviço é oferecido a menores? Que dados de terceiros podem ser enviados
   em mensagens ou observações?
5. Quais são as finalidades exatas de cada dado e quais campos são necessários
   para prestar cada serviço?
6. Quais bases legais são aplicáveis por finalidade, após avaliação jurídica?
   Existem obrigações legais, fiscais ou de defesa de direitos e quais registros
   e prazos elas abrangem?
7. Onde estão hospedados aplicação, banco e WebSocket? Quais fornecedores,
   regiões, operadores e transferências internacionais estão envolvidos?
8. O Brevo está habilitado em produção? Qual entidade/conta o utiliza, que
   contrato e instruções de tratamento se aplicam, quais suboperadores e
   retenções estão envolvidos?
9. Quais pessoas/funções têm acesso a produção, banco, logs, exportações e
   backups? Como os acessos são concedidos, revisados e revogados?
10. Existem backups e logs externos? Quais dados contêm, onde são guardados,
    quem acessa, como são protegidos e quando são eliminados?
11. Quais prazos de retenção e critérios de anonimização/expurgo serão adotados
    para cada categoria, inclusive dados de contas encerradas e solicitações
    abandonadas?
12. Como tratar a exclusão de mensagens, conta, histórico e dados relacionados,
    considerando registros que precisem ser conservados por fundamento válido?
13. Qual é o canal e o processo interno para direitos dos titulares, incidentes
    de segurança e solicitações de autoridades?
14. Há uso futuro planejado para marketing, análise ou métricas? Nenhum fluxo
    desse tipo foi comprovado nesta revisão; se existir fora do repositório,
    deve ser incluído no inventário e avaliado separadamente.

## 12. Referências do repositório

- [Modelo de dados](../backend/prisma/schema.prisma)
- [Autenticação e cadastro](../backend/src/auth/auth.service.ts)
- [Confirmação de e-mail](../backend/src/auth/email-verification.service.ts)
- [Recuperação de senha](../backend/src/auth/password-recovery.service.ts)
- [Integração Brevo](../backend/src/auth/brevo-email-verification-mailer.ts)
- [Perfil e autorização do usuário](../backend/src/users/users.controller.ts)
- [Agendamentos](../backend/src/appointments/appointments.service.ts)
- [Lista de espera](../backend/src/waitlist/waitlist.service.ts)
- [Outbox de reofertas](../backend/src/waitlist/waitlist-reoffer-outbox.service.ts)
- [Mensagens](../backend/src/messages/messages.service.ts)
- [Notificações](../backend/src/notifications/notifications.service.ts)
- [Regras de negócio](./REGRAS-DE-NEGOCIO.md)
- [Banco de dados](./BANCO-DE-DADOS.md)
- [API](./API.md)
- [Segurança e infraestrutura](./SEGURANCA-INFRAESTRUTURA.md)
