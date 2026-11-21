import 'reflect-metadata';
import { randomBytes, createECDH } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  isSafePushEndpoint,
  PushSubscriptionDto,
} from './push-subscription.dto';

function createValidSubscription(): PushSubscriptionDto {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
    keys: {
      p256dh: ecdh.getPublicKey('base64url', 'uncompressed'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

describe('PushSubscriptionDto', () => {
  it('accepts a valid HTTPS subscription with a P-256 point and auth secret', async () => {
    const errors = await validate(
      plainToInstance(PushSubscriptionDto, createValidSubscription()),
    );

    expect(errors).toHaveLength(0);
  });

  it.each([
    'http://push.example.com/subscription',
    'https://localhost/subscription',
    'https://push.localhost/subscription',
    'https://metadata.google.internal/subscription',
    'https://push.example.com/subscription',
    'https://10.1.2.3/subscription',
    'https://100.64.0.1/subscription',
    'https://169.254.169.254/latest/meta-data',
    'https://192.0.2.1/subscription',
    'https://[::1]/subscription',
    'https://[2001:db8::1]/subscription',
    'https://user:password@push.example.com/subscription',
  ])('rejects unsafe endpoint %s', (endpoint) => {
    expect(isSafePushEndpoint(endpoint)).toBe(false);
  });

  it('rejects malformed or non-canonical subscription keys', async () => {
    const subscription = createValidSubscription();
    subscription.keys.auth = 'not-a-key';
    const errors = await validate(
      plainToInstance(PushSubscriptionDto, subscription),
    );

    expect(errors.some((error) => error.property === 'keys')).toBe(true);
  });

  it('rejects a correctly sized P-256 key that is not a valid curve point', async () => {
    const subscription = createValidSubscription();
    subscription.keys.p256dh = Buffer.concat([
      Buffer.from([0x04]),
      Buffer.alloc(64),
    ]).toString('base64url');
    const errors = await validate(
      plainToInstance(PushSubscriptionDto, subscription),
    );

    expect(errors.some((error) => error.property === 'keys')).toBe(true);
  });

  it('rejects userId and other unknown registration properties', async () => {
    const subscription = {
      ...createValidSubscription(),
      userId: 99,
    };
    const errors = await validate(
      plainToInstance(PushSubscriptionDto, subscription),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errors.some((error) => error.property === 'userId')).toBe(true);
  });
});
