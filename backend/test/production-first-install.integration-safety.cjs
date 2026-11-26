const path = require('node:path');

const BACKEND_DIRECTORY = path.resolve(__dirname, '..');
const INTEGRATION_CONFIG_PATH = path.join(
  BACKEND_DIRECTORY,
  'prisma.production-integration.config.ts',
);

function blocked(message) {
  throw new Error(`Integração bloqueada: ${message}`);
}

function validateIntegrationUrl(rawUrl, expectedRunId) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    blocked('URL do PostgreSQL descartável ausente.');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    blocked('URL do PostgreSQL descartável inválida.');
  }

  const expectedDatabase = `barbearia_first_install_integration_${expectedRunId}`;
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', '::1'].includes(
      url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
    ) ||
    !/^[1-9]\d{3,4}$/.test(url.port) ||
    Number(url.port) < 49152 ||
    Number(url.port) > 65535 ||
    url.username !== 'postgres' ||
    url.password !== '' ||
    url.pathname !== `/${expectedDatabase}` ||
    url.hash ||
    url.searchParams.getAll('schema').length !== 1 ||
    url.searchParams.get('schema') !== 'public' ||
    url.searchParams.getAll('sslmode').length !== 1 ||
    url.searchParams.get('sslmode') !== 'disable' ||
    Array.from(url.searchParams.keys()).some(
      (key) => !['schema', 'sslmode'].includes(key),
    ) ||
    Array.from(url.searchParams.entries()).length !== 2
  ) {
    blocked('o destino não é o banco local temporário esperado.');
  }

  return {
    database: expectedDatabase,
    host: url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
    port: Number(url.port),
  };
}

function assertIntegrationConfigInvocation(
  argv = process.argv,
  env = process.env,
) {
  const migrateIndex = argv.findIndex((argument) => argument === 'migrate');
  const configIndex = argv.findIndex((argument) => argument === '--config');
  const suppliedConfig = configIndex >= 0 ? argv[configIndex + 1] : undefined;
  const commandArguments = migrateIndex >= 0 ? argv.slice(migrateIndex) : [];
  const runId = env.PRODUCTION_MIGRATION_TEST_RUN_ID;
  const expectedAuthorization = `DISPOSABLE_POSTGRES_TEST:${runId}`;

  if (
    env.NODE_ENV !== 'test' ||
    !/^[a-f0-9]{12}$/.test(runId || '') ||
    env.PRODUCTION_MIGRATION_TEST_AUTH !== expectedAuthorization ||
    migrateIndex < 0 ||
    commandArguments.length !== 4 ||
    commandArguments[1] !== 'deploy' ||
    commandArguments[2] !== '--config' ||
    configIndex < 0 ||
    !suppliedConfig ||
    path.resolve(suppliedConfig) !== path.resolve(INTEGRATION_CONFIG_PATH)
  ) {
    blocked('a configuração só aceita o runner de integração descartável.');
  }

  return validateIntegrationUrl(
    env.PRODUCTION_MIGRATION_TEST_DATABASE_URL,
    runId,
  );
}

module.exports = {
  assertIntegrationConfigInvocation,
  validateIntegrationUrl,
};
