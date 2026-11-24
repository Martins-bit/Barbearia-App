const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
const {
  DatabaseOperationSafetyError,
  resolveBackendEnvPath,
  validateLocalDatabaseEnvironment,
  sanitizedDatabaseProcessEnv,
  resolveApprovedDatabaseExecutable,
  getApprovedBackupDirectory,
  acquireDatabaseOperationLock,
  getSafeErrorCode,
} = require('./database-operation-safety.cjs');

function parseArgs(argv) {
  const result = { mode: 'validate' };
  for (const arg of argv) {
    if (arg === '--validate') result.mode = 'validate';
    else if (arg === '--restore') result.mode = 'restore';
    else if (arg.startsWith('--archive=')) {
      result.archive = arg.slice('--archive='.length);
    } else if (arg.startsWith('--checksum=')) {
      result.checksum = arg.slice('--checksum='.length);
    } else if (arg.startsWith('--confirm-destination=')) {
      result.confirmDestination = arg.slice('--confirm-destination='.length);
    } else if (arg.startsWith('--confirm-restore=')) {
      result.confirmRestore = arg.slice('--confirm-restore='.length);
    } else {
      throw new DatabaseOperationSafetyError(
        'DATABASE_OPERATION_ARGUMENT_INVALID',
        'Argumento local não permitido.',
      );
    }
  }
  return result;
}

function findExecutable(executable, env, resolver = resolveApprovedDatabaseExecutable) {
  return resolver(executable, env);
}

