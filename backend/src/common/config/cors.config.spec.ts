import { buildCorsOptions, resolveAllowedOrigins } from './cors.config';

/**
 * Testes da resolução centralizada de origens (CORS). Sem banco, sem I/O:
 * `resolveAllowedOrigins` recebe um `env` explícito.
 */
describe('resolveAllowedOrigins', () => {
  it('em desenvolvimento, sem configuração, usa as origens locais padrão', () => {
    const origins = resolveAllowedOrigins({ NODE_ENV: 'development' });
    expect(origins).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('lê e normaliza CORS_ALLOWED_ORIGINS (vírgulas, espaços, vazios)', () => {
    const origins = resolveAllowedOrigins({
      NODE_ENV: 'development',
      CORS_ALLOWED_ORIGINS:
        ' https://app.exemplo.com , http://localhost:5173 ,',
    });
    expect(origins).toEqual([
      'https://app.exemplo.com',
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

  it('aceita origens válidas http/https em produção', () => {
    const origins = resolveAllowedOrigins({
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://app.exemplo.com,https://www.exemplo.com',
    });
    expect(origins).toEqual([
      'https://app.exemplo.com',
      'https://www.exemplo.com',
    ]);
  });
});

describe('buildCorsOptions', () => {
  it('sempre usa credentials: true e métodos/headers explícitos', () => {
    const options = buildCorsOptions();
    expect(options.credentials).toBe(true);
    expect(options.methods).toContain('GET');
    expect(options.methods).toContain('OPTIONS');
    expect(options.allowedHeaders).toContain('Authorization');
    // origin é uma lista (nunca "*").
    expect(Array.isArray(options.origin)).toBe(true);
    expect(options.origin).not.toContain('*');
  });
});
