const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { Client } = require('pg');

const BACKEND_DIRECTORY = path.resolve(__dirname, '..');
const MIGRATIONS_DIRECTORY = path.join(
  BACKEND_DIRECTORY,
  'prisma',
  'migrations',
);
const MANIFEST_PATH = path.join(
  BACKEND_DIRECTORY,
  'prisma',
  'production-first-install.manifest.json',
);
const PRISMA_PATH = path.join(
  BACKEND_DIRECTORY,
  'node_modules',
  'prisma',
  'build',
  'index.js',
);
const PRISMA_CONFIG_PATH = path.join(
  BACKEND_DIRECTORY,
  'prisma.production.config.ts',
);
const EXPECTED_MIGRATION_COUNT = 17;
const PRODUCTION_TARGET = Object.freeze({
  projectRef: 'stxaxuzkivatxurubeus',
  host: 'db.stxaxuzkivatxurubeus.supabase.co',
  database: 'postgres',
  schema: 'public',
  port: 5432,
});
const APPROVAL_AUDIENCE = 'barbearia-app:production-first-install';
const APPROVAL_MAX_LIFETIME_SECONDS = 300;
const APPROVAL_CLOCK_SKEW_SECONDS = 30;
const APPROVAL_PUBLIC_KEY_ENV = 'PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY';
const APPROVAL_TOKEN_ENV = 'PRODUCTION_MIGRATION_APPROVAL_TOKEN';
const ADVISORY_LOCK_KEY = [1111634258, 1179200083];
const APPROVAL_CLAIM_KEYS = [
  'version',
  'audience',
  'projectRef',
  'host',
  'database',
  'schema',
  'operatorHost',
  'operationId',
  'issuedAt',
  'expiresAt',
  'backupVerified',
  'writersStopped',
];
const windowsAclAppliedDirectories = new Set();

class ProductionFirstInstallError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'ProductionFirstInstallError';
    this.code = code;
  }
}

function blocked(code, message, cause) {
  return new ProductionFirstInstallError(code, message, cause);
}

function safeDiagnosticCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_-]{1,32}$/i.test(value)
    ? value
    : 'UNKNOWN';
}

function serializeApprovalClaims(claims) {
  return JSON.stringify({
    version: claims.version,
    audience: claims.audience,
    projectRef: claims.projectRef,
    host: claims.host,
    database: claims.database,
    schema: claims.schema,
    operatorHost: claims.operatorHost,
    operationId: claims.operationId,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    backupVerified: claims.backupVerified,
    writersStopped: claims.writersStopped,
  });
}

function decodeBase64UrlSegment(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid base64url segment.');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new Error('Non-canonical base64url segment.');
  }
  return decoded;
}

function parseApprovalPublicKey(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw blocked(
      'PRODUCTION_APPROVAL_PUBLIC_KEY_REQUIRED',
      'A chave pública de aprovação não está configurada.',
    );
  }

  let publicKey;
  try {
    const trimmed = value.trim();
    if (trimmed.startsWith('-----BEGIN PUBLIC KEY-----')) {
      publicKey = crypto.createPublicKey(trimmed);
    } else {
      const compact = trimmed.replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
        throw new Error('Invalid public key encoding.');
      }
      const der = Buffer.from(compact, 'base64');
      if (der.toString('base64') !== compact) {
        throw new Error('Non-canonical public key encoding.');
      }
      publicKey = crypto.createPublicKey({
        key: der,
        format: 'der',
        type: 'spki',
      });
    }
  } catch {
    throw blocked(
      'PRODUCTION_APPROVAL_PUBLIC_KEY_INVALID',
      'A chave pública de aprovação não é válida.',
    );
  }

  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw blocked(
      'PRODUCTION_APPROVAL_PUBLIC_KEY_INVALID',
      'A chave pública de aprovação deve ser Ed25519.',
    );
  }
  return publicKey;
}

