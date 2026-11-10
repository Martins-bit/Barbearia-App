const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  E2E_CONFIG_PATH,
  E2E_DATABASE_NAME,
  E2E_MIGRATION_CONFIG_PATH,
  E2E_MIGRATION_DATABASE_USER,
  E2E_TEST_DATABASE_USER,
  loadE2EConfig,
  loadE2EMigrationConfig,
  sanitizedDatabaseEnvironment,
  validateE2EConfig,
  validateE2EMigrationConfig,
} = require('./e2e-safety.cjs');
const {
  assertDefaultPrismaMigrationAllowed,
  isSchemaMutationCommand,
} = require('./prisma-migration-safety.cjs');
const { runE2ETests } = require('./run-e2e-safely.cjs');
const { runE2EMigrations } = require('./run-e2e-migrations.cjs');

const TEST_URL =
  'postgresql://barbearia_e2e_test:test-only-password@127.0.0.1:5432/barbearia_app_e2e?schema=public';
const MIGRATION_URL =
  'postgresql://barbearia_e2e_migrator:migration-only-password@127.0.0.1:5432/barbearia_app_e2e?schema=public';
const DEVELOPMENT_URL =
  'postgresql://developer:development-only-password@localhost:5432/barbearia_app?schema=public';

function withConfig(contents, callback, filename = '.env.e2e') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'barbearia-e2e-'));
  const configPath = path.join(directory, filename);
  try {
    fs.writeFileSync(configPath, contents);
    callback(configPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function testConfig(overrides = {}) {
  return {
    DATABASE_URL: TEST_URL,
    JWT_SECRET: 'test-secret-with-more-than-thirty-two-characters',
    NODE_ENV: 'test',
    ...overrides,
  };
}

function migrationConfig(overrides = {}) {
  return {
    DATABASE_URL: MIGRATION_URL,
    E2E_MIGRATION_TARGET: E2E_DATABASE_NAME,
    ...overrides,
  };
}

function asEnvFile(config) {
  return Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

test('aceita somente o destino E2E e a role de execução dedicados', () => {
  assert.equal(validateE2EConfig(testConfig()), E2E_DATABASE_NAME);
  assert.equal(E2E_TEST_DATABASE_USER, 'barbearia_e2e_test');
});

test('recusa URLs de desenvolvimento e produção', () => {
  assert.throws(
    () => validateE2EConfig(testConfig({ DATABASE_URL: DEVELOPMENT_URL })),
    /E2E bloqueado/,
  );
  assert.throws(
    () =>
      validateE2EConfig(
        testConfig({
          DATABASE_URL:
            'postgresql://barbearia_e2e_test:secret@db.production.example:5432/barbearia_app_e2e?schema=public',
        }),
      ),
    /E2E bloqueado/,
  );
});

test('recusa host remoto e nomes de host locais ambíguos', () => {
  for (const host of ['remote.example', 'localhost', 'postgres']) {
    const url = TEST_URL.replace('127.0.0.1', host);
    assert.throws(
      () => validateE2EConfig(testConfig({ DATABASE_URL: url })),
      /E2E bloqueado/,
    );
  }
});

test('aceita loopback IPv4 ou IPv6 literal na porta explicitamente permitida', () => {
  assert.equal(validateE2EConfig(testConfig()), E2E_DATABASE_NAME);
  assert.equal(
    validateE2EConfig(
      testConfig({
        DATABASE_URL: TEST_URL.replace('127.0.0.1', '[::1]'),
      }),
    ),
    E2E_DATABASE_NAME,
  );
  assert.throws(
    () =>
      validateE2EConfig(
        testConfig({
          DATABASE_URL: TEST_URL.replace(':5432/', ':5433/'),
        }),
      ),
    /E2E bloqueado/,
  );
  assert.throws(
    () =>
      validateE2EConfig(
        testConfig({
          DATABASE_URL: TEST_URL.replace(':5432/', '/'),
        }),
      ),
    /E2E bloqueado/,
  );
});

test('recusa banco, protocolo e usuário incorretos', () => {
  assert.throws(
    () =>
      validateE2EConfig(
        testConfig({
          DATABASE_URL: TEST_URL.replace(
            'barbearia_app_e2e',
            'barbearia_app',
          ),
        }),
      ),
    /E2E bloqueado/,
  );
  assert.throws(
    () =>
      validateE2EConfig(
        testConfig({
          DATABASE_URL: TEST_URL.replace('postgresql:', 'https:'),
        }),
      ),
    /E2E bloqueado/,
  );
  assert.throws(
    () =>
      validateE2EConfig(
        testConfig({
          DATABASE_URL: TEST_URL.replace(
            E2E_TEST_DATABASE_USER,
            'postgres',
          ),
        }),
      ),
    /E2E bloqueado/,
  );
});

test('exige senha, JWT_SECRET e NODE_ENV de teste', () => {
  assert.throws(
    () =>
      validateE2EConfig({
        DATABASE_URL: TEST_URL,
        NODE_ENV: 'test',
      }),
    /E2E bloqueado/,
  );
  assert.throws(
    () => validateE2EConfig(testConfig({ JWT_SECRET: 'short' })),
    /E2E bloqueado/,
  );
  assert.throws(
    () => validateE2EConfig(testConfig({ NODE_ENV: 'development' })),
    /E2E bloqueado/,
  );
  assert.throws(
    () =>
      validateE2EConfig(
        testConfig({
          DATABASE_URL: TEST_URL.replace(
            ':test-only-password@',
            '@',
          ),
        }),
      ),
    /E2E bloqueado/,
  );
});

test('recusa parâmetros duplicados e qualquer parâmetro capaz de alterar destino', () => {
  for (const suffix of [
    '?schema=public&schema=public',
    '?schema=public&host=remote.example',
    '?schema=public&dbname=barbearia_app',
    '?schema=public&options=-csearch_path=other',
    '?schema=public&',
  ]) {
    const url = TEST_URL.replace('?schema=public', suffix);
    assert.throws(
      () => validateE2EConfig(testConfig({ DATABASE_URL: url })),
      /E2E bloqueado/,
    );
  }
});

test('recusa URL inválida sem revelar credenciais ou URL', () => {
  const secretUrl = 'postgresql://secret:private@host.invalid/not-safe';
  assert.throws(
    () => validateE2EConfig(testConfig({ DATABASE_URL: secretUrl })),
    (error) => {
      assert.match(error.message, /E2E bloqueado/);
      assert.doesNotMatch(error.message, /private|secret|host\.invalid/);
      return true;
    },
  );
});

test('não usa variáveis herdadas quando o arquivo E2E está ausente', () => {
  withConfig('', (configPath) => {
    fs.rmSync(configPath);
    assert.throws(
      () => loadE2EConfig(configPath),
      /E2E bloqueado/,
    );
  });
});

test('sanitiza variáveis de banco herdadas antes de iniciar um processo', () => {
  const env = sanitizedDatabaseEnvironment(
    {
      PATH: 'path-value',
      DATABASE_URL: DEVELOPMENT_URL,
      DIRECT_URL: DEVELOPMENT_URL,
      PGHOST: 'remote.example',
      PGPORT: '5433',
      PGDATABASE: 'production',
      PGUSER: 'postgres',
      PGPASSWORD: 'private',
      PGSERVICE: 'production-service',
      POSTGRES_URL: DEVELOPMENT_URL,
      DATABASE_HOST: 'remote.example',
      DB_HOST: 'remote.example',
      PRISMA_MIGRATION_TARGET: 'e2e',
    },
    testConfig(),
    E2E_CONFIG_PATH,
  );
  assert.equal(env.DATABASE_URL, TEST_URL);
  assert.equal(env.PATH, 'path-value');
  for (const key of [
    'DIRECT_URL',
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGSERVICE',
    'POSTGRES_URL',
    'DATABASE_HOST',
    'DB_HOST',
    'PRISMA_MIGRATION_TARGET',
  ]) {
    assert.equal(env[key], undefined);
  }
});

test('recusa variáveis extras de destino no arquivo E2E', () => {
  assert.throws(
    () => validateE2EConfig(testConfig({ POSTGRES_URL: DEVELOPMENT_URL })),
    /E2E bloqueado/,
  );
  assert.throws(
    () =>
      validateE2EMigrationConfig(
        migrationConfig({ PGHOST: 'remote.example' }),
        { E2E_MIGRATION_RUNNER_AUTH: '1' },
      ),
    /E2E bloqueado/,
  );
});

test('runner E2E passa configuração Jest fixa e ambiente sanitizado', () => {
  withConfig(asEnvFile(testConfig()), (configPath) => {
    let captured;
    const status = runE2ETests({
      configPath,
      args: ['--runInBand'],
      env: {
        DATABASE_URL: DEVELOPMENT_URL,
        PGHOST: 'remote.example',
        PATH: 'path-value',
      },
      spawn: (...args) => {
        captured = args;
        return { status: 0 };
      },
    });
    assert.equal(status, 0);
    assert.ok(captured[1].includes('--config'));
    assert.ok(captured[1].some((arg) => arg.endsWith('jest-e2e.json')));
    assert.equal(captured[2].env.DATABASE_URL, TEST_URL);
    assert.equal(captured[2].env.PGHOST, undefined);
    assert.equal(captured[2].env.PATH, 'path-value');
    assert.equal(captured[1].includes('dotenv/config'), false);
  });
});

test('runner E2E interrompe antes do Jest em configuração inválida', () => {
  withConfig(asEnvFile(testConfig({ DATABASE_URL: DEVELOPMENT_URL })), (configPath) => {
    let spawned = false;
    assert.throws(
      () =>
        runE2ETests({
          configPath,
          spawn: () => {
            spawned = true;
            return { status: 0 };
          },
        }),
      /E2E bloqueado/,
    );
    assert.equal(spawned, false);
  });
});

test('runner E2E não permite substituir o setup Jest protegido', () => {
  assert.throws(
    () => runE2ETests({ args: ['--config', 'unsafe.json'] }),
    /E2E bloqueado/,
  );
});

test('exige confirmação explícita antes de carregar configuração de migration E2E', () => {
  withConfig(
    asEnvFile(migrationConfig()),
    (configPath) => {
      assert.throws(
        () => loadE2EMigrationConfig(configPath, {}),
        /E2E bloqueado/,
      );
      assert.equal(
        loadE2EMigrationConfig(configPath, {
          E2E_MIGRATION_RUNNER_AUTH: '1',
        }).config.DATABASE_URL,
        MIGRATION_URL,
      );
    },
    path.basename(E2E_MIGRATION_CONFIG_PATH),
  );
});

test('configuração de migration exige role, destino e confirmação explícita', () => {
  const explicitConfirmation = { E2E_MIGRATION_RUNNER_AUTH: '1' };
  assert.equal(
    validateE2EMigrationConfig(migrationConfig(), explicitConfirmation),
    E2E_DATABASE_NAME,
  );
  assert.equal(E2E_MIGRATION_DATABASE_USER, 'barbearia_e2e_migrator');
  for (const invalid of [
    migrationConfig({
      DATABASE_URL: MIGRATION_URL.replace(
        E2E_MIGRATION_DATABASE_USER,
        E2E_TEST_DATABASE_USER,
      ),
    }),
    migrationConfig({ E2E_MIGRATION_TARGET: 'barbearia_app' }),
    migrationConfig({ DATABASE_URL: DEVELOPMENT_URL }),
  ]) {
    assert.throws(
      () => validateE2EMigrationConfig(invalid, explicitConfirmation),
      /E2E bloqueado/,
    );
  }
});

test('runner de migrations passa configuração dedicada e não inicia se inválida', () => {
  withConfig(
    asEnvFile(migrationConfig()),
    (configPath) => {
      let captured;
      const status = runE2EMigrations({
        configPath,
        env: {
          DATABASE_URL: DEVELOPMENT_URL,
          PGDATABASE: 'barbearia_app',
          PATH: 'path-value',
        },
        spawn: (...args) => {
          captured = args;
          return { status: 0 };
        },
      });
      assert.equal(status, 0);
      assert.ok(captured[1].includes('migrate'));
      assert.ok(captured[1].includes('deploy'));
      assert.ok(captured[1].includes('--config'));
      assert.ok(captured[1].some((arg) => arg.endsWith('prisma.e2e.config.ts')));
      assert.equal(captured[2].env.DATABASE_URL, MIGRATION_URL);
      assert.equal(captured[2].env.PGDATABASE, undefined);
      assert.equal(captured[2].env.E2E_MIGRATION_RUNNER_AUTH, '1');
      assert.equal(captured[2].env.PATH, 'path-value');
    },
    path.basename(E2E_MIGRATION_CONFIG_PATH),
  );

  withConfig(
    asEnvFile(migrationConfig({ DATABASE_URL: DEVELOPMENT_URL })),
    (configPath) => {
      let spawned = false;
      assert.throws(
        () =>
          runE2EMigrations({
            configPath,
            spawn: () => {
              spawned = true;
              return { status: 0 };
            },
          }),
        /E2E bloqueado/,
      );
      assert.equal(spawned, false);
    },
    path.basename(E2E_MIGRATION_CONFIG_PATH),
  );
});

test('runner de migrations rejeita configuração Prisma alternativa antes do spawn', () => {
  let spawned = false;
  assert.throws(
    () =>
      runE2EMigrations({
        args: ['--config=unsafe.prisma.config.ts'],
        spawn: () => {
          spawned = true;
          return { status: 0 };
        },
      }),
    /E2E bloqueado/,
  );
  assert.equal(spawned, false);
});

test('marcador manual não autentica o runner nem dispensa validação do destino', () => {
  const manualConfirmation = { E2E_MIGRATION_RUNNER_AUTH: '1' };
  assert.equal(
    validateE2EMigrationConfig(migrationConfig(), manualConfirmation),
    E2E_DATABASE_NAME,
  );

  for (const invalidConfig of [
    migrationConfig({ DATABASE_URL: DEVELOPMENT_URL }),
    migrationConfig({
      DATABASE_URL: MIGRATION_URL.replace('127.0.0.1', 'remote.example'),
    }),
    migrationConfig({
      DATABASE_URL: MIGRATION_URL.replace(
        E2E_MIGRATION_DATABASE_USER,
        E2E_TEST_DATABASE_USER,
      ),
    }),
  ]) {
    assert.throws(
      () => validateE2EMigrationConfig(invalidConfig, manualConfirmation),
      /E2E bloqueado/,
    );
  }
});

test('manifests e configurações oficiais mantêm migrations nos caminhos protegidos', () => {
  const backendDirectory = path.resolve(__dirname, '..');
  const workspaceDirectory = path.resolve(backendDirectory, '..');
  const backendPackage = JSON.parse(
    fs.readFileSync(path.join(backendDirectory, 'package.json'), 'utf8'),
  );
  const frontendPackage = JSON.parse(
    fs.readFileSync(
      path.join(workspaceDirectory, 'frontend', 'package.json'),
      'utf8',
    ),
  );
  const allScripts = [
    ...Object.values(backendPackage.scripts),
    ...Object.values(frontendPackage.scripts),
  ];
  const directMigrationScripts = allScripts.filter((script) =>
    /\bprisma\s+(?:migrate|db)\b/i.test(script),
  );
  assert.deepEqual(directMigrationScripts, []);
  assert.equal(
    backendPackage.scripts['db:e2e:migrate'],
    'node ./test/run-e2e-migrations.cjs',
  );

  const configFiles = fs
    .readdirSync(backendDirectory)
    .filter((file) => /^prisma(?:\..+)?\.config\.(?:[cm]?js|ts)$/i.test(file))
    .sort();
  assert.deepEqual(configFiles, ['prisma.config.ts', 'prisma.e2e.config.ts']);

  const defaultConfig = fs.readFileSync(
    path.join(backendDirectory, 'prisma.config.ts'),
    'utf8',
  );
  assert.match(defaultConfig, /prisma-migration-safety\.cjs/);
  assert.match(defaultConfig, /assertDefaultPrismaMigrationAllowed/);

  const migrationConfigSource = fs.readFileSync(
    path.join(backendDirectory, 'prisma.e2e.config.ts'),
    'utf8',
  );
  assert.match(migrationConfigSource, /loadE2EMigrationConfig/);
  assert.match(migrationConfigSource, /url:\s*config\.DATABASE_URL/);
  assert.doesNotMatch(migrationConfigSource, /dotenv\/config/);

  const migrationRunner = fs.readFileSync(
    path.join(__dirname, 'run-e2e-migrations.cjs'),
    'utf8',
  );
  assert.match(migrationRunner, /prisma\.e2e\.config\.ts/);
  assert.match(migrationRunner, /'migrate',\s*'deploy'/);
  assert.match(migrationRunner, /process\.argv\.slice\(2\)/);
});

test('configuração Prisma padrão bloqueia migration sem destino explicitamente autorizado', () => {
  assert.equal(isSchemaMutationCommand(['prisma', 'migrate', 'deploy']), true);
  assert.equal(isSchemaMutationCommand(['prisma', 'db', 'push']), true);
  assert.equal(isSchemaMutationCommand(['prisma', 'generate']), false);
  assert.throws(
    () =>
      assertDefaultPrismaMigrationAllowed(
        ['prisma', 'migrate', 'deploy'],
        { DATABASE_URL: DEVELOPMENT_URL },
      ),
    /Prisma bloqueado/,
  );
  assert.throws(
    () =>
      assertDefaultPrismaMigrationAllowed(
        ['prisma', 'migrate', 'deploy'],
        {
          DATABASE_URL: MIGRATION_URL,
          PRISMA_MIGRATION_TARGET: 'e2e',
        },
      ),
    /Prisma bloqueado/,
  );
});

test('configuração padrão só autoriza desenvolvimento local explicitamente selecionado', () => {
  assert.doesNotThrow(() =>
    assertDefaultPrismaMigrationAllowed(
      ['prisma', 'migrate', 'dev'],
      {
        DATABASE_URL: DEVELOPMENT_URL,
        PRISMA_MIGRATION_TARGET: 'development',
      },
    ),
  );
  for (const url of [
    TEST_URL,
    'postgresql://developer:password@production.example:5432/barbearia_app?schema=public',
  ]) {
    assert.throws(
      () =>
        assertDefaultPrismaMigrationAllowed(
          ['prisma', 'migrate', 'dev'],
          {
            DATABASE_URL: url,
            PRISMA_MIGRATION_TARGET: 'development',
          },
        ),
      /Prisma bloqueado/,
    );
  }
});

test('configuração padrão rejeita URLs de destino fornecidas como argumentos', () => {
  assert.throws(
    () =>
      assertDefaultPrismaMigrationAllowed(
        ['prisma', 'migrate', 'diff', '--to-url', DEVELOPMENT_URL],
        {
          DATABASE_URL: DEVELOPMENT_URL,
          PRISMA_MIGRATION_TARGET: 'development',
        },
      ),
    /Prisma bloqueado/,
  );
});
