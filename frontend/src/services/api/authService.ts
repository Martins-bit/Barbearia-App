import { http, authTokenStorage } from './http.ts'
import type { LoginResponse, Usuario, UpdateUserInput } from '../../types/domain'

export interface LoginInput {
  telefone: string
  senha: string
}

export interface RegisterInput {
  nome: string
  telefone: string
  senha: string
  email: string
}

export interface AuthMessageResponse {
  message: string
}

/**
 * Serviço de autenticação — endpoints reais do backend.
 * Endpoints de autenticação, perfil, confirmação de e-mail e recuperação.
 */
export const authService = {
  async login(input: LoginInput): Promise<LoginResponse> {
    const response = await http.post<LoginResponse>('/auth/login', input, {
      skipAuth: true,
    })
    authTokenStorage.set(response.token)
    return response
  },

  register(input: RegisterInput): Promise<Usuario> {
    return http.post<Usuario>('/auth/register', input, { skipAuth: true })
  },

  requestEmailVerification(): Promise<AuthMessageResponse> {
    return http.post<AuthMessageResponse>(
      '/auth/email/verification/request',
      undefined,
    )
  },

  confirmEmail(token: string): Promise<AuthMessageResponse> {
    return http.post<AuthMessageResponse>(
      '/auth/email/verification/confirm',
      { token },
      { skipAuth: true },
    )
  },

  requestPasswordRecovery(email: string): Promise<AuthMessageResponse> {
    return http.post<AuthMessageResponse>(
      '/auth/password-recovery',
      { email },
      { skipAuth: true },
    )
  },

  resetPassword(token: string, senha: string): Promise<AuthMessageResponse> {
    return http.post<AuthMessageResponse>(
      '/auth/password-reset',
      { token, senha },
      { skipAuth: true },
    )
  },

  me(signal?: AbortSignal): Promise<Usuario> {
    return http.get<Usuario>('/auth/me', { signal })
  },

  /** PATCH /users/me — atualiza nome, telefone e/ou e-mail da própria conta. */
  updateProfile(input: UpdateUserInput): Promise<Usuario> {
    return http.patch<Usuario>('/users/me', input)
  },

  logout(): void {
    authTokenStorage.clear()
  },
}
