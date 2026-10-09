/**
 * Resolução centralizada das origens autorizadas (CORS).
 *
 * Usada tanto pelo CORS REST (main.ts) quanto pelo handshake do Socket.IO
 * (messages.gateway), garantindo que ambos aceitem exatamente as mesmas
 * origens. Nenhuma credencial é combinada com "*".
 */

const LOCAL_DEV_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://localhost:5174',
];

function isValidOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Retorna a lista de origens autorizadas a partir de `CORS_ALLOWED_ORIGINS`.
 *
 * - Desenvolvimento: se `CORS_ALLOWED_ORIGINS` não estiver definido, usa as
 *   origens locais padrão do projeto (localhost:5173 / 5174).
 * - Produção (`NODE_ENV=production`): exige `CORS_ALLOWED_ORIGINS` explícito,
 *   não vazio e sem entradas inválidas; caso contrário interrompe o boot com
 *   mensagem clara (sem expor segredos).
 */
export function resolveAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const isProduction = env.NODE_ENV === 'production';
  const raw = (env.CORS_ALLOWED_ORIGINS ?? '').trim();

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    if (isProduction) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS é obrigatório em produção e não pode estar vazio.',
      );
    }
    return [...LOCAL_DEV_ORIGINS];
  }

  if (origins.includes('*')) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS não pode conter "*" quando credentials está ativo.',
    );
  }

  const invalidCount = origins.filter((origin) => !isValidOrigin(origin)).length;
  if (invalidCount > 0) {
    throw new Error(
      `CORS_ALLOWED_ORIGINS contém ${invalidCount} origem(ns) inválida(s); use o formato http(s)://host[:porta].`,
    );
  }

  return origins;
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
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}