function verifyApprovalToken(env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const publicKey = parseApprovalPublicKey(env[APPROVAL_PUBLIC_KEY_ENV]);
  const token = env[APPROVAL_TOKEN_ENV];
  if (typeof token !== 'string' || token.length === 0 || token.length > 8192) {
    throw blocked(
      'PRODUCTION_APPROVAL_TOKEN_REQUIRED',
      'A autorização assinada da operação não foi fornecida.',
    );
  }

  const segments = token.split('.');
  if (segments.length !== 2) {
    throw blocked(
      'PRODUCTION_APPROVAL_INVALID',
      'A autorização assinada é inválida.',
    );
  }

  let payloadBytes;
  let signature;
  let claims;
  try {
    payloadBytes = decodeBase64UrlSegment(segments[0]);
    signature = decodeBase64UrlSegment(segments[1]);
    if (payloadBytes.length > 4096 || signature.length !== 64) {
      throw new Error('Invalid approval token size.');
    }
    const payloadText = payloadBytes.toString('utf8');
    if (!Buffer.from(payloadText, 'utf8').equals(payloadBytes)) {
      throw new Error('Invalid UTF-8 payload.');
    }
    claims = JSON.parse(payloadText);
    if (
      !claims ||
      typeof claims !== 'object' ||
      Array.isArray(claims) ||
      Object.keys(claims).length !== APPROVAL_CLAIM_KEYS.length ||
      Object.keys(claims).some((key) => !APPROVAL_CLAIM_KEYS.includes(key)) ||
      serializeApprovalClaims(claims) !== payloadText
    ) {
      throw new Error('Unexpected approval claims.');
    }
    if (
      !crypto.verify(
        null,
        Buffer.from(segments[0], 'ascii'),
        publicKey,
        signature,
      )
    ) {
      throw new Error('Invalid approval signature.');
    }
  } catch {
    throw blocked(
      'PRODUCTION_APPROVAL_INVALID',
      'A autorização assinada é inválida.',
    );
  }

  if (
    claims.version !== 1 ||
    claims.audience !== APPROVAL_AUDIENCE ||
    claims.projectRef !== PRODUCTION_TARGET.projectRef ||
    claims.host !== PRODUCTION_TARGET.host ||
    claims.database !== PRODUCTION_TARGET.database ||
    claims.schema !== PRODUCTION_TARGET.schema ||
    claims.operatorHost !== os.hostname().toLowerCase() ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      claims.operationId,
    ) ||
    !Number.isSafeInteger(claims.issuedAt) ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.issuedAt > nowSeconds + APPROVAL_CLOCK_SKEW_SECONDS ||
    claims.expiresAt <= nowSeconds ||
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt > APPROVAL_MAX_LIFETIME_SECONDS ||
    claims.backupVerified !== true ||
    claims.writersStopped !== true
  ) {
    throw blocked(
      'PRODUCTION_APPROVAL_INVALID',
      'A autorização não corresponde ao destino, prazo ou condições operacionais exigidos.',
    );
  }

  return claims;
}

function validateProductionTarget(env = process.env) {
  if (env.NODE_ENV !== 'production') {
    throw blocked(
      'PRODUCTION_ENVIRONMENT_REQUIRED',
      'O runner exige NODE_ENV=production.',
    );
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined) {
    throw blocked(
      'NODE_TLS_OVERRIDE_FORBIDDEN',
      'O runner recusa qualquer sobrescrita global da validação TLS do Node.js.',
    );
  }

  const rawDatabaseUrl =
    typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL : '';
  if (!rawDatabaseUrl) {
    throw blocked(
      'PRODUCTION_DATABASE_URL_MISSING',
      'DATABASE_URL não está configurada.',
    );
  }

  let url;
  try {
    url = new URL(rawDatabaseUrl);
  } catch (error) {
    throw blocked(
      'PRODUCTION_DATABASE_URL_INVALID',
      'DATABASE_URL não é uma URL PostgreSQL válida.',
      error,
    );
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw blocked(
      'PRODUCTION_DATABASE_URL_INVALID',
      'O destino deve usar PostgreSQL.',
    );
  }

  const actualHost = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (actualHost.endsWith('.pooler.supabase.com')) {
    throw blocked(
      'SESSION_POOLER_NOT_ALLOWED',
      'Migrations de primeira instalação exigem conexão direta; Session Pooler não é aceito.',
    );
  }
  if (actualHost !== PRODUCTION_TARGET.host) {
    throw blocked(
      'PRODUCTION_TARGET_HOST_MISMATCH',
      'O host da conexão não corresponde ao projeto de produção fixado no runner.',
    );
  }
  if (
    url.port !== String(PRODUCTION_TARGET.port) ||
    url.pathname !== `/${PRODUCTION_TARGET.database}`
  ) {
    throw blocked(
      'PRODUCTION_TARGET_MISMATCH',
      'A porta ou o banco da conexão não corresponde ao destino autorizado.',
    );
  }
  if (url.username !== 'postgres' || !url.password || url.hash) {
    throw blocked(
      'PRODUCTION_DATABASE_URL_INVALID',
      'A conexão direta exige usuário postgres e credenciais válidas.',
    );
  }

  const queryEntries = Array.from(url.searchParams.entries());
  if (
    queryEntries.length !== 3 ||
    url.searchParams.getAll('schema').length !== 1 ||
    url.searchParams.get('schema') !== PRODUCTION_TARGET.schema ||
    url.searchParams.getAll('sslmode').length !== 1 ||
    url.searchParams.get('sslmode') !== 'require' ||
    url.searchParams.getAll('sslaccept').length !== 1 ||
    url.searchParams.get('sslaccept') !== 'strict'
  ) {
    throw blocked(
      'PRODUCTION_DATABASE_URL_INVALID',
      'A URL deve especificar somente schema=public, sslmode=require e sslaccept=strict.',
    );
  }

  return {
    database: PRODUCTION_TARGET.database,
    databaseUrl: rawDatabaseUrl,
    host: PRODUCTION_TARGET.host,
    port: PRODUCTION_TARGET.port,
    projectRef: PRODUCTION_TARGET.projectRef,
    schema: PRODUCTION_TARGET.schema,
  };
}

