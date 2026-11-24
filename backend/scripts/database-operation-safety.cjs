const fs = require('node:fs');
const path = require('node:path');

const LOCAL_DATABASE_NAME = 'barbearia_app';
const ALLOWED_HOSTS = new Set(['127.0.0.1', '::1']);

class DatabaseOperationSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DatabaseOperationSafetyError';
    this.code = code;
  }
}

function resolveBackendEnvPath(scriptDirectory = __dirname) {
  const candidates =
    scriptDirectory.split(path.sep).includes('dist')
      ? [
          path.resolve(scriptDirectory, '..', '..', '.env'),
          path.resolve(scriptDirectory, '..', '.env'),
        ]
      : [
          path.resolve(scriptDirectory, '..', '.env'),
          path.resolve(scriptDirectory, '..', '..', '.env'),
        ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function validateLocalDatabaseEnvironment(env = process.env) {
  if (env.ALLOW_LOCAL_DATABASE_OPERATIONS !== 'yes') {
    throw new DatabaseOperationSafetyError(
      'LOCAL_DATABASE_OPERATIONS_NOT_AUTHORIZED',
      'Operação local de banco não autorizada.',
    );
  }

  const raw = typeof env.DATABASE_URL === 'string'
    ? env.DATABASE_URL.trim()
    : '';
  if (!raw) {
    throw new DatabaseOperationSafetyError(
      'DATABASE_URL_MISSING',
      'DATABASE_URL não está configurada.',
    );
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new DatabaseOperationSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL não é uma URL válida.',
    );
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new DatabaseOperationSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL deve usar PostgreSQL.',
    );
  }
  if (
    url.search ||
    url.hash ||
    raw.includes('?') ||
    raw.includes('#') ||
    raw.includes(',')
  ) {
    throw new DatabaseOperationSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL não pode conter parâmetros ou destinos múltiplos.',
    );
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!ALLOWED_HOSTS.has(host)) {
    throw new DatabaseOperationSafetyError(
      'DATABASE_DESTINATION_NOT_LOCAL',
      'O destino do banco não é local.',
    );
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim();
  const expectedDatabase = (
    env.LOCAL_DATABASE_NAME ?? LOCAL_DATABASE_NAME
  ).trim();
  if (!expectedDatabase || !/^[A-Za-z0-9_-]{1,63}$/.test(expectedDatabase)) {
    throw new DatabaseOperationSafetyError(
      'LOCAL_DATABASE_NAME_INVALID',
      'O nome local do banco não foi configurado corretamente.',
    );
  }
  if (database !== LOCAL_DATABASE_NAME || expectedDatabase !== LOCAL_DATABASE_NAME) {
    throw new DatabaseOperationSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'O banco efetivo não corresponde ao banco local aprovado.',
    );
  }

  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port !== 5432) {
    throw new DatabaseOperationSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'A porta do banco deve ser exatamente 5432.',
    );
  }

  return {
    host,
    port,
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function sanitizedDatabaseProcessEnv(env = process.env) {
  const sanitized = { ...env };
  for (const key of Object.keys(sanitized)) {
    if (
      /^(DATABASE(?:_[A-Z0-9_]*)?|DIRECT_URL|SHADOW_DATABASE_URL|POSTGRES(?:QL)?_[A-Z0-9_]*|DB_(?:URL|HOST|PORT|NAME|DATABASE|USER|PASSWORD)|PG[A-Z0-9_]*|PRISMA_[A-Z0-9_]*)$/i.test(
        key,
      )
    ) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

function getDatabaseExecutable(executable, env = process.env) {
  void env;
  if (!['pg_dump', 'pg_restore', 'psql'].includes(executable)) {
    throw new DatabaseOperationSafetyError(
      'DATABASE_TOOL_UNAUTHORIZED',
      'Executável PostgreSQL não autorizado.',
    );
  }
  const candidates =
    process.platform === 'win32'
      ? [
          path.resolve(
            'C:\\',
            'Program Files',
            'PostgreSQL',
            '17',
            'bin',
            `${executable}.exe`,
          ),
        ]
      : [
          path.resolve('/usr/lib/postgresql/17/bin', executable),
          path.resolve('/usr/bin', executable),
        ];
  return candidates;
}

function normalizedPathForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePath(left, right) {
  return normalizedPathForComparison(left) === normalizedPathForComparison(right);
}

function isPathWithinDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function ensureCanonicalDirectory(directory) {
  if (!path.isAbsolute(directory)) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_DIRECTORY_UNSAFE',
      'O diretório de backup deve ser absoluto.',
    );
  }
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      fs.mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }

    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new DatabaseOperationSafetyError(
        'BACKUP_DIRECTORY_UNSAFE',
        'O diretório de operação contém um componente não permitido.',
      );
    }

    const realPath = fs.realpathSync(current);
    if (!isSamePath(realPath, current)) {
      throw new DatabaseOperationSafetyError(
        'BACKUP_DIRECTORY_UNSAFE',
        'O diretório de operação não possui caminho canônico.',
      );
    }
  }

  return fs.realpathSync(absolute);
}

