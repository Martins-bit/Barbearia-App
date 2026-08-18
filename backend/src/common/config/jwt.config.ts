export function validateAndGetJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not defined. ' +
      'This is required for authentication. ' +
      'Please set JWT_SECRET in your .env file or environment.',
    );
  }

  if (secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters long for security. ' +
      'Current length: ' + secret.length,
    );
  }

  return secret;
}

export const JWT_CONFIG = {
  secret: validateAndGetJwtSecret(),
  expiresIn: '24h',
};

export const JWT_EXPIRES_IN_SECONDS = 24 * 60 * 60; // 24 horas em segundos