function validateProductionEnvironment(
  env = process.env,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  return {
    ...validateProductionTarget(env),
    approval: verifyApprovalToken(env, nowSeconds),
  };
}

function defaultApprovalStateDirectory() {
  try {
    return path.join(
      fs.realpathSync(os.homedir()),
      '.barbearia-app-production-first-install',
      'consumed',
    );
  } catch {
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNAVAILABLE',
      'O diretório persistente de autorizações não está disponível.',
    );
  }
}

function applyWindowsLedgerAcl(directory) {
  if (windowsAclAppliedDirectories.has(directory)) {
    return;
  }

  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== 'string' || !path.win32.isAbsolute(systemRoot)) {
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNSAFE',
      'Não foi possível aplicar ACL privada ao ledger no Windows.',
    );
  }

  const system32 = path.win32.join(systemRoot, 'System32');
  const icaclsPath = path.win32.join(system32, 'icacls.exe');
  const whoamiPath = path.win32.join(system32, 'whoami.exe');
  if (!fs.existsSync(icaclsPath) || !fs.existsSync(whoamiPath)) {
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNSAFE',
      'Não foi possível aplicar ACL privada ao ledger no Windows.',
    );
  }

  const childEnv = {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: system32,
  };

  let operatorSid;
  try {
    const identity = execFileSync(whoamiPath, ['/user', '/fo', 'csv', '/nh'], {
      env: childEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 5000,
    });
    const match = identity.match(/"(S-1-[0-9-]+)"\s*$/m);
    if (!match) {
      throw new Error('Current Windows SID was not returned.');
    }
    operatorSid = match[1];
  } catch {
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNSAFE',
      'Não foi possível identificar o operador para proteger o ledger no Windows.',
    );
  }

  const applyAcl = (entryPath, isDirectory) => {
    const permissions = isDirectory ? '(OI)(CI)F' : 'F';
    try {
      execFileSync(icaclsPath, [entryPath, '/reset', '/Q'], {
        env: childEnv,
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5000,
      });
      execFileSync(
        icaclsPath,
        [
          entryPath,
          '/inheritance:r',
          '/grant:r',
          `*${operatorSid}:${permissions}`,
          `*S-1-5-18:${permissions}`,
          '/Q',
        ],
        {
          env: childEnv,
          stdio: 'ignore',
          windowsHide: true,
          timeout: 5000,
        },
      );
    } catch {
      throw blocked(
        'PRODUCTION_APPROVAL_STATE_UNSAFE',
        'Não foi possível aplicar ACL privada ao ledger no Windows.',
      );
    }
  };

  const applyAclRecursively = (entryPath) => {
    let stats;
    try {
      stats = fs.lstatSync(entryPath);
    } catch {
      throw blocked(
        'PRODUCTION_APPROVAL_STATE_UNSAFE',
        'Não foi possível verificar um objeto do ledger no Windows.',
      );
    }
    if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
      throw blocked(
        'PRODUCTION_APPROVAL_STATE_UNSAFE',
        'O ledger contém um objeto não permitido no Windows.',
      );
    }
    applyAcl(entryPath, stats.isDirectory());
    if (stats.isDirectory()) {
      let children;
      try {
        children = fs.readdirSync(entryPath);
      } catch {
        throw blocked(
          'PRODUCTION_APPROVAL_STATE_UNSAFE',
          'Não foi possível enumerar o ledger no Windows.',
        );
      }
      for (const child of children) {
        applyAclRecursively(path.join(entryPath, child));
      }
    }
  };

  applyAclRecursively(directory);
  windowsAclAppliedDirectories.add(directory);
}

