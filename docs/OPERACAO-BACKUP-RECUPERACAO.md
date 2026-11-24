# Operacao de backup e recuperacao do banco local

Este documento define os procedimentos para o banco local `barbearia_app`.
Os scripts nao iniciam banco, migrations, backup ou restauracao sem comando
explicito. Nenhum procedimento deste documento autoriza acesso a producao.

## Regras gerais

- Execute comandos operacionais somente em terminal local autorizado.
- `ALLOW_LOCAL_DATABASE_OPERATIONS=yes` e obrigatorio para os scripts de banco.
- O destino deve ser PostgreSQL local, porta `5432`, banco exato
  `barbearia_app`, sem parametros de URL.
- Nunca coloque a `DATABASE_URL` em argumentos ou logs.
- Nao use banco E2E ou producao.
- Nao sobrescreva dumps nem sidecars existentes.

## Localizacao e protecao dos backups

A raiz aprovada e:

```text
<diretorio pessoal>/.barbearia-app/backups
```

No Windows, isso corresponde a `.barbearia-app\backups` dentro do diretorio
pessoal do usuario. A raiz e criada quando necessario. O script verifica o
caminho canonico e rejeita symlinks/junctions em seus componentes, destinos
relativos que escapem da raiz, caminhos absolutos externos a ela e qualquer
destino dentro do repositorio. `backend/backups` nao e permitido.

Um `--output` absoluto so e aceito se estiver dentro da raiz aprovada. Um
`--output` relativo e resolvido dentro dela:

```powershell
npm run db:backup -- --output=barbearia_app.dump
```

O nome final e criado exclusivamente. Se o dump ou o sidecar `.sha256` ja
existir, a operacao aborta e preserva ambos. A saida de `pg_dump` e transmitida
diretamente para o arquivo; nao e mantida integralmente em memoria. Um lock
exclusivo impede outro backup/restauracao simultaneo. Se o processo for
interrompido e deixar o lock, confirme que nao ha operacao ativa antes de
qualquer intervencao operacional no arquivo de lock.

Os executaveis sao resolvidos por caminhos absolutos fixos para PostgreSQL 17;
`PATH` e `PG_BIN_DIR` nao escolhem os executaveis. Confirme que a instalacao
local corresponde a esses caminhos antes de qualquer backup real.

## Backup

Comando operacional (nao executado durante a implementacao desta protecao):

```powershell
cd backend
npm run db:backup
```

O script valida autorizacao, destino, executavel e caminho antes da operacao.
Cria o dump customizado sem sobrescrita, calcula SHA-256, grava o sidecar e
executa `pg_restore --list`. So informa sucesso depois de concluir checksum e
validacao estrutural. Em caso de falha, remove somente arquivos parciais que
foram criados pela propria chamada e cuja identidade de arquivo continua
correspondente; arquivos preexistentes nao sao removidos.

## Validacao de um arquivo

```powershell
npm run db:backup:validate -- --archive=C:\Users\<usuario>\.barbearia-app\backups\barbearia_app.dump
```

O checksum deve ser fornecido em `--checksum` ou estar no sidecar adjacente.
A validacao calcula SHA-256 e chama `pg_restore --list` com o caminho canonico
do arquivo, repetindo a verificacao do conteudo ao final. Ela nao restaura
dados nem conecta ao banco.

### Limites do SHA-256 e da validacao estrutural

SHA-256 detecta alteracao somente se o valor de referencia for confiavel e
protegido separadamente. Um sidecar guardado junto com o dump pode ser alterado
junto com ele; checksum nao e assinatura nem prova de origem. Preserve uma
copia do checksum em local confiavel quando precisar de autenticidade.

`pg_restore --list` confirma que a estrutura/TOC do arquivo pode ser lida; nao
prova que todo o conteudo sera restaurado com sucesso nem que o arquivo veio de
uma fonte confiavel. Um dump truncado ou adulterado pode falhar durante uma
restauracao, mesmo que a listagem inicial seja legivel.

## Restauracao

O modo padrao e somente validacao:

```powershell
npm run db:restore:validate -- --archive=C:\Users\<usuario>\.barbearia-app\backups\barbearia_app.dump
```

Uma restauracao real **esta bloqueada no script**. O fluxo exige checksum e
confirmacoes, valida o arquivo, mas aborta com `RESTORE_ISOLATION_REQUIRED`
antes de executar uma restauracao no banco `barbearia_app`. As confirmacoes
atuais nao habilitam nem contornam esse bloqueio.

Antes de habilitar qualquer restauracao real, a estrategia recomendada e
restaurar primeiro em um banco temporario isolado, com nome aleatorio e
validacao independente; inspecionar integridade/objetos e somente entao
planejar a recuperacao do destino operacional. Isso exige definir como criar,
limitar, validar e remover esse banco temporario, quais privilegios serao
necessarios e como impedir que o destino temporario coincida com E2E ou
producao. Essa operacao ainda nao foi implementada nem autorizada.

O script nao usa `--clean` ou `--if-exists`. Nao execute manualmente uma
restauracao direta no banco operacional como alternativa ao bloqueio. Uma
restauracao incompleta pode deixar alteracoes parciais; `pg_restore --list` e
checksum nao sao garantias de atomicidade.

## Migrations locais

Nao use `npx prisma migrate dev` ou `npx prisma migrate deploy` diretamente.
Use o runner protegido:

```powershell
cd backend
npm run db:development:migrate
```

O runner reutiliza [backend/test/prisma-migration-safety.cjs](../backend/test/prisma-migration-safety.cjs),
exige `PRISMA_MIGRATION_TARGET=development`, rejeita argumentos extras e
restringe o destino a `barbearia_app` local em loopback e porta `5432`. Variaveis
alternativas de conexao sao removidas do ambiente filho.

Para migrations E2E, use exclusivamente:

```powershell
npm run db:e2e:migrate
```

## Procedimento recomendado antes de migrations

1. Confirmar que a aplicacao esta parada.
2. Confirmar o destino local sem imprimir credenciais.
3. Criar o backup na raiz externa aprovada.
4. Guardar o checksum de referencia em local confiavel.
5. Validar o checksum e `pg_restore --list`.
6. Revisar a migration alvo.
7. Usar somente o runner local protegido.
8. Conservar o backup pelo ciclo aprovado.

Backup real, restauracao, migrations e acesso a banco dependem de autorizacao
operacional separada; os testes com mocks nao comprovam conectividade nem
compatibilidade com um arquivo ou servidor PostgreSQL real.
