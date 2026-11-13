# Aviso de Privacidade — Barbearia-App

> **Rascunho para revisão. Não publicar antes de preencher e validar todos os
> itens marcados como `[PENDENTE DE DEFINIÇÃO]`.**
>
> Este texto descreve os tratamentos identificados no código e na
> documentação do projeto em 12/11/2026. Não é uma declaração de conformidade
> com a LGPD nem substitui revisão pelo controlador e assessoria jurídica.

## 1. Quem é responsável pelos dados

A definição inicial do projeto é que o responsável pelo projeto será o
controlador dos dados pessoais, se efetivamente determinar as finalidades e os
meios do tratamento.

- Controlador efetivo: **[PENDENTE DE DEFINIÇÃO — confirmar quem determina as
  finalidades e os meios do tratamento]**
- Nome ou identificação pública: **[PENDENTE DE DEFINIÇÃO]**
- Canal para assuntos de privacidade e solicitações: **[PENDENTE DE DEFINIÇÃO]**

Não incluímos neste rascunho nome, endereço, telefone ou e-mail de contato,
pois essas informações não foram fornecidas nem confirmadas.

## 2. A quem este aviso se aplica

O aplicativo trata dados relacionados a:

- clientes que criam ou utilizam uma conta;
- barbeiros que utilizam as funções de perfil e gestão de atendimentos;
- pessoas que tentam se cadastrar ou recuperar o acesso;
- pessoas cujos dados possam ser mencionados em mensagens ou observações;
- pessoas cujos dados eventualmente apareçam em registros operacionais.

O tratamento de dados de crianças ou adolescentes não foi identificado como
uma finalidade específica do aplicativo. Se o serviço puder ser usado por
menores, essa situação e as medidas aplicáveis precisam ser confirmadas:
**[PENDENTE DE DEFINIÇÃO]**.

## 3. Quais dados são tratados e para quê

Os dados abaixo são tratados para disponibilizar e operar os recursos do
aplicativo. Os campos efetivamente preenchidos podem variar conforme a função
utilizada.

### Cadastro e segurança da conta

No cadastro de cliente, o aplicativo solicita nome, telefone, e-mail e senha.
Para autenticação, a senha é armazenada como hash, não como senha em texto
simples. O sistema também mantém identificador da conta, tipo e estado da conta,
datas de criação e atualização e informações necessárias para autenticação.

Esses dados são usados para criar e administrar a conta, permitir o acesso,
proteger a sessão e associar as ações à pessoa autenticada. O e-mail de novos
cadastros precisa ser confirmado antes do acesso normal à conta.

O processo de criação e administração de contas de barbeiros, inclusive quais
dados são solicitados e por quem, precisa ser confirmado:
**[PENDENTE DE DEFINIÇÃO]**.

### Perfis

O perfil permite consultar e alterar nome, telefone e e-mail. O e-mail pode
não estar informado. O próprio usuário autenticado pode consultar seu perfil;
o backend aplica controles de acesso às funções privadas.

O estado de confirmação do e-mail é usado para informar ao próprio usuário se
o endereço está confirmado. A alteração do e-mail invalida a confirmação
anterior e exige confirmar o novo endereço quando aplicável.

### Agendamentos e histórico

Para criar e administrar um agendamento, o sistema trata os vínculos com
cliente, barbeiro e serviço, data, horários, status e, quando informado,
observações. Esses dados são usados para organizar o atendimento, consultar a
agenda, alterar ou cancelar horários e comunicar informações relacionadas.

O cliente consulta seus próprios agendamentos. O barbeiro acessa os registros
da agenda e as informações necessárias aos atendimentos correspondentes,
conforme as permissões do aplicativo.

Registros de atendimentos podem permanecer como histórico. O prazo e os
critérios de conservação, anonimização ou exclusão ainda não foram definidos:
**[PENDENTE DE DEFINIÇÃO]**.

### Lista de espera

Quando uma pessoa solicita uma vaga, o sistema trata os vínculos com cliente,
barbeiro e serviço, a data desejada, horários informados, estado da solicitação
e datas operacionais. Claims de oportunidade e registros de reoferta também
podem guardar horários, estados, tentativas e erros de processamento.

Esses dados são usados para administrar solicitações e informar oportunidades
de horário. O cliente acessa suas próprias solicitações e o barbeiro, as
associadas à sua agenda, de acordo com as permissões do aplicativo.

O período de conservação de solicitações encerradas, claims e registros de
reoferta está **[PENDENTE DE DEFINIÇÃO]**.

### Mensagens

As mensagens incluem identificadores de remetente e destinatário, conteúdo,
datas e informações de leitura. São usadas para comunicação entre cliente e
barbeiro relacionada ao aplicativo e aos atendimentos. O acesso às conversas é
controlado pelo backend.

O aplicativo possui ações de exclusão que atualizam indicadores de exclusão.
No código revisado, o conteúdo original da mensagem ainda pode permanecer
armazenado depois dessa ação. O prazo de retenção e o tratamento definitivo do
conteúdo estão **[PENDENTE DE DEFINIÇÃO]**.

