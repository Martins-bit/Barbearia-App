const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  EXPECTED_MIGRATION_COUNT,
  PRODUCTION_TARGET,
  assertMigrationHistoryAndEmptyTables,
  assertProductionConfigInvocation,
  assertTargetIsEmpty,
  consumeAuthorizationOnce,
  createPostgresClient,
  readAndVerifyMigrationManifest,
  runProductionFirstInstall,
  sanitizedDatabaseEnvironment,
  validateProductionEnvironment,
} = require('./production-first-install.cjs');
const {
  assertIntegrationConfigInvocation,
  validateIntegrationUrl,
} = require('../test/production-first-install.integration-safety.cjs');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_KEY = publicKey.export({ format: 'pem', type: 'spki' });
const HOST = PRODUCTION_TARGET.host;
const DATABASE_URL =
  `postgresql://postgres:example-secret@${HOST}:5432/postgres` +
  '?schema=public&sslmode=require&sslaccept=strict';

function signedApproval(claimOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    version: 1,
    audience: 'barbearia-app:production-first-install',
    projectRef: PRODUCTION_TARGET.projectRef,
    host: PRODUCTION_TARGET.host,
    database: PRODUCTION_TARGET.database,
    schema: PRODUCTION_TARGET.schema,
    operatorHost: os.hostname().toLowerCase(),
    operationId: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + 240,
    backupVerified: true,
    writersStopped: true,
    ...claimOverrides,
  };
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString(
    'base64url',
  );
  const signature = crypto
    .sign(null, Buffer.from(encodedPayload, 'ascii'), privateKey)
    .toString('base64url');
  return { claims, token: `${encodedPayload}.${signature}` };
}

function productionEnvironment(overrides = {}, claimOverrides = {}) {
  const { token } = signedApproval(claimOverrides);
  return {
    NODE_ENV: 'production',
    DATABASE_URL,
    PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: PUBLIC_KEY,
    PRODUCTION_MIGRATION_APPROVAL_TOKEN: token,
    ...overrides,
  };
}

function temporaryAuthorizationStateDirectory(t) {
  const directory = fs.mkdtempSync(
    path.join(os.homedir(), '.barbearia-first-install-test-'),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function pgError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fakeInstalledClient() {
  const migrations = readAndVerifyMigrationManifest();
  const calls = [];
  let insertedData = false;
  const client = {
    calls,
    async connect() {},
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SET search_path')) {
        return { rows: [] };
      }
      if (sql.includes('current_database()')) {
        return {
          rows: [{ database: 'postgres', schema: 'public' }],
        };
      }
      if (sql.includes('pg_stat_ssl')) {
        return { rows: [{ ssl: true }] };
      }
      if (sql.includes('pg_advisory_lock')) {
        return { rows: [{}] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      if (sql.includes("c.relname = '_prisma_migrations'")) {
        return { rows: [] };
      }
      if (sql.includes('AS existing_objects')) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes('SELECT migration_name, checksum')) {
        return {
          rows: migrations.map((migration) => ({
            migration_name: migration.name,
            checksum: migration.sha256,
            finished_at: new Date(),
            rolled_back_at: null,
          })),
        };
      }
      if (sql.includes("c.relname <> '_prisma_migrations'")) {
        return { rows: [{ relname: 'Usuario' }, { relname: 'Barbeiro' }] };
      }
      if (sql.includes('SELECT EXISTS')) {
        return { rows: [{ has_rows: insertedData }] };
      }
      throw new Error('Unexpected mocked query.');
    },
    async end() {},
    setInsertedData(value) {
      insertedData = value;
    },
  };
  return client;
}

test('production target requires explicit production confirmation and direct Supabase endpoint', () => {
  const config = validateProductionEnvironment(
    productionEnvironment({
      PRODUCTION_PROJECT_REF: 'untrusted-project-ref',
      SUPABASE_PROJECT_REF: 'untrusted-project-ref',
    }),
  );
  assert.equal(config.host, HOST);
  assert.equal(config.database, 'postgres');
  assert.equal(config.schema, 'public');
  assert.equal(config.projectRef, PRODUCTION_TARGET.projectRef);

  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({ NODE_ENV: 'development' }),
      ),
    { code: 'PRODUCTION_ENVIRONMENT_REQUIRED' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({
          PRODUCTION_MIGRATION_APPROVAL_TOKEN: '',
        }),
      ),
    { code: 'PRODUCTION_APPROVAL_TOKEN_REQUIRED' },
  );
});

