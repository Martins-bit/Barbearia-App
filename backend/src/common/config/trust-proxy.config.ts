import { isIP } from 'node:net';

export type TrustProxySetting = false | number | string[];

const EXPRESS_PROXY_ALIASES = new Set([
  'loopback',
  'linklocal',
  'uniquelocal',
]);

function isValidProxyRange(value: string): boolean {
  if (EXPRESS_PROXY_ALIASES.has(value)) return true;

  const parts = value.split('/');
  if (parts.length > 2) return false;

  const address = parts[0];
  const version = isIP(address);
  if (version === 0) return false;
  if (parts.length === 1) return true;

  const range = parts[1];
  if (!range) return false;

  const maxPrefix = version === 4 ? 32 : 128;
  if (/^\d+$/.test(range)) {
    const prefixLength = Number(range);
    return (
      Number.isSafeInteger(prefixLength) &&
      prefixLength > 0 &&
      prefixLength <= maxPrefix
    );
  }

  if (version !== 4 || isIP(range) !== 4) return false;

  let prefixLength = 0;
  let foundZero = false;
  for (const octet of range.split('.').map(Number)) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      const isSet = (octet & (1 << bit)) !== 0;
      if (isSet && foundZero) return false;
      if (isSet) prefixLength += 1;
      else foundZero = true;
    }
  }

  return prefixLength > 0 && prefixLength <= maxPrefix;
}

/**
 * Converte TRUST_PROXY sem tratar números em texto como intervalos de IP.
 * O Express continua responsável por aplicar os intervalos confiáveis.
 */
export function parseTrustProxySetting(
  raw: string | undefined,
): TrustProxySetting | undefined {
  if (raw === undefined) return undefined;

  const value = raw.trim();
  if (!value) {
    throw new Error(
      'TRUST_PROXY está vazio. Remova a variável ou informe false, hops ou IPs confiáveis.',
    );
  }

  const normalized = value.toLowerCase();
  if (normalized === 'false') return false;
  if (normalized === 'true') {
    throw new Error(
      'TRUST_PROXY=true não é permitido. Informe hops ou IPs/sub-redes confiáveis após confirmar a topologia.',
    );
  }

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (Number.isSafeInteger(hops)) return hops;
    throw new Error(
      'TRUST_PROXY inválido. A quantidade de hops deve ser um inteiro não negativo seguro.',
    );
  }

  const ranges = value.split(',').map((range) => range.trim().toLowerCase());
  if (ranges.some((range) => !isValidProxyRange(range))) {
    throw new Error(
      'TRUST_PROXY inválido. Use false, uma quantidade de hops ou IPs/sub-redes válidos separados por vírgula.',
    );
  }

  return ranges;
}
