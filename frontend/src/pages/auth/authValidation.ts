import { ApiError } from '../../services/api/ApiError.ts'

export const PASSWORD_RECOVERY_ACCEPTED_MESSAGE =
  'Solicitação processada. Se houver uma conta elegível, as instruções poderão ser encaminhadas para o e-mail informado.'

export function registrationNameError(name: string): string | null {
  const normalizedName = name.trim()
  if (!normalizedName) return 'Informe seu nome.'
  if (normalizedName.length < 2) {
    return 'O nome deve ter pelo menos 2 caracteres.'
  }
  if (normalizedName.length > 120) {
    return 'O nome deve ter no máximo 120 caracteres.'
  }
  return null
}

export function normalizePhone(phone: string): string {
  return phone.trim().replace(/[()\s-]/g, '')
}

export function registrationPhoneError(phone: string): string | null {
  if (!/^\d{10,11}$/.test(normalizePhone(phone))) {
    return 'Telefone deve conter DDD e 10 ou 11 dígitos.'
  }
  return null
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return false
  }

  const [localPart, domain] = email.split('@')
  if (
    !localPart ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    email.includes('..')
  ) {
    return false
  }

  const labels = domain.split('.')
  return labels.every(
    (label) =>
      label.length > 0 && !label.startsWith('-') && !label.endsWith('-'),
  )
}

export function validatePasswordReset(
  password: string,
  confirmation: string,
): string | null {
  if (password.length < 8) {
    return 'A nova senha deve ter pelo menos 8 caracteres.'
  }
  if (new TextEncoder().encode(password).length > 72) {
    return 'A nova senha excede o limite de 72 bytes.'
  }
  if (password !== confirmation) {
    return 'A confirmação deve ser igual à nova senha.'
  }
  return null
}

export function readAuthToken(searchParams: URLSearchParams): string {
  const token = searchParams.get('token')?.trim() ?? ''
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : ''
}

export function removeVerificationTokenFromAddressBar(
  searchParams: URLSearchParams,
  location: Pick<Location, 'pathname' | 'hash'>,
  history: Pick<History, 'state' | 'replaceState'>,
): void {
  if (!searchParams.has('token')) return

  const cleanSearchParams = new URLSearchParams(searchParams)
  cleanSearchParams.delete('token')
  const query = cleanSearchParams.toString()
  const cleanUrl = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`

  history.replaceState(history.state, '', cleanUrl)
}

export function redactTokenFromMessage(
  message: string,
  token: string,
  fallback: string,
): string {
  return token && message.includes(token) ? fallback : message
}

export function authRequestErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof ApiError)) return fallback

  if (error.status === 401) {
    return 'Sua sessão expirou. Entre novamente para continuar.'
  }
  if (error.status === 429) {
    return 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.'
  }
  if (error.status === 503) {
    return 'O serviço de e-mail está indisponível no momento. Tente novamente mais tarde.'
  }

  return error.message || fallback
}