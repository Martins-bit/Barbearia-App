/**
 * Resolução centralizada das origens autorizadas (CORS).
 *
 * Usada tanto pelo CORS REST (main.ts) quanto pelo handshake do Socket.IO
 * (messages.gateway), garantindo que ambos aceitem exatamente as mesmas
 * origens. Nenhuma credencial é combinada com "*".
 */

const LOCAL_DEV_ORIGINS: readonly string[] = [
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://192.168.1.7:5173',
  'http://localhost:5174',
  'http://localhost:5175',
];

function isLocalDevelopmentHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '192.168.1.7' ||
    normalized === '::1'
  );
}

function normalizeOrigin(value: string, isProduction: boolean): string | null {
  const candidate = value.trim();
  if (
    !candidate ||
    /\s/.test(candidate) ||
    candidate.includes('*') ||
    candidate.includes('?') ||
    candidate.includes('#') ||
    candidate.includes('\\')
  ) {
    return null;
  }

  const authority = candidate.match(/^https?:\/\/([^/?#]*)\/?$/i)?.[1];
  if (!authority || authority.includes('@') || authority.endsWith(':')) {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.origin === 'null'
    ) {
      return null;
    }

    if (url.protocol === 'http:') {
      if (isProduction || !isLocalDevelopmentHostname(url.hostname)) {
        return null;
      }
    }

    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Retorna a lista de origens autorizadas a partir de `CORS_ALLOWED_ORIGINS`.
 *
 * - Desenvolvimento: se `CORS_ALLOWED_ORIGINS` não estiver definido, usa as
 *   origens locais padrão do projeto.
 * - Produção (`NODE_ENV=production`): exige `CORS_ALLOWED_ORIGINS` explícito,
 *   não vazio, com origens HTTPS e sem entradas inválidas; caso contrário
 *   interrompe o boot sem expor os valores configurados.
 */
export function resolveAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const isProduction = env.NODE_ENV === 'production';
  const raw = (env.CORS_ALLOWED_ORIGINS ?? '').trim();

  if (!raw) {
    if (isProduction) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS é obrigatório em produção e não pode estar vazio.',
      );
    }
    return [...LOCAL_DEV_ORIGINS];
  }

  const configuredOrigins = raw.split(',').map((origin) => origin.trim());
  if (configuredOrigins.includes('*')) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS não pode conter "*" quando credentials está ativo.',
    );
  }

  if (configuredOrigins.some((origin) => !origin)) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS contém uma entrada vazia.',
    );
  }

  const normalizedOrigins = configuredOrigins.map((origin) =>
    normalizeOrigin(origin, isProduction),
  );
  if (normalizedOrigins.some((origin) => origin === null)) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS contém origem inválida. Use apenas origens http(s) sem credenciais, caminhos, query ou fragmento; em produção, use HTTPS.',
    );
  }

  return [
    ...new Set(
      normalizedOrigins.filter((origin): origin is string => origin !== null),
    ),
  ];
}

export function isAllowedOrigin(
  origin: unknown,
  allowedOrigins: readonly string[],
): boolean {
  return typeof origin === 'string' && allowedOrigins.includes(origin);
}

/**
 * Monta as opções de CORS do Express a partir das origens autorizadas.
 *
 * Centraliza REST e Socket.IO: mesma lista, sempre com `credentials: true` e
 * nunca com `"*"`. Consumido por `main.ts` (REST).
 */
export function buildCorsOptions() {
  return {
    origin: resolveAllowedOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  };
}
