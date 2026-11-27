const LOCAL_API_BASE_URL = 'http://localhost:3000'

function isLocalDevelopmentHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '192.168.1.7' ||
    normalized === '192.168.1.11'
  )
}

function invalidApiBaseUrl(): Error {
  return new Error(
    'VITE_API_URL deve ser uma origem HTTP(S) sem credenciais, caminhos, query ou fragmento; em produção, use HTTPS.',
  )
}

export function resolveApiBaseUrl(
  configuredUrl: string | undefined,
  isProduction: boolean,
): string {
  const candidate = configuredUrl?.trim()
  if (!candidate) {
    if (isProduction) {
      throw new Error(
        'VITE_API_URL é obrigatória em produção. Configure a origem HTTPS do backend no ambiente de build.',
      )
    }
    return LOCAL_API_BASE_URL
  }

  const authority = candidate.match(/^https?:\/\/([^/?#\\]*)\/?$/i)?.[1]
  if (
    !authority ||
    authority.includes('@') ||
    candidate.includes('*') ||
    candidate.includes('?') ||
    candidate.includes('#') ||
    candidate.includes('\\')
  ) {
    throw invalidApiBaseUrl()
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw invalidApiBaseUrl()
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin === 'null' ||
    (isProduction && url.protocol !== 'https:') ||
    (url.protocol === 'http:' &&
      !isLocalDevelopmentHostname(url.hostname))
  ) {
    throw invalidApiBaseUrl()
  }

  return url.origin
}

export const API_BASE_URL = resolveApiBaseUrl(
  import.meta.env?.VITE_API_URL,
  import.meta.env?.PROD ?? false,
)
