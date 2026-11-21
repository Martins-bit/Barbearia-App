import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

export const PUSH_DATA_KEY_PROTECTION_PROVIDER = Symbol(
  'PUSH_DATA_KEY_PROTECTION_PROVIDER',
);
export const PUSH_FINGERPRINT_KEY_PROVIDER = Symbol(
  'PUSH_FINGERPRINT_KEY_PROVIDER',
);

export const PUSH_CRYPTO_FORMAT_VERSION = 1;

const AES_256_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const HMAC_SHA256_KEY_BYTES = 32;
const MAX_ENDPOINT_BYTES = 4096;
const MAX_WRAPPED_DATA_KEY_BYTES = 16 * 1024;
const MAX_ENCRYPTION_KEY_VERSION_LENGTH = 512;
const MAX_FINGERPRINT_KEY_VERSION = 2_147_483_647;

type PushSubscriptionField = 'endpoint' | 'p256dh' | 'auth';

export interface PushSubscriptionCryptoContext {
  subscriptionId: number;
  userId: number;
}

export interface PushSubscriptionSecrets {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface EncryptedPushSubscription {
  endpointCiphertext: Buffer;
  endpointNonce: Buffer;
  endpointTag: Buffer;
  p256dhCiphertext: Buffer;
  p256dhNonce: Buffer;
  p256dhTag: Buffer;
  authCiphertext: Buffer;
  authNonce: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
  encryptionKeyVersion: string;
  cryptoFormatVersion: number;
}

export interface PushDataKeyProtectionProvider {
  getActiveKeyVersion(): Promise<string>;
  isKeyVersionSupported(keyVersion: string): Promise<boolean>;
  protectDataKey(dataKey: Buffer, keyVersion: string): Promise<Buffer>;
  recoverDataKey(wrappedDataKey: Buffer, keyVersion: string): Promise<Buffer>;
}

export interface PushFingerprintKeyProvider {
  getActiveKeyVersion(): Promise<number>;
  isKeyVersionSupported(keyVersion: number): Promise<boolean>;
  /** Returns a fresh buffer owned by the caller. */
  getKey(keyVersion: number): Promise<Buffer>;
}

export interface EndpointFingerprint {
  keyVersion: number;
  fingerprint: string;
}

export type PushCryptoErrorCode =
  | 'INVALID_CONTEXT'
  | 'INVALID_SUBSCRIPTION_SECRETS'
  | 'INVALID_ENVELOPE'
  | 'UNSUPPORTED_CRYPTO_FORMAT'
  | 'UNKNOWN_ENCRYPTION_KEY_VERSION'
  | 'UNKNOWN_FINGERPRINT_KEY_VERSION'
  | 'INVALID_DATA_KEY'
  | 'INVALID_FINGERPRINT_KEY'
  | 'KEY_PROVIDER_UNAVAILABLE'
  | 'FINGERPRINT_KEY_PROVIDER_UNAVAILABLE'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED';

export class PushCryptoError extends Error {
  constructor(
    readonly code: PushCryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PushCryptoError';
  }
}

interface EncryptedField {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

function invalidSecrets(): PushCryptoError {
  return new PushCryptoError(
    'INVALID_SUBSCRIPTION_SECRETS',
    'Os dados da inscrição push são inválidos.',
  );
}

function validateContext(context: PushSubscriptionCryptoContext): void {
  if (
    !context ||
    !Number.isSafeInteger(context.subscriptionId) ||
    context.subscriptionId <= 0 ||
    !Number.isSafeInteger(context.userId) ||
    context.userId <= 0
  ) {
    throw new PushCryptoError(
      'INVALID_CONTEXT',
      'O contexto da inscrição push é inválido.',
    );
  }
}

function encodeEndpoint(endpoint: string): Buffer {
  if (
    typeof endpoint !== 'string' ||
    endpoint.length === 0 ||
    endpoint.trim() !== endpoint
  ) {
    throw invalidSecrets();
  }

  const bytes = Buffer.from(endpoint, 'utf8');
  if (
    bytes.length === 0 ||
    bytes.length > MAX_ENDPOINT_BYTES ||
    bytes.toString('utf8') !== endpoint
  ) {
    bytes.fill(0);
    throw invalidSecrets();
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    bytes.fill(0);
    throw invalidSecrets();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0
  ) {
    bytes.fill(0);
    throw invalidSecrets();
  }

  return bytes;
}

function decodeBase64Url(value: string, expectedBytes: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw invalidSecrets();
  }

  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== expectedBytes || bytes.toString('base64url') !== value) {
    bytes.fill(0);
    throw invalidSecrets();
  }
  return bytes;
}

