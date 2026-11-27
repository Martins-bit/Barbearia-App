const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const PRODUCTION_PROJECT_REF = 'stxaxuzkivatxurubeus';
const TEST_PROJECT_TYPE = 'temporary-test';
const TEST_PROJECT_ACK = 'I_CONFIRM_TEMPORARY_TEST_PROJECT';
const SESSION_POOLER_HOST_PATTERN =
  /^aws-\d+-[a-z]{2}(?:-[a-z0-9]+)+-\d+\.pooler\.supabase\.com$/;
const ADVISORY_LOCK_KEY = [1111634258, 1179200083];
const HEARTBEAT_INTERVAL_MS = 5000;
const CHILD_TERMINATION_TIMEOUT_MS = 5000;
const INOFFENSIVE_CHILD_SOURCE = 'setInterval(() => {}, 1000)';

class SessionPoolerValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SessionPoolerValidationError';
    this.code = code;
  }
}

function blocked(code) {
  return new SessionPoolerValidationError(code);
}

function validateConfiguration(env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined) {
    throw blocked('NODE_TLS_OVERRIDE_FORBIDDEN');
  }

  const projectRef = env.SESSION_POOLER_TEST_PROJECT_REF;
  const projectType = env.SESSION_POOLER_TEST_PROJECT_TYPE;
  const acknowledgement = env.SESSION_POOLER_TEST_ACK;
  const host = env.SESSION_POOLER_TEST_HOST;
  const port = env.SESSION_POOLER_TEST_PORT;
  const database = env.SESSION_POOLER_TEST_DATABASE;
  const username = env.SESSION_POOLER_TEST_USERNAME;
  const password = env.SESSION_POOLER_TEST_PASSWORD;

  if (
    typeof projectRef !== 'string' ||
    !/^[a-z0-9]{20}$/.test(projectRef) ||
    projectRef === PRODUCTION_PROJECT_REF
  ) {
    throw blocked('TEST_PROJECT_REF_INVALID');
  }
  if (
    projectType !== TEST_PROJECT_TYPE ||
    acknowledgement !== TEST_PROJECT_ACK
  ) {
    throw blocked('TEMPORARY_TEST_PROJECT_CONFIRMATION_REQUIRED');
  }
  if (
    typeof host !== 'string' ||
    host !== host.toLowerCase() ||
    !SESSION_POOLER_HOST_PATTERN.test(host) ||
    host === `db.${PRODUCTION_PROJECT_REF}.supabase.co`
  ) {
    throw blocked('SESSION_POOLER_HOST_INVALID');
  }
  if (port !== '5432') {
    throw blocked('SESSION_POOLER_PORT_INVALID');
  }
  if (database !== 'postgres') {
    throw blocked('SESSION_POOLER_DATABASE_INVALID');
  }
  if (username !== `postgres.${projectRef}`) {
    throw blocked('SESSION_POOLER_USERNAME_INVALID');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw blocked('TEST_PROJECT_PASSWORD_REQUIRED');
  }

  return Object.freeze({
    projectRef,
    host,
    port: 5432,
    database,
    username,
    password,
  });
}

function clientOptions(config) {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: {
      rejectUnauthorized: true,
      servername: config.host,
    },
    connectionTimeoutMillis: 10000,
    query_timeout: 5000,
    keepAlive: true,
  };
}

async function assertTlsAndIdentity(client, config) {
  const identity = await client.query(
    'SELECT current_database() AS database, current_user AS username, pg_backend_pid() AS pid',
  );
  const row = identity.rows && identity.rows[0];
  if (
    !row ||
    row.database !== config.database ||
    row.username !== config.username ||
    !Number.isInteger(row.pid)
  ) {
    throw blocked('TEST_PROJECT_IDENTITY_MISMATCH');
  }

  const tls = await client.query(
    'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
  );
  if (!tls.rows || !tls.rows[0] || tls.rows[0].ssl !== true) {
    throw blocked('SESSION_POOLER_TLS_NOT_CONFIRMED');
  }
  return row.pid;
}

