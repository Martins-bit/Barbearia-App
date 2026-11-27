const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PRODUCTION_TARGET,
  serializeApprovalClaims,
  validateProductionEnvironment,
} = require('./production-first-install.cjs');
const { createApprovalToken } = require('./production-approval-signer.cjs');

const SESSION_POOLER_HOST = 'aws-0-us-east-1.pooler.supabase.com';
const SUPABASE_CA_PATH = path.join(
  __dirname,
  'fixtures',
  'supabase-prod-ca-2021.crt',
);
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PRIVATE_KEY_PEM = privateKey.export({
  format: 'pem',
  type: 'pkcs8',
});
const PUBLIC_KEY_PEM = publicKey.export({
  format: 'pem',
  type: 'spki',
});
const NOW = Math.floor(Date.now() / 1000);
const DIRECT_DATABASE_URL =
  `postgresql://postgres:unit-test-only@${PRODUCTION_TARGET.host}:5432/postgres` +
  '?schema=public&sslmode=require&sslaccept=strict';

function signerInput(overrides = {}) {
  return {
    connectionMode: 'direct',
    sessionPoolerHost: undefined,
    backupVerified: true,
    writersStopped: true,
    sessionPoolerValidated: false,
    sessionPoolerRiskAccepted: false,
    privateKeyPem: PRIVATE_KEY_PEM,
    publicKeyPem: PUBLIC_KEY_PEM,
    nowSeconds: NOW,
    ...overrides,
  };
}

function directEnvironment(token, overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: DIRECT_DATABASE_URL,
    NODE_EXTRA_CA_CERTS: SUPABASE_CA_PATH,
    PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: PUBLIC_KEY_PEM,
    PRODUCTION_MIGRATION_APPROVAL_TOKEN: token,
    ...overrides,
  };
}

function resignClaims(claims) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  );
  const signature = crypto
    .sign(null, Buffer.from(payload, 'ascii'), privateKey)
    .toString('base64url');
  return `${payload}.${signature}`;
}

test('signs canonical v3 claims accepted by the production verifier', () => {
  const token = createApprovalToken(signerInput());
  const verified = validateProductionEnvironment(
    directEnvironment(token),
    NOW,
  );
  const payload = JSON.parse(
    Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
  );

  assert.equal(verified.approval.connectionMode, 'direct');
  assert.deepEqual(Object.keys(payload), [
    'version',
    'audience',
    'projectRef',
    'connectionMode',
    'host',
    'port',
    'username',
    'database',
    'schema',
    'operatorHost',
    'operationId',
    'issuedAt',
    'expiresAt',
    'backupVerified',
    'writersStopped',
    'sessionPoolerValidated',
    'sessionPoolerRiskAccepted',
  ]);
  assert.equal(payload.version, 3);
  assert.equal(payload.audience, 'barbearia-app:production-first-install:v3');
  assert.equal(payload.operatorHost, os.hostname().toLowerCase());
  assert.equal(payload.expiresAt - payload.issuedAt, 240);
});

test('signs Session Pooler claims accepted only for the matching session endpoint', () => {
  const token = createApprovalToken(
    signerInput({
      connectionMode: 'session',
      sessionPoolerHost: SESSION_POOLER_HOST,
      sessionPoolerValidated: true,
      sessionPoolerRiskAccepted: false,
    }),
  );
  const verified = validateProductionEnvironment(
    {
      NODE_ENV: 'production',
      DATABASE_URL:
        `postgresql://postgres.${PRODUCTION_TARGET.projectRef}:unit-test-only@` +
        `${SESSION_POOLER_HOST}:5432/postgres` +
        '?schema=public&sslmode=require&sslaccept=strict',
      NODE_EXTRA_CA_CERTS: SUPABASE_CA_PATH,
      PRODUCTION_SESSION_POOLER_HOST: SESSION_POOLER_HOST,
      PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: PUBLIC_KEY_PEM,
      PRODUCTION_MIGRATION_APPROVAL_TOKEN: token,
    },
    NOW,
  );

  assert.equal(verified.approval.connectionMode, 'session');
  assert.equal(verified.approval.host, SESSION_POOLER_HOST);
  assert.equal(verified.approval.username, `postgres.${PRODUCTION_TARGET.projectRef}`);
  assert.equal(verified.approval.sessionPoolerValidated, true);
  assert.equal(verified.approval.sessionPoolerRiskAccepted, false);
});

