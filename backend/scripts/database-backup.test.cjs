const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const {
  parseArgs,
  restrictedOutputPath,
  sha256File,
  parseSha256Sidecar,
  validateArchive,
  main,
} = require('./database-backup.cjs');
const {
  DatabaseOperationSafetyError,
  getDatabaseExecutable,
  isSamePath,
  validateLocalDatabaseEnvironment,
} = require('./database-operation-safety.cjs');

const VALID_ENV = {
  ALLOW_LOCAL_DATABASE_OPERATIONS: 'yes',
  LOCAL_DATABASE_NAME: 'barbearia_app',
  DATABASE_URL:
    'postgresql://backup_user:private-test-password@127.0.0.1:5432/barbearia_app',
};

function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'barbearia-backup-test-'));
}

function makeChild({ stdout = Buffer.alloc(0), code = 0, close = true } = {}) {
  const child = new EventEmitter();
  child.stdout =
    stdout instanceof Readable
      ? stdout
      : Readable.from(stdout.length ? [stdout] : []);
  child.stderr = Readable.from([]);
  child.kill = () => true;
  if (close) {
    process.nextTick(() => child.emit('close', code, null));
  }
  return child;
}

function removeTemporaryDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

async function withBackupHome(home, callback) {
  const originalHome = os.homedir;
  os.homedir = () => home;
  try {
    return await callback();
  } finally {
    os.homedir = originalHome;
  }
}

test('backup parser rejects unknown options', () => {
  assert.deepEqual(parseArgs(['--backup']), { mode: 'backup' });
  assert.throws(() => parseArgs(['--reset']), DatabaseOperationSafetyError);
});