async function lockIsHeld(client) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_locks
       WHERE locktype = 'advisory'
         AND pid = pg_backend_pid()
         AND classid = $1::oid
         AND objid = $2::oid
         AND objsubid = 2
         AND mode = 'ExclusiveLock'
         AND granted
     ) AS held`,
    ADVISORY_LOCK_KEY,
  );
  return Boolean(result.rows && result.rows[0] && result.rows[0].held === true);
}

function safeChildEnvironment() {
  const env = {
    PATH: path.dirname(process.execPath),
  };
  if (process.platform === 'win32' && process.env.SystemRoot) {
    env.SystemRoot = process.env.SystemRoot;
  }
  return env;
}

function stopChild(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let escalationTimer;
    let finalTimer;
    let signalSent = 'SIGTERM';

    const cleanup = () => {
      clearTimeout(escalationTimer);
      clearTimeout(finalTimer);
    };
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve({ closed: true, signalSent });
      }
    };

    child.once('close', () => finish());
    child.once('error', () => finish(blocked('TEST_CHILD_PROCESS_FAILED')));

    try {
      if (!child.kill('SIGTERM')) {
        signalSent = 'SIGKILL';
        child.kill('SIGKILL');
      }
    } catch {
      signalSent = 'SIGKILL';
      try {
        child.kill('SIGKILL');
      } catch {
        finish(blocked('TEST_CHILD_PROCESS_STOP_FAILED'));
        return;
      }
    }

    escalationTimer = setTimeout(() => {
      try {
        signalSent = 'SIGKILL';
        child.kill('SIGKILL');
      } catch {
        finish(blocked('TEST_CHILD_PROCESS_STOP_FAILED'));
        return;
      }
      finalTimer = setTimeout(
        () => finish(blocked('TEST_CHILD_PROCESS_STOP_TIMEOUT')),
        timeoutMs,
      );
    }, timeoutMs);
  });
}

function spawnInoffensiveChild(spawnProcess) {
  return spawnProcess(process.execPath, ['-e', INOFFENSIVE_CHILD_SOURCE], {
    env: safeChildEnvironment(),
    stdio: 'ignore',
    windowsHide: true,
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeError(error) {
  return error instanceof SessionPoolerValidationError
    ? error
    : blocked('SESSION_POOLER_VALIDATION_FAILED');
}

function configurationFromProcessEnvironment() {
  return {
    NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    SESSION_POOLER_TEST_PROJECT_REF:
      process.env.SESSION_POOLER_TEST_PROJECT_REF,
    SESSION_POOLER_TEST_PROJECT_TYPE:
      process.env.SESSION_POOLER_TEST_PROJECT_TYPE,
    SESSION_POOLER_TEST_ACK: process.env.SESSION_POOLER_TEST_ACK,
    SESSION_POOLER_TEST_HOST: process.env.SESSION_POOLER_TEST_HOST,
    SESSION_POOLER_TEST_PORT: process.env.SESSION_POOLER_TEST_PORT,
    SESSION_POOLER_TEST_DATABASE: process.env.SESSION_POOLER_TEST_DATABASE,
    SESSION_POOLER_TEST_USERNAME: process.env.SESSION_POOLER_TEST_USERNAME,
    SESSION_POOLER_TEST_PASSWORD: process.env.SESSION_POOLER_TEST_PASSWORD,
  };
}

async function runSessionPoolerValidation(env, dependencies = {}) {
  const config = validateConfiguration(env);
  const createClient =
    dependencies.createClient || ((options) => new Client(options));
  const spawnProcess = dependencies.spawnProcess || spawn;
  const heartbeatIntervalMs =
    dependencies.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const childTerminationTimeoutMs =
    dependencies.childTerminationTimeoutMs ?? CHILD_TERMINATION_TIMEOUT_MS;
  const delay = dependencies.sleep || sleep;
  const clients = [
    createClient(clientOptions(config)),
    createClient(clientOptions(config)),
  ];
  let child;
  let childClosed = false;
  let childFailed = false;
  let failure;
  let report;

  try {
    const connectionResults = await Promise.allSettled(
      clients.map((client) => client.connect()),
    );
    if (connectionResults.some((result) => result.status === 'rejected')) {
      throw blocked('SESSION_POOLER_CONNECTION_FAILED');
    }

    const [firstPid, secondPid] = await Promise.all(
      clients.map((client) => assertTlsAndIdentity(client, config)),
    );
    if (firstPid === secondPid) {
      throw blocked('SESSION_POOLER_BACKENDS_NOT_DISTINCT');
    }

    await clients[0].query(
      'SELECT pg_advisory_lock($1::integer, $2::integer)',
      ADVISORY_LOCK_KEY,
    );
    if (!(await lockIsHeld(clients[0]))) {
      throw blocked('ADVISORY_LOCK_NOT_CONFIRMED');
    }

    child = spawnInoffensiveChild(spawnProcess);
    if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function') {
      throw blocked('TEST_CHILD_PROCESS_START_FAILED');
    }
    child.once('close', () => {
      childClosed = true;
    });
    child.once('error', () => {
      childFailed = true;
    });

    let successfulHeartbeats = 0;
    let lockLossDetected = false;
    while (successfulHeartbeats < 2 && !lockLossDetected) {
      await delay(heartbeatIntervalMs);
      if (childFailed) {
        throw blocked('TEST_CHILD_PROCESS_FAILED');
      }
      if (childClosed) {
        throw blocked('TEST_CHILD_PROCESS_EXITED_EARLY');
      }

      try {
        if (!(await lockIsHeld(clients[0]))) {
          lockLossDetected = true;
          break;
        }
      } catch {
        lockLossDetected = true;
        break;
      }

      successfulHeartbeats += 1;
      if (successfulHeartbeats === 1) {
        const released = await clients[0].query(
          'SELECT pg_advisory_unlock($1::integer, $2::integer) AS unlocked',
          ADVISORY_LOCK_KEY,
        );
        if (!released.rows || released.rows[0].unlocked !== true) {
          throw blocked('ADVISORY_LOCK_RELEASE_TEST_FAILED');
        }
      }
    }
    if (!lockLossDetected) {
      throw blocked('ADVISORY_LOCK_LOSS_NOT_DETECTED');
    }
    if (successfulHeartbeats === 0) {
      throw blocked('ADVISORY_LOCK_PERSISTENCE_NOT_CONFIRMED');
    }

    const termination = await stopChild(child, childTerminationTimeoutMs);
    childClosed = termination.closed;
    if (!childClosed) {
      throw blocked('TEST_CHILD_PROCESS_STOP_FAILED');
    }
    report = {
      tlsVerified: true,
      pgStatSslVerified: true,
      simultaneousConnections: true,
      distinctBackendPids: true,
      advisoryLockHeldDuringHeartbeat: successfulHeartbeats > 0,
      lockLossDetected: true,
      childTerminated: true,
      terminationSignal: termination.signalSent,
    };
  } catch (error) {
    failure = safeError(error);
  }

  if (child && !childClosed) {
    try {
      const termination = await stopChild(child, childTerminationTimeoutMs);
      childClosed = termination.closed;
    } catch {
      if (!failure) {
        failure = blocked('TEST_CHILD_PROCESS_STOP_FAILED');
      }
    }
  }

  const cleanup = await Promise.allSettled(clients.map((client) => client.end()));
  if (!failure && cleanup.some((result) => result.status === 'rejected')) {
    failure = blocked('SESSION_POOLER_CONNECTION_CLEANUP_FAILED');
  }
  if (failure) {
    throw failure;
  }
  return report;
}

async function main() {
  const report = await runSessionPoolerValidation(
    configurationFromProcessEnvironment(),
  );
  console.log(
    `Session Pooler validation passed: TLS, two sessions, advisory-lock heartbeat, lock-loss detection, child shutdown (${report.terminationSignal}).`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    const code =
      error instanceof SessionPoolerValidationError
        ? error.code
        : 'SESSION_POOLER_VALIDATION_FAILED';
    console.error(`Session Pooler validation blocked [${code}].`);
    process.exitCode = 1;
  });
}

module.exports = {
  ADVISORY_LOCK_KEY,
  PRODUCTION_PROJECT_REF,
  TEST_PROJECT_ACK,
  TEST_PROJECT_TYPE,
  clientOptions,
  runSessionPoolerValidation,
  validateConfiguration,
};
