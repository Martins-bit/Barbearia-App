const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const dotenv = require('dotenv');
const {
  DatabaseOperationSafetyError,
  resolveBackendEnvPath,
  validateLocalDatabaseEnvironment,
  sanitizedDatabaseProcessEnv,
  resolveApprovedDatabaseExecutable,
  getApprovedBackupDirectory,
  isPathWithinDirectory,
  acquireDatabaseOperationLock,
  getSafeErrorCode,
} = require('./database-operation-safety.cjs');

function parseArgs(argv) {
  const result = { mode: null };
  for (const arg of argv) {
    if (arg === '--backup') result.mode = 'backup';
    else if (arg === '--validate') result.mode = 'validate';
    else if (arg.startsWith('--archive=')) {
      result.archive = arg.slice('--archive='.length);
    } else if (arg.startsWith('--checksum=')) {
      result.checksum = arg.slice('--checksum='.length);
    } else if (arg.startsWith('--output=')) {
      result.output = arg.slice('--output='.length);
    } else {
      throw new DatabaseOperationSafetyError(
        'DATABASE_OPERATION_ARGUMENT_INVALID',
        'Argumento local não permitido.',
      );
    }
  }
  if (!result.mode) {
    throw new DatabaseOperationSafetyError(
      'DATABASE_OPERATION_MODE_MISSING',
      'Escolha backup ou validação.',
    );
  }
  return result;
}

function findExecutable(executable, env, resolver = resolveApprovedDatabaseExecutable) {
  return resolver(executable, env);
}

function fileIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function lstatIfExists(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertOwnedFile(filePath, identity) {
  const stat = lstatIfExists(filePath);
  if (
    !stat ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    !sameFileIdentity(fileIdentity(stat), identity)
  ) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_FILE_CHANGED',
      'Um arquivo de backup mudou durante a operação.',
    );
  }
}

function removeOwnedFile(filePath, identity) {
  const stat = lstatIfExists(filePath);
  if (
    stat &&
    !stat.isSymbolicLink() &&
    stat.isFile() &&
    sameFileIdentity(fileIdentity(stat), identity)
  ) {
    fs.unlinkSync(filePath);
  }
}

function canonicalBackupPath(outputArg, options = {}) {
  const backupDirectory = options.backupDirectory
    ? getApprovedBackupDirectory({
        backupRoot: options.backupDirectory,
        repositoryDirectory:
          options.repositoryDirectory ?? path.resolve(__dirname, '..', '..'),
      })
    : getApprovedBackupDirectory(options);
  const requestedPath = outputArg
    ? (path.isAbsolute(outputArg)
        ? path.resolve(outputArg)
        : path.resolve(backupDirectory, outputArg))
    : path.resolve(
        backupDirectory,
        `barbearia_app-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`,
      );

  if (!isPathWithinDirectory(backupDirectory, requestedPath)) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_OUTPUT_UNSAFE',
      'O caminho de backup deve permanecer no diretório aprovado.',
    );
  }

  const relativeParent = path.relative(
    backupDirectory,
    path.dirname(requestedPath),
  );
  const parentPath = relativeParent
    ? path.join(backupDirectory, relativeParent)
    : backupDirectory;
  const canonicalParent = getApprovedBackupDirectory({
    backupRoot: parentPath,
    repositoryDirectory:
      options.repositoryDirectory ?? path.resolve(__dirname, '..', '..'),
  });
  if (!isPathWithinDirectory(backupDirectory, canonicalParent)) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_OUTPUT_UNSAFE',
      'O caminho canônico de backup escapou do diretório aprovado.',
    );
  }

  const basename = path.basename(requestedPath);
  if (!basename || basename === '.' || basename === '..') {
    throw new DatabaseOperationSafetyError(
      'BACKUP_OUTPUT_UNSAFE',
      'O nome do arquivo de backup não é válido.',
    );
  }
  return path.join(canonicalParent, basename);
}

function restrictedOutputPath(outputArg, options = {}) {
  const backupDirectory = options.backupDirectory
    ? getApprovedBackupDirectory({
        backupRoot: options.backupDirectory,
        repositoryDirectory:
          options.repositoryDirectory ?? path.resolve(__dirname, '..', '..'),
      })
    : getApprovedBackupDirectory(options);
  return canonicalBackupPath(outputArg, {
    ...options,
    backupDirectory,
  });
}

