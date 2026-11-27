# Primeira instalação do schema em produção

## Escopo e limites

Este procedimento descreve o uso futuro do runner exclusivo
`npm run db:production:first-install`. Criar ou testar o runner não autoriza
executá-lo em produção. A execução depende de autorização operacional separada
e revisão humana.

O comando não é chamado por build, start, deploy, seed ou provisionamento.
Ele executa somente `prisma migrate deploy` com configuração própria. Não use
`migrate dev`, `migrate reset`, `db push`, `db execute`, os runners de
desenvolvimento/E2E ou comandos Prisma diretos para primeira instalação.

## Conexão Prisma e Supabase

O projeto usa Prisma ORM `7.10.1`. A documentação atual do Supabase recomenda
conexão direta para migrations e demais operações administrativas de sessão
única. O runner aceita o endpoint direto do projeto de produção fixado no
código ou o Session Pooler compartilhado IPv4 do mesmo projeto, em modo sessão
e porta `5432`. O uso do Session Pooler para esta operação é uma exceção
operacional à recomendação de conexão direta do Supabase. O operador deve
assinar uma destas declarações mutuamente exclusivas: validação técnica
concluída em ambiente não produtivo ou aceitação explícita do risco de seguir
sem essa validação. Aceitar o risco não comprova compatibilidade nem equivale
à validação. O Transaction Pooler, na porta `6543`, nunca é aceito.

Para Session Pooler, obtenha o hostname regional exato em **Connect** no
dashboard Supabase e configure-o como `PRODUCTION_SESSION_POOLER_HOST` no
ambiente operacional protegido. O runner não infere host/região nem aceita
qualquer hostname apenas por terminar em `.pooler.supabase.com`; compara o
host da URL com esse valor exato. A URL deve usar o usuário
`postgres.<PROJECT-REF>`, além do banco `postgres` e da porta `5432`. A
aprovação assinada vincula modo, host, porta e usuário. Aprovações do formato
anterior não são aceitas. A aplicação pode continuar usando sua conexão de
runtime separada.

O runner exige `sslmode=require&sslaccept=strict` na URL. Prisma ORM 7.10.1
usa `node-pg`; `sslmode=require` sozinho não comprova a identidade do servidor.
Por isso, o runner exige `NODE_EXTRA_CA_CERTS` apontando para a CA Root 2021
oficial do Supabase, valida o PEM e seu SHA-256 fixado no código, e passa a
mesma CA ao preflight `pg` e ao subprocesso Prisma. O preflight define
explicitamente `rejectUnauthorized: true` e SNI/hostname igual ao endpoint
aprovado. Após `connect()`, o runner confirma no socket TLS do cliente que
`encrypted` e `authorized` são verdadeiros e que o host/SNI e a CA continuam
correspondendo à configuração validada. `pg_stat_ssl` não é usado como prova
da conexão cliente → pooler. O runner não verifica independentemente a conexão
pooler → PostgreSQL. Prisma recebe somente o caminho validado por
`NODE_EXTRA_CA_CERTS`, que deve estar definido antes de iniciar o processo
Node; a variável é repassada pela allowlist restrita do subprocesso. Nenhum
modo de TLS inseguro é habilitado, e o runner recusa
`NODE_TLS_REJECT_UNAUTHORIZED`.