test('production target is pinned and rejects poolers, other projects, and local hosts', () => {
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({
          DATABASE_URL:
            'postgresql://postgres.projectref:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?schema=public&sslmode=require',
        }),
      ),
    { code: 'SESSION_POOLER_NOT_ALLOWED' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({
          DATABASE_URL:
            'postgresql://postgres:secret@127.0.0.1:5432/postgres?schema=public&sslmode=require',
        }),
      ),
    { code: 'PRODUCTION_TARGET_HOST_MISMATCH' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({
          DATABASE_URL:
            'postgresql://postgres:secret@db.otherprojectref.supabase.co:5432/postgres?schema=public&sslmode=require&sslaccept=strict',
        }),
      ),
    { code: 'PRODUCTION_TARGET_HOST_MISMATCH' },
  );
});

test('approval requires a valid short-lived Ed25519 signature for this target', () => {
  const now = Math.floor(Date.now() / 1000);
  const invalidSignatureApproval = signedApproval();
  const [encodedPayload] = invalidSignatureApproval.token.split('.');
  const publicKeyBase64 = publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  assert.doesNotThrow(() =>
    validateProductionEnvironment(
      productionEnvironment({
        PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: publicKeyBase64,
      }),
    ),
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({}, { expiresAt: now - 1 }),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({
          PRODUCTION_MIGRATION_APPROVAL_TOKEN: `${encodedPayload}.${Buffer.alloc(64).toString('base64url')}`,
        }),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({}, { expiresAt: now + 301 }),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({}, { writersStopped: false }),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({}, { projectRef: 'differentprojectref' }),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({
          PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: undefined,
        }),
      ),
    { code: 'PRODUCTION_APPROVAL_PUBLIC_KEY_REQUIRED' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({
          PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: 'not-a-public-key',
        }),
      ),
    { code: 'PRODUCTION_APPROVAL_PUBLIC_KEY_INVALID' },
  );
});

test('authorization consumption is atomic and refuses a replayed operation id', (t) => {
  const environment = productionEnvironment();
  const config = validateProductionEnvironment(environment);
  const stateDirectory = temporaryAuthorizationStateDirectory(t);

  consumeAuthorizationOnce(config.approval, stateDirectory);
  assert.throws(
    () => consumeAuthorizationOnce(config.approval, stateDirectory),
    { code: 'PRODUCTION_APPROVAL_ALREADY_CONSUMED' },
  );
});

test('approval rejects a token signed for a different operator host', () => {
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({}, { operatorHost: 'another-host' }),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
});

test('production URL requires the pinned database, schema, port, and strict TLS', () => {
  const invalidUrls = [
    `postgresql://postgres:secret@${HOST}:6543/postgres?schema=public&sslmode=require&sslaccept=strict`,
    `postgresql://postgres:secret@${HOST}:5432/other?schema=public&sslmode=require&sslaccept=strict`,
    `postgresql://postgres:secret@${HOST}:5432/postgres?schema=other&sslmode=require&sslaccept=strict`,
    `postgresql://postgres:secret@${HOST}:5432/postgres?schema=public&sslmode=disable&sslaccept=strict`,
    `postgresql://postgres:secret@${HOST}:5432/postgres?schema=public&sslmode=require`,
    `postgresql://postgres:secret@${HOST}:5432/postgres?schema=public&sslmode=require&sslaccept=accept_invalid_certs`,
    `postgresql://postgres:secret@${HOST}:5432/postgres?schema=public&sslmode=require&sslaccept=strict&connect_timeout=2`,
  ];

  for (const url of invalidUrls) {
    assert.throws(() =>
      validateProductionEnvironment(
        productionEnvironment({ DATABASE_URL: url }),
      ),
    );
  }
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
      ),
    { code: 'NODE_TLS_OVERRIDE_FORBIDDEN' },
  );
});

test('versioned manifest matches all 17 ordered migration checksums', () => {
  const migrations = readAndVerifyMigrationManifest();
  assert.equal(migrations.length, EXPECTED_MIGRATION_COUNT);
  assert.deepEqual(
    migrations.map(({ name }) => name),
    migrations
      .map(({ name }) => name)
      .slice()
      .sort(),
  );
});

