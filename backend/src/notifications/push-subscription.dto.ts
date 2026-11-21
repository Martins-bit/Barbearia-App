import { createECDH } from 'node:crypto';
import { isIP } from 'node:net';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsString,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const MAX_ENDPOINT_LENGTH = 4096;

function isDisallowedIpv4(address: string): boolean {
  const [first, second, third] = address.split('.').map(Number);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 &&
      (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function parseIpv6Groups(address: string): number[] | undefined {
  if (address.includes('%') || address.includes('.')) {
    return undefined;
  }

  const halves = address.split('::');
  if (halves.length > 2) {
    return undefined;
  }

  const parseHalf = (half: string): number[] | undefined => {
    if (!half) {
      return [];
    }
    const groups = half.split(':');
    if (groups.some((group) => !/^[\da-f]{1,4}$/i.test(group))) {
      return undefined;
    }
    return groups.map((group) => Number.parseInt(group, 16));
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) {
    return undefined;
  }

  const zeroGroups = 8 - left.length - right.length;
  if (
    (halves.length === 1 && zeroGroups !== 0) ||
    (halves.length === 2 && zeroGroups < 1)
  ) {
    return undefined;
  }
  return [...left, ...Array<number>(zeroGroups).fill(0), ...right];
}

function isPublicIpv6(address: string): boolean {
  const groups = parseIpv6Groups(address);
  if (!groups) {
    return false;
  }

  const [first, second] = groups;
  if (first < 0x2000 || first > 0x3fff) {
    return false;
  }

  if (
    first === 0x2001 &&
    (second <= 0x01ff || second === 0x0db8 || second === 0x0010)
  ) {
    return false;
  }
  if (first === 0x2002 || (first === 0x3fff && second <= 0x0fff)) {
    return false;
  }
  return true;
}

const RESERVED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.home.arpa',
  '.localdomain',
  '.test',
  '.invalid',
  '.example',
  '.example.com',
  '.example.net',
  '.example.org',
  '.example.edu',
  '.onion',
  '.svc',
  '.cluster.local',
  '.corp',
  '.arpa',
];

export function isSafePushEndpoint(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ENDPOINT_LENGTH ||
    value.trim() !== value
  ) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const address =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    return !isDisallowedIpv4(address);
  }
  if (ipVersion === 6) {
    return isPublicIpv6(address);
  }
  if (
    address.length === 0 ||
    address.length > 253 ||
    address.endsWith('.') ||
    !address.includes('.') ||
    RESERVED_HOST_SUFFIXES.some(
      (suffix) => address === suffix.slice(1) || address.endsWith(suffix),
    )
  ) {
    return false;
  }

  const labels = address.split('.');
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label),
  );
}

function decodeCanonicalBase64Url(
  value: unknown,
  length: number,
): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== length || decoded.toString('base64url') !== value) {
    decoded.fill(0);
    return null;
  }
  return decoded;
}

@ValidatorConstraint({ name: 'isSafePushEndpoint', async: false })
class SafePushEndpointConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isSafePushEndpoint(value);
  }
}

@ValidatorConstraint({ name: 'isP256dhPublicKey', async: false })
class P256dhPublicKeyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    const decoded = decodeCanonicalBase64Url(value, 65);
    if (!decoded) {
      return false;
    }
    try {
      if (decoded[0] !== 0x04) {
        return false;
      }
      // Scalar público fixo usado apenas para validar o ponto P-256 recebido.
      const validationScalar = Buffer.alloc(32);
      validationScalar[31] = 1;
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(validationScalar);
      validationScalar.fill(0);
      const sharedSecret = ecdh.computeSecret(decoded);
      sharedSecret.fill(0);
      return true;
    } catch {
      return false;
    } finally {
      decoded.fill(0);
    }
  }
}

@ValidatorConstraint({ name: 'isPushAuthSecret', async: false })
class PushAuthSecretConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    const decoded = decodeCanonicalBase64Url(value, 16);
    if (!decoded) {
      return false;
    }
    decoded.fill(0);
    return true;
  }
}

export class PushSubscriptionKeysDto {
  @IsDefined()
  @IsString()
  @MaxLength(128)
  @Validate(P256dhPublicKeyConstraint)
  p256dh!: string;

  @IsDefined()
  @IsString()
  @MaxLength(64)
  @Validate(PushAuthSecretConstraint)
  auth!: string;
}

export class PushSubscriptionDto {
  @IsDefined()
  @IsString()
  @MaxLength(MAX_ENDPOINT_LENGTH)
  @Validate(SafePushEndpointConstraint)
  endpoint!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}
