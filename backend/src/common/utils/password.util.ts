import * as bcrypt from 'bcrypt';
import { BadRequestException } from '@nestjs/common';

const SALT_ROUNDS = 10;
export const MAX_BCRYPT_PASSWORD_BYTES = 72;

export function isPasswordWithinBcryptLimit(password: string): boolean {
  return Buffer.byteLength(password, 'utf8') <= MAX_BCRYPT_PASSWORD_BYTES;
}

export async function hashPassword(password: string): Promise<string> {
  if (!isPasswordWithinBcryptLimit(password)) {
    throw new BadRequestException(
      'Senha deve possuir no máximo 72 bytes UTF-8.',
    );
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePasswords(
  password: string,
  hash: string,
): Promise<boolean> {
  if (!isPasswordWithinBcryptLimit(password)) {
    return false;
  }
  return bcrypt.compare(password, hash);
}