function sanitizedExecutableEnv(env, target) {
  const childEnv = sanitizedDatabaseProcessEnv(env);
  childEnv.PGHOST = target.host;
  childEnv.PGPORT = String(target.port);
  childEnv.PGDATABASE = target.database;
  childEnv.PGUSER = target.username;
  childEnv.PGPASSWORD = target.password;
  return childEnv;
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
      'DATABASE_PROCESS_START_FAILED',
      'Não foi possível iniciar o processo PostgreSQL aprovado.',
    );
  }
  if (!child || typeof child.once !== 'function') {
    throw new DatabaseOperationSafetyError(
      'DATABASE_PROCESS_START_FAILED',
      'O processo PostgreSQL não retornou um resultado válido.',
    );
  }
  child.stderr?.resume();

  try {
    const result = await waitForChild(child);
    if (result.code !== 0 || result.signal) {
      throw new DatabaseOperationSafetyError(
        'DATABASE_PROCESS_FAILED',
        'O processo PostgreSQL não foi concluído com sucesso.',
      );
    }
  } catch (error) {
    if (typeof child.kill === 'function') child.kill();
    throw error instanceof DatabaseOperationSafetyError
      ? error
      : new DatabaseOperationSafetyError(
          'DATABASE_PROCESS_FAILED',
          'O processo PostgreSQL falhou.',
        );
  }
}

async function runPgDumpToFile({
  executable,
  outputPath,
  env,
  cwd,
  spawnProcess = spawn,
}) {
  const descriptor = fs.openSync(outputPath, 'wx', 0o600);
  const identity = fileIdentity(fs.fstatSync(descriptor));
  let output;
  let child;
  let stdoutPromise;
  let childPromise;

  try {
    output = fs.createWriteStream(outputPath, {
      fd: descriptor,
      autoClose: true,
    });
    child = spawnProcess(
      executable,
      ['--format=custom', '--no-owner', '--no-privileges'],
      {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    if (!child || typeof child.once !== 'function' || !child.stdout) {
      throw new Error('invalid child process');
    }
    child.stderr?.resume();
    stdoutPromise = pipeline(child.stdout, output);
    childPromise = waitForChild(child);
    const [result] = await Promise.all([childPromise, stdoutPromise]);
    if (result.code !== 0 || result.signal) {
      throw new Error('pg_dump failed');
    }
  } catch {
    if (child && typeof child.kill === 'function') child.kill();
    if (childPromise || stdoutPromise) {
      await Promise.allSettled([childPromise, stdoutPromise].filter(Boolean));
    }
    if (output) {
      if (!output.closed) {
        const closed = new Promise((resolve) => output.once('close', resolve));
        output.destroy();
        await closed;
      }
    } else {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    removeOwnedFile(outputPath, identity);
    throw new DatabaseOperationSafetyError(
      'BACKUP_FAILED',
      'O backup local não foi concluído.',
    );
  }

  assertOwnedFile(outputPath, identity);
  const stat = fs.statSync(outputPath);
  if (stat.size === 0) {
    removeOwnedFile(outputPath, identity);
    throw new DatabaseOperationSafetyError(
      'BACKUP_OUTPUT_INVALID',
      'O backup não produziu dados válidos.',
    );
  }
  return identity;
}

function writeExclusiveFile(filePath, content) {
  const descriptor = fs.openSync(filePath, 'wx', 0o600);
  const identity = fileIdentity(fs.fstatSync(descriptor));
  let failure;
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } catch (error) {
    failure = error;
  }
  try {
    fs.closeSync(descriptor);
  } catch (error) {
    failure ??= error;
  }
  if (failure) {
    removeOwnedFile(filePath, identity);
    throw failure;
  }
  return identity;
}

async function validateArchive({
  archivePath,
  checksum,
  env,
  target,
  spawnProcess = spawn,
  resolveExecutable = resolveApprovedDatabaseExecutable,
}) {
  const archiveStat = lstatIfExists(archivePath);
  if (!archiveStat || archiveStat.isSymbolicLink() || !archiveStat.isFile()) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_ARCHIVE_MISSING',
      'Arquivo de backup não encontrado ou não permitido.',
    );
  }
  const identity = fileIdentity(archiveStat);

  if (!checksum || !/^[a-fA-F0-9]{64}$/.test(checksum)) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_CHECKSUM_INVALID',
      'Checksum SHA-256 obrigatório ou inválido.',
    );
  }
  const actual = await sha256File(archivePath);
  if (checksum.toLowerCase() !== actual) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_CHECKSUM_INVALID',
      'Checksum do arquivo de backup inválido.',
    );
  }

  const pgRestore = findExecutable('pg_restore', env, resolveExecutable);
  await runProcess(
    pgRestore,
    ['--list', archivePath],
    {
      cwd: path.resolve(__dirname, '..'),
      env: sanitizedDatabaseProcessEnv(env),
      stdio: 'ignore',
      windowsHide: true,
    },
    spawnProcess,
  );

  assertOwnedFile(archivePath, identity);
  const finalChecksum = await sha256File(archivePath);
  if (finalChecksum !== actual) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_FILE_CHANGED',
      'O arquivo de backup mudou durante a validação.',
    );
  }
  return { archivePath, checksum: finalChecksum };
}

