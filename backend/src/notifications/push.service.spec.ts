import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createECDH } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PushSubscriptionDto } from './push-subscription.dto';
import { PushService } from './push.service';

function createVapidConfig(): Record<string, string> {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    PUSH_VAPID_PUBLIC_KEY: ecdh.getPublicKey('base64url', 'uncompressed'),
    PUSH_VAPID_PRIVATE_KEY: ecdh.getPrivateKey('base64url'),
    PUSH_VAPID_SUBJECT: 'mailto:push@example.com',
  };
}

describe('PushService', () => {
  let queryRaw: jest.Mock;
  let configValues: Record<string, string>;
  let service: PushService;

  beforeEach(() => {
    queryRaw = jest.fn();
    configValues = {};
    service = new PushService(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      {
        get: jest.fn((key: string) => configValues[key]),
      } as unknown as ConfigService,
    );
  });

  it('returns the VAPID public key only when the complete pair matches', () => {
    configValues = createVapidConfig();

    expect(service.getPublicKey()).toEqual({
      publicKey: configValues.PUSH_VAPID_PUBLIC_KEY,
    });
  });

  it('fails closed when VAPID is missing or inconsistent', () => {
    expect(() => service.getPublicKey()).toThrow(ServiceUnavailableException);

    configValues = createVapidConfig();
    const otherKeyPair = createECDH('prime256v1');
    otherKeyPair.generateKeys();
    configValues.PUSH_VAPID_PUBLIC_KEY = otherKeyPair.getPublicKey(
      'base64url',
      'uncompressed',
    );

    expect(() => service.getPublicKey()).toThrow(ServiceUnavailableException);
  });

  it('blocks registration without invoking persistence', () => {
    expect(() =>
      service.registerSubscription(12, {} as PushSubscriptionDto),
    ).toThrow(ServiceUnavailableException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('lists only metadata using the authenticated owner id', async () => {
    const subscriptions = [
      { id: 8, dataCriacao: new Date(), ultimoUsoEm: null },
    ];
    queryRaw.mockResolvedValue(subscriptions);

    await expect(service.findMine(12)).resolves.toBe(subscriptions);
    const [sql, ownerId] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      number,
    ];
    expect(sql.join('')).toContain('"usuarioId" = ');
    expect(ownerId).toBe(12);
    expect(sql.join('')).not.toContain('Ciphertext');
    expect(sql.join('')).not.toContain('fingerprint');
  });

  it('revokes only an active subscription owned by the authenticated user', async () => {
    queryRaw.mockResolvedValue([{ id: 8 }]);

    await expect(service.revokeMine(12, 8)).resolves.toBeUndefined();
    const [sql, subscriptionId, ownerId] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      number,
      number,
    ];
    expect(sql.join('')).toContain('"usuarioId" = ');
    expect(sql.join('')).toContain('"revogadoEm" IS NULL');
    expect(subscriptionId).toBe(8);
    expect(ownerId).toBe(12);
  });

  it('returns not found for missing, revoked, or another user’s subscription', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(service.revokeMine(12, 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
