import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createECDH } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PushSubscriptionDto } from './push-subscription.dto';

export interface PushSubscriptionSummary {
  id: number;
  dataCriacao: Date;
  ultimoUsoEm: Date | null;
}

const VAPID_UNAVAILABLE_MESSAGE =
  'O serviço de notificações push está indisponível.';

function decodeVapidKey(
  value: string | undefined,
  expectedBytes: number,
): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ServiceUnavailableException(VAPID_UNAVAILABLE_MESSAGE);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length !== expectedBytes ||
    decoded.toString('base64url') !== value
  ) {
    decoded.fill(0);
    throw new ServiceUnavailableException(VAPID_UNAVAILABLE_MESSAGE);
  }
  return decoded;
}

function isValidVapidSubject(value: string | undefined): boolean {
  if (!value || value.length > 2048 || value.trim() !== value) {
    return false;
  }
  if (value.startsWith('mailto:')) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.slice('mailto:'.length));
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  getPublicKey(): { publicKey: string } {
    const publicKeyValue = this.config.get<string>('PUSH_VAPID_PUBLIC_KEY');
    const privateKeyValue = this.config.get<string>('PUSH_VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('PUSH_VAPID_SUBJECT');
    if (!publicKeyValue || !privateKeyValue || !isValidVapidSubject(subject)) {
      throw new ServiceUnavailableException(VAPID_UNAVAILABLE_MESSAGE);
    }

    let publicKey: Buffer | undefined;
    let privateKey: Buffer | undefined;
    let derivedPublicKey: Buffer | undefined;
    try {
      publicKey = decodeVapidKey(publicKeyValue, 65);
      privateKey = decodeVapidKey(privateKeyValue, 32);
      if (publicKey[0] !== 0x04) {
        throw new ServiceUnavailableException(VAPID_UNAVAILABLE_MESSAGE);
      }

      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(privateKey);
      derivedPublicKey = ecdh.getPublicKey(undefined, 'uncompressed');
      if (!derivedPublicKey.equals(publicKey)) {
        throw new ServiceUnavailableException(VAPID_UNAVAILABLE_MESSAGE);
      }

      return { publicKey: publicKeyValue };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(VAPID_UNAVAILABLE_MESSAGE);
    } finally {
      publicKey?.fill(0);
      privateKey?.fill(0);
      derivedPublicKey?.fill(0);
    }
  }

  registerSubscription(
    _userId: number,
    _subscription: PushSubscriptionDto,
  ): never {
    void _userId;
    void _subscription;
    throw new ServiceUnavailableException(
      'O cadastro de inscrições push está temporariamente desabilitado.',
    );
  }

  async findMine(userId: number): Promise<PushSubscriptionSummary[]> {
    return this.prisma.$queryRaw<PushSubscriptionSummary[]>`
      SELECT "id", "dataCriacao", "ultimoUsoEm"
      FROM "PushSubscription"
      WHERE "usuarioId" = ${userId}
        AND "revogadoEm" IS NULL
      ORDER BY "dataCriacao" DESC, "id" DESC
    `;
  }

  async revokeMine(userId: number, subscriptionId: number): Promise<void> {
    const revoked = await this.prisma.$queryRaw<Array<{ id: number }>>`
      UPDATE "PushSubscription"
      SET "revogadoEm" = clock_timestamp(),
          "dataAtualizacao" = clock_timestamp()
      WHERE "id" = ${subscriptionId}
        AND "usuarioId" = ${userId}
        AND "revogadoEm" IS NULL
      RETURNING "id"
    `;
    if (revoked.length === 0) {
      throw new NotFoundException('Inscrição push não encontrada.');
    }
  }
}
