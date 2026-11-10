const {
  E2E_DATABASE_NAME,
  E2E_DATABASE_PORT,
  validateDatabaseUrl,
} = require('./e2e-safety.cjs');

const DEVELOPMENT_DATABASE_NAME = 'barbearia_app';
const DEVELOPMENT_MIGRATION_TARGET = 'development';

function isSchemaMutationCommand(argv) {
  const commandIndex = argv.findIndex((argument) =>
    ['migrate', 'db'].includes(argument),
  );
  if (commandIndex < 0) {
    return false;
  }

  const command = argv[commandIndex];
  const operation = argv[commandIndex + 1];
  return (
    command === 'migrate' ||
    (command === 'db' && ['push', 'execute'].includes(operation))
  );
}

function assertDefaultPrismaMigrationAllowed(argv, env) {
  if (!isSchemaMutationCommand(argv)) {
    return;
  }

  if (argv.some((argument) => /^--(?:url|from-url|to-url|shadow-database-url)(?:=|$)/i.test(argument))) {
    throw new Error(
      'Prisma bloqueado: URLs de destino por argumento não são permitidas.',
    );
  }

  if (env.PRISMA_MIGRATION_TARGET !== DEVELOPMENT_MIGRATION_TARGET) {
    throw new Error(
      'Prisma bloqueado: defina PRISMA_MIGRATION_TARGET=development para operações locais de desenvolvimento. Use o runner E2E para migrations de teste.',
    );
  }

  try {
    validateDatabaseUrl(env.DATABASE_URL, {
      databaseName: DEVELOPMENT_DATABASE_NAME,
      allowLocalhost: true,
    });
  } catch {
    throw new Error(
      'Prisma bloqueado: a configuração padrão só pode migrar barbearia_app em PostgreSQL local na porta autorizada. A URL não será exibida.',
    );
  }

  if (env.DATABASE_URL.includes(E2E_DATABASE_NAME)) {
    throw new Error(
      'Prisma bloqueado: migrations E2E exigem configuração e runner dedicados.',
    );
  }
}

module.exports = {
  DEVELOPMENT_DATABASE_NAME,
  DEVELOPMENT_MIGRATION_TARGET,
  assertDefaultPrismaMigrationAllowed,
  isSchemaMutationCommand,
};
