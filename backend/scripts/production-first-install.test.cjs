const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  EXPECTED_MIGRATION_COUNT,
  PRODUCTION_TARGET,
  assertMigrationHistoryAndEmptyTables,
  assertDatabaseIdentityAndTls,
  assertProductionConfigInvocation,
  assertTargetIsEmpty,
  consumeAuthorizationOnce,
  createRunnerLaunchProof,
  createPostgresClient,
  migrationSqlChecksum,
  readAndVerifyMigrationManifest,
  runProductionFirstInstall,
  sanitizedDatabaseEnvironment,
  validateProductionEnvironment,
} = require('./production-first-install.cjs');
const {
  assertIntegrationConfigInvocation,
  validateIntegrationUrl,
} = require('../test/production-first-install.integration-safety.cjs');

// Ephemeral keys are confined to unit tests and cannot authorize production.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_KEY = publicKey.export({ format: 'pem', type: 'spki' });
const HOST = PRODUCTION_TARGET.host;
const SESSION_POOLER_HOST = 'aws-999-test-region.pooler.supabase.com';
const SUPABASE_CA_PATH = path.join(
  __dirname,
  'fixtures',
  'supabase-prod-ca-2021.crt',
);
const DATABASE_URL =
  `postgresql://postgres:example-secret@${HOST}:5432/postgres` +
  '?schema=public&sslmode=require&sslaccept=strict';
const SESSION_POOLER_DATABASE_URL =
  `postgresql://postgres.${PRODUCTION_TARGET.projectRef}:example-secret@` +
  `${SESSION_POOLER_HOST}:5432/postgres` +
  '?schema=public&sslmode=require&sslaccept=strict';

function signedApproval(claimOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    version: 3,
    audience: 'barbearia-app:production-first-install:v3',
    projectRef: PRODUCTION_TARGET.projectRef,
    connectionMode: 'direct',
    host: PRODUCTION_TARGET.host,
    port: PRODUCTION_TARGET.port,
    username: 'postgres',
    database: PRODUCTION_TARGET.database,
    schema: PRODUCTION_TARGET.schema,
    operatorHost: os.hostname().toLowerCase(),
    operationId: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + 240,
    backupVerified: true,
    writersStopped: true,
    sessionPoolerValidated: false,
    sessionPoolerRiskAccepted: false,
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

function sessionPoolerEnvironment(overrides = {}, claimOverrides = {}) {
  const { token } = signedApproval({
    connectionMode: 'session',
    host: SESSION_POOLER_HOST,
    port: 5432,
    username: `postgres.${PRODUCTION_TARGET.projectRef}`,
    sessionPoolerValidated: true,
    sessionPoolerRiskAccepted: false,
    ...claimOverrides,
  });
  return {
    NODE_ENV: 'production',
    DATABASE_URL: SESSION_POOLER_DATABASE_URL,
    NODE_EXTRA_CA_CERTS: SUPABASE_CA_PATH,
    PRODUCTION_SESSION_POOLER_HOST: SESSION_POOLER_HOST,
    PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: PUBLIC_KEY,
    PRODUCTION_MIGRATION_APPROVAL_TOKEN: token,
    ...overrides,
  };
}

function productionEnvironment(overrides = {}, claimOverrides = {}) {
  const { token } = signedApproval(claimOverrides);
  return {
    NODE_ENV: 'production',
    DATABASE_URL,
    NODE_EXTRA_CA_CERTS: SUPABASE_CA_PATH,
    PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: PUBLIC_KEY,
    PRODUCTION_MIGRATION_APPROVAL_TOKEN: token,
    ...overrides,
  };
}

function temporaryCertificatePath(t, certificatePem) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'barbearia-ca-certificate-test-'),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const certificatePath = path.join(directory, 'ca.pem');
  fs.writeFileSync(certificatePath, certificatePem);
  return certificatePath;
}

function fakeChildProcess({ status = 0, delayMs = 0 } = {}) {
  const child = new EventEmitter();
  let closed = false;
  child.signals = [];
  const close = (exitCode, signal) => {
    if (!closed) {
      closed = true;
      child.emit('close', exitCode, signal);
    }
  };
  child.kill = (signal) => {
    child.signals.push(signal);
    setImmediate(() => close(null, signal));
    return true;
  };
  setTimeout(() => close(status, null), delayMs);
  return child;
}

