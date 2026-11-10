const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  loadE2EConfig,
  sanitizedDatabaseEnvironment,
} = require('./e2e-safety.cjs');

function runE2ETests({
  args = [],
  configPath,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  if (args.some((argument) => /^--config(?:=|$)/i.test(argument))) {
    throw new Error(
      'E2E bloqueado: não é permitido substituir a configuração Jest protegida.',
    );
  }

  const { config, configPath: resolvedConfigPath } =
    loadE2EConfig(configPath);
  const backendDirectory = path.resolve(__dirname, '..');
  const jestPath = path.join(
    backendDirectory,
    'node_modules',
    'jest',
    'bin',
    'jest.js',
  );
  const result = spawn(
    process.execPath,
    [
      '--experimental-vm-modules',
      jestPath,
      '--config',
      path.join(__dirname, 'jest-e2e.json'),
      ...args,
    ],
    {
      cwd: backendDirectory,
      env: {
        ...sanitizedDatabaseEnvironment(env, config, resolvedConfigPath),
        NODE_ENV: 'test',
      },
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw new Error(`Não foi possível iniciar Jest: ${result.error.message}`);
  }
  return result.status ?? 1;
}

if (require.main === module) {
  try {
    process.exitCode = runE2ETests({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'E2E bloqueado.');
    process.exitCode = 1;
  }
}

module.exports = { runE2ETests };