function prepareApprovalStateDirectory(directory) {
  let homeDirectory;
  try {
    homeDirectory = fs.realpathSync(os.homedir());
  } catch {
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNAVAILABLE',
      'O diretório persistente de autorizações não está disponível.',
    );
  }

  const resolvedDirectory = path.resolve(directory);
  const relativeDirectory = path.relative(homeDirectory, resolvedDirectory);
  if (
    !relativeDirectory ||
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeDirectory)
  ) {
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNSAFE',
      'O ledger de autorizações deve ficar dentro do perfil persistente do operador.',
    );
  }

  let currentDirectory = homeDirectory;
  try {
    for (const segment of relativeDirectory.split(path.sep)) {
      currentDirectory = path.join(currentDirectory, segment);
      try {
        fs.mkdirSync(currentDirectory, { mode: 0o700 });
      } catch (error) {
        if (!error || error.code !== 'EEXIST') {
          throw error;
        }
      }

      const directoryStat = fs.lstatSync(currentDirectory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new Error('Unsafe approval state path.');
      }
      if (process.platform !== 'win32' && (directoryStat.mode & 0o077) !== 0) {
        throw new Error('Approval state permissions are too broad.');
      }
    }

    if (fs.realpathSync(resolvedDirectory) !== resolvedDirectory) {
      throw new Error('Approval state path resolves through a link.');
    }
  } catch {
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNSAFE',
      'O ledger de autorizações não tem caminho ou permissões seguros.',
    );
  }
  if (process.platform === 'win32') {
    applyWindowsLedgerAcl(resolvedDirectory);
  }
  return resolvedDirectory;
}

function consumeAuthorizationOnce(
  approval,
  stateDirectory = defaultApprovalStateDirectory(),
) {
  const safeDirectory = prepareApprovalStateDirectory(stateDirectory);
  const operationDigest = crypto
    .createHash('sha256')
    .update(approval.operationId, 'utf8')
    .digest('hex');
  const markerPath = path.join(safeDirectory, `${operationDigest}.consumed`);
  let descriptor;
  try {
    descriptor = fs.openSync(markerPath, 'wx', 0o600);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw blocked(
        'PRODUCTION_APPROVAL_ALREADY_CONSUMED',
        'Esta autorização já foi consumida e não pode ser reutilizada.',
      );
    }
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNAVAILABLE',
      'Não foi possível consumir a autorização de forma exclusiva.',
    );
  }

  let writeFailed = false;
  try {
    fs.writeSync(descriptor, 'consumed\n');
    fs.fsyncSync(descriptor);
  } catch {
    writeFailed = true;
  }
  try {
    fs.closeSync(descriptor);
  } catch {
    writeFailed = true;
  }
  if (writeFailed) {
    throw blocked(
      'PRODUCTION_APPROVAL_STATE_UNAVAILABLE',
      'Não foi possível persistir o consumo da autorização.',
    );
  }
}

function operationDigest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createRunnerLaunchProof(stateDirectory) {
  const safeDirectory = prepareApprovalStateDirectory(stateDirectory);
  const launchId = crypto.randomUUID();
  const proof = crypto.randomBytes(32).toString('base64url');
  const digest = operationDigest(launchId);
  const markerPath = path.join(safeDirectory, `launch-${digest}.proof`);
  let descriptor;
  try {
    descriptor = fs.openSync(markerPath, 'wx', 0o600);
  } catch {
    throw blocked(
      'PRODUCTION_RUNNER_PROOF_UNAVAILABLE',
      'Não foi possível criar a prova exclusiva de invocação do Prisma.',
    );
  }

  let writeFailed = false;
  try {
    fs.writeSync(descriptor, operationDigest(proof));
    fs.fsyncSync(descriptor);
  } catch {
    writeFailed = true;
  }
  try {
    fs.closeSync(descriptor);
  } catch {
    writeFailed = true;
  }
  if (writeFailed) {
    throw blocked(
      'PRODUCTION_RUNNER_PROOF_UNAVAILABLE',
      'Não foi possível persistir a prova exclusiva de invocação do Prisma.',
    );
  }

  return {
    PRODUCTION_MIGRATION_RUNNER_ACTIVE: launchId,
    PRODUCTION_MIGRATION_RUNNER_PROOF: proof,
    PRODUCTION_MIGRATION_RUNNER_STATE_DIRECTORY: safeDirectory,
  };
}