function parseSha256Sidecar(content) {
  const match =
    typeof content === 'string'
      ? content.trim().match(/^([a-fA-F0-9]{64})(?:\s+.*)?$/)
      : null;
  return match ? match[1].toLowerCase() : null;
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
  const repositoryDirectory =
    path.resolve(__dirname, '..', '..');
  const backupDirectory = getApprovedBackupDirectory({
    repositoryDirectory,
  });
  const spawnProcess = dependencies.spawn ?? spawn;
  const resolveExecutable = dependencies.resolveExecutable ??
    resolveApprovedDatabaseExecutable;

  if (args.mode === 'validate') {
    if (!args.archive) {
      throw new DatabaseOperationSafetyError(
        'BACKUP_ARCHIVE_MISSING',
        'Informe o arquivo de backup para validação.',
      );
    }
    const archivePath = fs.realpathSync(args.archive);
    const sidecarPath = `${archivePath}.sha256`;
    const checksum =
      args.checksum ??
      (fs.existsSync(sidecarPath)
        ? parseSha256Sidecar(fs.readFileSync(sidecarPath, 'utf8'))
        : null);
    if (!checksum) {
      throw new DatabaseOperationSafetyError(
        'BACKUP_CHECKSUM_MISSING',
        'Checksum SHA-256 obrigatório para validar o backup.',
      );
    }
    return validateArchive({
      archivePath,
      checksum,
      env,
      target,
      spawnProcess,
      resolveExecutable,
    });
  }

  const backupPath = restrictedOutputPath(args.output, {
    backupDirectory,
    repositoryDirectory,
  });
  const sidecarPath = `${backupPath}.sha256`;
  const lock = acquireDatabaseOperationLock(backupDirectory);
  let archiveIdentity;
  let sidecarIdentity;

  try {
    if (lstatIfExists(backupPath) || lstatIfExists(sidecarPath)) {
      throw new DatabaseOperationSafetyError(
        'BACKUP_FILE_EXISTS',
        'O arquivo ou checksum de backup já existe.',
      );
    }
    const pgDump = findExecutable('pg_dump', env, resolveExecutable);
    archiveIdentity = await runPgDumpToFile({
      executable: pgDump,
      outputPath: backupPath,
      env: sanitizedExecutableEnv(env, target),
      cwd: path.resolve(__dirname, '..'),
      spawnProcess,
    });

    const checksum = await sha256File(backupPath);
    sidecarIdentity = writeExclusiveFile(
      sidecarPath,
      `${checksum}  ${path.basename(backupPath)}\n`,
    );
    assertOwnedFile(backupPath, archiveIdentity);
    assertOwnedFile(sidecarPath, sidecarIdentity);
    await validateArchive({
      archivePath: backupPath,
      checksum,
      env,
      target,
      spawnProcess,
      resolveExecutable,
    });
    assertOwnedFile(backupPath, archiveIdentity);
    assertOwnedFile(sidecarPath, sidecarIdentity);
    if (
      fs.readFileSync(sidecarPath, 'utf8') !==
      `${checksum}  ${path.basename(backupPath)}\n`
    ) {
      throw new DatabaseOperationSafetyError(
        'BACKUP_FILE_CHANGED',
        'O checksum lateral mudou durante a validação.',
      );
    }

    return { archivePath: backupPath, checksum };
  } catch (error) {
    if (archiveIdentity) removeOwnedFile(backupPath, archiveIdentity);
    if (sidecarIdentity) removeOwnedFile(sidecarPath, sidecarIdentity);
    throw error;
  } finally {
    lock.release();
  }
}

if (require.main === module) {
  main().then((result) => {
    process.stdout.write(
      `BACKUP_OPERAÇÃO_CONCLUÍDA arquivo=${path.basename(result.archivePath)} checksum=${result.checksum}\n`,
    );
  }).catch((error) => {
    const code = getSafeErrorCode(error);
    process.stderr.write(
      `Operação de backup abortada [${code}]. Nenhum detalhe interno foi exibido.\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  restrictedOutputPath,
  sha256File,
  parseSha256Sidecar,
  validateArchive,
  runProcess,
  runPgDumpToFile,
  main,
};
