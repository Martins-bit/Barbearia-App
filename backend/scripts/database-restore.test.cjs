const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  parseArgs,
  canonicalArchivePath,
  validateRestoreArchive,
  main,
} = require('./database-restore.cjs');
const { DatabaseOperationSafetyError } = require('./database-operation-safety.cjs');

const VALID_ENV = {
  ALLOW_LOCAL_DATABASE_OPERATIONS: 'yes',
  LOCAL_DATABASE_NAME: 'barbearia_app',
  DATABASE_URL:
    'postgresql://restore_user:private-test-password@127.0.0.1:5432/barbearia_app',
};

function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'barbearia-restore-test-'));
}

function archiveSha(archive) {
  return crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
}

function makeChild({ code = 0, close = true } = {}) {
  const child = new EventEmitter();
  child.kill = () => true;
  child.stdout = { resume() {} };
  child.stderr = { resume() {} };
  if (close) process.nextTick(() => child.emit('close', code, null));
  return child;
}

function restoreArgs(archive, checksum) {
  return [
    '--restore',
    `--archive=${archive}`,
    `--checksum=${checksum}`,
    '--confirm-destination=barbearia_app',
    '--confirm-restore=RESTORE',
  ];
}

test('restore defaults to validation mode', () => {
  assert.equal(parseArgs([]).mode, 'validate');
  assert.equal(parseArgs(['--restore']).mode, 'restore');
});