function consumeRunnerLaunchProof(env) {
  const launchId = env.PRODUCTION_MIGRATION_RUNNER_ACTIVE;
  const proof = env.PRODUCTION_MIGRATION_RUNNER_PROOF;
  const stateDirectory = env.PRODUCTION_MIGRATION_RUNNER_STATE_DIRECTORY;
  if (
    typeof launchId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      launchId,
    ) ||
    typeof proof !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
    typeof stateDirectory !== 'string' ||
    stateDirectory.length === 0
  ) {
    throw blocked(
      'PRODUCTION_CONFIG_RUNNER_REQUIRED',
      'Use exclusivamente o runner protegido de primeira instalação.',
    );
  }

  const safeDirectory = prepareApprovalStateDirectory(stateDirectory);
  const launchDigest = operationDigest(launchId);
  const markerPath = path.join(safeDirectory, `launch-${launchDigest}.proof`);
  const consumedPath = path.join(
    safeDirectory,
    `launch-${launchDigest}.claimed`,
  );
  let expectedDigest;
  let storedDigest;
  try {
    expectedDigest = Buffer.from(operationDigest(proof), 'hex');
    storedDigest = Buffer.from(fs.readFileSync(markerPath, 'utf8'), 'hex');
  } catch {
    throw blocked(
      'PRODUCTION_CONFIG_RUNNER_REQUIRED',
      'A prova exclusiva do runner está ausente ou inválida.',
    );
  }
  if (
    expectedDigest.length !== storedDigest.length ||
    !crypto.timingSafeEqual(expectedDigest, storedDigest)
  ) {
    throw blocked(
      'PRODUCTION_CONFIG_RUNNER_REQUIRED',
      'A prova exclusiva do runner está ausente ou inválida.',
    );
  }

  let descriptor;
  try {
    descriptor = fs.openSync(consumedPath, 'wx', 0o600);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw blocked(
        'PRODUCTION_RUNNER_PROOF_REPLAYED',
        'A prova de invocação do Prisma já foi consumida.',
      );
    }
    throw blocked(
      'PRODUCTION_RUNNER_PROOF_UNAVAILABLE',
      'Não foi possível consumir a prova exclusiva do runner.',
    );
  }

  let writeFailed = false;
  try {
    fs.writeSync(descriptor, 'claimed\n');
    fs.fsyncSync(descriptor);
  } catch {
    writeFailed = true;
  }
  try {
    fs.closeSync(descriptor);
  } catch {
    writeFailed = true;
  }
  if (writeFailed) {
    throw blocked(
      'PRODUCTION_RUNNER_PROOF_UNAVAILABLE',
      'Não foi possível persistir o consumo da prova exclusiva do runner.',
    );
  }
}

function assertProductionConfigInvocation(
  argv = process.argv,
  env = process.env,
) {
  const migrateIndex = argv.findIndex((argument) => argument === 'migrate');
  const configIndex = argv.findIndex((argument) => argument === '--config');
  const suppliedConfig = configIndex >= 0 ? argv[configIndex + 1] : undefined;
  const expectedConfig = path.resolve(PRISMA_CONFIG_PATH);
  const commandArguments = migrateIndex >= 0 ? argv.slice(migrateIndex) : [];

  if (
    migrateIndex < 0 ||
    commandArguments.length !== 4 ||
    commandArguments[1] !== 'deploy' ||
    commandArguments[2] !== '--config' ||
    configIndex < 0 ||
    !suppliedConfig ||
    path.resolve(suppliedConfig) !== expectedConfig
  ) {
    throw blocked(
      'PRODUCTION_CONFIG_RUNNER_REQUIRED',
      'Use exclusivamente o runner protegido de primeira instalação.',
    );
  }

  validateProductionTarget(env);
  consumeRunnerLaunchProof(env);
}

