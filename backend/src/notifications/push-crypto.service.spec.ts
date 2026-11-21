import { randomBytes } from 'node:crypto';
import {
  PUSH_CRYPTO_FORMAT_VERSION,
  PushCryptoError,
  PushCryptoService,
} from './push-crypto.service';
import type {
  EncryptedPushSubscription,
  PushDataKeyProtectionProvider,
  PushFingerprintKeyProvider,
  PushSubscriptionCryptoContext,
  PushSubscriptionSecrets,
} from './push-crypto.service';

const CONTEXT: PushSubscriptionCryptoContext = {
  subscriptionId: 31,
  userId: 12,
};
const SECRETS: PushSubscriptionSecrets = {
  endpoint: 'https://push.example.test/send/opaque-endpoint',
  p256dh: Buffer.concat([Buffer.from([0x04]), randomBytes(64)]).toString(
    'base64url',
  ),
  auth: randomBytes(16).toString('base64url'),
};

class TestOnlyInMemoryDataKeyProvider implements PushDataKeyProtectionProvider {
  activeVersion = 'test-key-v1';
  supportedVersions = new Set([this.activeVersion]);
  recoveryKey: Buffer | undefined;
  unavailable = false;
  private readonly keys = new Map<string, Buffer>();

  getActiveKeyVersion(): Promise<string> {
    if (this.unavailable) {
      return Promise.reject(new Error('test provider unavailable'));
    }
    return Promise.resolve(this.activeVersion);
  }

  isKeyVersionSupported(version: string): Promise<boolean> {
    if (this.unavailable) {
      return Promise.reject(new Error('test provider unavailable'));
    }
    return Promise.resolve(this.supportedVersions.has(version));
  }

  protectDataKey(dataKey: Buffer, version: string): Promise<Buffer> {
    if (this.unavailable) {
      return Promise.reject(new Error('test provider unavailable'));
    }
    const handle = randomBytes(24);
    this.keys.set(`${version}:${handle.toString('hex')}`, Buffer.from(dataKey));
    return Promise.resolve(handle);
  }

  recoverDataKey(wrappedDataKey: Buffer, version: string): Promise<Buffer> {
    if (this.unavailable) {
      return Promise.reject(new Error('test provider unavailable'));
    }
    if (this.recoveryKey) {
      return Promise.resolve(Buffer.from(this.recoveryKey));
    }
    const key = this.keys.get(`${version}:${wrappedDataKey.toString('hex')}`);
    if (!key) {
      return Promise.reject(new Error('test key unavailable'));
    }
    return Promise.resolve(Buffer.from(key));
  }

  dispose(): void {
    for (const key of this.keys.values()) key.fill(0);
    this.recoveryKey?.fill(0);
    this.keys.clear();
  }
}

class TestOnlyFingerprintKeyProvider implements PushFingerprintKeyProvider {
  activeVersion = 1;
  unavailable = false;
  readonly keys = new Map<number, Buffer>([
    [1, Buffer.alloc(32, 0x11)],
    [2, Buffer.alloc(32, 0x22)],
  ]);

  getActiveKeyVersion(): Promise<number> {
    if (this.unavailable) {
      return Promise.reject(new Error('test provider unavailable'));
    }
    return Promise.resolve(this.activeVersion);
  }

  isKeyVersionSupported(version: number): Promise<boolean> {
    if (this.unavailable) {
      return Promise.reject(new Error('test provider unavailable'));
    }
    return Promise.resolve(this.keys.has(version));
  }

  getKey(version: number): Promise<Buffer> {
    if (this.unavailable) {
      return Promise.reject(new Error('test provider unavailable'));
    }
    const key = this.keys.get(version);
    if (!key) {
      return Promise.reject(new Error('test key unavailable'));
    }
    return Promise.resolve(Buffer.from(key));
  }

  dispose(): void {
    for (const key of this.keys.values()) key.fill(0);
    this.keys.clear();
  }
}

function cloneEnvelope(
  envelope: EncryptedPushSubscription,
): EncryptedPushSubscription {
  return {
    ...envelope,
    endpointCiphertext: Buffer.from(envelope.endpointCiphertext),
    endpointNonce: Buffer.from(envelope.endpointNonce),
    endpointTag: Buffer.from(envelope.endpointTag),
    p256dhCiphertext: Buffer.from(envelope.p256dhCiphertext),
    p256dhNonce: Buffer.from(envelope.p256dhNonce),
    p256dhTag: Buffer.from(envelope.p256dhTag),
    authCiphertext: Buffer.from(envelope.authCiphertext),
    authNonce: Buffer.from(envelope.authNonce),
    authTag: Buffer.from(envelope.authTag),
    wrappedDataKey: Buffer.from(envelope.wrappedDataKey),
  };
}