test('archive paths are canonical absolute paths before pg_restore receives them', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, '--archive.dump');
  fs.writeFileSync(archive, 'mock restore archive');
  let capturedArgs;

  try {
    const canonical = canonicalArchivePath(archive);
    const result = await validateRestoreArchive({
      archivePath: archive,
      checksum: archiveSha(archive),
      env: VALID_ENV,
      resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
      spawnProcess: (_executable, args) => {
        capturedArgs = args;
        return makeChild();
      },
    });
    assert.equal(result.archivePath, canonical);
    assert.ok(path.isAbsolute(capturedArgs[1]));
    assert.equal(capturedArgs[1], canonical);
    assert.deepEqual(capturedArgs, ['--list', canonical]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('restore validation rejects missing, malformed, or mismatching checksums before process start', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'backup.dump');
  fs.writeFileSync(archive, 'mock restore archive');
  let spawnCount = 0;

  try {
    for (const checksum of [undefined, 'not-a-checksum', 'b'.repeat(64)]) {
      await assert.rejects(
        validateRestoreArchive({
          archivePath: archive,
          checksum,
          env: VALID_ENV,
          resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
          spawn: () => {
            spawnCount += 1;
            return makeChild();
          },
        }),
        DatabaseOperationSafetyError,
      );
    }
    assert.equal(spawnCount, 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('validation failure and truncated archive are rejected without database arguments', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'truncated.dump');
  fs.writeFileSync(archive, 'truncated archive bytes');
  let capturedArgs;

  try {
    await assert.rejects(
      validateRestoreArchive({
        archivePath: archive,
        checksum: archiveSha(archive),
        env: VALID_ENV,
        resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
        spawnProcess: (_executable, args) => {
          capturedArgs = args;
          return makeChild({ code: 1 });
        },
      }),
      DatabaseOperationSafetyError,
    );
    assert.deepEqual(capturedArgs, ['--list', archive]);
    assert.equal(capturedArgs.some((arg) => arg.startsWith('--dbname')), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('validation rejects an archive changed after its initial checksum', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'changing.dump');
  fs.writeFileSync(archive, 'original archive bytes');

  try {
    await assert.rejects(
      validateRestoreArchive({
        archivePath: archive,
        checksum: archiveSha(archive),
        env: VALID_ENV,
        resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
        spawnProcess: () => {
          fs.writeFileSync(archive, 'changed after checksum');
          return makeChild();
        },
      }),
      (error) =>
        error instanceof DatabaseOperationSafetyError &&
        error.code === 'RESTORE_ARCHIVE_CHANGED',
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('real restore remains blocked after checksum, confirmation, and archive validation', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'backup.dump');
  fs.writeFileSync(archive, 'mock restore archive');
  const backupDirectory = path.join(temporary, 'operations');
  let capturedArgs;

  try {
    await assert.rejects(
      main(restoreArgs(archive, archiveSha(archive)), {
        env: VALID_ENV,
        backupDirectory,
        repositoryDirectory: path.resolve(__dirname, '..', '..'),
        resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
        spawn: (_executable, args) => {
          capturedArgs = args;
          return makeChild();
        },
      }),
      (error) =>
        error instanceof DatabaseOperationSafetyError &&
        error.code === 'RESTORE_ISOLATION_REQUIRED',
    );
    assert.deepEqual(capturedArgs, ['--list', archive]);
    assert.equal(capturedArgs.some((arg) => arg.startsWith('--dbname')), false);
    assert.equal(capturedArgs.includes('--clean'), false);
    assert.equal(capturedArgs.includes('--if-exists'), false);
    assert.equal(
      fs.existsSync(path.join(backupDirectory, 'database-operation.lock')),
      false,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('real restore rejects absent confirmations and incorrect destination without spawning', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'backup.dump');
  fs.writeFileSync(archive, 'mock restore archive');
  const checksum = archiveSha(archive);
  let spawnCount = 0;

  try {
    for (const args of [
      ['--restore', `--archive=${archive}`, `--checksum=${checksum}`],
      [
        ...restoreArgs(archive, checksum).slice(0, -2),
        '--confirm-destination=barbearia_app_e2e',
        '--confirm-restore=RESTORE',
      ],
    ]) {
      await assert.rejects(
        main(args, {
          env: VALID_ENV,
          backupDirectory: path.join(temporary, 'operations'),
          repositoryDirectory: path.resolve(__dirname, '..', '..'),
          spawn: () => {
            spawnCount += 1;
            return makeChild();
          },
        }),
        DatabaseOperationSafetyError,
      );
    }
    assert.equal(spawnCount, 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('real restore rejects a missing or malformed checksum without starting a process', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'backup.dump');
  fs.writeFileSync(archive, 'mock restore archive');
  let spawnCount = 0;

  try {
    for (const args of [
      [
        '--restore',
        `--archive=${archive}`,
        '--confirm-destination=barbearia_app',
        '--confirm-restore=RESTORE',
      ],
      [
        ...restoreArgs(archive, 'invalid').slice(0, -2),
        '--confirm-destination=barbearia_app',
        '--confirm-restore=RESTORE',
      ],
    ]) {
      await assert.rejects(
        main(args, {
          env: VALID_ENV,
          backupDirectory: path.join(temporary, 'operations'),
          repositoryDirectory: path.resolve(__dirname, '..', '..'),
          spawn: () => {
            spawnCount += 1;
            return makeChild();
          },
        }),
        DatabaseOperationSafetyError,
      );
    }
    assert.equal(spawnCount, 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('restore validation error releases the operation lock', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'backup.dump');
  const backupDirectory = path.join(temporary, 'operations');
  fs.writeFileSync(archive, 'mock restore archive');

  try {
    await assert.rejects(
      main(restoreArgs(archive, archiveSha(archive)), {
        env: VALID_ENV,
        backupDirectory,
        repositoryDirectory: path.resolve(__dirname, '..', '..'),
        resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
        spawn: () => makeChild({ code: 1 }),
      }),
      DatabaseOperationSafetyError,
    );
    assert.equal(
      fs.existsSync(path.join(backupDirectory, 'database-operation.lock')),
      false,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('concurrent restore flows allow only one lock holder to start a child process', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'backup.dump');
  const backupDirectory = path.join(temporary, 'operations');
  fs.writeFileSync(archive, 'mock restore archive');
  let child;
  let spawnCount = 0;
  let markSpawnStarted;
  const spawnStarted = new Promise((resolve) => {
    markSpawnStarted = resolve;
  });
  const dependencies = {
    env: VALID_ENV,
    backupDirectory,
    repositoryDirectory: path.resolve(__dirname, '..', '..'),
    resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
    spawn: () => {
      spawnCount += 1;
      child = makeChild({ close: false });
      markSpawnStarted();
      return child;
    },
  };

  try {
    const first = main(restoreArgs(archive, archiveSha(archive)), dependencies);
    await spawnStarted;
    await assert.rejects(
      main(restoreArgs(archive, archiveSha(archive)), dependencies),
      (error) =>
        error instanceof DatabaseOperationSafetyError &&
        error.code === 'DATABASE_OPERATION_LOCKED',
    );
    assert.equal(spawnCount, 1);
    child.emit('close', 0, null);
    await assert.rejects(
      first,
      (error) =>
        error instanceof DatabaseOperationSafetyError &&
        error.code === 'RESTORE_ISOLATION_REQUIRED',
    );
    assert.equal(
      fs.existsSync(path.join(backupDirectory, 'database-operation.lock')),
      false,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('restore sidecar parser reads its first hexadecimal SHA-256 token', () => {
  const { parseSha256Sidecar } = require('./database-restore.cjs');
  assert.equal(
    parseSha256Sidecar(`${'a'.repeat(64)}  backup.dump`),
    'a'.repeat(64),
  );
  assert.equal(parseSha256Sidecar('invalid'), null);
});