Baixe `prod-ca-2021.crt` em **Database Settings → SSL Configuration** no
dashboard Supabase e configure `NODE_EXTRA_CA_CERTS` antes do comando npm. O
runner aceita somente a CA Root 2021 cujo SHA-256 é
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`;
PEMs inválidos, outras CAs (inclusive raízes autoassinadas não reconhecidas),
links simbólicos e caminhos inexistentes são recusados. A raiz atual expira em
26 de abril de 2031. Uma rotação de CA exige revisar e atualizar explicitamente
o fingerprint fixado e os testes; não aceite uma CA diferente para contornar
uma falha TLS.

O endpoint direto do Supabase é IPv6 por padrão; ele só é acessível por IPv4
quando o projeto possui o complemento IPv4. O Session Pooler compartilhado é
IPv4 e preserva uma sessão PostgreSQL por cliente conectado; não use o modo
transação como substituto. O Supabase ainda recomenda conexão direta para
migrations. antes de aprovar a exceção Session Pooler, valide em ambiente não
produtivo o comportamento do Prisma 7.10.1, a validação TLS do socket cliente
contra o hostname regional, o advisory lock e o conjunto completo das
migrations. `pg_stat_ssl` descreve a conexão vista pelo backend PostgreSQL e
não substitui a verificação TLS cliente → pooler; a perna pooler → PostgreSQL
não é atestada independentemente pelo runner.
Se o operador optar por continuar sem essa validação, a aprovação deve
registrar separadamente a aceitação explícita do risco, sem marcar a validação
como concluída.

### Validação do Session Pooler sem migrations

O script independente `scripts/session-pooler-validation.cjs` usa somente
Node.js e o pacote `pg` já instalado. Ele não carrega `.env`, não lê
`DATABASE_URL`, não importa o runner de produção e não executa Prisma. Exige
que o operador identifique explicitamente um projeto temporário, bloqueia o
project ref de produção conhecido e valida o formato do hostname, porta `5432`,
banco `postgres` e usuário `postgres.<PROJECT-REF>`.

Conectado somente ao projeto de teste configurado, verifica TLS com
`rejectUnauthorized: true` e SNI do hostname. A consulta a `pg_stat_ssl` é
somente uma observação separada reportada pelo servidor; ela não comprova TLS
no socket cliente → pooler. O script também abre duas sessões ao mesmo tempo e
exige PIDs PostgreSQL distintos. Em seguida adquire o advisory lock
correspondente ao runner, verifica sua posse durante um heartbeat, libera
intencionalmente esse lock e confirma que o heartbeat detecta a perda e encerra
um processo Node inofensivo. O script não cria tabelas nem grava dados; o lock
é estado temporário da sessão e é liberado no encerramento. Este teste cobre os
comportamentos de conexão, não a execução das migrations Prisma.

Depois que o responsável fornecer os dados de um projeto realmente temporário
e descartável obtidos no painel Supabase, execute no PowerShell a partir da
pasta `backend`, preenchendo somente os valores desse projeto:

```powershell
$env:SESSION_POOLER_TEST_PROJECT_TYPE = 'temporary-test'
$env:SESSION_POOLER_TEST_ACK = 'I_CONFIRM_TEMPORARY_TEST_PROJECT'
$env:SESSION_POOLER_TEST_PROJECT_REF = '<project-ref de teste>'
$env:SESSION_POOLER_TEST_HOST = '<hostname Session Pooler copiado de Connect>'
$env:SESSION_POOLER_TEST_PORT = '5432'
$env:SESSION_POOLER_TEST_DATABASE = 'postgres'
$env:SESSION_POOLER_TEST_USERNAME = 'postgres.<project-ref de teste>'
# Injete SESSION_POOLER_TEST_PASSWORD por um mecanismo local protegido;
# nunca a coloque literalmente no comando ou no histórico do shell.
node scripts/session-pooler-validation.cjs
```

Não use valores de exemplo, hostname inferido ou qualquer dado da produção.
Forneça a senha por mecanismo local protegido, nunca no comando, histórico ou
saída. Ao terminar, remova as variáveis `SESSION_POOLER_TEST_*` do processo.
Sem os dados reais do projeto temporário e a confirmação literal exigida, o
script recusa a execução antes de conectar.

Os testes simulados, que não conectam a banco, podem ser executados com
`npm run test:session-pooler-validation`.

Referências oficiais:

- [Prisma ORM v7: alterações de validação SSL](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7#ssl-certificate-validation-changes)
- [Node.js: NODE_EXTRA_CA_CERTS](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)
- [Supabase: SSL para PostgreSQL](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Certificado público Supabase Root CA 2021](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)
- [Prisma Migrate em produção (v7)](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)
- [Conectar ao PostgreSQL no Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Limites de conexão do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)
- [FAQ do Supavisor](https://supabase.com/kb/troubleshooting/supavisor-faq-YyP5tI)

## Proteções do runner

Antes de iniciar o Prisma, o runner:

1. exige `NODE_ENV=production`, uma chave pública Ed25519 configurada e um
   token de aprovação assinado, válido por no máximo cinco minutos e vinculado
   ao projeto e a uma única operação;
2. compara `DATABASE_URL` com o projeto, banco `postgres`, schema `public`,
   porta `5432`, modo e usuário aprovados; para Session Pooler, exige o
   hostname exato configurado e usuário `postgres.<PROJECT-REF>`;
3. rejeita loopback, host diferente, Transaction Pooler, parâmetros adicionais
   e argumentos de linha de comando;
4. confere o manifesto versionado das 17 migrations, a ordem, o provider
   PostgreSQL e o SHA-256 de cada `migration.sql`;
5. consome o identificador da operação por criação exclusiva atômica no ledger
   persistente do host autorizado, abre uma conexão TLS, confere o
   banco/schema efetivos e adquire um advisory lock para serializar este
   runner;
6. aborta se encontrar histórico `_prisma_migrations` em qualquer schema ou
   objetos no schema `public`; registros `pg_default_acl` são metadados de
   privilégios padrão, não objetos existentes, e não entram nessa contagem;
7. só então cria uma prova aleatória de invocação, de uso único, e inicia o
   Prisma com a configuração exclusiva `prisma.production.config.ts` e
   argumentos fixos `migrate deploy`; a configuração consome a prova
   atomicamente e recusa chamadas diretas ou reutilizadas;
8. descarta toda a saída stdout/stderr do Prisma e verifica o histórico final,
   checksums, sucesso de cada migration e ausência de linhas nas tabelas da
   aplicação.

O token de aprovação e a chave pública não são repassados ao Prisma. A prova de
invocação é gerada somente depois do preflight, validada pela configuração
Prisma e consumida uma única vez no mesmo ledger privado do operador. A
allowlist do subprocesso contém apenas a URL necessária, o hostname Session
Pooler quando esse modo foi aprovado, variáveis mínimas de runtime e essa prova
efêmera; a saída do subprocesso continua descartada.

O advisory lock é cooperativo e protege somente contra outra execução que
utilize este runner. **Ele não bloqueia a aplicação nem outros clientes
PostgreSQL.** Antes de iniciar e durante toda a operação, a aplicação e
quaisquer outros processos que possam escrever no banco devem estar parados.
Mantenha-os parados até o postflight terminar e o resultado ser revisado. Essa
suspensão é uma pré-condição operacional obrigatória; o runner não consegue
impor nem comprovar que todos os escritores foram interrompidos.

Como o preflight e o subprocesso Prisma usam conexões distintas, Session
Pooler requer capacidade para pelo menos duas conexões backend simultâneas,
além de qualquer conexão adicional que o Prisma precise. O runner consulta a
posse do advisory lock na mesma sessão a cada cinco segundos enquanto Prisma
executa e interrompe o subprocesso se essa posse deixar de ser comprovada; ele
também verifica a posse antes e depois da migration. A perda da sessão é uma
falha operacional, nunca uma condição em que o lock é presumido ativo. Antes
de produção, valide esse comportamento e a capacidade real do pool em ambiente
não produtivo. Para Session Pooler, a aprovação assinada usa
`sessionPoolerValidated=true` somente depois de a validação ter sido
realizada. Se ela não foi, o token pode registrar
`sessionPoolerValidated=false` e
`sessionPoolerRiskAccepted=true`, mediante confirmação explícita do operador.
Essas declarações são assinadas junto com projeto, endpoint, operador e
operação. O runner aceita exatamente uma disposição para Session Pooler;
ambas verdadeiras ou ambas falsas são inválidas. Para conexão direta, ambas
devem ser `false`. A aceitação de risco não altera TLS estrito, verificações de
banco vazio, ledger, advisory lock/heartbeat, manifesto, checksums ou
postflight, e não reduz a incerteza técnica sobre o pooler.

Uma falha durante a aplicação exige revisão e recuperação manual. O runner não
limpa objetos, não marca migrations como resolvidas e não tenta novamente
automaticamente. Não execute novamente diante de uma instalação parcial.

O runner não contém comandos de seed nem de provisionamento. A configuração
Prisma não declara seed; os scripts explícitos de criação de administrador e
barbeiro não são chamados. As migrations aprovadas também são protegidas por
hash. O pós-check recusa qualquer linha nas tabelas da aplicação, além do
histórico técnico do Prisma.

## Preparação operacional futura

Antes de qualquer execução:

1. confirme no dashboard Supabase o project ref e, se usar Session Pooler, copie
   o hostname regional exato de **Connect**; configure-o como
   `PRODUCTION_SESSION_POOLER_HOST` no mecanismo protegido do host operacional.
   Não infira o hostname pela região nem use valores de ambiente de
   desenvolvimento;
2. confirme que o endpoint escolhido é alcançável e que o certificado TLS e o
   hostname serão validados;
3. pare a aplicação e todos os escritores externos antes da operação; mantenha
   todos parados até a conclusão e revisão do postflight;
4. confirme o backup aprovado e a possibilidade de recuperação com o
   responsável operacional;
5. revise as 17 migrations e o manifesto de checksums. Em especial,
   `20260902000030_add_waitlist_barbeiro_fields` adiciona
   `ListaEspera.barbeiroId` como `NOT NULL` sem default. A instalação inicial
   só é segura porque o preflight exige schema sem tabelas/objetos e, portanto,
   sem linhas para atualizar;
6. configure a chave pública Ed25519 em um mecanismo protegido e restrinja
   quem pode alterá-la; a chave privada deve permanecer exclusivamente com o
   responsável pela aprovação, fora do repositório e do servidor;
7. obtenha um token assinado para esta operação, com validade máxima de cinco
   minutos, e entregue `DATABASE_URL` e o token ao processo por mecanismo
   protegido, sem incluí-los em argumentos, scripts versionados, logs ou
   saída de diagnóstico.

### Assinatura local no Windows

O assinador local `scripts/production-approval-signer.ps1` requer PowerShell 7
ou posterior no Windows e usa a chave privada
DPAPI em `%LOCALAPPDATA%\BarbeariaApp-ProductionApprovalKeys` no contexto do
usuário Windows atual. Antes de descriptografar, verifica ACLs protegidas para
o SID desse usuário, recusa links simbólicos e confirma que a chave privada
corresponde à chave pública PEM no mesmo diretório. A chave privada é
descriptografada somente em memória e enviada ao processo Node por stdin
redirecionado; não é colocada em arquivo temporário, argumento ou variável de
ambiente. O processo de assinatura recebe somente variáveis mínimas, sem
herdar a URL de banco. O token não é exibido: fica apenas em
`PRODUCTION_MIGRATION_APPROVAL_TOKEN` no processo PowerShell atual, junto da
chave pública carregada do arquivo PEM. Mantenha esse mesmo processo aberto
para iniciar o runner.

Antes de iniciar o primeiro processo Node desta operação, configure o caminho
absoluto do arquivo oficial baixado. Exemplo no PowerShell, ajustando o nome
caso tenha salvo o arquivo em outro local:

```powershell
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path -LiteralPath "$env:LOCALAPPDATA\BarbeariaApp-ProductionApprovalKeys\prod-ca-2021.crt").Path
```

Faça isso antes de chamar `npm`; o Node lê `NODE_EXTRA_CA_CERTS` somente na
inicialização. O runner valida o certificado sem imprimir seu conteúdo ou
caminho e repassa somente esse caminho validado ao processo Prisma. Não defina
`NODE_TLS_REJECT_UNAUTHORIZED` nem use `NODE_OPTIONS` para alterar a validação.

Somente depois de completar todas as validações operacionais, no PowerShell
interativo aberto na pasta `backend`:

```powershell
$env:NODE_ENV = 'production'
. .\scripts\production-approval-signer.ps1
New-ProductionMigrationApprovalToken -ConnectionMode direct
npm run db:production:first-install
```

O assinador exige que o operador confirme digitando `BACKUP_VALIDATED` e
`WRITERS_STOPPED`. São declarações explícitas do operador, não verificações
automáticas do backup ou dos escritores. Ele não lê nem valida
`DATABASE_URL`; o runner continua responsável por recusar qualquer URL cujo
projeto, host, porta, usuário, banco, schema ou TLS não corresponda ao token.
O modo Direct também depende de conectividade real com o endpoint; o assinador
não tenta conectar.

Para Session Pooler, configure no processo o hostname regional exato copiado
do dashboard Supabase. Escolha explicitamente a disposição. Use
`validated` somente depois de completar a validação não produtiva:

```powershell
$env:PRODUCTION_SESSION_POOLER_HOST = '<hostname copiado de Supabase Connect>'
New-ProductionMigrationApprovalToken -ConnectionMode session -SessionPoolerDisposition validated
```

Quando a validação não foi feita e o operador, ciente da incerteza, decidir
prosseguir, use a disposição alternativa:

```powershell
New-ProductionMigrationApprovalToken -ConnectionMode session -SessionPoolerDisposition accept-risk-unvalidated
```

Além das confirmações de backup e escritores, em ambos os modos o assinador
exige redigitar exatamente o hostname. A disposição `validated` exige
`SESSION_POOLER_VALIDATED` e só deve ser usada após a validação técnica
descrita acima. A disposição `accept-risk-unvalidated` exige
`SESSION_POOLER_RISK_ACCEPTED_UNVALIDATED`; ela mantém
`sessionPoolerValidated=false` e não substitui nem representa validação. O
assinador aceita somente hostname no formato regional AWS do Session Pooler,
e o runner confere que o host da URL corresponde exatamente ao valor
configurado. Não use valores de exemplo nem um hostname inferido.

O token expira em quatro minutos, é específico ao operador/host, endpoint e
operação, e o runner consome seu `operationId` uma única vez. Se o runner já
consumiu a autorização, obtenha aprovação nova; não reutilize nem copie o
token. Para iniciar outra assinatura na mesma sessão, remova explicitamente o
token antigo de `Env:` após concluir o tratamento da tentativa anterior.

O runner exige estas variáveis no processo autorizado:

- `NODE_ENV=production`;
- `DATABASE_URL`: endpoint direto fixado ou Session Pooler aprovado, TLS
  obrigatório; nunca exiba ou passe em argumentos; a URL deve conter somente
  `schema=public`, `sslmode=require` e `sslaccept=strict`. Para Session Pooler,
  use o host configurado e usuário `postgres.<PROJECT-REF>` na porta `5432`;
- `PRODUCTION_SESSION_POOLER_HOST`: obrigatório no modo Session Pooler; hostname
  regional exato copiado do dashboard Supabase. O runner bloqueia se ausente,
  inválido ou diferente do host da URL;
- `NODE_EXTRA_CA_CERTS`: caminho absoluto para o `prod-ca-2021.crt` oficial do
  Supabase, definido antes de iniciar Node. O runner valida o PEM, a validade
  X.509 e o fingerprint oficial fixado; nenhuma CA diferente é aceita;
- `PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY`: chave pública Ed25519 em PEM ou
  base64 de DER SubjectPublicKeyInfo, fornecida pela configuração protegida do
  host operacional. Se estiver ausente ou inválida, a execução é recusada;
- `PRODUCTION_MIGRATION_APPROVAL_TOKEN`: token assinado pelo responsável pela
  aprovação, entregue para esta operação e nunca registrado em logs.

O token é composto por `<payload-base64url>.<assinatura-base64url>`. A
assinatura Ed25519 cobre exatamente os bytes ASCII do segmento
`payload-base64url`. O payload JSON canônico v3 contém, nesta ordem,
`version`, `audience`, `projectRef`, `connectionMode`, `host`, `port`,
`username`, `database`, `schema`, `operatorHost`, `operationId`, `issuedAt`,
`expiresAt`, `backupVerified`, `writersStopped`, `sessionPoolerValidated` e
`sessionPoolerRiskAccepted`.
`operatorHost` deve ser exatamente o hostname local em minúsculas; o runner
rejeita uma autorização assinada para outro host. O runner exige `version=3`,
audience `barbearia-app:production-first-install:v3`, modo e endpoint
correspondentes à URL, UUID v4 único, backup e suspensão de escritores
confirmados, horário de emissão dentro da tolerância do relógio e validade de
no máximo cinco minutos. Para Session Pooler, somente uma das combinações
`sessionPoolerValidated=true`/`sessionPoolerRiskAccepted=false` ou
`sessionPoolerValidated=false`/`sessionPoolerRiskAccepted=true` é aceita. Para
conexão direta, ambas devem ser `false`. Tokens de formatos anteriores não
são aceitos. O runner não gera chaves nem emite aprovações; o assinador
Windows documentado acima cria a assinatura somente após as confirmações
explícitas.

O `operationId` é consumido com `open(..., 'wx')` no ledger persistente
`<perfil-do-operador>/.barbearia-app-production-first-install/consumed`. O
registro é criado antes de qualquer conexão PostgreSQL; uma falha posterior
também consome a aprovação e exige novo token. Todas as tentativas devem
ocorrer no mesmo host persistente designado. Não copie tokens entre hosts nem
apague, restaure para um estado anterior ou mova o ledger. O diretório deve ser
protegido pelo perfil do operador; em sistemas POSIX, o runner também exige
permissões privadas e rejeita caminhos por symlink. No Windows, o runner
substitui as ACLs do ledger e dos arquivos existentes por DACLs protegidos,
permitindo controle somente ao SID do operador atual e ao LocalSystem. Se
`icacls` ou a identificação do operador falhar, aborta antes de conectar ao
PostgreSQL.
Administradores locais com privilégios elevados ainda podem substituir ACLs;
proteja o host e o perfil do operador conforme a política operacional.

A mesma pasta protegida guarda os digests das provas efêmeras de invocação
Prisma e seus marcadores de consumo. Eles não contêm o token de aprovação nem
segredos de conexão. Não apague ou restaure esses registros durante uma
operação.

## Execução controlada

Somente depois de completar a preparação e obter autorização:

```powershell
Set-Location backend
npm run db:production:first-install
```

Forneça as variáveis ao processo por um mecanismo protegido aprovado pela
organização. Não as inclua no comando PowerShell, na linha de comando, em
arquivos versionados ou em mensagens. Não use `--` nem argumentos adicionais.

O comando é intencionalmente manual. Não o associe a Render, CI/CD, build,
start ou deploy automático. O sucesso deve ser revisado junto aos logs
de progresso e aos diagnósticos fixos (a saída do Prisma é descartada) e ao
histórico final no Supabase por um operador autorizado. Não retome os
escritores até a revisão do postflight.

## Testes

Os testes unitários não conectam a banco:

```powershell
Set-Location backend
npm run test:production-first-install
```

O teste de integração cria uma rede Docker interna, publica PostgreSQL somente
em `127.0.0.1`, usa armazenamento `tmpfs` sem volume persistente, aplica as
migrations e remove somente os recursos rotulados que ele próprio criou:

```powershell
npm run test:production-first-install:integration
```

Esse teste exige um daemon Docker local. Ele recusa `DOCKER_HOST`,
`DOCKER_CONTEXT` e endpoints Docker remotos. Não reutilize os bancos de
desenvolvimento ou E2E; não configure variáveis de produção no processo de
teste.