function canonicalArchivePath(archivePath) {
  if (!archivePath) {
    throw new DatabaseOperationSafetyError(
      'RESTORE_ARCHIVE_MISSING',
      'Informe o arquivo de restauração.',
    );
  }

  let canonical;
  try {
    canonical = fs.realpathSync(path.resolve(archivePath));
  } catch {
    throw new DatabaseOperationSafetyError(
      'RESTORE_ARCHIVE_MISSING',
      'Arquivo de restauração não encontrado.',
    );
  }
  const stat = fs.statSync(canonical);
  if (!stat.isFile()) {
    throw new DatabaseOperationSafetyError(
      'RESTORE_ARCHIVE_INVALID',
      'O caminho de restauração não é um arquivo regular.',
    );
  }
  return canonical;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function parseSha256Sidecar(content) {
  const match =
    typeof content === 'string'
      ? content.trim().match(/^([a-fA-F0-9]{64})(?:\s+.*)?$/)
      : null;
  return match ? match[1].toLowerCase() : null;
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

async function runProcess(executable, args, options, start = spawn) {
  let child;
  try {
    child = start(executable, args, options);
  } catch {
    throw new DatabaseOperationSafetyError(
      'RESTORE_PROCESS_START_FAILED',
      'Não foi possível iniciar o validador PostgreSQL aprovado.',
    );
  }
  if (!child || typeof child.once !== 'function') {
    throw new DatabaseOperationSafetyError(
      'RESTORE_PROCESS_START_FAILED',
      'O processo PostgreSQL não retornou um resultado válido.',
    );
  }
  child.stdout?.resume();
  child.stderr?.resume();

  try {
    const result = await waitForChild(child);
    if (result.code !== 0 || result.signal) {
      throw new DatabaseOperationSafetyError(
        'RESTORE_ARCHIVE_INVALID',
        'O arquivo não passou na validação estrutural.',
      );
    }
  } catch (error) {
    if (typeof child.kill === 'function') child.kill();
    throw error instanceof DatabaseOperationSafetyError
      ? error
      : new DatabaseOperationSafetyError(
          'RESTORE_ARCHIVE_INVALID',
          'O arquivo não passou na validação estrutural.',
        );
  }
}

async function validateRestoreArchive({
  archivePath,
  checksum,
  env,
  spawnProcess = spawn,
  resolveExecutable = resolveApprovedDatabaseExecutable,
}) {
  const canonicalPath = canonicalArchivePath(archivePath);
  if (!checksum || !/^[a-fA-F0-9]{64}$/.test(checksum)) {
    throw new DatabaseOperationSafetyError(
      'RESTORE_CHECKSUM_REQUIRED',
      'Checksum SHA-256 obrigatório ou inválido.',
    );
  }

  const actual = await sha256File(canonicalPath);
  const initialStat = fs.statSync(canonicalPath);
  if (checksum.toLowerCase() !== actual) {
    throw new DatabaseOperationSafetyError(
      'RESTORE_CHECKSUM_INVALID',
      'Checksum do arquivo de restauração inválido.',
    );
  }

  const pgRestore = findExecutable('pg_restore', env, resolveExecutable);
  await runProcess(
    pgRestore,
    ['--list', canonicalPath],
    {
      cwd: path.resolve(__dirname, '..'),
      env: sanitizedDatabaseProcessEnv(env),
      stdio: 'ignore',
      windowsHide: true,
    },
    spawnProcess,
  );
  const finalStat = fs.statSync(canonicalPath);
  if (
    finalStat.dev !== initialStat.dev ||
    finalStat.ino !== initialStat.ino ||
    (await sha256File(canonicalPath)) !== actual
  ) {
    throw new DatabaseOperationSafetyError(
      'RESTORE_ARCHIVE_CHANGED',
      'O arquivo mudou durante a validação.',
    );
  }
  return { archivePath: canonicalPath, checksum: actual };
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const env = dependencies.env ?? process.env;
  if (!dependencies.env) {
    dotenv.config({
      path: resolveBackendEnvPath(path.resolve(__dirname)),
      override: false,
    });
  }

  const args = parseArgs(argv);
  const target = validateLocalDatabaseEnvironment(env);
  const archivePath = canonicalArchivePath(args.archive);
  const sidecarPath = `${archivePath}.sha256`;
  const checksum =
    args.checksum ??
    (fs.existsSync(sidecarPath)
      ? parseSha256Sidecar(fs.readFileSync(sidecarPath, 'utf8'))
      : undefined);
  const spawnProcess = dependencies.spawn ?? spawn;
  const resolveExecutable = dependencies.resolveExecutable ??
    resolveApprovedDatabaseExecutable;

  if (args.mode === 'validate') {
    return validateRestoreArchive({
      archivePath,
      checksum,
      env,
      spawnProcess,
      resolveExecutable,
    });
  }

  if (!checksum || !/^[a-fA-F0-9]{64}$/.test(checksum)) {
    throw new DatabaseOperationSafetyError(
      'RESTORE_CHECKSUM_REQUIRED',
      'Checksum SHA-256 obrigatório para restauração.',
    );
  }
  if (
    args.confirmDestination !== target.database ||
    args.confirmRestore !== 'RESTORE'
  ) {
    throw new DatabaseOperationSafetyError(
      'RESTORE_CONFIRMATION_MISSING',
      'Confirmação explícita de restauração ausente.',
    );
  }

  const backupDirectory = getApprovedBackupDirectory({
    repositoryDirectory: path.resolve(__dirname, '..', '..'),
  });
  const lock = acquireDatabaseOperationLock(backupDirectory);
  try {
    await validateRestoreArchive({
      archivePath,
      checksum,
      env,
      spawnProcess,
      resolveExecutable,
    });
    throw new DatabaseOperationSafetyError(
      'RESTORE_ISOLATION_REQUIRED',
      'Restauração real bloqueada até existir validação em banco temporário isolado.',
    );
  } finally {
    lock.release();
  }
}

if (require.main === module) {
  main().then((result) => {
    process.stdout.write(
      `RESTAURAÇÃO_VALIDADA arquivo=${path.basename(result.archivePath)} modo=validacao\n`,
    );
  }).catch((error) => {
    const code = getSafeErrorCode(error);
    process.stderr.write(
      `Operação de restauração abortada [${code}]. Nenhum detalhe interno foi exibido.\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  canonicalArchivePath,
  sha256File,
  parseSha256Sidecar,
  validateRestoreArchive,
  main,
};
