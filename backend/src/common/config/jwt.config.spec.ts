import * as fs from 'fs';
import * as path from 'path';

describe('JWT Configuration Security', () => {
  const validSecret = 'test-jwt-secret-key-for-testing-purposes-min-32';

  beforeEach(() => {
    jest.resetModules();
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;
  });

  it('should fail in development when JWT_SECRET is missing', () => {
    process.env.NODE_ENV = 'development';

    expect(() => require('./jwt.config')).toThrow('JWT_SECRET');
  });

  it('should fail in production when JWT_SECRET is missing', () => {
    process.env.NODE_ENV = 'production';

    expect(() => require('./jwt.config')).toThrow('JWT_SECRET');
  });

  it('should use JWT_SECRET defined by the test in NODE_ENV test', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = validSecret;

    const { JWT_CONFIG } = require('./jwt.config');

    expect(JWT_CONFIG.secret).toBe(validSecret);
  });

  it('should not have any JWT fallback string in application code', () => {
    const configPath = path.join(__dirname, 'jwt.config.ts');
    const content = fs.readFileSync(configPath, 'utf-8');

    expect(content).not.toContain('test-secret-key-for-testing-purposes-only');
    expect(content).not.toContain('test-jwt-secret-key');
    expect(content).not.toContain('||');
  });

  it('should load JWT_CONFIG successfully with valid environment', () => {
    process.env.JWT_SECRET = validSecret;
    const { JWT_CONFIG } = require('./jwt.config');

    expect(JWT_CONFIG).toBeDefined();
    expect(JWT_CONFIG.secret).toBeDefined();
    expect(JWT_CONFIG.secret.length).toBeGreaterThanOrEqual(32);
    expect(JWT_CONFIG.expiresIn).toBe('24h');
  });

  it('should have expiration time defined', () => {
    process.env.JWT_SECRET = validSecret;
    const { JWT_EXPIRES_IN_SECONDS } = require('./jwt.config');

    expect(JWT_EXPIRES_IN_SECONDS).toBe(24 * 60 * 60);
  });
});