function readAndVerifyMigrationManifest({
  migrationsDirectory = MIGRATIONS_DIRECTORY,
  manifestPath = MANIFEST_PATH,
} = {}) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw blocked(
      'MIGRATION_MANIFEST_INVALID',
      'O manifesto versionado de migrations não pôde ser lido.',
      error,
    );
  }

  if (
    manifest.version !== 1 ||
    manifest.provider !== 'postgresql' ||
    !Array.isArray(manifest.migrations) ||
    manifest.migrations.length !== EXPECTED_MIGRATION_COUNT
  ) {
    throw blocked(
      'MIGRATION_MANIFEST_INVALID',
      'O manifesto não corresponde à sequência aprovada de migrations PostgreSQL.',
    );
  }

  const names = manifest.migrations.map((migration) => migration.name);
  const sortedNames = [...names].sort();
  if (
    new Set(names).size !== names.length ||
    names.some(
      (name, index) =>
        !/^\d{14}_[a-z0-9_]+$/.test(name) || name !== sortedNames[index],
    ) ||
    manifest.migrations.some(
      (migration) => !/^[a-f0-9]{64}$/.test(migration.sha256),
    )
  ) {
    throw blocked(
      'MIGRATION_MANIFEST_INVALID',
      'A sequência ou os checksums do manifesto são inválidos.',
    );
  }

  let directoryEntries;
  try {
    directoryEntries = fs
      .readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    throw blocked(
      'MIGRATION_DIRECTORY_INVALID',
      'A pasta versionada de migrations não pôde ser lida.',
      error,
    );
  }

  if (
    directoryEntries.length !== names.length ||
    directoryEntries.some((name, index) => name !== names[index])
  ) {
    throw blocked(
      'MIGRATION_SEQUENCE_MISMATCH',
      'A sequência local de migrations difere do manifesto aprovado.',
    );
  }

  const lockPath = path.join(migrationsDirectory, 'migration_lock.toml');
  let migrationLock;
  try {
    migrationLock = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    throw blocked(
      'MIGRATION_PROVIDER_INVALID',
      'O arquivo migration_lock.toml está ausente ou ilegível.',
      error,
    );
  }
  if (!/^\s*provider\s*=\s*"postgresql"\s*$/m.test(migrationLock)) {
    throw blocked(
      'MIGRATION_PROVIDER_INVALID',
      'O provider de migrations não é PostgreSQL.',
    );
  }

  for (const migration of manifest.migrations) {
    const sqlPath = path.join(
      migrationsDirectory,
      migration.name,
      'migration.sql',
    );
    let sql;
    try {
      sql = fs.readFileSync(sqlPath);
    } catch (error) {
      throw blocked(
        'MIGRATION_FILE_MISSING',
        'Um arquivo migration.sql aprovado está ausente ou ilegível.',
        error,
      );
    }
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    if (checksum !== migration.sha256) {
      throw blocked(
        'MIGRATION_CHECKSUM_MISMATCH',
        'Um arquivo de migration difere do conteúdo revisado.',
      );
    }
  }

  return manifest.migrations;
}

function sanitizedDatabaseEnvironment(env, config, launchProof) {
  const childEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: config.databaseUrl,
    ...launchProof,
    PATH: path.dirname(process.execPath),
  };
  const runtimeVariables =
    process.platform === 'win32'
      ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']
      : ['HOME', 'TMPDIR', 'LANG', 'LC_ALL'];
  for (const key of runtimeVariables) {
    if (typeof env[key] === 'string') {
      childEnv[key] = env[key];
    }
  }

  if (process.platform === 'win32' && typeof env.SystemRoot === 'string') {
    childEnv.PATH = [
      path.dirname(process.execPath),
      path.join(env.SystemRoot, 'System32'),
    ].join(path.delimiter);
  }
  return childEnv;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function assertDatabaseIdentityAndTls(client, config) {
  await client.query('SET search_path TO "public"');
  const identity = await client.query(
    'SELECT current_database() AS database, current_schema() AS schema',
  );
  const row = identity.rows && identity.rows[0];
  if (
    !row ||
    row.database !== config.database ||
    row.schema !== config.schema
  ) {
    throw blocked(
      'PRODUCTION_DATABASE_IDENTITY_MISMATCH',
      'O banco ou schema efetivo não corresponde ao destino autorizado.',
    );
  }

  const tls = await client.query(
    'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
  );
  if (!tls.rows || !tls.rows[0] || tls.rows[0].ssl !== true) {
    throw blocked(
      'PRODUCTION_TLS_REQUIRED',
      'A conexão PostgreSQL não confirmou TLS.',
    );
  }
}

async function acquireFirstInstallLock(client) {
  await client.query(
    'SELECT pg_advisory_lock($1::integer, $2::integer)',
    ADVISORY_LOCK_KEY,
  );
}

