const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  ADVISORY_LOCK_KEY,
  PRODUCTION_PROJECT_REF,
  TEST_PROJECT_ACK,
  TEST_PROJECT_TYPE,
  clientOptions,
  runSessionPoolerValidation,
  validateConfiguration,
} = require('./session-pooler-validation.cjs');

const PROJECT_REF = 'abcdefghijklmnopqrst';
const HOST = 'aws-0-us-east-1.pooler.supabase.com';

function testEnvironment(overrides = {}) {
  return {
    SESSION_POOLER_TEST_PROJECT_REF: PROJECT_REF,
    SESSION_POOLER_TEST_PROJECT_TYPE: TEST_PROJECT_TYPE,
    SESSION_POOLER_TEST_ACK: TEST_PROJECT_ACK,
    SESSION_POOLER_TEST_HOST: HOST,
    SESSION_POOLER_TEST_PORT: '5432',
    SESSION_POOLER_TEST_DATABASE: 'postgres',
    SESSION_POOLER_TEST_USERNAME: `postgres.${PROJECT_REF}`,
    SESSION_POOLER_TEST_PASSWORD: 'unit-test-only',
    ...overrides,
  };
}

function simulatedConnections({ tls = true, samePid = false } = {}) {
  const options = [];
  const clients = [];
  let activeConnections = 0;
  let maximumActiveConnections = 0;

  class SimulatedClient {
    constructor(clientConfig) {
      this.config = clientConfig;
      this.pid = samePid ? 1234 : 1234 + clients.length;
      this.lockHeld = false;
      options.push(clientConfig);
      clients.push(this);
    }

    async connect() {
      activeConnections += 1;
      maximumActiveConnections = Math.max(
        maximumActiveConnections,
        activeConnections,
      );
    }

    async query(sql) {
      if (sql.includes('current_database()')) {
        return {
          rows: [
            {
              database: 'postgres',
              username: `postgres.${PROJECT_REF}`,
              pid: this.pid,
            },
          ],
        };
      }
      if (sql.includes('pg_stat_ssl')) {
        return { rows: [{ ssl: tls }] };
      }
      if (sql.includes('pg_advisory_lock')) {
        this.lockHeld = true;
        return { rows: [] };
      }
      if (sql.includes('FROM pg_locks')) {
        return { rows: [{ held: this.lockHeld }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        const unlocked = this.lockHeld;
        this.lockHeld = false;
        return { rows: [{ unlocked }] };
      }
      throw new Error('Unexpected simulated query.');
    }

    async end() {
      if (this.lockHeld) {
        this.lockHeld = false;
      }
      activeConnections -= 1;
    }
  }

  return {
    options,
    clients,
    createClient: (config) => new SimulatedClient(config),
    hadTwoSimultaneousConnections: () => maximumActiveConnections === 2,
  };
}

function simulatedChildProcess() {
  const child = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      setImmediate(() => child.emit('close', null, null));
      return true;
    }
    return false;
  };
  return child;
}

test('requires a separately identified temporary project and exact target values', () => {
  const config = validateConfiguration(testEnvironment());
  assert.equal(config.projectRef, PROJECT_REF);
  assert.equal(config.host, HOST);
  assert.equal(config.port, 5432);
  assert.equal(config.database, 'postgres');
  assert.equal(config.username, `postgres.${PROJECT_REF}`);
});

test('rejects the production project, absent confirmation, and non-session targets', () => {
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({
          SESSION_POOLER_TEST_PROJECT_REF: PRODUCTION_PROJECT_REF,
          SESSION_POOLER_TEST_USERNAME: `postgres.${PRODUCTION_PROJECT_REF}`,
        }),
      ),
    { code: 'TEST_PROJECT_REF_INVALID' },
  );
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({ SESSION_POOLER_TEST_ACK: 'yes' }),
      ),
    { code: 'TEMPORARY_TEST_PROJECT_CONFIRMATION_REQUIRED' },
  );
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({
          SESSION_POOLER_TEST_HOST: `db.${PRODUCTION_PROJECT_REF}.supabase.co`,
        }),
      ),
    { code: 'SESSION_POOLER_HOST_INVALID' },
  );
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({ SESSION_POOLER_TEST_PORT: '6543' }),
      ),
    { code: 'SESSION_POOLER_PORT_INVALID' },
  );
});

