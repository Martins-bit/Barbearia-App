const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const {
  assertDefaultPrismaMigrationAllowed,
} = require('./prisma-migration-safety.cjs');

function resolveBackendEnvPath() {
  return path.resolve(__dirname, '..', '.env');
}

function runDevelopmentMigrations({
  env = process.env,
  argv = [],
  spawn = spawnSync,
} = {}) {
  if (argv.length > 0) {
    throw new Error(
      'Migration local bloqueada: argumentos extras não são permitidos.',
    );
  }

  const resolvedEnv = { ...env };
  for (const key of Object.keys(resolvedEnv)) {
    if (
      /^(DATABASE(?:_[A-Z0-9_]*)?|DIRECT_URL|SHADOW_DATABASE_URL|POSTGRES(?:QL)?_[A-Z0-9_]*|DB_(?:URL|HOST|PORT|NAME|DATABASE|USER|PASSWORD)|PG[A-Z0-9_]*|PRISMA_[A-Z0-9_]*)$/i.test(
        key,
      )
    ) {
      if (key !== 'DATABASE_URL') {
        delete resolvedEnv[key];
      }
    }
  }
  resolvedEnv.PRISMA_MIGRATION_TARGET = 'development';

  assertDefaultPrismaMigrationAllowed(
    ['node', 'prisma', 'migrate', 'deploy'],
    resolvedEnv,
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
    'prisma.config.ts',
  );

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
      env: resolvedEnv,
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw new Error(
      'Não foi possível iniciar a proteção de migrations locais.',
    );
  }
  return result.status ?? 1;
}

if (require.main === module) {
  dotenv.config({
    path: resolveBackendEnvPath(),
    override: false,
  });
  try {
    process.exitCode = runDevelopmentMigrations({
      env: process.env,
      argv: process.argv.slice(2),
    });
  } catch {
    process.stderr.write(
      'Migration local abortada [MIGRATION_LOCAL_BLOCKED]. Nenhum detalhe interno foi exibido.\n',
    );
    process.exitCode = 1;
  }
}

module.exports = {
  resolveBackendEnvPath,
  runDevelopmentMigrations,
};