test('Prisma production config consumes only a one-time proof created by the runner', async (t) => {
  const stateDirectory = temporaryAuthorizationStateDirectory(t);
  let invocation;
  await runProductionFirstInstall({
    env: productionEnvironment(),
    authorizationStateDirectory: stateDirectory,
    clientFactory: () => fakeInstalledClient(),
    spawn(_command, args, options) {
      invocation = { args, env: options.env };
      assert.doesNotThrow(() =>
        assertProductionConfigInvocation(args, options.env),
      );
      return { status: 0 };
    },
    log() {},
  });
  const configPath = path.resolve(
    __dirname,
    '..',
    'prisma.production.config.ts',
  );
  assert.throws(
    () => assertProductionConfigInvocation(invocation.args, invocation.env),
    { code: 'PRODUCTION_RUNNER_PROOF_REPLAYED' },
  );
  assert.throws(
    () =>
      assertProductionConfigInvocation(
        ['node', 'prisma', 'migrate', 'deploy', '--config', configPath],
        productionEnvironment(),
      ),
    { code: 'PRODUCTION_CONFIG_RUNNER_REQUIRED' },
  );
  assert.throws(
    () =>
      assertProductionConfigInvocation(
        ['node', 'prisma', 'migrate', 'deploy', '--config', configPath],
        {
          ...productionEnvironment(),
          PRODUCTION_MIGRATION_RUNNER_ACTIVE: '1',
        },
      ),
    { code: 'PRODUCTION_CONFIG_RUNNER_REQUIRED' },
  );
});

test('integration Prisma config accepts only the local throwaway database shape', () => {
  const runId = 'a1b2c3d4e5f6';
  const databaseUrl =
    `postgresql://postgres@127.0.0.1:55321/` +
    `barbearia_first_install_integration_${runId}` +
    '?schema=public&sslmode=disable';
  const env = {
    NODE_ENV: 'test',
    PRODUCTION_MIGRATION_TEST_RUN_ID: runId,
    PRODUCTION_MIGRATION_TEST_AUTH: `DISPOSABLE_POSTGRES_TEST:${runId}`,
    PRODUCTION_MIGRATION_TEST_DATABASE_URL: databaseUrl,
  };
  const configPath = path.resolve(
    __dirname,
    '..',
    'prisma.production-integration.config.ts',
  );
  const args = ['node', 'prisma', 'migrate', 'deploy', '--config', configPath];

  assert.equal(validateIntegrationUrl(databaseUrl, runId).port, 55321);
  assert.doesNotThrow(() => assertIntegrationConfigInvocation(args, env));
  assert.throws(
    () =>
      validateIntegrationUrl(
        databaseUrl.replace('127.0.0.1', 'db.example.supabase.co'),
        runId,
      ),
    /Integração bloqueada/,
  );
  assert.throws(
    () =>
      assertIntegrationConfigInvocation(
        [...args, '--url=postgresql://remote'],
        env,
      ),
    /Integração bloqueada/,
  );
});

test('preflight refuses migration history or any pre-existing schema object', async () => {
  await assert.rejects(
    () =>
      assertTargetIsEmpty(
        {
          async query() {
            return { rows: [{ nspname: 'public' }] };
          },
        },
        'public',
      ),
    { code: 'PRISMA_MIGRATION_HISTORY_EXISTS' },
  );

  await assert.rejects(
    () =>
      assertTargetIsEmpty(
        {
          async query(sql) {
            return sql.includes('_prisma_migrations')
              ? { rows: [] }
              : { rows: [{ count: 1 }] };
          },
        },
        'public',
      ),
    { code: 'PRODUCTION_SCHEMA_NOT_EMPTY' },
  );
  await assert.doesNotReject(() =>
    assertTargetIsEmpty(
      {
        async query(sql) {
          return sql.includes('_prisma_migrations')
            ? { rows: [] }
            : { rows: [{ count: 0 }] };
        },
      },
      'public',
    ),
  );
});

test('postflight verifies exact migration history and rejects generated data', async () => {
  const migrations = readAndVerifyMigrationManifest();
  const client = fakeInstalledClient();
  await assert.doesNotReject(() =>
    assertMigrationHistoryAndEmptyTables(client, migrations, 'public'),
  );

  client.setInsertedData(true);
  await assert.rejects(
    () => assertMigrationHistoryAndEmptyTables(client, migrations, 'public'),
    { code: 'PRODUCTION_SCHEMA_CONTAINS_DATA' },
  );
});

