const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const {
  readAndVerifyMigrationManifest,
  assertMigrationHistoryAndEmptyTables,
  sanitizePrismaOutput,
} = require('../scripts/production-first-install.cjs');
const {
  validateIntegrationUrl,
} = require('./production-first-install.integration-safety.cjs');

const BACKEND_DIRECTORY = path.resolve(__dirname, '..');
const PRISMA_PATH = path.join(
  BACKEND_DIRECTORY,
  'node_modules',
  'prisma',
  'build',
  'index.js',
);
const PRISMA_CONFIG_PATH = path.join(
  BACKEND_DIRECTORY,
  'prisma.production-integration.config.ts',
);
const DOCKER_LABEL = 'barbearia-app.production-first-install-test';
const POSTGRES_IMAGE = 'postgres:17-alpine';

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} falhou durante o teste descartável.`);
  }
  return (result.stdout || '').trim();
}

function inspectJson(kind, id) {
  const output = runCommand('docker', [
    'inspect',
    '--type',
    kind,
    '--format',
    '{{json .}}',
    id,
  ]);
  return JSON.parse(output);
}

function assertLocalDockerEngine() {
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) {
    throw new Error(
      'Integração bloqueada: DOCKER_HOST/DOCKER_CONTEXT não podem selecionar um daemon remoto.',
    );
  }

  const context = runCommand('docker', ['context', 'show']);
  const endpoint = runCommand('docker', [
    'context',
    'inspect',
    '--format',
    '{{(index .Endpoints "docker").Host}}',
    context,
  ]);
  if (!/^(npipe:|unix:)/i.test(endpoint)) {
    throw new Error(
      'Integração bloqueada: somente daemon Docker local é permitido.',
    );
  }
  runCommand('docker', ['version', '--format', '{{.Server.Version}}']);
}

function assertOwnedNetwork(network, runId) {
  if (
    !network ||
    !network.Labels ||
    network.Labels[DOCKER_LABEL] !== runId ||
    network.Internal !== true
  ) {
    throw new Error('Rede descartável não corresponde ao teste atual.');
  }
}

function assertOwnedContainer(container, runId, networkName) {
  const publishedPort =
    container.NetworkSettings &&
    container.NetworkSettings.Ports &&
    container.NetworkSettings.Ports['5432/tcp'];
  const mounts = (container.Mounts || []).filter(
    (mount) => mount.Destination === '/var/lib/postgresql/data',
  );
  if (
    !container ||
    !container.Config ||
    !container.Config.Labels ||
    container.Config.Labels[DOCKER_LABEL] !== runId ||
    container.Config.Image !== POSTGRES_IMAGE ||
    container.State.Running !== true ||
    container.HostConfig.NetworkMode !== networkName ||
    (container.HostConfig.Binds || []).length !== 0 ||
    (container.HostConfig.VolumesFrom || []).length !== 0 ||
    !container.HostConfig.Tmpfs ||
    !container.HostConfig.Tmpfs['/var/lib/postgresql/data'] ||
    mounts.some((mount) => mount.Type !== 'tmpfs') ||
    !Array.isArray(publishedPort) ||
    publishedPort.length !== 1 ||
    publishedPort[0].HostIp !== '127.0.0.1' ||
    Number(publishedPort[0].HostPort) < 49152
  ) {
    throw new Error(
      'Container não corresponde ao PostgreSQL descartável esperado.',
    );
  }
}

function waitForPostgres(containerId, databaseName) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      ['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', databaseName],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    if (!result.error && result.status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error('PostgreSQL descartável não ficou pronto a tempo.');
}

async function verifyAppliedDatabase(databaseUrl, runId, migrations) {
  const { database, host, port } = validateIntegrationUrl(databaseUrl, runId);
  const client = new Client({
    connectionString: databaseUrl,
    ssl: false,
    connectionTimeoutMillis: 5000,
  });
  let connected = false;
  let operationError;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query(
      'SELECT current_database() AS database, current_schema() AS schema',
    );
    if (
      identity.rows[0].database !== database ||
      identity.rows[0].schema !== 'public' ||
      host !== '127.0.0.1' ||
      port < 49152
    ) {
      throw new Error('PostgreSQL descartável reportou identidade inesperada.');
    }
    await assertMigrationHistoryAndEmptyTables(client, migrations, 'public');
  } catch (error) {
    operationError = error;
  }

  try {
    await client.end();
  } catch (error) {
    if (!operationError) {
      operationError = error;
    }
  }

  if (operationError) {
    throw new Error('Verificação final do PostgreSQL descartável falhou.');
  }
  if (!connected) {
    throw new Error('Não foi possível conectar ao PostgreSQL descartável.');
  }
}

async function runDisposablePostgresIntegration() {
  if (process.argv.length > 2) {
    throw new Error('O teste de integração não aceita argumentos adicionais.');
  }
  assertLocalDockerEngine();

  const runId = crypto.randomBytes(6).toString('hex');
  const networkName = `barbearia-first-install-${runId}`;
  const databaseName = `barbearia_first_install_integration_${runId}`;
  let networkId;
  let containerId;
  let operationError;
  let cleanupError;

  try {
    networkId = runCommand('docker', [
      'network',
      'create',
      '--internal',
      '--label',
      `${DOCKER_LABEL}=${runId}`,
      networkName,
    ]);
    assertOwnedNetwork(inspectJson('network', networkId), runId);

    containerId = runCommand('docker', [
      'run',
      '--detach',
      '--name',
      networkName,
      '--label',
      `${DOCKER_LABEL}=${runId}`,
      '--network',
      networkName,
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      '--env',
      `POSTGRES_DB=${databaseName}`,
      POSTGRES_IMAGE,
    ]);
    let container = inspectJson('container', containerId);
    assertOwnedContainer(container, runId, networkName);
    waitForPostgres(containerId, databaseName);

    container = inspectJson('container', containerId);
    assertOwnedContainer(container, runId, networkName);
    const hostPort = container.NetworkSettings.Ports['5432/tcp'][0].HostPort;
    const databaseUrl =
      `postgresql://postgres@127.0.0.1:${hostPort}/${databaseName}` +
      '?schema=public&sslmode=disable';
    const config = validateIntegrationUrl(databaseUrl, runId);
    const integrationEnv = { ...process.env };
    for (const key of Object.keys(integrationEnv)) {
      if (
        /^(DATABASE(?:_[A-Z0-9_]*)?|DIRECT_URL|SHADOW_DATABASE_URL|POSTGRES(?:QL)?_[A-Z0-9_]*|DB_(?:URL|HOST|PORT|NAME|DATABASE|USER|PASSWORD)|PG[A-Z0-9_]*|PRISMA_[A-Z0-9_]*|.*(?:DATABASE_URL|DB_URL))$/i.test(
          key,
        ) ||
        key.startsWith('PRODUCTION_MIGRATION_') ||
        key.startsWith('E2E_MIGRATION_') ||
        ['NODE_OPTIONS', 'NODE_PATH', 'DOTENV_CONFIG_PATH'].includes(key)
      ) {
        delete integrationEnv[key];
      }
    }
    Object.assign(integrationEnv, {
      NODE_ENV: 'test',
      PRODUCTION_MIGRATION_TEST_AUTH: `DISPOSABLE_POSTGRES_TEST:${runId}`,
      PRODUCTION_MIGRATION_TEST_DATABASE_URL: databaseUrl,
      PRODUCTION_MIGRATION_TEST_RUN_ID: runId,
    });

    const migrationOutput = spawnSync(
      process.execPath,
      [PRISMA_PATH, 'migrate', 'deploy', '--config', PRISMA_CONFIG_PATH],
      {
        cwd: BACKEND_DIRECTORY,
        env: integrationEnv,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (migrationOutput.error || migrationOutput.status !== 0) {
      const output = sanitizePrismaOutput(
        `${migrationOutput.stdout || ''}\n${migrationOutput.stderr || ''}`,
        databaseUrl,
      );
      throw new Error(
        output
          ? `Migrations falharam no PostgreSQL descartável:\n${output}`
          : 'Migrations falharam no PostgreSQL descartável.',
      );
    }

    const migrations = readAndVerifyMigrationManifest();
    await verifyAppliedDatabase(databaseUrl, runId, migrations);
  } catch (error) {
    operationError =
      error instanceof Error
        ? error
        : new Error('Teste de integração descartável falhou.');
  } finally {
    if (containerId) {
      try {
        const container = inspectJson('container', containerId);
        if (
          !container.Config ||
          !container.Config.Labels ||
          container.Config.Labels[DOCKER_LABEL] !== runId
        ) {
          throw new Error('Identidade do container temporário não confere.');
        }
        runCommand('docker', ['rm', '--force', '--volumes', containerId]);
      } catch {
        cleanupError = new Error(
          'Falha ao remover o container descartável criado pelo teste.',
        );
      }
    }
    if (networkId) {
      try {
        const network = inspectJson('network', networkId);
        assertOwnedNetwork(network, runId);
        runCommand('docker', ['network', 'rm', networkId]);
      } catch {
        cleanupError = new Error(
          'Falha ao remover a rede descartável criada pelo teste.',
        );
      }
    }
  }

  if (operationError) {
    if (cleanupError) {
      process.stderr.write(`${cleanupError.message}\n`);
    }
    throw operationError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
  process.stdout.write(
    'Integração concluída: 17 migrations aplicadas em PostgreSQL descartável; tabelas sem dados.\n',
  );
}

if (require.main === module) {
  runDisposablePostgresIntegration().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertLocalDockerEngine,
  runDisposablePostgresIntegration,
  verifyAppliedDatabase,
};