function encodeSecrets(secrets: PushSubscriptionSecrets): {
  endpoint: Buffer;
  p256dh: Buffer;
  auth: Buffer;
} {
  const endpoint = encodeEndpoint(secrets?.endpoint);
  let p256dh: Buffer | undefined;
  let auth: Buffer | undefined;
  try {
    p256dh = decodeBase64Url(secrets.p256dh, 65);
    auth = decodeBase64Url(secrets.auth, 16);
    if (p256dh[0] !== 0x04) {
      throw invalidSecrets();
    }
    return { endpoint, p256dh, auth };
  } catch (error) {
    endpoint.fill(0);
    p256dh?.fill(0);
    auth?.fill(0);
    throw error;
  }
}

function validateEncryptionKeyVersion(version: string): void {
  if (
    typeof version !== 'string' ||
    version.length === 0 ||
    version.length > MAX_ENCRYPTION_KEY_VERSION_LENGTH ||
    version.trim() !== version
  ) {
    throw new PushCryptoError(
      'UNKNOWN_ENCRYPTION_KEY_VERSION',
      'A versão da chave de criptografia é inválida.',
    );
  }
  for (const character of version) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      throw new PushCryptoError(
        'UNKNOWN_ENCRYPTION_KEY_VERSION',
        'A versão da chave de criptografia é inválida.',
      );
    }
  }
}

function validateFingerprintKeyVersion(version: number): void {
  if (
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    version > MAX_FINGERPRINT_KEY_VERSION
  ) {
    throw new PushCryptoError(
      'UNKNOWN_FINGERPRINT_KEY_VERSION',
      'A versão da chave de fingerprint é inválida.',
    );
  }
}

function validateWrappedDataKey(wrappedDataKey: Buffer): void {
  if (
    !Buffer.isBuffer(wrappedDataKey) ||
    wrappedDataKey.length === 0 ||
    wrappedDataKey.length > MAX_WRAPPED_DATA_KEY_BYTES
  ) {
    throw new PushCryptoError(
      'INVALID_ENVELOPE',
      'A DEK protegida da inscrição push é inválida.',
    );
  }
}

function validateEncryptedField(
  field: EncryptedField,
  ciphertextBytes?: number,
): void {
  if (
    !field ||
    !Buffer.isBuffer(field.ciphertext) ||
    (ciphertextBytes !== undefined &&
      field.ciphertext.length !== ciphertextBytes) ||
    !Buffer.isBuffer(field.nonce) ||
    field.nonce.length !== AES_GCM_NONCE_BYTES ||
    !Buffer.isBuffer(field.tag) ||
    field.tag.length !== AES_GCM_TAG_BYTES
  ) {
    throw new PushCryptoError(
      'INVALID_ENVELOPE',
      'O envelope criptográfico da inscrição push é inválido.',
    );
  }
}

function buildAad(
  context: PushSubscriptionCryptoContext,
  field: PushSubscriptionField,
  formatVersion: number,
): Buffer {
  return Buffer.from(
    [
      'barbearia-app',
      'push-subscription',
      `format=${formatVersion}`,
      `subscription=${context.subscriptionId}`,
      `user=${context.userId}`,
      `field=${field}`,
    ].join('\0'),
    'utf8',
  );
}

function generateUniqueNonce(usedNonces: Set<string>): Buffer {
  for (let attempt = 0; attempt < 8; attempt++) {
    const nonce = randomBytes(AES_GCM_NONCE_BYTES);
    const key = nonce.toString('hex');
    if (!usedNonces.has(key)) {
      usedNonces.add(key);
      return nonce;
    }
    nonce.fill(0);
  }
  throw new PushCryptoError(
    'ENCRYPTION_FAILED',
    'Não foi possível gerar um nonce único para a inscrição push.',
  );
}

