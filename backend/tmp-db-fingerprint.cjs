// TEMPORÁRIO (diagnóstico) — impressão digital SOMENTE LEITURA do banco
// apontado pelo argumento (nunca imprime a URL). Remover no fim da etapa.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const target = process.argv[2] || 'dev';

async function fingerprint(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const who = await client.query(
      'select current_database() as db, inet_server_addr()::text as addr, inet_server_port() as port',
    );
    const tables = await client.query(
      `select table_schema, table_name from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
        order by 1, 2`,
    );
    const counts = {};
    for (const row of tables.rows) {
      const q = `select count(*)::int as n from "${row.table_schema}"."${row.table_name}"`;
      const res = await client.query(q);
      counts[`${row.table_schema}.${row.table_name}`] = res.rows[0].n;
    }
    const maxUpdated = {};
    for (const row of tables.rows) {
      const q = `select max("dataAtualizacao")::text as m from "${row.table_schema}"."${row.table_name}" where false`;
      try {
        const res = await client.query(q);
        maxUpdated[`${row.table_schema}.${row.table_name}`] = res.rows[0].m;
      } catch {
        /* coluna ausente */
      }
    }
    const migrations = await client
      .query(
        'select migration_name, checksum from _prisma_migrations order by migration_name',
      )
      .catch(() => ({ rows: [] }));
    return {
      db: who.rows[0].db,
      addr: who.rows[0].addr,
      port: who.rows[0].port,
      tableCount: tables.rowCount,
      counts,
      checksum: migrations.rows.map((r) => `${r.migration_name}:${r.checksum}`).join('|'),
      migrations: migrations.rows.length,
    };
  } finally {
    await client.end();
  }
}

(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log('DATABASE_URL ausente');
    process.exitCode = 1;
    return;
  }
  const result = await fingerprint(connectionString);
  const out = path.resolve(__dirname, `..`, `tmp-fingerprint-${target}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(
    `FINGERPRINT ${target}: db=${result.db} addr=${result.addr || 'local'} ` +
    `tables=${result.tableCount} migrations=${result.migrations}`,
  );
  console.log('ROWS=' + JSON.stringify(result.counts));
})().catch((e) => {
  console.log('FINGERPRINT_ERR=' + e.code + ' ' + e.message);
  process.exitCode = 1;
});