test('Prisma child receives only the migration URL and allowlisted runtime values', (t) => {
  const config = validateProductionEnvironment(productionEnvironment());
  const launchProof = {
    PRODUCTION_MIGRATION_RUNNER_ACTIVE: crypto.randomUUID(),
    PRODUCTION_MIGRATION_RUNNER_PROOF: crypto
      .randomBytes(32)
      .toString('base64url'),
    PRODUCTION_MIGRATION_RUNNER_STATE_DIRECTORY:
      temporaryAuthorizationStateDirectory(t),
  };
  const childEnv = sanitizedDatabaseEnvironment(
    {
      ...productionEnvironment(),
      DIRECT_URL: 'postgresql://private',
      SHADOW_DATABASE_URL: 'postgresql://private',
      PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: '1',
      REDIS_URL: 'rediss://private',
      JWT_SECRET: 'private-token',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_OPTIONS: '--require=unsafe.js',
      NODE_PATH: 'unsafe',
      DOTENV_CONFIG_PATH: '.env',
    },
    config,
    launchProof,
  );

  assert.equal(childEnv.DATABASE_URL, DATABASE_URL);
  assert.equal(childEnv.NODE_ENV, 'production');
  assert.match(childEnv.PRODUCTION_MIGRATION_RUNNER_ACTIVE, /^[0-9a-f-]{36}$/);
  assert.equal(
    childEnv.PRODUCTION_MIGRATION_RUNNER_PROOF,
    launchProof.PRODUCTION_MIGRATION_RUNNER_PROOF,
  );
  assert.ok(childEnv.PRODUCTION_MIGRATION_RUNNER_STATE_DIRECTORY);
  assert.equal(childEnv.PATH, path.dirname(process.execPath));
  assert.equal(childEnv.DIRECT_URL, undefined);
  assert.equal(childEnv.SHADOW_DATABASE_URL, undefined);
  assert.equal(childEnv.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK, undefined);
  assert.equal(childEnv.REDIS_URL, undefined);
  assert.equal(childEnv.JWT_SECRET, undefined);
  assert.equal(childEnv.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  assert.equal(childEnv.NODE_OPTIONS, undefined);
  assert.equal(childEnv.NODE_PATH, undefined);
  assert.equal(childEnv.DOTENV_CONFIG_PATH, undefined);
  assert.equal(childEnv.PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY, undefined);
  assert.equal(childEnv.PRODUCTION_MIGRATION_APPROVAL_TOKEN, undefined);
});

test('preflight removes URL TLS parameters and explicitly verifies certificate and hostname', () => {
  let clientOptions;
  createPostgresClient(
    validateProductionEnvironment(productionEnvironment()),
    (options) => {
      clientOptions = options;
      return options;
    },
  );

  assert.equal(clientOptions.ssl.rejectUnauthorized, true);
  assert.equal(clientOptions.ssl.servername, HOST);
  assert.equal(clientOptions.connectionString.includes('schema='), false);
  assert.equal(clientOptions.connectionString.includes('sslmode='), false);
  assert.equal(clientOptions.connectionString.includes('sslaccept='), false);
});

test('Prisma failure output is discarded and diagnostics remain fixed and secret-free', async (t) => {
  const environment = productionEnvironment();
  const config = validateProductionEnvironment(environment);
  const secrets = [
    DATABASE_URL,
    'private-password',
    'private-token',
    'private-hostname',
  ];
  let invocationOptions;
  const logs = [];

  await assert.rejects(
    () =>
      runProductionFirstInstall({
        env: environment,
        authorizationStateDirectory: temporaryAuthorizationStateDirectory(t),
        clientFactory: () => fakeInstalledClient(),
        spawn(_command, _args, options) {
          invocationOptions = options;
          return {
            status: 1,
            stdout: secrets.join(' '),
            stderr: secrets.join(' '),
          };
        },
        log: (message) => logs.push(message),
      }),
    (error) => {
      assert.equal(error.code, 'PRISMA_MIGRATION_FAILED');
      for (const secret of secrets) {
        assert.equal(error.message.includes(secret), false);
      }
      return true;
    },
  );
  assert.equal(invocationOptions.stdio, 'ignore');
  for (const secret of secrets) {
    assert.equal(logs.join('\n').includes(secret), false);
  }
});

test('runner stops before PostgreSQL or Prisma when approval is missing', async () => {
  let clientCreated = false;
  let prismaStarted = false;
  await assert.rejects(
    () =>
      runProductionFirstInstall({
        env: productionEnvironment({
          PRODUCTION_MIGRATION_APPROVAL_TOKEN: '',
        }),
        clientFactory: () => {
          clientCreated = true;
          return fakeInstalledClient();
        },
        spawn: () => {
          prismaStarted = true;
          return { status: 0 };
        },
        log() {},
      }),
    { code: 'PRODUCTION_APPROVAL_TOKEN_REQUIRED' },
  );
  assert.equal(clientCreated, false);
  assert.equal(prismaStarted, false);
});

test('runner refuses an existing Prisma history before starting Prisma', async (t) => {
  const client = fakeInstalledClient();
  const originalQuery = client.query.bind(client);
  client.query = async (sql, ...args) => {
    if (sql.includes("c.relname = '_prisma_migrations'")) {
      return { rows: [{ nspname: 'public' }] };
    }
    return originalQuery(sql, ...args);
  };
  let prismaStarted = false;

  await assert.rejects(
    () =>
      runProductionFirstInstall({
        env: productionEnvironment(),
        authorizationStateDirectory: temporaryAuthorizationStateDirectory(t),
        clientFactory: () => client,
        spawn() {
          prismaStarted = true;
          return { status: 0 };
        },
        log() {},
      }),
    { code: 'PRISMA_MIGRATION_HISTORY_EXISTS' },
  );
  assert.equal(prismaStarted, false);
});

test('runner invokes only fixed Prisma migrate deploy arguments and excludes approval material from child env', async (t) => {
  const client = fakeInstalledClient();
  const stateDirectory = temporaryAuthorizationStateDirectory(t);
  let invocation;
  await runProductionFirstInstall({
    env: productionEnvironment(),
    authorizationStateDirectory: stateDirectory,
    clientFactory: () => client,
    spawn(command, args, options) {
      invocation = { command, args, options };
      assert.doesNotThrow(() =>
        assertProductionConfigInvocation(args, options.env),
      );
      return { status: 0, stdout: '', stderr: '' };
    },
    log() {},
  });

  assert.deepEqual(invocation.args.slice(1, 3), ['migrate', 'deploy']);
  assert.equal(invocation.args.includes(DATABASE_URL), false);
  assert.equal(invocation.options.env.DATABASE_URL, DATABASE_URL);
  assert.match(
    invocation.options.env.PRODUCTION_MIGRATION_RUNNER_ACTIVE,
    /^[0-9a-f-]{36}$/,
  );
  assert.match(
    invocation.options.env.PRODUCTION_MIGRATION_RUNNER_PROOF,
    /^[A-Za-z0-9_-]{43}$/,
  );
  assert.equal(
    invocation.options.env.PRODUCTION_MIGRATION_RUNNER_STATE_DIRECTORY,
    stateDirectory,
  );
  assert.equal(
    invocation.options.env.PRODUCTION_MIGRATION_APPROVAL_TOKEN,
    undefined,
  );
  assert.equal(
    invocation.options.env.PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY,
    undefined,
  );
});

test('cleanup failures do not replace the original preflight error', async (t) => {
  const client = fakeInstalledClient();
  client.query = async (sql) => {
    if (sql.startsWith('SET search_path')) {
      return { rows: [] };
    }
    if (sql.includes('current_database()')) {
      return { rows: [{ database: 'wrong', schema: 'public' }] };
    }
    if (sql.includes('pg_stat_ssl')) {
      return { rows: [{ ssl: true }] };
    }
    throw new Error('unexpected query');
  };
  client.end = async () => {
    throw pgError('ECONNRESET', 'secondary connection close failure');
  };

  const logs = [];
  await assert.rejects(
    () =>
      runProductionFirstInstall({
        env: productionEnvironment(),
        authorizationStateDirectory: temporaryAuthorizationStateDirectory(t),
        clientFactory: () => client,
        spawn() {
          throw new Error('Prisma must not start.');
        },
        log: (message) => logs.push(message),
      }),
    { code: 'PRODUCTION_DATABASE_IDENTITY_MISMATCH' },
  );
  assert.equal(
    logs.some((message) => message.includes('falha secundária')),
    true,
  );
});

test('original database failure remains the cause and is never logged verbatim', async (t) => {
  const secretError = pgError(
    '28P01',
    `password=example-secret at ${DATABASE_URL}`,
  );
  const logs = [];
  await assert.rejects(
    () =>
      runProductionFirstInstall({
        env: productionEnvironment(),
        authorizationStateDirectory: temporaryAuthorizationStateDirectory(t),
        clientFactory: () => ({
          async connect() {
            throw secretError;
          },
          async end() {},
        }),
        spawn() {
          throw new Error('Prisma must not start.');
        },
        log: (message) => logs.push(message),
      }),
    (error) => {
      assert.equal(error.code, 'PRODUCTION_PREFLIGHT_CONNECTION_FAILED');
      assert.equal(error.cause, secretError);
      assert.equal(error.message.includes(DATABASE_URL), false);
      assert.equal(error.message.includes('example-secret'), false);
      return true;
    },
  );
  assert.equal(logs.join('\n').includes(DATABASE_URL), false);
  assert.equal(logs.join('\n').includes('example-secret'), false);
});