function encryptField(
  dataKey: Buffer,
  plaintext: Buffer,
  context: PushSubscriptionCryptoContext,
  field: PushSubscriptionField,
  usedNonces: Set<string>,
): EncryptedField {
  const nonce = generateUniqueNonce(usedNonces);
  const aad = buildAad(context, field, PUSH_CRYPTO_FORMAT_VERSION);
  try {
    const cipher = createCipheriv('aes-256-gcm', dataKey, nonce, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return { ciphertext, nonce, tag: cipher.getAuthTag() };
  } catch {
    nonce.fill(0);
    throw new PushCryptoError(
      'ENCRYPTION_FAILED',
      'Não foi possível proteger os dados da inscrição push.',
    );
  } finally {
    aad.fill(0);
  }
}

function decryptField(
  dataKey: Buffer,
  fieldData: EncryptedField,
  context: PushSubscriptionCryptoContext,
  field: PushSubscriptionField,
): Buffer {
  const aad = buildAad(context, field, PUSH_CRYPTO_FORMAT_VERSION);
  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, fieldData.nonce, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(fieldData.tag);
    return Buffer.concat([
      decipher.update(fieldData.ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw new PushCryptoError(
      'DECRYPTION_FAILED',
      'Não foi possível autenticar os dados da inscrição push.',
    );
  } finally {
    aad.fill(0);
  }
}

function decodeEndpointBuffer(endpoint: Buffer): string {
  const value = endpoint.toString('utf8');
  const roundTrip = Buffer.from(value, 'utf8');
  const isValidUtf8 = roundTrip.equals(endpoint);
  roundTrip.fill(0);
  if (!isValidUtf8) {
    throw new PushCryptoError(
      'DECRYPTION_FAILED',
      'Os dados autenticados da inscrição push são inválidos.',
    );
  }

  try {
    encodeEndpoint(value).fill(0);
  } catch {
    throw new PushCryptoError(
      'DECRYPTION_FAILED',
      'Os dados autenticados da inscrição push são inválidos.',
    );
  }
  return value;
}

@Injectable()
export class PushCryptoService {
  constructor(
    @Inject(PUSH_DATA_KEY_PROTECTION_PROVIDER)
    private readonly dataKeyProvider: PushDataKeyProtectionProvider,
    @Inject(PUSH_FINGERPRINT_KEY_PROVIDER)
    private readonly fingerprintKeyProvider: PushFingerprintKeyProvider,
  ) {}

  async encryptSubscription(
    context: PushSubscriptionCryptoContext,
    secrets: PushSubscriptionSecrets,
  ): Promise<EncryptedPushSubscription> {
    validateContext(context);
    const plaintext = encodeSecrets(secrets);
    let dataKey: Buffer | undefined;
    let protectedDataKey: Buffer | undefined;
    try {
      const keyVersion = await this.getActiveEncryptionKeyVersion();
      dataKey = randomBytes(AES_256_KEY_BYTES);
      protectedDataKey = await this.protectDataKey(dataKey, keyVersion);
      const usedNonces = new Set<string>();

      const endpoint = encryptField(
        dataKey,
        plaintext.endpoint,
        context,
        'endpoint',
        usedNonces,
      );
      const p256dh = encryptField(
        dataKey,
        plaintext.p256dh,
        context,
        'p256dh',
        usedNonces,
      );
      const auth = encryptField(
        dataKey,
        plaintext.auth,
        context,
        'auth',
        usedNonces,
      );

      return {
        endpointCiphertext: endpoint.ciphertext,
        endpointNonce: endpoint.nonce,
        endpointTag: endpoint.tag,
        p256dhCiphertext: p256dh.ciphertext,
        p256dhNonce: p256dh.nonce,
        p256dhTag: p256dh.tag,
        authCiphertext: auth.ciphertext,
        authNonce: auth.nonce,
        authTag: auth.tag,
        wrappedDataKey: Buffer.from(protectedDataKey),
        encryptionKeyVersion: keyVersion,
        cryptoFormatVersion: PUSH_CRYPTO_FORMAT_VERSION,
      };
    } catch (error) {
      if (error instanceof PushCryptoError) {
        throw error;
      }
      throw new PushCryptoError(
        'ENCRYPTION_FAILED',
        'Não foi possível proteger os dados da inscrição push.',
      );
    } finally {
      dataKey?.fill(0);
      protectedDataKey?.fill(0);
      plaintext.endpoint.fill(0);
      plaintext.p256dh.fill(0);
      plaintext.auth.fill(0);
    }
  }

  async decryptSubscription(
    context: PushSubscriptionCryptoContext,
    encrypted: EncryptedPushSubscription,
  ): Promise<PushSubscriptionSecrets> {
    validateContext(context);
    const fields = this.validateEnvelope(encrypted);
    let recoveredKey: Buffer | undefined;
    let dataKey: Buffer | undefined;
    const plaintext: {
      endpoint?: Buffer;
      p256dh?: Buffer;
      auth?: Buffer;
    } = {};
    try {
      const supported = await this.isEncryptionKeyVersionSupported(
        encrypted.encryptionKeyVersion,
      );
      if (!supported) {
        throw new PushCryptoError(
          'UNKNOWN_ENCRYPTION_KEY_VERSION',
          'A versão da chave de criptografia não é suportada.',
        );
      }

      recoveredKey = await this.recoverDataKey(
        encrypted.wrappedDataKey,
        encrypted.encryptionKeyVersion,
      );
      if (recoveredKey.length !== AES_256_KEY_BYTES) {
        throw new PushCryptoError(
          'INVALID_DATA_KEY',
          'A DEK recuperada da inscrição push é inválida.',
        );
      }
      dataKey = Buffer.from(recoveredKey);
      recoveredKey.fill(0);

      plaintext.endpoint = decryptField(
        dataKey,
        fields.endpoint,
        context,
        'endpoint',
      );
      plaintext.p256dh = decryptField(
        dataKey,
        fields.p256dh,
        context,
        'p256dh',
      );
      plaintext.auth = decryptField(dataKey, fields.auth, context, 'auth');

      if (
        plaintext.p256dh.length !== 65 ||
        plaintext.p256dh[0] !== 0x04 ||
        plaintext.auth.length !== 16
      ) {
        throw new PushCryptoError(
          'DECRYPTION_FAILED',
          'Os dados autenticados da inscrição push são inválidos.',
        );
      }

      return {
        endpoint: decodeEndpointBuffer(plaintext.endpoint),
        p256dh: plaintext.p256dh.toString('base64url'),
        auth: plaintext.auth.toString('base64url'),
      };
    } finally {
      recoveredKey?.fill(0);
      dataKey?.fill(0);
      plaintext.endpoint?.fill(0);
      plaintext.p256dh?.fill(0);
      plaintext.auth?.fill(0);
    }
  }

  async fingerprintEndpoint(
    endpoint: string,
    keyVersion?: number,
  ): Promise<EndpointFingerprint> {
    const endpointBytes = encodeEndpoint(endpoint);
    let fingerprintKey: Buffer | undefined;
    try {
      const version =
        keyVersion ?? (await this.getActiveFingerprintKeyVersion());
      validateFingerprintKeyVersion(version);
      if (!(await this.isFingerprintKeyVersionSupported(version))) {
        throw new PushCryptoError(
          'UNKNOWN_FINGERPRINT_KEY_VERSION',
          'A versão da chave de fingerprint não é suportada.',
        );
      }

      fingerprintKey = await this.getFingerprintKey(version);
      const digest = createHmac('sha256', fingerprintKey)
        .update(`barbearia-app:push-endpoint:v1:${version}\0`, 'utf8')
        .update(endpointBytes)
        .digest('hex');
      return { keyVersion: version, fingerprint: digest };
    } finally {
      fingerprintKey?.fill(0);
      endpointBytes.fill(0);
    }
  }

  private validateEnvelope(encrypted: EncryptedPushSubscription): {
    endpoint: EncryptedField;
    p256dh: EncryptedField;
    auth: EncryptedField;
  } {
    if (
      !encrypted ||
      encrypted.cryptoFormatVersion !== PUSH_CRYPTO_FORMAT_VERSION
    ) {
      throw new PushCryptoError(
        'UNSUPPORTED_CRYPTO_FORMAT',
        'A versão do formato criptográfico da inscrição não é suportada.',
      );
    }
    validateEncryptionKeyVersion(encrypted.encryptionKeyVersion);
    validateWrappedDataKey(encrypted.wrappedDataKey);

    const fields = {
      endpoint: {
        ciphertext: encrypted.endpointCiphertext,
        nonce: encrypted.endpointNonce,
        tag: encrypted.endpointTag,
      },
      p256dh: {
        ciphertext: encrypted.p256dhCiphertext,
        nonce: encrypted.p256dhNonce,
        tag: encrypted.p256dhTag,
      },
      auth: {
        ciphertext: encrypted.authCiphertext,
        nonce: encrypted.authNonce,
        tag: encrypted.authTag,
      },
    };
    validateEncryptedField(fields.endpoint);
    validateEncryptedField(fields.p256dh, 65);
    validateEncryptedField(fields.auth, 16);
    if (
      fields.endpoint.ciphertext.length === 0 ||
      fields.endpoint.ciphertext.length > MAX_ENDPOINT_BYTES
    ) {
      throw new PushCryptoError(
        'INVALID_ENVELOPE',
        'O ciphertext do endpoint push é inválido.',
      );
    }
    return fields;
  }

  private async getActiveEncryptionKeyVersion(): Promise<string> {
    let version: string;
    try {
      version = await this.dataKeyProvider.getActiveKeyVersion();
    } catch {
      throw new PushCryptoError(
        'KEY_PROVIDER_UNAVAILABLE',
        'O provedor de chaves de criptografia está indisponível.',
      );
    }
    validateEncryptionKeyVersion(version);
    if (!(await this.isEncryptionKeyVersionSupported(version))) {
      throw new PushCryptoError(
        'UNKNOWN_ENCRYPTION_KEY_VERSION',
        'A versão ativa da chave de criptografia não é suportada.',
      );
    }
    return version;
  }

  private async isEncryptionKeyVersionSupported(
    version: string,
  ): Promise<boolean> {
    try {
      return await this.dataKeyProvider.isKeyVersionSupported(version);
    } catch {
      throw new PushCryptoError(
        'KEY_PROVIDER_UNAVAILABLE',
        'O provedor de chaves de criptografia está indisponível.',
      );
    }
  }

  private async protectDataKey(
    dataKey: Buffer,
    version: string,
  ): Promise<Buffer> {
    let wrapped: Buffer;
    try {
      wrapped = await this.dataKeyProvider.protectDataKey(dataKey, version);
    } catch {
      throw new PushCryptoError(
        'KEY_PROVIDER_UNAVAILABLE',
        'O provedor de chaves de criptografia está indisponível.',
      );
    }
    validateWrappedDataKey(wrapped);
    return wrapped;
  }

  private async recoverDataKey(
    wrappedDataKey: Buffer,
    version: string,
  ): Promise<Buffer> {
    let recovered: Buffer;
    try {
      recovered = await this.dataKeyProvider.recoverDataKey(
        wrappedDataKey,
        version,
      );
    } catch {
      throw new PushCryptoError(
        'KEY_PROVIDER_UNAVAILABLE',
        'O provedor de chaves de criptografia está indisponível.',
      );
    }
    if (!Buffer.isBuffer(recovered)) {
      throw new PushCryptoError(
        'INVALID_DATA_KEY',
        'A DEK recuperada da inscrição push é inválida.',
      );
    }
    return recovered;
  }

  private async getActiveFingerprintKeyVersion(): Promise<number> {
    let version: number;
    try {
      version = await this.fingerprintKeyProvider.getActiveKeyVersion();
    } catch {
      throw new PushCryptoError(
        'FINGERPRINT_KEY_PROVIDER_UNAVAILABLE',
        'O provedor da chave de fingerprint está indisponível.',
      );
    }
    validateFingerprintKeyVersion(version);
    return version;
  }

  private async isFingerprintKeyVersionSupported(
    version: number,
  ): Promise<boolean> {
    try {
      return await this.fingerprintKeyProvider.isKeyVersionSupported(version);
    } catch {
      throw new PushCryptoError(
        'FINGERPRINT_KEY_PROVIDER_UNAVAILABLE',
        'O provedor da chave de fingerprint está indisponível.',
      );
    }
  }

  private async getFingerprintKey(version: number): Promise<Buffer> {
    let key: Buffer;
    try {
      key = await this.fingerprintKeyProvider.getKey(version);
    } catch {
      throw new PushCryptoError(
        'FINGERPRINT_KEY_PROVIDER_UNAVAILABLE',
        'O provedor da chave de fingerprint está indisponível.',
      );
    }
    if (!Buffer.isBuffer(key) || key.length !== HMAC_SHA256_KEY_BYTES) {
      if (Buffer.isBuffer(key)) {
        key.fill(0);
      }
      throw new PushCryptoError(
        'INVALID_FINGERPRINT_KEY',
        'A chave de fingerprint recuperada é inválida.',
      );
    }
    const ownedKey = Buffer.from(key);
    key.fill(0);
    return ownedKey;
  }
}
