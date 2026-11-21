/**
 * Cria o banco dedicado de testes E2E (`barbearia_app_e2e`), se ainda não
 * existir. Idempotente e NÃO destrutivo: nunca apaga, nunca recria, nunca
 * toca em outro banco.
 *
 * Pré-requisito: `DATABASE_URL_E2E` definida (ver backend/.env.e2e.example) e
 * um PostgreSQL local já em execução, com um usuário autorizado a criar bancos.
 *
 * Fluxo de segurança:
 *   1. test/e2e-env.ts valida a URL (protocolo, host local, nome do banco);
 *   2. conecta ao banco de MANUTENÇÃO (`postgres`) apenas para verificar
 *      existência e criar o banco, caso ausente;
 *   3. confirma `CREATE DATABASE` com o usuário que irá usa-lo.
 *
 * Uso: npm run db:e2e:create
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const TEST_DATABASE_NAME = 'barbearia_app_e2e';

function log(message) {
  console.log(`[e2e:create] ${message}`);
}

function die(message) {
  console.error(`[e2e:create] ERRO: ${message}`);
  process.exit(1);
}

async function main() {
  const e2eUrl = process.env.DATABASE_URL_E2E;
  if (!e2eUrl) {
    die(
      'DATABASE_URL_E2E não está definida. Copie backend/.env.e2e.example para ' +
      'backend/.env.e2e (ou exporte a variável) e preencha com um banco LOCAL.',
    );
  }

  const parsed = new URL(e2eUrl);
  const database = parsed.pathname.replace(/^\//, '');
  if (database !== TEST_DATABASE_NAME) {
    die(
      `DATABASE_URL_E2E aponta para "${database}", mas apenas "${TEST_DATABASE_NAME}" ` +
      'pode ser criado por este script. Nada foi feito.',
    );
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) {
    die(
      `Host "${parsed.hostname}" não permitido: este script só cria bancos em um ` +
      'PostgreSQL local. Nada foi feito.',
    );
  }

  // Conexão de manutenção: MESMO servidor/usuário, no banco padrão "postgres".
  const adminUrl = new URL(e2eUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const who = await client.query(
      'select current_user as usr, inet_server_addr()::text as addr, inet_server_port() as port',
    );
    log(`servidor: ${who.rows[0].addr || 'local'}:${who.rows[0].port}`);

    const exists = await client.query(
      'select 1 from pg_database where datname = $1',
      [database],
    );
    if (exists.rowCount > 0) {
      log(`banco "${database}" já existe — nada a criar.`);
      return;
    }

    const canCreate = await client.query(
      'select rolcreatedb or rolsuper as ok from pg_roles where rolname = current_user',
    );
    if (!canCreate.rows[0]?.ok) {
      die(
        `o usuário conectado não tem permissão para criar bancos. ` +
        `Crie "${database}" manualmente como administrador (veja docs/TESTES-E2E.md).`,
      );
    }

    // Identificador validado acima; interpolação sem parâmetro é necessária
    // porque CREATE DATABASE não aceita parâmetros de bind.
    await client.query(`CREATE DATABASE "${database}"`);
    log(`banco "${database}" criado. Agora rode: npm run db:e2e:prepare`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  // Nenhuma mensagem inclui usuário/senha/URL.
  die(`falha ao conectar/criar (code=${e.code || 'n/a'}): ${e.message}`);
});
