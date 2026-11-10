import * as bcrypt from 'bcrypt';
import { BadRequestException } from '@nestjs/common';
import {
  comparePasswords,
  hashPassword,
  isPasswordWithinBcryptLimit,
  MAX_BCRYPT_PASSWORD_BYTES,
} from './password.util';

jest.mock('bcrypt');

describe('password.util bcrypt input limit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts a password whose UTF-8 encoding is exactly 72 bytes', () => {
    expect(isPasswordWithinBcryptLimit('a'.repeat(72))).toBe(true);
    expect(MAX_BCRYPT_PASSWORD_BYTES).toBe(72);
  });

  it('rejects passwords over 72 UTF-8 bytes even when character count is lower', () => {
    const password = 'é'.repeat(37);
    expect(password.length).toBeLessThan(72);
    expect(Buffer.byteLength(password, 'utf8')).toBeGreaterThan(72);
    expect(isPasswordWithinBcryptLimit(password)).toBe(false);
  });

  it('does not hash or compare an over-limit password', async () => {
    const password = 'a'.repeat(73);

    await expect(hashPassword(password)).rejects.toThrow(BadRequestException);
    await expect(comparePasswords(password, 'hash')).resolves.toBe(false);
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});