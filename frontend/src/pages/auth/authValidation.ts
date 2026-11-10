import { ApiError } from '../../services/api/ApiError.ts'

export const PASSWORD_RECOVERY_ACCEPTED_MESSAGE =
  'Solicitação processada. Se houver uma conta elegível, as instruções poderão ser encaminhadas para o e-mail informado.'

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