async function assertTargetIsEmpty(client, schema) {
  const history = await client.query(
    `SELECT n.nspname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = '_prisma_migrations'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      LIMIT 1`,
  );
  if (history.rows && history.rows.length > 0) {
    throw blocked(
      'PRISMA_MIGRATION_HISTORY_EXISTS',
      'O destino já contém histórico Prisma; primeira instalação recusada.',
    );
  }

  const objects = await client.query(
    `SELECT count(*)::integer AS count
       FROM (
         SELECT c.oid
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT t.oid
           FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = $1
            AND t.typtype IN ('e', 'd', 'c', 'r', 'm')
         UNION ALL
         SELECT p.oid
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT o.oid
           FROM pg_operator o
           JOIN pg_namespace n ON n.oid = o.oprnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT c.oid
           FROM pg_collation c
           JOIN pg_namespace n ON n.oid = c.collnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT c.oid
           FROM pg_conversion c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT o.oid
           FROM pg_opclass o
           JOIN pg_namespace n ON n.oid = o.opcnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT o.oid
           FROM pg_opfamily o
           JOIN pg_namespace n ON n.oid = o.opfnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT t.oid
           FROM pg_ts_config t
           JOIN pg_namespace n ON n.oid = t.cfgnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT t.oid
           FROM pg_ts_dict t
           JOIN pg_namespace n ON n.oid = t.dictnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT t.oid
           FROM pg_ts_parser t
           JOIN pg_namespace n ON n.oid = t.prsnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT t.oid
           FROM pg_ts_template t
           JOIN pg_namespace n ON n.oid = t.tmplnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT s.oid
           FROM pg_statistic_ext s
           JOIN pg_namespace n ON n.oid = s.stxnamespace
          WHERE n.nspname = $1
         UNION ALL
         SELECT d.oid
           FROM pg_default_acl d
           JOIN pg_namespace n ON n.oid = d.defaclnamespace
          WHERE n.nspname = $1
       ) AS existing_objects`,
    [schema],
  );
  if (!objects.rows || Number(objects.rows[0].count) !== 0) {
    throw blocked(
      'PRODUCTION_SCHEMA_NOT_EMPTY',
      'O schema public já contém objetos; primeira instalação recusada.',
    );
  }
}

async function assertMigrationHistoryAndEmptyTables(
  client,
  migrations,
  schema,
) {
  const history = await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at
       FROM ${quoteIdentifier(schema)}."_prisma_migrations"
      ORDER BY migration_name`,
  );
  if (!history.rows || history.rows.length !== migrations.length) {
    throw blocked(
      'MIGRATION_HISTORY_INCOMPLETE',
      'O histórico final não contém a sequência completa de migrations.',
    );
  }

  for (const [index, migration] of migrations.entries()) {
    const applied = history.rows[index];
    if (
      applied.migration_name !== migration.name ||
      applied.checksum !== migration.sha256 ||
      !applied.finished_at ||
      applied.rolled_back_at
    ) {
      throw blocked(
        'MIGRATION_HISTORY_INVALID',
        'O histórico final difere da sequência aprovada ou contém falhas.',
      );
    }
  }

  const tables = await client.query(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p')
        AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname`,
    [schema],
  );
  for (const { relname } of tables.rows || []) {
    const result = await client.query(
      `SELECT EXISTS (SELECT 1 FROM ${quoteIdentifier(schema)}.${quoteIdentifier(relname)} LIMIT 1) AS has_rows`,
    );
    if (result.rows && result.rows[0] && result.rows[0].has_rows === true) {
      throw blocked(
        'PRODUCTION_SCHEMA_CONTAINS_DATA',
        'Foram detectados dados após a primeira instalação; revisão manual obrigatória.',
      );
    }
  }
}

function createPostgresClient(
  config,
  clientFactory = (options) => new Client(options),
) {
  const connectionUrl = new URL(config.databaseUrl);
  connectionUrl.searchParams.delete('schema');
  connectionUrl.searchParams.delete('sslmode');
  connectionUrl.searchParams.delete('sslaccept');
  return clientFactory({
    connectionString: connectionUrl.toString(),
    ssl: {
      rejectUnauthorized: true,
      servername: config.host,
    },
    connectionTimeoutMillis: 10000,
    application_name: 'barbearia-app-first-install',
  });
}