Evite enviar em mensagens informações pessoais que não sejam necessárias à
comunicação. O aplicativo não foi identificado como solicitando dados pessoais
sensíveis em mensagens.

### Notificações

Notificações podem conter tipo, título, mensagem, estado de leitura e vínculos
com agendamento ou lista de espera. São usadas para informar eventos e ações
relacionados à conta e aos serviços solicitados. O sistema limita a consulta
às notificações do usuário correspondente.

A limpeza de uma notificação não confirma, por si só, a eliminação física do
registro. Prazo e forma de descarte estão **[PENDENTE DE DEFINIÇÃO]**.

### Confirmação de e-mail

O sistema trata o endereço de e-mail e informações técnicas necessárias para
gerar, validar e limitar solicitações de confirmação. Tokens são armazenados
como hash e têm validade funcional de 30 minutos. Novos cadastros iniciam uma
tentativa automática de envio; qualquer reenvio posterior depende de solicitação
explícita do usuário e está sujeito a limites.

O prazo para apagar do banco tokens expirados ou utilizados e registros de
limitação está **[PENDENTE DE DEFINIÇÃO]**. A validade do token não significa
que o registro é eliminado automaticamente ao expirar.

### Recuperação de senha

Quando alguém solicita recuperação, o sistema utiliza o e-mail associado e
informações técnicas de solicitação e token para permitir a redefinição segura
da senha. A nova senha é armazenada como hash. A validade funcional do token é
definida no sistema, mas a retenção dos registros expirados ou usados está
**[PENDENTE DE DEFINIÇÃO]**.

## 4. De onde vêm os dados

Nome, telefone, e-mail, senha, informações de agendamento, solicitações de lista
de espera e conteúdo de mensagens são fornecidos pelas pessoas ao usar os
recursos correspondentes. Estados de conta, tokens, datas, notificações e
registros de processamento são gerados ou atualizados pelo sistema.

Dados de terceiros podem ser incluídos por usuários em mensagens ou
observações. O aplicativo não identifica essas pessoas separadamente.

## 5. Com quem os dados podem ser compartilhados

Dentro do aplicativo, os dados são disponibilizados ao próprio titular e,
conforme a função e a relação com o atendimento, ao cliente ou barbeiro
envolvido. O backend aplica autenticação e autorização para limitar o acesso.

**Brevo:** o código contém uma integração para envio de e-mails transacionais
de confirmação e recuperação de senha. Quando essa integração é configurada,
o endereço e o token/código necessário à mensagem são enviados ao serviço de
e-mail para entrega. O provedor está desabilitado por padrão no código; não foi
verificado se está habilitado em produção.

O papel contratual do Brevo, condições de tratamento, localização, retenção,
suboperadores e transferências internacionais não foram confirmados:
**[PENDENTE DE DEFINIÇÃO]**.

O código consultado não comprovou outros compartilhamentos externos de dados
pessoais nos fluxos descritos. Isso não confirma quais fornecedores são usados
na operação do site, banco de dados, hospedagem, logs, backups ou observabilidade.
Esses fornecedores e os dados a que possam ter acesso estão
**[PENDENTE DE DEFINIÇÃO]**.

## 6. Bases legais

As bases legais adequadas a cada finalidade ainda precisam ser avaliadas e
documentadas pelo controlador: **[PENDENTE DE DEFINIÇÃO]**.

Dependendo do tratamento e dos fatos, a avaliação pode considerar a execução
de contrato ou procedimentos solicitados pela pessoa, obrigação legal ou
regulatória, exercício regular de direitos ou legítimo interesse com análise
de necessidade e balanceamento. Consentimento não é presumido como necessário
para todos os tratamentos. Não foi identificado, no código revisado, um fluxo
de marketing por e-mail.

Esta lista não é uma decisão jurídica sobre a base aplicável. A justificativa
final para cada finalidade, inclusive dados compartilhados com fornecedores,
deve ser confirmada antes da publicação: **[PENDENTE DE DEFINIÇÃO]**.

## 7. Onde os dados ficam e por quanto tempo

O código utiliza PostgreSQL por meio do Prisma para armazenar dados de contas,
agendamentos, lista de espera, mensagens, notificações, tokens, solicitações
dos titulares e registros operacionais. A solicitação guarda titular,
categoria, status, data de criação e uma chave UUID interna de idempotência;
não há descrição livre. O frontend mantém a sessão JWT em `localStorage`. A
aplicação da migration no ambiente de execução precisa ser confirmada antes
da publicação deste aviso.

O código não permite confirmar o provedor, a localização física, a criptografia
em repouso, os backups ou os prazos gerais de retenção. Essas informações estão
**[PENDENTE DE DEFINIÇÃO]**. Prazos funcionais de expiração de tokens não
representam, necessariamente, o prazo de eliminação dos registros.