test('rejects mismatched database, user, and malformed test project host', () => {
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({ SESSION_POOLER_TEST_DATABASE: 'app' }),
      ),
    { code: 'SESSION_POOLER_DATABASE_INVALID' },
  );
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({ SESSION_POOLER_TEST_USERNAME: 'postgres' }),
      ),
    { code: 'SESSION_POOLER_USERNAME_INVALID' },
  );
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({
          SESSION_POOLER_TEST_HOST: 'pooler-host.pooler.supabase.com',
        }),
      ),
    { code: 'SESSION_POOLER_HOST_INVALID' },
  );
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({ SESSION_POOLER_TEST_PASSWORD: '' }),
      ),
    { code: 'TEST_PROJECT_PASSWORD_REQUIRED' },
  );
  assert.throws(
    () =>
      validateConfiguration(
        testEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
      ),
    { code: 'NODE_TLS_OVERRIDE_FORBIDDEN' },
  );
});

test('uses strict TLS, SNI host, and no connection URL or production variables', () => {
  const config = validateConfiguration(testEnvironment());
  const options = clientOptions(config);

  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.servername, HOST);
  assert.equal(options.host, HOST);
  assert.equal(options.port, 5432);
  assert.equal(options.database, 'postgres');
  assert.equal(options.user, `postgres.${PROJECT_REF}`);
  assert.equal('connectionString' in options, false);
  assert.equal('DATABASE_URL' in options, false);
});

test('checks TLS and simultaneous backends, then detects lock loss and stops a harmless child', async () => {
  const simulated = simulatedConnections();
  let child;
  let spawnArguments;
  let spawnOptions;

  const report = await runSessionPoolerValidation(testEnvironment(), {
    createClient: simulated.createClient,
    spawnProcess(...args) {
      [spawnArguments, spawnOptions] = [args.slice(0, 2), args[2]];
      child = simulatedChildProcess();
      return child;
    },
    heartbeatIntervalMs: 1,
    childTerminationTimeoutMs: 50,
    sleep: () => Promise.resolve(),
  });

  assert.equal(simulated.hadTwoSimultaneousConnections(), true);
  assert.equal(simulated.options.length, 2);
  assert.ok(
    simulated.options.every(
      (options) =>
        options.ssl.rejectUnauthorized === true &&
        options.ssl.servername === HOST,
    ),
  );
  assert.equal(spawnArguments[0], process.execPath);
  assert.deepEqual(spawnArguments[1], ['-e', 'setInterval(() => {}, 1000)']);
  assert.equal(spawnOptions.stdio, 'ignore');
  assert.equal(
    Object.prototype.hasOwnProperty.call(spawnOptions.env, 'SESSION_POOLER_TEST_PASSWORD'),
    false,
  );
  assert.equal(report.tlsVerified, true);
  assert.equal(report.simultaneousConnections, true);
  assert.equal(report.distinctBackendPids, true);
  assert.equal(report.advisoryLockHeldDuringHeartbeat, true);
  assert.equal(report.lockLossDetected, true);
  assert.equal(report.childTerminated, true);
  assert.ok(child.signals.includes('SIGTERM'));
  assert.deepEqual(ADVISORY_LOCK_KEY, [1111634258, 1179200083]);
});

test('fails closed when pg_stat_ssl does not confirm TLS', async () => {
  const simulated = simulatedConnections({ tls: false });

  await assert.rejects(
    () =>
      runSessionPoolerValidation(testEnvironment(), {
        createClient: simulated.createClient,
        heartbeatIntervalMs: 1,
        sleep: () => Promise.resolve(),
      }),
    { code: 'SESSION_POOLER_TLS_NOT_CONFIRMED' },
  );
});

test('fails closed when both sessions report the same backend PID', async () => {
  const simulated = simulatedConnections({ samePid: true });

  await assert.rejects(
    () =>
      runSessionPoolerValidation(testEnvironment(), {
        createClient: simulated.createClient,
        heartbeatIntervalMs: 1,
        sleep: () => Promise.resolve(),
      }),
    { code: 'SESSION_POOLER_BACKENDS_NOT_DISTINCT' },
  );
});
