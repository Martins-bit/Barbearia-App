/**
 * Prepara o banco dedicado de testes E2E com o fluxo de migrations do projeto
 * (`prisma migrate deploy`), e confirma que o schema está atualizado.
 *
 * Uso: npm run db:e2e:prepare  (depois de `npm run db:e2e:create`)
 *
 * Segurança:
 *   - usa SOMENTE `DATABASE_URL_E2E` (o preload test/load-e2e-env.cjs já
 *     validou protocolo, host local e nome do banco);
 *   - revalida na conexão real que `current_database()` é o banco de testes;
 *   - recusa executar se `_prisma_migrations` indicar migrations pendentes
 *     após o deploy;
 *   - não roda `migrate reset`, `db push --force-reset` nem `deleteMany`.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const TEST_DATABASE_NAME = 'barbearia_app_e2e';

function log(message) {
  console.log(`[e2e:prepare] ${message}`);
}

function die(message) {
  console.error(`[e2e:prepare] ERRO: ${message}`);
  process.exit(1);
}

async function main() {
  const connectionString = process.env.DATABASE_URL_E2E;
  if (!connectionString) {
    die('DATABASE_URL_E2E não está definida.');
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (e) {
    die(
      `não foi possível conectar ao banco de testes (code=${e.code || 'n/a'}). ` +
      'Confira se o PostgreSQL local está em execução e se o banco foi criado ' +
      'com "npm run db:e2e:create".',
    );
  }

  const who = await client.query('select current_database() as db');
  const current = who.rows[0].db;
  if (current !== TEST_DATABASE_NAME) {
    await client.end();
    die(
      `a conexão aponta para "${current}", diferente de "${TEST_DATABASE_NAME}". ` +
      'Aplicação de migrations interrompida.',
    );
  }
  log(`conexão confirmada no banco "${current}".`);

  await client.end();

  // Fluxo adotado pelo projeto: Prisma CLI + prisma.config.ts (que lê
  // DATABASE_URL — aqui já substituída pela URL de testes validada).
  const backendDir = path.resolve(__dirname, '..');
  const prismaBin = path.join(
    backendDir,
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );

  log('aplicando migrations (prisma migrate deploy)...');
  execFileSync(process.execPath, [prismaBin, 'migrate', 'deploy'], {
    cwd: backendDir,
    stdio: 'inherit',
    env: process.env,
  });

  // Confirmação pós-deploy: nenhuma migration pendente e tabelas presentes.
  const check = new Client({ connectionString });
  await check.connect();
  try {
    const pending = await check.query(
      'select count(*)::int as n from _prisma_migrations where finished_at is null',
    );
    if (pending.rows[0].n > 0) {
      die(`${pending.rows[0].n} migration(ões) pendente(s) após o deploy.`);
    }
    const applied = await check.query(
      'select count(*)::int as n from _prisma_migrations',
    );
    const tables = await check.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name not like '\\_prisma%'`,
    );
    log(
      `schema em dia: ${applied.rows[0].n} migration(ões) aplicada(s), ` +
      `${tables.rows[0].n} tabela(s) no schema public.`,
    );
  } finally {
    await check.end();
  }

  log('banco de testes pronto. Rode: npm run test:e2e');
}

main().catch((e) => {
  die(`falha no prepare (code=${e.code || 'n/a'}): ${e.message}`);
});