test('backup paths are canonical and confined to an external approved directory', () => {
  const temporary = createTemporaryDirectory();
  const backupRoot = path.join(temporary, 'approved');
  const repositoryDirectory = path.resolve(__dirname, '..', '..');
  fs.mkdirSync(backupRoot);

  try {
    const output = restrictedOutputPath('nested/backup.dump', {
      backupDirectory: backupRoot,
      repositoryDirectory,
    });
    assert.equal(path.dirname(output), path.join(backupRoot, 'nested'));
    assert.throws(
      () =>
        restrictedOutputPath('../escape.dump', {
          backupDirectory: backupRoot,
          repositoryDirectory,
        }),
      DatabaseOperationSafetyError,
    );
    assert.throws(
      () =>
        restrictedOutputPath(path.join(temporary, 'outside.dump'), {
          backupDirectory: backupRoot,
          repositoryDirectory,
        }),
      DatabaseOperationSafetyError,
    );
    assert.throws(
      () =>
        restrictedOutputPath('inside.dump', {
          backupDirectory: repositoryDirectory,
          repositoryDirectory,
        }),
      DatabaseOperationSafetyError,
    );
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('backup path validation rejects a symlink or junction below the approved root', (t) => {
  const temporary = createTemporaryDirectory();
  const backupRoot = path.join(temporary, 'approved');
  const outside = path.join(temporary, 'outside');
  fs.mkdirSync(backupRoot);
  fs.mkdirSync(outside);
  try {
    try {
      fs.symlinkSync(
        outside,
        path.join(backupRoot, 'redirect'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (process.platform === 'win32') {
        t.skip(`junction indisponível neste ambiente: ${error.code}`);
        return;
      }
      throw error;
    }

    assert.throws(
      () =>
        restrictedOutputPath('redirect/backup.dump', {
          backupDirectory: backupRoot,
          repositoryDirectory: path.resolve(__dirname, '..', '..'),
        }),
      DatabaseOperationSafetyError,
    );
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('local database validation rejects remote destinations and routing parameters', () => {
  for (const url of [
    'postgresql://user:secret@remote.example:5432/barbearia_app',
    'postgresql://user:secret@127.0.0.1:5432/barbearia_app?host=remote.example',
    'postgresql://user:secret@127.0.0.1:5432/barbearia_app_e2e',
    'postgresql://user:secret@127.0.0.1:5433/barbearia_app',
  ]) {
    assert.throws(
      () =>
        validateLocalDatabaseEnvironment({
          ...VALID_ENV,
          DATABASE_URL: url,
        }),
      DatabaseOperationSafetyError,
    );
  }
});

test('backup destination validation uses a real pg_restore --list mock', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'backup.dump');
  fs.writeFileSync(archive, 'mock custom archive');
  const checksum = await sha256File(archive);
  let captured;

  try {
    const result = await validateArchive({
      archivePath: archive,
      checksum,
      env: VALID_ENV,
      target: { host: '127.0.0.1', port: 5432, database: 'barbearia_app' },
      resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
      spawnProcess: (executable, args, options) => {
        captured = { executable, args, options };
        return makeChild();
      },
    });
    assert.equal(result.checksum, checksum);
    assert.deepEqual(captured.args, ['--list', archive]);
    assert.equal(captured.options.env.DATABASE_URL, undefined);
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('main refuses existing dump and sidecar without starting pg_dump or changing either file', async () => {
  const temporary = createTemporaryDirectory();
  const backupRoot = path.join(temporary, '.barbearia-app', 'backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const archive = path.join(backupRoot, 'existing.dump');
  const sidecar = `${archive}.sha256`;
  const originalArchive = Buffer.from('original dump bytes');
  const originalSidecar = Buffer.from(`${'a'.repeat(64)}  existing.dump\n`);
  fs.writeFileSync(archive, originalArchive);
  fs.writeFileSync(sidecar, originalSidecar);
  let spawnCount = 0;

  try {
    await withBackupHome(temporary, async () => {
      await assert.rejects(
        main(['--backup', '--output=existing.dump'], {
          env: VALID_ENV,
          resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
          spawn: () => {
            spawnCount += 1;
            throw new Error('process must not start');
          },
        }),
        (error) =>
          error instanceof DatabaseOperationSafetyError &&
          error.code === 'BACKUP_FILE_EXISTS',
      );
      assert.equal(spawnCount, 0);
      assert.deepEqual(fs.readFileSync(archive), originalArchive);
      assert.deepEqual(fs.readFileSync(sidecar), originalSidecar);
      assert.equal(
        fs.existsSync(path.join(backupRoot, 'database-operation.lock')),
        false,
      );
    });
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('main streams pg_dump into an exclusive file and validates before success', async () => {
  const temporary = createTemporaryDirectory();
  const backupRoot = path.join(temporary, '.barbearia-app', 'backups');
  const archiveBytes = Buffer.from('mock custom archive streamed in chunks');
  const calls = [];

  try {
    await withBackupHome(temporary, async () => {
      const result = await main(['--backup', '--output=first.dump'], {
        env: VALID_ENV,
        resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
        spawn: (executable, args, options) => {
          calls.push({ executable, args, options });
          if (executable.endsWith('pg_dump.exe')) {
            return makeChild({ stdout: archiveBytes });
          }
          return makeChild();
        },
      });

      assert.equal(fs.readFileSync(result.archivePath).compare(archiveBytes), 0);
      assert.equal(
        fs.readFileSync(`${result.archivePath}.sha256`, 'utf8'),
        `${result.checksum}  first.dump\n`,
      );
      assert.deepEqual(calls[0].args, [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
      ]);
      assert.deepEqual(calls[1].args, ['--list', result.archivePath]);
      assert.equal(calls[0].options.env.PGPASSWORD, 'private-test-password');
      assert.equal(calls[0].args.join(' ').includes('private-test-password'), false);
      assert.equal(
        fs.existsSync(path.join(backupRoot, 'database-operation.lock')),
        false,
      );
    });
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('main removes only its partial dump when pg_dump fails', async () => {
  const temporary = createTemporaryDirectory();
  const backupRoot = path.join(temporary, '.barbearia-app', 'backups');
  let calls = 0;

  try {
    await withBackupHome(temporary, async () => {
      await assert.rejects(
        main(['--backup', '--output=failed.dump'], {
          env: VALID_ENV,
          resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
          spawn: () => {
            calls += 1;
            return makeChild({ stdout: Buffer.from('partial'), code: 1 });
          },
        }),
        DatabaseOperationSafetyError,
      );
      assert.equal(calls, 1);
      assert.equal(fs.existsSync(path.join(backupRoot, 'failed.dump')), false);
      assert.equal(fs.existsSync(path.join(backupRoot, 'failed.dump.sha256')), false);
      assert.equal(
        fs.existsSync(path.join(backupRoot, 'database-operation.lock')),
        false,
      );
    });
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('main cleans its exclusive partial file after a stream write failure', async () => {
  const temporary = createTemporaryDirectory();
  const backupRoot = path.join(temporary, '.barbearia-app', 'backups');
  const failingStdout = new Readable({
    read() {
      this.destroy(new Error('simulated stream write failure'));
    },
  });

  try {
    await withBackupHome(temporary, async () => {
      await assert.rejects(
        main(['--backup', '--output=write-error.dump'], {
          env: VALID_ENV,
          resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
          spawn: () => {
            const child = makeChild({ stdout: failingStdout, close: false });
            child.kill = () => {
              setImmediate(() => child.emit('close', 1, null));
              return true;
            };
            return child;
          },
        }),
        DatabaseOperationSafetyError,
      );
      assert.equal(fs.existsSync(path.join(backupRoot, 'write-error.dump')), false);
      assert.equal(
        fs.existsSync(path.join(backupRoot, 'database-operation.lock')),
        false,
      );
    });
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('main removes its new dump and sidecar if final archive validation fails', async () => {
  const temporary = createTemporaryDirectory();
  const backupRoot = path.join(temporary, '.barbearia-app', 'backups');
  let calls = 0;

  try {
    await withBackupHome(temporary, async () => {
      await assert.rejects(
        main(['--backup', '--output=invalid.dump'], {
          env: VALID_ENV,
          resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
          spawn: () => {
            calls += 1;
            return makeChild({
              stdout: Buffer.from('archive bytes'),
              code: calls === 1 ? 0 : 1,
            });
          },
        }),
        DatabaseOperationSafetyError,
      );
      assert.equal(calls, 2);
      assert.equal(fs.existsSync(path.join(backupRoot, 'invalid.dump')), false);
      assert.equal(
        fs.existsSync(path.join(backupRoot, 'invalid.dump.sha256')),
        false,
      );
    });
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('concurrent backup flows allow only one lock holder to start pg_dump', async () => {
  const temporary = createTemporaryDirectory();
  const backupRoot = path.join(temporary, '.barbearia-app', 'backups');
  let child;
  let spawnCount = 0;
  let markSpawnStarted;
  const spawnStarted = new Promise((resolve) => {
    markSpawnStarted = resolve;
  });
  const dependencies = {
    env: VALID_ENV,
    resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
    spawn: () => {
      spawnCount += 1;
      child = makeChild({ close: false });
      markSpawnStarted();
      return child;
    },
  };

  try {
    await withBackupHome(temporary, async () => {
      const first = main(['--backup', '--output=concurrent.dump'], dependencies);
      await spawnStarted;
      await assert.rejects(
        main(['--backup', '--output=second.dump'], dependencies),
        (error) =>
          error instanceof DatabaseOperationSafetyError &&
          error.code === 'DATABASE_OPERATION_LOCKED',
      );
      assert.equal(spawnCount, 1);
      child.emit('close', 0, null);
      await assert.rejects(first, DatabaseOperationSafetyError);
      assert.equal(
        fs.existsSync(path.join(backupRoot, 'database-operation.lock')),
        false,
      );
    });
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('executable resolution is absolute, allowlisted, and ignores PATH and PG_BIN_DIR', () => {
  const candidates = getDatabaseExecutable('pg_dump', {
    PATH: 'untrusted-path',
    PG_BIN_DIR: 'C:\\unapproved',
  });
  assert.ok(candidates.every(path.isAbsolute));
  assert.equal(candidates.some((candidate) => candidate === 'pg_dump'), false);
  assert.throws(
    () => getDatabaseExecutable('arbitrary-tool', {}),
    DatabaseOperationSafetyError,
  );
});

test('canonical executable directory comparison rejects a prefix-sharing sibling', () => {
  const approvedDirectory = path.resolve(
    os.tmpdir(),
    'PostgreSQL',
    '17',
    'bin',
  );
  const siblingDirectory = `${approvedDirectory}-untrusted`;
  assert.equal(isSamePath(approvedDirectory, approvedDirectory), true);
  assert.equal(isSamePath(approvedDirectory, siblingDirectory), false);
});

test('pg_restore --list rejects a truncated or invalid archive reported by the child process', async () => {
  const temporary = createTemporaryDirectory();
  const archive = path.join(temporary, 'truncated.dump');
  fs.writeFileSync(archive, Buffer.from('truncated archive bytes'));
  const checksum = await sha256File(archive);

  try {
    await assert.rejects(
      validateArchive({
        archivePath: archive,
        checksum,
        env: VALID_ENV,
        resolveExecutable: (name) => `C:\\approved\\${name}.exe`,
        spawnProcess: () => makeChild({ code: 1 }),
      }),
      DatabaseOperationSafetyError,
    );
  } finally {
    removeTemporaryDirectory(temporary);
  }
});

test('sidecar parser accepts the first hexadecimal SHA-256 token only', () => {
  assert.equal(
    parseSha256Sidecar(`${'a'.repeat(64)}  backup.dump`),
    'a'.repeat(64),
  );
  assert.equal(parseSha256Sidecar('invalid'), null);
  assert.equal(parseSha256Sidecar('g'.repeat(64)), null);
});
