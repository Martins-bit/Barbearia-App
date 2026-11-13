const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  E2E_MIGRATION_CONFIG_PATH,
  loadE2EMigrationConfig,
  sanitizedDatabaseEnvironment,
} = require('./e2e-safety.cjs');

function runE2EMigrations({
  configPath = E2E_MIGRATION_CONFIG_PATH,
  env = process.env,
  spawn = spawnSync,
  args = [],
} = {}) {
  if (args.length > 0) {
    throw new Error(
      'E2E bloqueado: argumentos extras não são permitidos no runner de migrations.',
    );
  }

  const authorizedEnv = { ...env, E2E_MIGRATION_RUNNER_AUTH: '1' };
  const { config, configPath: resolvedConfigPath } = loadE2EMigrationConfig(
    configPath,
    authorizedEnv,
  );
  const backendDirectory = path.resolve(__dirname, '..');
  const prismaPath = path.join(
    backendDirectory,
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );
  const prismaConfigPath = path.join(
    backendDirectory,
    'prisma.e2e.config.ts',
  );
  const childEnv = sanitizedDatabaseEnvironment(
    env,
    config,
    resolvedConfigPath,
  );
  childEnv.E2E_MIGRATION_RUNNER_AUTH = '1';

  const result = spawn(
    process.execPath,
    [
      prismaPath,
      'migrate',
      'deploy',
      '--config',
      prismaConfigPath,
    ],
    {
      cwd: backendDirectory,
      env: childEnv,
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw new Error(
      `Não foi possível iniciar Prisma para migrations E2E: ${result.error.message}`,
    );
  }
  return result.status ?? 1;
}

if (require.main === module) {
  try {
    process.exitCode = runE2EMigrations({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Migration E2E bloqueada.');
    process.exitCode = 1;
  }
}

module.exports = { runE2EMigrations };
