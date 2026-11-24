const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runDevelopmentMigrations,
} = require('./run-development-migrations.cjs');

test('development migration runner reuses the protected guard and blocks remote targets', () => {
  let spawned = false;
  assert.throws(
    () =>
      runDevelopmentMigrations({
        env: {
          PRISMA_MIGRATION_TARGET: 'development',
          DATABASE_URL:
            'postgresql://usuario:secret@remote.example:5432/barbearia_app',
        },
        spawn: () => {
          spawned = true;
          return { status: 0 };
        },
      }),
  );
  assert.equal(spawned, false);
});

test('development migration runner rejects unsafe host, port, database, parameters, E2E, and production URLs', () => {
  const invalidUrls = [
    'postgresql://usuario:secret@remote.example:5432/barbearia_app',
    'postgresql://usuario:secret@localhost:5432/barbearia_app',
    'postgresql://usuario:secret@127.0.0.1:5433/barbearia_app',
    'postgresql://usuario:secret@127.0.0.1:5432/barbearia_app_e2e',
    'postgresql://usuario:secret@127.0.0.1:5432/production',
    'postgresql://usuario:secret@127.0.0.1:5432/barbearia_app?host=remote.example',
    'postgresql://usuario:secret@127.0.0.1:5432/barbearia_app?schema=other',
    'postgresql://usuario:secret@127.0.0.1:5432/barbearia_app?schema=public&host=remote.example',
  ];

  for (const DATABASE_URL of invalidUrls) {
    let spawned = false;
    assert.throws(
      () =>
        runDevelopmentMigrations({
          env: {
            PRISMA_MIGRATION_TARGET: 'development',
            DATABASE_URL,
          },
          spawn: () => {
            spawned = true;
            return { status: 0 };
          },
        }),
      undefined,
      `deveria rejeitar destino ${DATABASE_URL.replace(/\/\/[^/]+@/, '//<redacted>@')}`,
    );
    assert.equal(spawned, false);
  }
});

test('development migration runner fixes migrate deploy and target for local approval', () => {
  let captured;
  const status = runDevelopmentMigrations({
    env: {
      PRISMA_MIGRATION_TARGET: 'development',
      DATABASE_URL:
        'postgresql://usuario:secret@127.0.0.1:5432/barbearia_app',
      PATH: 'test-path',
    },
    spawn: (...args) => {
      captured = args;
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.ok(captured[1].includes('migrate'));
  assert.ok(captured[1].includes('deploy'));
  assert.ok(captured[1].some((arg) => arg.endsWith('prisma.config.ts')));
  assert.equal(captured[2].env.PRISMA_MIGRATION_TARGET, 'development');
  assert.equal(captured[2].env.PGDATABASE, undefined);
  assert.equal(captured[2].env.PGHOST, undefined);
});

test('development migration runner removes alternate database and Prisma destination variables', () => {
  let captured;
  runDevelopmentMigrations({
    env: {
      PRISMA_MIGRATION_TARGET: 'untrusted',
      DATABASE_URL:
        'postgresql://usuario:secret@127.0.0.1:5432/barbearia_app?schema=public',
      DIRECT_URL: 'postgresql://remote.example/other',
      SHADOW_DATABASE_URL: 'postgresql://remote.example/shadow',
      POSTGRES_URL: 'postgresql://remote.example/other',
      DATABASE_HOST: 'remote.example',
      DB_HOST: 'remote.example',
      PGHOST: 'remote.example',
      PGPORT: '5433',
      PGSERVICE: 'production',
      PRISMA_SCHEMA: 'unsafe.prisma',
      PATH: 'test-path',
    },
    spawn: (...args) => {
      captured = args;
      return { status: 0 };
    },
  });

  assert.equal(
    captured[2].env.DATABASE_URL,
    'postgresql://usuario:secret@127.0.0.1:5432/barbearia_app?schema=public',
  );
  assert.equal(captured[2].env.PRISMA_MIGRATION_TARGET, 'development');
  assert.equal(captured[2].env.PATH, 'test-path');
  for (const key of [
    'DIRECT_URL',
    'SHADOW_DATABASE_URL',
    'POSTGRES_URL',
    'DATABASE_HOST',
    'DB_HOST',
    'PGHOST',
    'PGPORT',
    'PGSERVICE',
    'PRISMA_SCHEMA',
  ]) {
    assert.equal(captured[2].env[key], undefined, `${key} should be removed`);
  }
});

test('development migration runner rejects extra arguments before spawn', () => {
  let spawned = false;
  assert.throws(
    () =>
      runDevelopmentMigrations({
        env: {
          PRISMA_MIGRATION_TARGET: 'development',
          DATABASE_URL:
            'postgresql://usuario:secret@127.0.0.1:5432/barbearia_app',
        },
        argv: ['--config=unsafe.prisma.config.ts'],
        spawn: () => {
          spawned = true;
          return { status: 0 };
        },
      }),
  );
  assert.equal(spawned, false);
});