describe('PushCryptoService', () => {
  let dataKeys: TestOnlyInMemoryDataKeyProvider;
  let fingerprintKeys: TestOnlyFingerprintKeyProvider;
  let service: PushCryptoService;

  beforeEach(() => {
    dataKeys = new TestOnlyInMemoryDataKeyProvider();
    fingerprintKeys = new TestOnlyFingerprintKeyProvider();
    service = new PushCryptoService(dataKeys, fingerprintKeys);
  });

  afterEach(() => {
    dataKeys.dispose();
    fingerprintKeys.dispose();
  });

  it('encrypts and decrypts subscription secrets with AES-256-GCM', async () => {
    const encrypted = await service.encryptSubscription(CONTEXT, SECRETS);

    expect(encrypted.cryptoFormatVersion).toBe(PUSH_CRYPTO_FORMAT_VERSION);
    expect(
      encrypted.endpointCiphertext.equals(Buffer.from(SECRETS.endpoint)),
    ).toBe(false);
    await expect(
      service.decryptSubscription(CONTEXT, encrypted),
    ).resolves.toEqual(SECRETS);
  });

  it('rejects a modified ciphertext', async () => {
    const encrypted = await service.encryptSubscription(CONTEXT, SECRETS);
    const tampered = cloneEnvelope(encrypted);
    tampered.endpointCiphertext[0] ^= 0x01;

    await expect(
      service.decryptSubscription(CONTEXT, tampered),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('rejects a modified authentication tag', async () => {
    const encrypted = await service.encryptSubscription(CONTEXT, SECRETS);
    const tampered = cloneEnvelope(encrypted);
    tampered.authTag[0] ^= 0x01;

    await expect(
      service.decryptSubscription(CONTEXT, tampered),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('authenticates subscription and user identifiers through AAD', async () => {
    const encrypted = await service.encryptSubscription(CONTEXT, SECRETS);

    await expect(
      service.decryptSubscription({ ...CONTEXT, userId: 13 }, encrypted),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'DECRYPTION_FAILED',
    });
    await expect(
      service.decryptSubscription(
        { ...CONTEXT, subscriptionId: 32 },
        encrypted,
      ),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('rejects invalid nonce sizes and malformed subscription keys', async () => {
    const encrypted = await service.encryptSubscription(CONTEXT, SECRETS);
    const invalidNonce = cloneEnvelope(encrypted);
    invalidNonce.endpointNonce = Buffer.alloc(11);

    await expect(
      service.decryptSubscription(CONTEXT, invalidNonce),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'INVALID_ENVELOPE',
    });
    await expect(
      service.encryptSubscription(CONTEXT, {
        ...SECRETS,
        auth: 'not-base64url!',
      }),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'INVALID_SUBSCRIPTION_SECRETS',
    });
  });

  it('rejects unsupported cryptographic format versions', async () => {
    const encrypted = await service.encryptSubscription(CONTEXT, SECRETS);
    const unknownFormat = {
      ...cloneEnvelope(encrypted),
      cryptoFormatVersion: PUSH_CRYPTO_FORMAT_VERSION + 1,
    };

    await expect(
      service.decryptSubscription(CONTEXT, unknownFormat),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'UNSUPPORTED_CRYPTO_FORMAT',
    });
  });

  it('rejects unknown encryption key versions', async () => {
    const encrypted = await service.encryptSubscription(CONTEXT, SECRETS);
    const unknownKeyVersion = cloneEnvelope(encrypted);
    unknownKeyVersion.encryptionKeyVersion = 'retired-key-v0';

    await expect(
      service.decryptSubscription(CONTEXT, unknownKeyVersion),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'UNKNOWN_ENCRYPTION_KEY_VERSION',
    });
  });

  it('rejects a recovered DEK with an invalid size', async () => {
    const encrypted = await service.encryptSubscription(CONTEXT, SECRETS);
    dataKeys.recoveryKey = Buffer.alloc(31, 0x44);

    await expect(
      service.decryptSubscription(CONTEXT, encrypted),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'INVALID_DATA_KEY',
    });
  });

  it('creates stable endpoint fingerprints for the same key version', async () => {
    const first = await service.fingerprintEndpoint(SECRETS.endpoint, 1);
    const second = await service.fingerprintEndpoint(SECRETS.endpoint, 1);

    expect(first).toEqual(second);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes endpoint fingerprints when the HMAC key version changes', async () => {
    const first = await service.fingerprintEndpoint(SECRETS.endpoint, 1);
    const second = await service.fingerprintEndpoint(SECRETS.endpoint, 2);

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it('fails closed when the data-key provider is unavailable', async () => {
    dataKeys.unavailable = true;

    await expect(
      service.encryptSubscription(CONTEXT, SECRETS),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'KEY_PROVIDER_UNAVAILABLE',
    });
  });

  it('fails closed when the fingerprint-key provider is unavailable', async () => {
    fingerprintKeys.unavailable = true;

    await expect(
      service.fingerprintEndpoint(SECRETS.endpoint),
    ).rejects.toMatchObject<Partial<PushCryptoError>>({
      code: 'FINGERPRINT_KEY_PROVIDER_UNAVAILABLE',
    });
  });
});
