const crypto = require('node:crypto');
const os = require('node:os');
const {
  PRODUCTION_TARGET,
  serializeApprovalClaims,
} = require('./production-first-install.cjs');

const APPROVAL_AUDIENCE = 'barbearia-app:production-first-install:v3';
const APPROVAL_LIFETIME_SECONDS = 240;
const SESSION_POOLER_HOST_PATTERN =
  /^aws-\d+-[a-z]{2}(?:-[a-z0-9]+)+-\d+\.pooler\.supabase\.com$/;

function signingError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function getTarget(connectionMode, sessionPoolerHost) {
  if (connectionMode === 'direct') {
    return {
      connectionMode,
      host: PRODUCTION_TARGET.host,
      port: PRODUCTION_TARGET.port,
      username: 'postgres',
    };
  }

  if (
    connectionMode !== 'session' ||
    typeof sessionPoolerHost !== 'string' ||
    !SESSION_POOLER_HOST_PATTERN.test(sessionPoolerHost)
  ) {
    throw signingError('APPROVAL_SIGNER_TARGET_INVALID');
  }

  return {
    connectionMode,
    host: sessionPoolerHost,
    port: PRODUCTION_TARGET.port,
    username: `postgres.${PRODUCTION_TARGET.projectRef}`,
  };
}

function loadMatchingEd25519Keys(privateKeyPem, publicKeyPem) {
  let privateKey;
  let publicKey;
  try {
    privateKey = crypto.createPrivateKey(privateKeyPem);
    publicKey = crypto.createPublicKey(publicKeyPem);
  } catch {
    throw signingError('APPROVAL_SIGNER_KEY_INVALID');
  }

  if (
    privateKey.asymmetricKeyType !== 'ed25519' ||
    publicKey.asymmetricKeyType !== 'ed25519'
  ) {
    throw signingError('APPROVAL_SIGNER_KEY_INVALID');
  }

  const derivedPublicKey = crypto
    .createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' });
  const suppliedPublicKey = publicKey.export({
    format: 'der',
    type: 'spki',
  });
  if (!derivedPublicKey.equals(suppliedPublicKey)) {
    throw signingError('APPROVAL_SIGNER_KEY_MISMATCH');
  }

  return { privateKey, publicKey };
}

function createApprovalToken({
  connectionMode,
  sessionPoolerHost,
  backupVerified,
  writersStopped,
  sessionPoolerValidated,
  sessionPoolerRiskAccepted,
  privateKeyPem,
  publicKeyPem,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (
    backupVerified !== true ||
    writersStopped !== true ||
    !Number.isSafeInteger(nowSeconds)
  ) {
    throw signingError('APPROVAL_SIGNER_CONFIRMATION_REQUIRED');
  }

  if (
    (connectionMode === 'direct' &&
      (sessionPoolerValidated !== false || sessionPoolerRiskAccepted !== false)) ||
    (connectionMode === 'session' &&
      !(
        (sessionPoolerValidated === true && sessionPoolerRiskAccepted === false) ||
        (sessionPoolerValidated === false && sessionPoolerRiskAccepted === true)
      ))
  ) {
    throw signingError('APPROVAL_SIGNER_SESSION_DISPOSITION_REQUIRED');
  }

  const target = getTarget(connectionMode, sessionPoolerHost);
  const { privateKey, publicKey } = loadMatchingEd25519Keys(
    privateKeyPem,
    publicKeyPem,
  );
  const operatorHost = os.hostname().toLowerCase();
  if (!operatorHost) {
    throw signingError('APPROVAL_SIGNER_OPERATOR_INVALID');
  }

  const claims = {
    version: 3,
    audience: APPROVAL_AUDIENCE,
    projectRef: PRODUCTION_TARGET.projectRef,
    connectionMode: target.connectionMode,
    host: target.host,
    port: target.port,
    username: target.username,
    database: PRODUCTION_TARGET.database,
    schema: PRODUCTION_TARGET.schema,
    operatorHost,
    operationId: crypto.randomUUID(),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + APPROVAL_LIFETIME_SECONDS,
    backupVerified,
    writersStopped,
    sessionPoolerValidated,
    sessionPoolerRiskAccepted,
  };
  const payload = Buffer.from(serializeApprovalClaims(claims), 'utf8').toString(
    'base64url',
  );
  const signature = crypto
    .sign(null, Buffer.from(payload, 'ascii'), privateKey)
    .toString('base64url');
  const token = `${payload}.${signature}`;

  if (
    !crypto.verify(
      null,
      Buffer.from(payload, 'ascii'),
      publicKey,
      Buffer.from(signature, 'base64url'),
    )
  ) {
    throw signingError('APPROVAL_SIGNER_SELF_CHECK_FAILED');
  }

  return token;
}

module.exports = {
  APPROVAL_LIFETIME_SECONDS,
  createApprovalToken,
};
