import {
  buildCorsOptions,
  isAllowedOrigin,
  resolveAllowedOrigins,
} from './cors.config';

/**
 * Testes da resolução centralizada de origens (CORS). Sem banco, sem I/O:
 * `resolveAllowedOrigins` recebe um `env` explícito.
 */
describe('resolveAllowedOrigins', () => {
  it('em desenvolvimento, sem configuração, usa as origens locais padrão', () => {
    const origins = resolveAllowedOrigins({ NODE_ENV: 'development' });
    expect(origins).toEqual([
      'http://localhost:4173',
      'http://127.0.0.1:4173',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://192.168.1.7:5173',
      'http://localhost:5174',
      'http://localhost:5175',
    ]);
  });

  it('lê e normaliza CORS_ALLOWED_ORIGINS (vírgulas e espaços)', () => {
    const origins = resolveAllowedOrigins({
      NODE_ENV: 'development',
      CORS_ALLOWED_ORIGINS:
        ' https://app.exemplo.com/ , http://127.0.0.1:4173 , http://localhost:5173 ',
    });
    expect(origins).toEqual([
      'https://app.exemplo.com',
      'http://127.0.0.1:4173',
      'http://localhost:5173',
    ]);
  });

  it('em produção, exige CORS_ALLOWED_ORIGINS explícito (ausente → erro)', () => {
    expect(() => resolveAllowedOrigins({ NODE_ENV: 'production' })).toThrow(
      'CORS_ALLOWED_ORIGINS',
    );
  });

  it('em produção, valor vazio/espaços → erro', () => {
    expect(() =>
      resolveAllowedOrigins({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: '  ',
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
  });

  it('nunca aceita "*" quando há credenciais', () => {
    expect(() =>
      resolveAllowedOrigins({
        NODE_ENV: 'development',
        CORS_ALLOWED_ORIGINS: '*',
      }),
    ).toThrow(/"\*"/);
  });

  it('rejeita origens com formato inválido', () => {
    expect(() =>
      resolveAllowedOrigins({
        NODE_ENV: 'development',
        CORS_ALLOWED_ORIGINS: 'nao-e-url, ftp://host',
      }),
    ).toThrow(/inválida/);
  });

  it('normaliza host, porta padrão e barra final', () => {
    const origins = resolveAllowedOrigins({
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: ' HTTPS://APP.INVALID:443/ ',
    });

    expect(origins).toEqual(['https://app.invalid']);
  });

  it.each([
    'https://api.invalid/path',
    'https://api.invalid?x=1',
    'https://api.invalid#section',
    'https://user:pass@api.invalid',
    'https://@api.invalid',
    'https://*.api.invalid',
    'http://api.invalid',
    'ftp://api.invalid',
    '*',
  ])('rejeita origem não permitida em produção: %s', (origin) => {
    expect(() =>
      resolveAllowedOrigins({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: origin,
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
  });

  it('aceita HTTP local somente em desenvolvimento', () => {
    expect(
      resolveAllowedOrigins({
        NODE_ENV: 'development',
        CORS_ALLOWED_ORIGINS:
          'http://localhost:5173,http://127.0.0.1:4173,http://192.168.1.7:5173',
      }),
    ).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:4173',
      'http://192.168.1.7:5173',
    ]);

    expect(() =>
      resolveAllowedOrigins({
        NODE_ENV: 'development',
        CORS_ALLOWED_ORIGINS: 'http://frontend.invalid',
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');

    expect(() =>
      resolveAllowedOrigins({
        NODE_ENV: 'development',
        CORS_ALLOWED_ORIGINS: 'http://192.168.1.8:5173',
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS');
  });

  it('rejeita entradas vazias em uma lista configurada', () => {
    expect(() =>
      resolveAllowedOrigins({
        NODE_ENV: 'development',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173,',
      }),
    ).toThrow('entrada vazia');
  });

  it('aceita origens HTTPS válidas em produção', () => {
    const origins = resolveAllowedOrigins({
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://app.exemplo.com,https://www.exemplo.com',
    });
    expect(origins).toEqual([
      'https://app.exemplo.com',
      'https://www.exemplo.com',
    ]);
  });

  it('deduplica origens depois da normalização', () => {
    expect(
      resolveAllowedOrigins({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS:
          'https://app.invalid, HTTPS://APP.INVALID:443/',
      }),
    ).toEqual(['https://app.invalid']);
  });
});

describe('isAllowedOrigin', () => {
  const allowedOrigins = ['https://app.invalid'];

  it('aceita somente uma origem exata da allowlist', () => {
    expect(isAllowedOrigin('https://app.invalid', allowedOrigins)).toBe(true);
    expect(isAllowedOrigin('https://other.invalid', allowedOrigins)).toBe(false);
    expect(isAllowedOrigin(undefined, allowedOrigins)).toBe(false);
    expect(isAllowedOrigin('null', allowedOrigins)).toBe(false);
  });
});

describe('buildCorsOptions', () => {
  it('sempre usa credentials: true e métodos/headers explícitos', () => {
    const options = buildCorsOptions();
    expect(options.credentials).toBe(true);
    expect(options.methods).toContain('GET');
    expect(options.methods).toContain('OPTIONS');
    expect(options.allowedHeaders).toContain('Authorization');
    expect(options.allowedHeaders).toContain('Idempotency-Key');
    // origin é uma lista (nunca "*").
    expect(Array.isArray(options.origin)).toBe(true);
    expect(options.origin).not.toContain('*');
  });
});
