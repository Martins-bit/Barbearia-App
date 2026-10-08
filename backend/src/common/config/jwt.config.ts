import { config } from 'dotenv';
import { resolve } from 'path';

config({
  path: resolve(process.cwd(), '.env'),
});

export function validateAndGetJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.trim().length < 32) {
    throw new Error(
      'JWT_SECRET must be defined and contain at least 32 characters.',
    );
  }

  return secret;
}

export const JWT_CONFIG = {
  secret: validateAndGetJwtSecret(),
  expiresIn: '24h',
};

export const JWT_EXPIRES_IN_SECONDS = 24 * 60 * 60;