Não foi localizada uma política geral de retenção e descarte para contas,
agendamentos, histórico, lista de espera, mensagens, notificações, tokens,
logs e backups. Os prazos e os critérios de exclusão ou anonimização estão
**[PENDENTE DE DEFINIÇÃO]**.

## 8. Segurança

O código revisado implementa hash de senhas; autenticação e controles de acesso
por usuário e papel; tokens de confirmação e recuperação protegidos por hash,
expiração e uso controlado; e limites de solicitações para reduzir abuso.

Essas medidas descrevem mecanismos encontrados no código e não garantem, por si
só, a segurança de um ambiente implantado. Configuração de produção, controles
de acesso operacional, proteção de logs, criptografia do banco e backups,
monitoramento e resposta a incidentes estão
**[PENDENTE DE DEFINIÇÃO]**.

## 9. Seus direitos e como solicitar atendimento

As pessoas podem solicitar informações e atendimento sobre seus dados,
incluindo acesso, correção, informações sobre o tratamento e, quando aplicável,
anonimização, bloqueio, eliminação, portabilidade, oposição ou revisão de
tratamentos. O atendimento dependerá da confirmação da identidade e da análise
do pedido e de eventuais motivos válidos para conservação de determinados
registros.

O perfil permite consultar e corrigir parte dos dados, e a área autenticada
permite baixar um arquivo JSON com os dados próprios disponíveis ao usuário,
como informações da conta e do perfil, registros acessíveis de agendamentos e
lista de espera, além de metadados visíveis de mensagens e notificações.
Solicitações próprias registradas também aparecem na exportação, limitadas à
categoria, status e data de criação; a chave de idempotência não é exportada.
Conteúdo de mensagens, dados do outro participante e observações livres não
são incluídos nesta versão. O arquivo é montado para download pelo navegador;
o endpoint não cria uma cópia persistente no servidor.

Esse recurso não cobre todo conteúdo ou todo tipo de informação possivelmente
relacionada à pessoa e não substitui um processo geral de atendimento. Não há
fluxo implementado para executar exclusão ou anonimização da conta e de todos
os dados associados. A API autenticada permite registrar e consultar pedidos
próprios nas categorias acesso/exportação, correção, exclusão/anonimização e
outras solicitações; o status inicial é `RECEBIDA`. O registro não executa o
pedido, não permite descrição livre e não oferece análise administrativa ou
mudança de status nesta fase. O canal de contato e o procedimento para
responder solicitações estão **[PENDENTE DE DEFINIÇÃO]**.

A área autenticada de Privacidade explica esses recursos e as limitações de
pedidos de exclusão ou anonimização e está integrada à API para registrar uma
categoria e consultar solicitações próprias. A página exibe categoria, status e
data de criação. Nesta primeira fase, `RECEBIDA` é o único status atual e
significa apenas que o registro foi criado; não há análise administrativa,
alteração de status, exclusão ou anonimização pela tela. Outros estados são
apenas etapas futuras. O canal de atendimento continua **[PENDENTE DE
DEFINIÇÃO]**.

Para que este aviso possa ser publicado, o controlador deverá informar um canal
de atendimento real e definir o processo de resposta, sem deixar o titular sem
orientação: **[PENDENTE DE DEFINIÇÃO]**.

## 10. Exclusão e encerramento

O aplicativo permite cancelar agendamentos e solicitações da lista de espera
e possui ações de exclusão lógica de mensagens/notificações. Essas ações não
significam que o conteúdo ou todos os dados relacionados foram removidos do
banco ou de backups. No caso de mensagens, as ações atualizam flags de
visibilidade; o campo original do conteúdo permanece armazenado no banco,
inclusive após a opção “apagar para todos”. Isso não representa remoção física
imediata.

Não foi identificado no código um fluxo geral de exclusão de conta. A forma de
tratar pedidos de exclusão, dados históricos, mensagens, cópias de segurança e
registros que precisem eventualmente ser conservados está
**[PENDENTE DE DEFINIÇÃO]**.

A relação entre solicitações de titulares e contas usa `ON DELETE RESTRICT` no
schema: a exclusão física de uma conta com solicitações vinculadas fica
bloqueada. Não há exclusão automática de solicitações; qualquer exclusão ou
anonimização depende de procedimento específico, autorizado e documentado. A
política de retenção continua **[PENDENTE DE DEFINIÇÃO]**.

## 11. Transferências internacionais

Não foi possível confirmar, a partir do código, se dados são armazenados ou
acessados fora do Brasil. A localização do banco, da hospedagem, do Brevo e de
eventuais ferramentas operacionais, assim como a existência de transferências
internacionais e salvaguardas aplicáveis, está
**[PENDENTE DE DEFINIÇÃO]**.

## 12. Atualizações deste aviso

Este é um rascunho baseado na revisão do repositório em 12/11/2026. O conteúdo,
as finalidades, os fornecedores, as bases legais, os canais de atendimento e os
prazos precisam ser confirmados pelo controlador antes da publicação. A data
de vigência e o procedimento de comunicação de alterações estão
**[PENDENTE DE DEFINIÇÃO]**.
