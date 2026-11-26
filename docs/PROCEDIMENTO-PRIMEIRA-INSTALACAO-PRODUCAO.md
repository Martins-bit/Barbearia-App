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
única. O runner, portanto, aceita somente o endpoint direto
do projeto de produção fixado no código, na porta `5432`, banco `postgres` e
schema `public`. O Session Pooler é rejeitado, mesmo em modo de sessão. A
aplicação pode continuar usando seu endpoint de runtime separado.

O runner exige `sslmode=require&sslaccept=strict`. No Prisma Engine usado pelo
Prisma `7.10.1`, `sslmode=require` sozinho não rejeita certificados inválidos;
`sslaccept=strict` exige validação da cadeia confiável e do hostname pelo TLS
nativo. Não substitua por `sslmode=verify-full`: essa versão do engine não
reconhece esse valor como modo SSL. O preflight remove esses parâmetros antes
de construir a conexão `pg` e passa explicitamente `rejectUnauthorized: true`
e o hostname esperado. O runner também recusa `NODE_TLS_REJECT_UNAUTHORIZED`.

O endpoint direto do Supabase é IPv6 por padrão; ele só é acessível por IPv4
quando o projeto possui o complemento IPv4. Antes de planejar a execução,
confirme a conectividade direta a partir do ambiente operacional autorizado.
Se essa rota não estiver disponível, interrompa o procedimento e defina uma
solução aprovada; não troque silenciosamente para o Session Pooler.

Referências oficiais:

- [Prisma Migrate em produção (v7)](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)
- [Conectar ao PostgreSQL no Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)

## Proteções do runner

Antes de iniciar o Prisma, o runner:

1. exige `NODE_ENV=production`, uma chave pública Ed25519 configurada e um
   token de aprovação assinado, válido por no máximo cinco minutos e vinculado
   ao projeto e a uma única operação;
2. compara `DATABASE_URL` com project ref e host fixados no código, banco
   `postgres`, schema `public`, porta `5432`, usuário `postgres` e TLS
   estritamente validado;
3. rejeita loopback, host diferente, Session Pooler, parâmetros adicionais e
   argumentos de linha de comando;
4. confere o manifesto versionado das 17 migrations, a ordem, o provider
   PostgreSQL e o SHA-256 de cada `migration.sql`;
5. consome o identificador da operação por criação exclusiva atômica no ledger
   persistente do host autorizado, abre uma conexão TLS, confere o
   banco/schema efetivos e adquire um advisory lock para serializar este
   runner;
6. aborta se encontrar histórico `_prisma_migrations` em qualquer schema ou
   qualquer objeto no schema `public`;
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
allowlist do subprocesso contém apenas a URL necessária, variáveis mínimas de
runtime e essa prova efêmera; a saída do subprocesso continua descartada.

O advisory lock é cooperativo e protege somente contra outra execução que
utilize este runner. **Ele não bloqueia a aplicação nem outros clientes
PostgreSQL.** Antes de iniciar e durante toda a operação, a aplicação e
quaisquer outros processos que possam escrever no banco devem estar parados.
Mantenha-os parados até o postflight terminar e o resultado ser revisado. Essa
suspensão é uma pré-condição operacional obrigatória; o runner não consegue
impor nem comprovar que todos os escritores foram interrompidos.

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

1. confirme que o project ref e host direto no dashboard Supabase correspondem
   ao destino fixado no runner; não confie em valores copiados de ambiente de
   desenvolvimento;
2. confirme que o endpoint direto é alcançável pelo ambiente escolhido e que
   o certificado TLS e o hostname serão validados;
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

O runner exige estas variáveis no processo autorizado:

- `NODE_ENV=production`;
- `DATABASE_URL`: conexão direta PostgreSQL, TLS obrigatório; nunca exiba ou
  passe em argumentos; a URL deve conter somente `schema=public`,
  `sslmode=require` e `sslaccept=strict`;
- `PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY`: chave pública Ed25519 em PEM ou
  base64 de DER SubjectPublicKeyInfo, fornecida pela configuração protegida do
  host operacional. Se estiver ausente ou inválida, a execução é recusada;
- `PRODUCTION_MIGRATION_APPROVAL_TOKEN`: token assinado pelo responsável pela
  aprovação, entregue para esta operação e nunca registrado em logs.

O token é composto por `<payload-base64url>.<assinatura-base64url>`. A
assinatura Ed25519 cobre exatamente os bytes ASCII do segmento
`payload-base64url`. O payload JSON canônico contém, nesta ordem, `version`,
`audience`, `projectRef`, `host`, `database`, `schema`, `operationId`,
`operatorHost`, `issuedAt`, `expiresAt`, `backupVerified` e `writersStopped`.
`operatorHost` deve ser exatamente o hostname local em minúsculas; o runner
rejeita uma autorização assinada para outro host. O runner exige `version=1`,
audience `barbearia-app:production-first-install`, o destino fixado, UUID v4
único, backup e suspensão de escritores confirmados, horário de emissão
dentro da tolerância do relógio e validade de no máximo cinco minutos. O
runner não gera chaves nem emite aprovações.

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