function getApprovedBackupDirectory({
  backupRoot,
  repositoryDirectory = path.resolve(__dirname, '..', '..'),
} = {}) {
  const canonicalRepository = fs.realpathSync(repositoryDirectory);
  const canonicalHome = fs.realpathSync(require('node:os').homedir());
  const requestedRoot =
    backupRoot ??
    path.join(canonicalHome, '.barbearia-app', 'backups');
  const canonicalRoot = ensureCanonicalDirectory(requestedRoot);

  if (isPathWithinDirectory(canonicalRepository, canonicalRoot)) {
    throw new DatabaseOperationSafetyError(
      'BACKUP_DIRECTORY_UNSAFE',
      'O diretório de backup deve ficar fora do repositório.',
    );
  }

  return canonicalRoot;
}

function acquireDatabaseOperationLock(directory) {
  const lockDirectory = ensureCanonicalDirectory(directory);
  const lockPath = path.join(lockDirectory, 'database-operation.lock');
  let descriptor;
  let identity;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
    const stat = fs.fstatSync(descriptor);
    identity = { dev: stat.dev, ino: stat.ino };
    fs.writeFileSync(descriptor, String(process.pid));
    fs.closeSync(descriptor);
    descriptor = undefined;

    let released = false;
    return {
      lockPath,
      release() {
        if (released) return;
        released = true;
        try {
          const current = fs.lstatSync(lockPath);
          if (
            !current.isSymbolicLink() &&
            current.dev === identity.dev &&
            current.ino === identity.ino
          ) {
            fs.unlinkSync(lockPath);
          }
        } catch (error) {
          if (!error || error.code !== 'ENOENT') throw error;
        }
      },
    };
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    if (identity) {
      try {
        const current = fs.lstatSync(lockPath);
        if (
          !current.isSymbolicLink() &&
          current.dev === identity.dev &&
          current.ino === identity.ino
        ) {
          fs.unlinkSync(lockPath);
        }
      } catch {}
    }
    if (error && error.code === 'EEXIST') {
      throw new DatabaseOperationSafetyError(
        'DATABASE_OPERATION_LOCKED',
        'Outra operação de banco local já está em andamento.',
      );
    }
    throw error;
  }
}

function resolveApprovedDatabaseExecutable(executable, env = process.env) {
  const candidates = getDatabaseExecutable(executable, env);
  const approvedDirectories =
    process.platform === 'win32'
      ? [path.resolve('C:\\', 'Program Files', 'PostgreSQL', '17', 'bin')]
      : ['/usr/lib/postgresql/17/bin', '/usr/bin', '/bin'];

  const canonicalApprovedDirectories = approvedDirectories.flatMap((directory) => {
    if (!fs.existsSync(directory)) return [];
    try {
      const canonicalDirectory = fs.realpathSync(directory);
      if (!isSamePath(canonicalDirectory, directory)) return [];
      return [canonicalDirectory];
    } catch {
      return [];
    }
  });

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    let resolved;
    try {
      resolved = fs.realpathSync(candidate);
    } catch {
      continue;
    }
    const normalized = path.resolve(resolved);
    const expectedName =
      process.platform === 'win32' ? `${executable}.exe` : executable;
    if (
      path.basename(normalized).toLowerCase() === expectedName.toLowerCase() &&
      canonicalApprovedDirectories.some((directory) =>
        isSamePath(path.dirname(normalized), directory),
      )
    ) {
      return normalized;
    }
  }
  throw new DatabaseOperationSafetyError(
    'DATABASE_TOOL_UNAUTHORIZED',
    `${executable} não está em um diretório PostgreSQL aprovado.`,
  );
}

function getSafeErrorCode(error) {
  if (error instanceof DatabaseOperationSafetyError) {
    return error.code;
  }
  return 'DATABASE_OPERATION_INTERNAL';
}

module.exports = {
  LOCAL_DATABASE_NAME,
  DatabaseOperationSafetyError,
  resolveBackendEnvPath,
  validateLocalDatabaseEnvironment,
  sanitizedDatabaseProcessEnv,
  getDatabaseExecutable,
  normalizedPathForComparison,
  isSamePath,
  isPathWithinDirectory,
  ensureCanonicalDirectory,
  getApprovedBackupDirectory,
  acquireDatabaseOperationLock,
  resolveApprovedDatabaseExecutable,
  getSafeErrorCode,
};