function temporaryAuthorizationStateDirectory(t) {
  const directory = fs.mkdtempSync(
    path.join(os.homedir(), '.barbearia-first-install-test-'),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function temporaryMigrationFixture(t, approvedSql) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'barbearia-migration-checksum-test-'),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const migrationsDirectory = path.join(directory, 'migrations');
  const migrationNames = readAndVerifyMigrationManifest().map(
    ({ name }) => name,
  );
  const manifest = {
    version: 1,
    provider: 'postgresql',
    migrations: migrationNames.map((name, index) => {
      const sql = index === 0 ? approvedSql : `-- fixture ${index}\n`;
      const migrationDirectory = path.join(migrationsDirectory, name);
      fs.mkdirSync(migrationDirectory, { recursive: true });
      fs.writeFileSync(path.join(migrationDirectory, 'migration.sql'), sql);
      return {
        name,
        sha256: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    }),
  };
  fs.writeFileSync(
    path.join(migrationsDirectory, 'migration_lock.toml'),
    'provider = "postgresql"\n',
  );
  const manifestPath = path.join(directory, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  return {
    migrationsDirectory,
    manifestPath,
    writeFirstMigration(sql) {
      fs.writeFileSync(
        path.join(
          migrationsDirectory,
          migrationNames[0],
          'migration.sql',
        ),
        sql,
      );
    },
    verify() {
      return readAndVerifyMigrationManifest({
        migrationsDirectory,
        manifestPath,
      });
    },
  };
}

function pgError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fakeInstalledClient({
  host = HOST,
  stream = { encrypted: true, authorized: true, authorizationError: null },
} = {}) {
  const migrations = readAndVerifyMigrationManifest();
  const calls = [];
  let insertedData = false;
  const client = {
    calls,
    host,
    ssl: {
      ca: fs.readFileSync(SUPABASE_CA_PATH, 'utf8'),
      rejectUnauthorized: true,
      servername: host,
    },
    connection: { stream },
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
      if (sql.includes('pg_advisory_lock')) {
        return { rows: [{}] };
      }
      if (sql.includes('FROM pg_locks')) {
        return { rows: [{ held: true }] };
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

function tlsAssertionClient(config, { stream, ssl } = {}) {
  const queries = [];
  return {
    host: config.host,
    ssl: {
      ca: config.supabaseCa.pem,
      rejectUnauthorized: true,
      servername: config.host,
      ...ssl,
    },
    connection: {
      stream: {
        encrypted: true,
        authorized: true,
        authorizationError: null,
        ...stream,
      },
    },
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith('SET search_path')) {
        return { rows: [] };
      }
      if (sql.includes('current_database()')) {
        return { rows: [{ database: config.database, schema: config.schema }] };
      }
      throw new Error('Unexpected mocked query.');
    },
  };
}

function targetEmptinessClient({
  historyRows = [],
  realObjectCatalogs = [],
  defaultAclScopes = [],
} = {}) {
  const catalogMarkers = {
    pg_class: 'FROM pg_class c',
    pg_type: 'FROM pg_type t',
    pg_proc: 'FROM pg_proc p',
    pg_operator: 'FROM pg_operator o',
    pg_collation: 'FROM pg_collation c',
    pg_conversion: 'FROM pg_conversion c',
    pg_opclass: 'FROM pg_opclass o',
    pg_opfamily: 'FROM pg_opfamily o',
    pg_ts_config: 'FROM pg_ts_config t',
    pg_ts_dict: 'FROM pg_ts_dict t',
    pg_ts_parser: 'FROM pg_ts_parser t',
    pg_ts_template: 'FROM pg_ts_template t',
    pg_statistic_ext: 'FROM pg_statistic_ext s',
  };
  let objectQuery;

  return {
    get objectQuery() {
      return objectQuery;
    },
    async query(sql) {
      if (sql.includes("c.relname = '_prisma_migrations'")) {
        return { rows: historyRows };
      }
      if (sql.includes('AS existing_objects')) {
        objectQuery = sql;
        const realObjectCount = realObjectCatalogs.filter((catalog) =>
          sql.includes(catalogMarkers[catalog]),
        ).length;
        const countsSchemaDefaultAcls =
          sql.includes('FROM pg_default_acl d') &&
          sql.includes('JOIN pg_namespace n ON n.oid = d.defaclnamespace') &&
          sql.includes('WHERE n.nspname = $1');
        const defaultAclCount = countsSchemaDefaultAcls
          ? defaultAclScopes.filter((scope) => scope === 'public').length
          : 0;
        return {
          rows: [{ count: realObjectCount + defaultAclCount }],
        };
      }
      throw new Error('Unexpected mocked query.');
    },
  };
}

test('production target requires production mode and an explicitly approved endpoint', () => {
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
  assert.equal(config.connectionMode, 'direct');
  assert.equal(config.username, 'postgres');

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

test('Session Pooler requires its exact configured host, project user and session port', () => {
  const config = validateProductionEnvironment(sessionPoolerEnvironment());
  assert.equal(config.connectionMode, 'session');
  assert.equal(config.host, SESSION_POOLER_HOST);
  assert.equal(config.port, 5432);
  assert.equal(config.username, `postgres.${PRODUCTION_TARGET.projectRef}`);
  assert.equal(config.database, 'postgres');
  assert.equal(config.schema, 'public');

  const wrongHosts = [
    'aws-998-test-region.pooler.supabase.com',
    'arbitrary.pooler.supabase.com',
  ];
  for (const host of wrongHosts) {
    assert.throws(
      () =>
        validateProductionEnvironment(
          sessionPoolerEnvironment({
            DATABASE_URL: SESSION_POOLER_DATABASE_URL.replace(
              SESSION_POOLER_HOST,
              host,
            ),
          }),
        ),
      { code: 'PRODUCTION_TARGET_HOST_MISMATCH' },
    );
  }

  assert.throws(
    () =>
      validateProductionEnvironment(
        sessionPoolerEnvironment({
          PRODUCTION_SESSION_POOLER_HOST: undefined,
        }),
      ),
    { code: 'SESSION_POOLER_HOST_REQUIRED' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        sessionPoolerEnvironment({
          DATABASE_URL: SESSION_POOLER_DATABASE_URL.replace(
            `postgres.${PRODUCTION_TARGET.projectRef}`,
            'postgres.other-project',
          ),
        }),
      ),
    { code: 'PRODUCTION_DATABASE_URL_INVALID' },
  );
  assert.throws(
    () =>
      validateProductionEnvironment(
        sessionPoolerEnvironment({
          DATABASE_URL: SESSION_POOLER_DATABASE_URL.replace(':5432/', ':6543/'),
        }),
      ),
    { code: 'TRANSACTION_POOLER_NOT_ALLOWED' },
  );
});

test('Session Pooler approval binds mode, exact endpoint, port and user', () => {
  const invalidClaims = [
    { connectionMode: 'direct' },
    { host: 'aws-998-test-region.pooler.supabase.com' },
    { port: 6543 },
    { username: 'postgres' },
    { sessionPoolerValidated: false },
    { sessionPoolerValidated: true, sessionPoolerRiskAccepted: true },
  ];
  for (const claims of invalidClaims) {
    assert.throws(
      () =>
        validateProductionEnvironment(
          sessionPoolerEnvironment({}, claims),
        ),
      { code: 'PRODUCTION_APPROVAL_INVALID' },
    );
  }

  const directApproval = signedApproval({
    version: 1,
    audience: 'barbearia-app:production-first-install',
  });
  assert.throws(
    () =>
      validateProductionEnvironment(
        sessionPoolerEnvironment({
          PRODUCTION_MIGRATION_APPROVAL_TOKEN: directApproval.token,
        }),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
});

test('unvalidated Session Pooler requires a signed risk acceptance bound to the target', () => {
  const config = validateProductionEnvironment(
    sessionPoolerEnvironment(
      {},
      {
        sessionPoolerValidated: false,
        sessionPoolerRiskAccepted: true,
      },
    ),
  );
  assert.equal(config.approval.sessionPoolerValidated, false);
  assert.equal(config.approval.sessionPoolerRiskAccepted, true);
  assert.equal(config.approval.projectRef, PRODUCTION_TARGET.projectRef);
  assert.equal(config.approval.host, SESSION_POOLER_HOST);
  assert.equal(config.approval.port, 5432);
  assert.equal(
    config.approval.username,
    `postgres.${PRODUCTION_TARGET.projectRef}`,
  );
  assert.equal(config.approval.operatorHost, os.hostname().toLowerCase());
  assert.match(config.approval.operationId, /^[0-9a-f-]{36}$/);

  const otherHost = 'aws-0-us-east-1.pooler.supabase.com';
  assert.throws(
    () =>
      validateProductionEnvironment(
        sessionPoolerEnvironment(
          {
            DATABASE_URL: SESSION_POOLER_DATABASE_URL.replace(
              SESSION_POOLER_HOST,
              otherHost,
            ),
            PRODUCTION_SESSION_POOLER_HOST: otherHost,
          },
          {
            sessionPoolerValidated: false,
            sessionPoolerRiskAccepted: true,
          },
        ),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );

  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({}, { sessionPoolerRiskAccepted: true }),
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
});

test('Session Pooler URL preserves strict TLS requirements', () => {
  const invalidUrls = [
    SESSION_POOLER_DATABASE_URL.replace(
      'sslaccept=strict',
      'sslaccept=accept_invalid_certs',
    ),
    SESSION_POOLER_DATABASE_URL.replace('&sslaccept=strict', ''),
    SESSION_POOLER_DATABASE_URL.replace('sslmode=require', 'sslmode=disable'),
  ];
  for (const url of invalidUrls) {
    assert.throws(() =>
      validateProductionEnvironment(
        sessionPoolerEnvironment({ DATABASE_URL: url }),
      ),
    );
  }
  assert.throws(
    () =>
      validateProductionEnvironment(
        sessionPoolerEnvironment({
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
        }),
      ),
    { code: 'NODE_TLS_OVERRIDE_FORBIDDEN' },
  );
});

test('production target remains pinned and rejects unexpected direct endpoints', () => {
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({
          DATABASE_URL: SESSION_POOLER_DATABASE_URL,
        }),
      ),
    { code: 'SESSION_POOLER_HOST_REQUIRED' },
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

test('migration checksums accept equivalent LF and CRLF files', (t) => {
  const approvedSql = 'CREATE TABLE checksum_fixture (\n  id integer\n);\n';
  const crlfSql = approvedSql.replace(/\n/g, '\r\n');
  const fixture = temporaryMigrationFixture(t, approvedSql);

  assert.equal(
    migrationSqlChecksum(Buffer.from(approvedSql, 'utf8')),
    migrationSqlChecksum(Buffer.from(crlfSql, 'utf8')),
  );
  assert.doesNotThrow(() => fixture.verify());
  fixture.writeFirstMigration(crlfSql);
  assert.doesNotThrow(() => fixture.verify());
});

test('migration checksums do not normalize isolated CR characters', (t) => {
  const approvedSql = 'CREATE TABLE checksum_fixture (\n  id integer\n);\n';
  const fixture = temporaryMigrationFixture(t, approvedSql);
  fixture.writeFirstMigration(approvedSql.replace('\n', '\r'));

  assert.throws(() => fixture.verify(), {
    code: 'MIGRATION_CHECKSUM_MISMATCH',
  });
});

test('migration checksums reject changed SQL content', (t) => {
  const approvedSql = 'CREATE TABLE checksum_fixture (\n  id integer\n);\n';
  const fixture = temporaryMigrationFixture(t, approvedSql);
  const changedSql = approvedSql
    .replace('id integer', 'id text')
    .replace(/\n/g, '\r\n');

  assert.notEqual(
    migrationSqlChecksum(Buffer.from(approvedSql, 'utf8')),
    migrationSqlChecksum(Buffer.from(changedSql, 'utf8')),
  );
  fixture.writeFirstMigration(changedSql);

  assert.throws(() => fixture.verify(), {
    code: 'MIGRATION_CHECKSUM_MISMATCH',
  });
});

test('migration checksums reject changed string literals despite CRLF endings', (t) => {
  const approvedSql =
    "INSERT INTO checksum_fixture (value)\nVALUES ('approved');\n";
  const fixture = temporaryMigrationFixture(t, approvedSql);
  fixture.writeFirstMigration(
    "INSERT INTO checksum_fixture (value)\r\nVALUES ('changed');\r\n",
  );

  assert.throws(() => fixture.verify(), {
    code: 'MIGRATION_CHECKSUM_MISMATCH',
  });
});

test('Prisma production config consumes only a one-time proof created by the runner', async (t) => {
  const stateDirectory = temporaryAuthorizationStateDirectory(t);
  let invocation;
  await runProductionFirstInstall({
    env: productionEnvironment(),
    authorizationStateDirectory: stateDirectory,
    clientFactory: () => fakeInstalledClient(),
    spawnProcess(_command, args, options) {
      invocation = { args, env: options.env };
      assert.doesNotThrow(() =>
        assertProductionConfigInvocation(args, options.env),
      );
      return fakeChildProcess();
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

test('preflight ignores global and public-scoped default ACL metadata', async () => {
  for (const scope of ['global', 'public']) {
    const client = targetEmptinessClient({
      defaultAclScopes: [scope],
    });

    await assert.doesNotReject(() =>
      assertTargetIsEmpty(client, 'public'),
    );
    assert.doesNotMatch(client.objectQuery, /pg_default_acl/);
  }
});

test('preflight still rejects tables, views, and sequences in public', async () => {
  for (const objectKind of ['table', 'view', 'sequence']) {
    const client = targetEmptinessClient({
      realObjectCatalogs: ['pg_class'],
    });

    await assert.rejects(
      () => assertTargetIsEmpty(client, 'public'),
      { code: 'PRODUCTION_SCHEMA_NOT_EMPTY' },
      objectKind,
    );
    assert.ok(client.objectQuery.includes('FROM pg_class c'));
  }
});

test('preflight still rejects types and functions in public', async () => {
  for (const catalog of ['pg_type', 'pg_proc']) {
    const client = targetEmptinessClient({
      realObjectCatalogs: [catalog],
    });

    await assert.rejects(
      () => assertTargetIsEmpty(client, 'public'),
      { code: 'PRODUCTION_SCHEMA_NOT_EMPTY' },
    );
    assert.ok(client.objectQuery.includes(`FROM ${catalog}`));
    if (catalog === 'pg_type') {
      assert.match(
        client.objectQuery,
        /t\.typtype IN \('e', 'd', 'c', 'r', 'm'\)/,
      );
    }
  }
});

test('preflight still rejects other catalog objects in public', async () => {
  const catalogs = [
    'pg_operator',
    'pg_collation',
    'pg_conversion',
    'pg_opclass',
    'pg_opfamily',
    'pg_ts_config',
    'pg_ts_dict',
    'pg_ts_parser',
    'pg_ts_template',
    'pg_statistic_ext',
  ];

  for (const catalog of catalogs) {
    const client = targetEmptinessClient({
      realObjectCatalogs: [catalog],
    });

    await assert.rejects(
      () => assertTargetIsEmpty(client, 'public'),
      { code: 'PRODUCTION_SCHEMA_NOT_EMPTY' },
    );
    assert.ok(client.objectQuery.includes(`FROM ${catalog}`));
  }
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
  assert.equal(
    childEnv.NODE_EXTRA_CA_CERTS,
    fs.realpathSync(SUPABASE_CA_PATH),
  );
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

test('Session Pooler host reaches only the protected Prisma invocation', (t) => {
  const environment = sessionPoolerEnvironment();
  const config = validateProductionEnvironment(environment);
  const stateDirectory = temporaryAuthorizationStateDirectory(t);
  const launchProof = createRunnerLaunchProof(stateDirectory);
  const childEnv = sanitizedDatabaseEnvironment(
    environment,
    config,
    launchProof,
  );
  const args = [
    'prisma',
    'migrate',
    'deploy',
    '--config',
    path.join(__dirname, '..', 'prisma.production.config.ts'),
  ];

  assert.equal(childEnv.PRODUCTION_SESSION_POOLER_HOST, SESSION_POOLER_HOST);
  assert.equal(
    childEnv.PRODUCTION_MIGRATION_APPROVAL_TOKEN,
    undefined,
  );
  assert.doesNotThrow(() => assertProductionConfigInvocation(args, childEnv));
});

test('preflight removes URL TLS parameters and explicitly verifies certificate and hostname', () => {
  const config = validateProductionEnvironment(productionEnvironment());
  let clientOptions;
  createPostgresClient(
    config,
    (options) => {
      clientOptions = options;
      return options;
    },
  );

  assert.equal(clientOptions.ssl.ca, config.supabaseCa.pem);
  assert.equal(clientOptions.ssl.rejectUnauthorized, true);
  assert.equal(clientOptions.ssl.servername, HOST);
  assert.equal(clientOptions.query_timeout, 5000);
  assert.equal(clientOptions.keepAlive, true);
  assert.equal(clientOptions.connectionString.includes('schema='), false);
  assert.equal(clientOptions.connectionString.includes('sslmode='), false);
  assert.equal(clientOptions.connectionString.includes('sslaccept='), false);
});

test('Session Pooler preflight validates TLS against the exact pooler hostname', () => {
  const config = validateProductionEnvironment(sessionPoolerEnvironment());
  let clientOptions;
  createPostgresClient(
    config,
    (options) => {
      clientOptions = options;
      return options;
    },
  );

  assert.equal(clientOptions.ssl.ca, config.supabaseCa.pem);
  assert.equal(clientOptions.ssl.rejectUnauthorized, true);
  assert.equal(clientOptions.ssl.servername, SESSION_POOLER_HOST);
  assert.equal(clientOptions.query_timeout, 5000);
  assert.equal(clientOptions.keepAlive, true);
  assert.equal(clientOptions.connectionString.includes('sslmode='), false);
  assert.equal(clientOptions.connectionString.includes('sslaccept='), false);
});

test('preflight confirms TLS directly on the authorized client socket', async () => {
  const config = validateProductionEnvironment(productionEnvironment());
  const client = tlsAssertionClient(config);

  await assert.doesNotReject(() =>
    assertDatabaseIdentityAndTls(client, config),
  );
  assert.equal(
    client.queries.some((sql) => sql.includes('pg_stat_ssl')),
    false,
  );
});

test('preflight rejects an unencrypted PostgreSQL client socket', async () => {
  const config = validateProductionEnvironment(productionEnvironment());
  const client = tlsAssertionClient(config, {
    stream: { encrypted: false, authorized: false },
  });

  await assert.rejects(
    () => assertDatabaseIdentityAndTls(client, config),
    { code: 'PRODUCTION_TLS_REQUIRED' },
  );
  assert.deepEqual(client.queries, []);
});

test('preflight rejects a missing PostgreSQL client socket', async () => {
  const config = validateProductionEnvironment(productionEnvironment());
  const client = tlsAssertionClient(config);
  delete client.connection.stream;

  await assert.rejects(
    () => assertDatabaseIdentityAndTls(client, config),
    { code: 'PRODUCTION_TLS_REQUIRED' },
  );
  assert.deepEqual(client.queries, []);
});

test('preflight rejects a client socket with an unauthorized certificate', async () => {
  const config = validateProductionEnvironment(productionEnvironment());
  const client = tlsAssertionClient(config, {
    stream: {
      encrypted: true,
      authorized: false,
      authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    },
  });

  await assert.rejects(
    () => assertDatabaseIdentityAndTls(client, config),
    { code: 'PRODUCTION_TLS_REQUIRED' },
  );
  assert.deepEqual(client.queries, []);
});

test('preflight rejects a client certificate that fails hostname validation', async () => {
  const config = validateProductionEnvironment(productionEnvironment());
  const client = tlsAssertionClient(config, {
    stream: {
      encrypted: true,
      authorized: false,
      authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID',
    },
  });

  await assert.rejects(
    () => assertDatabaseIdentityAndTls(client, config),
    { code: 'PRODUCTION_TLS_REQUIRED' },
  );
  assert.deepEqual(client.queries, []);
});

test('preflight rejects SNI that differs from the approved hostname', async () => {
  const config = validateProductionEnvironment(productionEnvironment());
  const client = tlsAssertionClient(config, {
    ssl: { servername: 'unexpected.example' },
  });

  await assert.rejects(
    () => assertDatabaseIdentityAndTls(client, config),
    { code: 'PRODUCTION_TLS_REQUIRED' },
  );
  assert.deepEqual(client.queries, []);
});

test('production validation requires the pinned official Supabase CA', (t) => {
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({ NODE_EXTRA_CA_CERTS: undefined }),
      ),
    { code: 'SUPABASE_CA_PATH_REQUIRED' },
  );

  const invalidPath = temporaryCertificatePath(t, 'not a PEM certificate');
  let invalidError;
  try {
    validateProductionEnvironment(
      productionEnvironment({ NODE_EXTRA_CA_CERTS: invalidPath }),
    );
  } catch (error) {
    invalidError = error;
  }
  assert.ok(invalidError);
  assert.equal(invalidError.code, 'SUPABASE_CA_INVALID');
  assert.equal(invalidError.message.includes(invalidPath), false);
  assert.equal(invalidError.message.includes('not a PEM certificate'), false);

  const untrustedRoot = tls.rootCertificates.find((pem) => {
    const certificate = new crypto.X509Certificate(pem);
    return certificate.ca && certificate.subject === certificate.issuer;
  });
  assert.ok(untrustedRoot, 'Node should provide a self-signed root CA fixture');
  const untrustedPath = temporaryCertificatePath(t, untrustedRoot);
  assert.throws(
    () =>
      validateProductionEnvironment(
        productionEnvironment({ NODE_EXTRA_CA_CERTS: untrustedPath }),
      ),
    { code: 'SUPABASE_CA_UNTRUSTED' },
  );

  const config = validateProductionEnvironment(productionEnvironment());
  assert.equal(
    config.supabaseCa.path,
    fs.realpathSync(SUPABASE_CA_PATH),
  );
  assert.equal(
    config.supabaseCa.fingerprint256,
    '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
  );
});

test('runner terminates Prisma when it can no longer prove the advisory lock is held', async (t) => {
  const client = fakeInstalledClient({ host: SESSION_POOLER_HOST });
  const originalQuery = client.query.bind(client);
  let lockChecks = 0;
  client.query = async (sql, ...args) => {
    if (sql.includes('FROM pg_locks')) {
      lockChecks += 1;
      return { rows: [{ held: lockChecks < 2 }] };
    }
    return originalQuery(sql, ...args);
  };
  let child;

  await assert.rejects(
    () =>
      runProductionFirstInstall({
        env: sessionPoolerEnvironment(),
        authorizationStateDirectory: temporaryAuthorizationStateDirectory(t),
        clientFactory: () => client,
        spawnProcess() {
          child = fakeChildProcess({ delayMs: 100 });
          return child;
        },
        lockHeartbeatIntervalMs: 2,
        log() {},
      }),
    { code: 'PRODUCTION_ADVISORY_LOCK_LOST' },
  );
  assert.ok(lockChecks >= 2);
  assert.ok(child.signals.includes('SIGTERM'));
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
        spawnProcess(_command, _args, options) {
          invocationOptions = options;
          return fakeChildProcess({ status: 1 });
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
        spawnProcess: () => {
          prismaStarted = true;
          return fakeChildProcess();
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
        spawnProcess() {
          prismaStarted = true;
          return fakeChildProcess();
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
    spawnProcess(command, args, options) {
      invocation = { command, args, options };
      assert.doesNotThrow(() =>
        assertProductionConfigInvocation(args, options.env),
      );
      return fakeChildProcess();
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
        spawnProcess() {
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
        spawnProcess() {
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