function makeChildInvocation(
  config,
  env,
  spawn = spawnSync,
  authorizationStateDirectory = defaultApprovalStateDirectory(),
) {
  if (!fs.existsSync(PRISMA_PATH) || !fs.existsSync(PRISMA_CONFIG_PATH)) {
    throw blocked(
      'PRISMA_INSTALLATION_MISSING',
      'Prisma CLI ou configuração exclusiva de produção está ausente.',
    );
  }

  const launchProof = createRunnerLaunchProof(authorizationStateDirectory);
  const args = [
    PRISMA_PATH,
    'migrate',
    'deploy',
    '--config',
    PRISMA_CONFIG_PATH,
  ];
  const result = spawn(process.execPath, args, {
    cwd: BACKEND_DIRECTORY,
    env: sanitizedDatabaseEnvironment(env, config, launchProof),
    stdio: 'ignore',
  });

  if (result.error) {
    throw blocked(
      'PRISMA_START_FAILED',
      'Não foi possível iniciar Prisma migrate deploy.',
      result.error,
    );
  }
  if (result.status !== 0) {
    const status = Number.isInteger(result.status)
      ? String(result.status)
      : 'unknown';
    const signal = safeDiagnosticCode(result.signal);
    throw blocked(
      'PRISMA_MIGRATION_FAILED',
      `Prisma migrate deploy falhou [status=${status}, signal=${signal}].`,
    );
  }
}

async function runProductionFirstInstall({
  env = process.env,
  argv = [],
  clientFactory,
  spawn = spawnSync,
  authorizationStateDirectory,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  if (argv.length > 0) {
    throw blocked(
      'PRODUCTION_ARGUMENTS_NOT_ALLOWED',
      'O runner não aceita argumentos adicionais.',
    );
  }

  const config = validateProductionEnvironment(env);
  const migrations = readAndVerifyMigrationManifest();
  const safeAuthorizationStateDirectory = prepareApprovalStateDirectory(
    authorizationStateDirectory || defaultApprovalStateDirectory(),
  );
  consumeAuthorizationOnce(config.approval, safeAuthorizationStateDirectory);
  log('A autorização desta operação foi consumida.');
  const client = createPostgresClient(config, clientFactory);
  let connected = false;
  let lockAcquired = false;
  let operationError;
  let closeError;

  try {
    await client.connect();
    connected = true;
    await assertDatabaseIdentityAndTls(client, config);
    await acquireFirstInstallLock(client);
    lockAcquired = true;
    await assertTargetIsEmpty(client, config.schema);
    log('Preflight de primeira instalação concluído.');

    log('Iniciando Prisma migrate deploy.');
    makeChildInvocation(config, env, spawn, safeAuthorizationStateDirectory);
    log('Prisma migrate deploy concluído.');
    await assertMigrationHistoryAndEmptyTables(
      client,
      migrations,
      config.schema,
    );
  } catch (error) {
    operationError =
      error instanceof ProductionFirstInstallError
        ? error
        : blocked(
            connected
              ? 'PRODUCTION_FIRST_INSTALL_FAILED'
              : 'PRODUCTION_PREFLIGHT_CONNECTION_FAILED',
            `A primeira instalação foi abortada [${safeDiagnosticCode(error && error.code)}].`,
            error,
          );
  } finally {
    if (connected && lockAcquired) {
      try {
        await client.query(
          'SELECT pg_advisory_unlock($1::integer, $2::integer)',
          ADVISORY_LOCK_KEY,
        );
      } catch {
        log(
          'Aviso: o lock advisory deste runner não foi liberado explicitamente; o fechamento da sessão deve liberá-lo.',
        );
      }
    }

    try {
      await client.end();
    } catch (error) {
      closeError = error;
    }
  }

  if (operationError) {
    if (closeError) {
      log(
        `Aviso: falha secundária ao fechar a conexão [${safeDiagnosticCode(closeError.code)}].`,
      );
    }
    throw operationError;
  }
  if (closeError) {
    throw blocked(
      'PRODUCTION_PREFLIGHT_CLOSE_FAILED',
      `A conexão de preflight não pôde ser encerrada [${safeDiagnosticCode(closeError.code)}].`,
      closeError,
    );
  }

  log('Primeira instalação concluída; histórico e schema vazio verificados.');
  return 0;
}

if (require.main === module) {
  runProductionFirstInstall({ argv: process.argv.slice(2) }).catch((error) => {
    const code = safeDiagnosticCode(error && error.code);
    const message =
      error instanceof ProductionFirstInstallError
        ? error.message
        : `A primeira instalação foi abortada [${code}].`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_MIGRATION_COUNT,
  PRODUCTION_TARGET,
  ProductionFirstInstallError,
  assertDatabaseIdentityAndTls,
  assertMigrationHistoryAndEmptyTables,
  assertProductionConfigInvocation,
  assertTargetIsEmpty,
  consumeAuthorizationOnce,
  createPostgresClient,
  readAndVerifyMigrationManifest,
  runProductionFirstInstall,
  safeDiagnosticCode,
  serializeApprovalClaims,
  sanitizedDatabaseEnvironment,
  validateProductionEnvironment,
  validateProductionTarget,
  verifyApprovalToken,
};
