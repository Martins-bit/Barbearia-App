const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const E2E_DATABASE_NAME = 'barbearia_app_e2e';
const E2E_DATABASE_PORT = 5432;
const E2E_TEST_DATABASE_USER = 'barbearia_e2e_test';
const E2E_MIGRATION_DATABASE_USER = 'barbearia_e2e_migrator';
const E2E_CONFIG_PATH = path.join(__dirname, '.env.e2e');
const E2E_MIGRATION_CONFIG_PATH = path.join(
  __dirname,
  '.env.e2e.migrate',
);
const DATABASE_ENV_KEYS =
  /^(DATABASE(?:_[A-Z0-9_]*)?|DIRECT_URL|SHADOW_DATABASE_URL|POSTGRES(?:QL)?_[A-Z0-9_]*|DB_(?:URL|HOST|PORT|NAME|DATABASE|USER|PASSWORD)|PG[A-Z0-9_]*|PRISMA_[A-Z0-9_]*(?:URL|TARGET)|E2E_MIGRATION_[A-Z0-9_]*)$/i;

function blocked(message) {
  throw new Error(`E2E bloqueado: ${message}`);
}

function validateDatabaseUrl(
  connectionString,
  { databaseName, username, allowLocalhost = false },
) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    blocked('DATABASE_URL ausente.');
  }

  let url;
  let parsedDatabase;
  let parsedUsername;
  try {
    url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      blocked('protocolo PostgreSQL obrigatório.');
    }

    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const allowedHosts = allowLocalhost
      ? new Set(['127.0.0.1', '::1', 'localhost'])
      : new Set(['127.0.0.1', '::1']);
    if (!allowedHosts.has(host)) {
      blocked('host PostgreSQL não permitido.');
    }
    if (url.port !== String(E2E_DATABASE_PORT)) {
      blocked('porta PostgreSQL não permitida ou ausente.');
    }
    if (url.hash) {
      blocked('fragmento não permitido na URL PostgreSQL.');
    }

    const rawPath = url.pathname;
    parsedDatabase = decodeURIComponent(rawPath.replace(/^\/+/, ''));
    if (
      parsedDatabase !== databaseName ||
      rawPath !== `/${encodeURIComponent(databaseName)}`
    ) {
      blocked('nome do banco PostgreSQL não permitido.');
    }

    parsedUsername = decodeURIComponent(url.username);
    if (
      !parsedUsername ||
      (username && parsedUsername !== username) ||
      !url.password
    ) {
      blocked('usuário ou credenciais PostgreSQL não permitidos.');
    }

    const queryEntries = Array.from(url.searchParams.entries());
    if (
      queryEntries.length !== 1 ||
      url.search !== '?schema=public' ||
      queryEntries[0][0] !== 'schema' ||
      queryEntries[0][1] !== 'public'
    ) {
      blocked('parâmetros PostgreSQL ausentes, duplicados ou não permitidos.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('E2E bloqueado:')) {
      throw error;
    }
    blocked('URL PostgreSQL inválida.');
  }

  return { databaseName: parsedDatabase, username: parsedUsername };
}

function validateE2EConfig(config) {
  if (
    Object.keys(config).some(
      (key) => !['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV'].includes(key),
    )
  ) {
    blocked(
      'variáveis adicionais de conexão ou configuração não são permitidas.',
    );
  }
  const { databaseName } = validateDatabaseUrl(config.DATABASE_URL, {
    databaseName: E2E_DATABASE_NAME,
    username: E2E_TEST_DATABASE_USER,
  });
  if (
    typeof config.JWT_SECRET !== 'string' ||
    config.JWT_SECRET.length < 32
  ) {
    blocked(
      'JWT_SECRET exclusivo de teste com ao menos 32 caracteres obrigatório.',
    );
  }
  if (config.NODE_ENV !== 'test') {
    blocked('NODE_ENV deve ser test.');
  }
  return databaseName;
}

function validateE2EMigrationConfig(config, env = process.env) {
  if (
    Object.keys(config).some(
      (key) => !['DATABASE_URL', 'E2E_MIGRATION_TARGET'].includes(key),
    )
  ) {
    blocked(
      'variáveis adicionais de conexão para migration não são permitidas.',
    );
  }
  const { databaseName } = validateDatabaseUrl(config.DATABASE_URL, {
    databaseName: E2E_DATABASE_NAME,
    username: E2E_MIGRATION_DATABASE_USER,
  });
  if (config.E2E_MIGRATION_TARGET !== E2E_DATABASE_NAME) {
    blocked('autorização explícita para migration E2E ausente.');
  }
  if (env.E2E_MIGRATION_RUNNER_AUTH !== '1') {
    blocked('confirmação explícita para migration E2E ausente.');
  }
  return databaseName;
}

function readConfig(configPath, kind, env) {
  if (!fs.existsSync(configPath)) {
    blocked(`arquivo ${path.basename(configPath)} ausente.`);
  }

  let config;
  try {
    config = dotenv.parse(fs.readFileSync(configPath));
  } catch {
    blocked(`não foi possível ler ${path.basename(configPath)}.`);
  }

  if (kind === 'migration') {
    validateE2EMigrationConfig(config, env);
  } else {
    validateE2EConfig(config);
  }
  return { config, configPath: path.resolve(configPath) };
}

function loadE2EConfig(configPath = E2E_CONFIG_PATH) {
  return readConfig(configPath, 'test');
}

function loadE2EMigrationConfig(
  configPath = E2E_MIGRATION_CONFIG_PATH,
  env = process.env,
) {
  return readConfig(configPath, 'migration', env);
}

function sanitizedDatabaseEnvironment(baseEnv, config, configPath) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (DATABASE_ENV_KEYS.test(key)) {
      delete env[key];
    }
  }
  Object.assign(env, config, {
    DATABASE_URL: config.DATABASE_URL,
    DOTENV_CONFIG_PATH: path.resolve(configPath),
  });
  return env;
}

function applyE2EConfig(configPath = E2E_CONFIG_PATH) {
  const { config, configPath: resolvedConfigPath } =
    loadE2EConfig(configPath);
  const sanitized = sanitizedDatabaseEnvironment(
    process.env,
    config,
    resolvedConfigPath,
  );
  for (const key of Object.keys(process.env)) {
    if (DATABASE_ENV_KEYS.test(key)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, sanitized, { NODE_ENV: 'test' });
  return config;
}

module.exports = {
  DATABASE_ENV_KEYS,
  E2E_CONFIG_PATH,
  E2E_DATABASE_NAME,
  E2E_DATABASE_PORT,
  E2E_MIGRATION_CONFIG_PATH,
  E2E_MIGRATION_DATABASE_USER,
  E2E_TEST_DATABASE_USER,
  applyE2EConfig,
  loadE2EConfig,
  loadE2EMigrationConfig,
  sanitizedDatabaseEnvironment,
  validateDatabaseUrl,
  validateE2EConfig,
  validateE2EMigrationConfig,
};
