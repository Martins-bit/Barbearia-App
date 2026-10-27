require('dotenv/config');
const { Client } = require('pg');

const c = new Client({ connectionString: process.env.DATABASE_URL });

c.connect()
  .then(async () => {
    const ins =
      'insert into "Usuario" ("nome","telefone","email","senhaHash","tipoUsuario","ativo","dataCriacao","dataAtualizacao") ' +
      'values ($1,$2,$3,$4,$5,true,now(),now()) returning id';
    try {
      await c.query('begin');
      await c.query(ins, ['diagA', '99990001', 'diag.detail@x.com', 'h', 'CLIENTE']);
      await c.query(ins, ['diagB', '99990002', 'diag.detail@x.com', 'h', 'CLIENTE']);
    } catch (e) {
      console.log('pg error code =', e.code);
      console.log('pg detail     =', JSON.stringify(e.detail));
      console.log('pg constraint =', JSON.stringify(e.constraint));
      console.log('pg message    =', e.message);
      console.log('pg keys       =', Object.keys(e).join(','));
    } finally {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  })
  .catch((e) => {
    console.log('ERR', e.message);
  });