test('signs explicit unvalidated Session Pooler risk acceptance without claiming validation', () => {
  const token = createApprovalToken(
    signerInput({
      connectionMode: 'session',
      sessionPoolerHost: SESSION_POOLER_HOST,
      sessionPoolerValidated: false,
      sessionPoolerRiskAccepted: true,
    }),
  );
  const verified = validateProductionEnvironment(
    {
      NODE_ENV: 'production',
      DATABASE_URL:
        `postgresql://postgres.${PRODUCTION_TARGET.projectRef}:unit-test-only@` +
        `${SESSION_POOLER_HOST}:5432/postgres` +
        '?schema=public&sslmode=require&sslaccept=strict',
      NODE_EXTRA_CA_CERTS: SUPABASE_CA_PATH,
      PRODUCTION_SESSION_POOLER_HOST: SESSION_POOLER_HOST,
      PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: PUBLIC_KEY_PEM,
      PRODUCTION_MIGRATION_APPROVAL_TOKEN: token,
    },
    NOW,
  );

  assert.equal(verified.approval.sessionPoolerValidated, false);
  assert.equal(verified.approval.sessionPoolerRiskAccepted, true);
  assert.equal(verified.approval.connectionMode, 'session');
  assert.equal(verified.approval.projectRef, PRODUCTION_TARGET.projectRef);
  assert.equal(verified.approval.host, SESSION_POOLER_HOST);
  assert.equal(verified.approval.port, 5432);
  assert.equal(
    verified.approval.username,
    `postgres.${PRODUCTION_TARGET.projectRef}`,
  );
  assert.equal(verified.approval.operatorHost, os.hostname().toLowerCase());
  assert.match(
    verified.approval.operationId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test('rejects a payload changed after signing', () => {
  const token = createApprovalToken(signerInput());
  const [encodedPayload, signature] = token.split('.');
  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  );
  payload.host = 'unexpected.example.invalid';
  const alteredToken = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;

  assert.throws(
    () =>
      validateProductionEnvironment(
        directEnvironment(alteredToken),
        NOW,
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
});

test('rejects a valid signature when the verifier has a different public key', () => {
  const token = createApprovalToken(signerInput());
  const unrelatedPair = crypto.generateKeyPairSync('ed25519');
  const unrelatedPublicKeyPem = unrelatedPair.publicKey.export({
    format: 'pem',
    type: 'spki',
  });

  assert.throws(
    () =>
      validateProductionEnvironment(
        directEnvironment(token, {
          PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY: unrelatedPublicKeyPem,
        }),
        NOW,
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
});

test('rejects an expired approval', () => {
  const token = createApprovalToken(signerInput());

  assert.throws(
    () => validateProductionEnvironment(directEnvironment(token), NOW + 241),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
});

test('rejects claims with a missing required field even when re-signed', () => {
  const token = createApprovalToken(signerInput());
  const claims = JSON.parse(
    Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
  );
  delete claims.sessionPoolerValidated;

  assert.throws(
    () =>
      validateProductionEnvironment(
        directEnvironment(resignClaims(claims)),
        NOW,
      ),
    { code: 'PRODUCTION_APPROVAL_INVALID' },
  );
});

test('rejects an endpoint different from the one in the signed approval', () => {
  const token = createApprovalToken(signerInput());

  assert.throws(
    () =>
      validateProductionEnvironment(
        directEnvironment(token, {
          DATABASE_URL:
            'postgresql://postgres:unit-test-only@other-project.supabase.co:5432/postgres' +
            '?schema=public&sslmode=require&sslaccept=strict',
        }),
        NOW,
      ),
    { code: 'PRODUCTION_TARGET_HOST_MISMATCH' },
  );
});

test('rejects a mismatched key pair and incomplete confirmations', () => {
  const unrelatedPair = crypto.generateKeyPairSync('ed25519');
  const unrelatedPrivateKeyPem = unrelatedPair.privateKey.export({
    format: 'pem',
    type: 'pkcs8',
  });

  assert.throws(
    () =>
      createApprovalToken(
        signerInput({ privateKeyPem: unrelatedPrivateKeyPem }),
      ),
    { code: 'APPROVAL_SIGNER_KEY_MISMATCH' },
  );
  assert.throws(
    () => createApprovalToken(signerInput({ backupVerified: false })),
    { code: 'APPROVAL_SIGNER_CONFIRMATION_REQUIRED' },
  );
  assert.throws(
    () => createApprovalToken(signerInput({ writersStopped: false })),
    { code: 'APPROVAL_SIGNER_CONFIRMATION_REQUIRED' },
  );
  assert.throws(
    () =>
      createApprovalToken(
        signerInput({
          sessionPoolerValidated: true,
          sessionPoolerRiskAccepted: true,
        }),
      ),
    { code: 'APPROVAL_SIGNER_SESSION_DISPOSITION_REQUIRED' },
  );
  assert.throws(
    () =>
      createApprovalToken(
        signerInput({
          connectionMode: 'session',
          sessionPoolerHost: SESSION_POOLER_HOST,
          sessionPoolerValidated: false,
          sessionPoolerRiskAccepted: false,
        }),
      ),
    { code: 'APPROVAL_SIGNER_SESSION_DISPOSITION_REQUIRED' },
  );
});

test('rejects a placeholder or malformed Session Pooler hostname', () => {
  assert.throws(
    () =>
      createApprovalToken(
        signerInput({
          connectionMode: 'session',
          sessionPoolerHost: 'aws-999-test-region.pooler.supabase.com',
          sessionPoolerValidated: true,
        }),
      ),
    { code: 'APPROVAL_SIGNER_TARGET_INVALID' },
  );
});

test('uses the install verifier canonical serializer for claims', () => {
  const token = createApprovalToken(signerInput());
  const payloadText = Buffer.from(token.split('.')[0], 'base64url').toString(
    'utf8',
  );
  const claims = JSON.parse(payloadText);

  assert.equal(serializeApprovalClaims(claims), payloadText);
});
