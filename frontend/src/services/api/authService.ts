import { http, authTokenStorage } from './http.ts'
import { ApiError } from './ApiError.ts'
import { pushSubscriptionService } from './pushSubscriptionService.ts'
import type {
  LoginResponse,
  Usuario,
  UpdateUserInput,
} from '../../types/domain'

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

export interface RegisterResponse extends Usuario {
  emailConfirmationSent: boolean
}

/**
 * Serviço de autenticação — endpoints reais do backend.
 * Endpoints de autenticação, perfil, confirmação de e-mail e recuperação.
 */
export const authService = {
  async login(input: LoginInput): Promise<LoginResponse> {
    try {
      await pushSubscriptionService.clearLocalSubscription()
    } catch {
      throw new ApiError(
        'Não foi possível limpar a inscrição anterior de notificações. Tente novamente.',
        0,
      )
    }

    const response = await http.post<LoginResponse>('/auth/login', input, {
      skipAuth: true,
    })
    authTokenStorage.set(response.token)
    return response
  },

  register(input: RegisterInput): Promise<RegisterResponse> {
    return http.post<RegisterResponse>('/auth/register', input, {
      skipAuth: true,
    })
  },

  requestEmailVerification(): Promise<AuthMessageResponse> {
    return http.post<AuthMessageResponse>(
      '/auth/email/verification/request',
      undefined,
    )
  },

  requestEmailVerificationResend(email: string): Promise<AuthMessageResponse> {
    return http.post<AuthMessageResponse>(
      '/auth/email/verification/resend',
      { email },
      { skipAuth: true },
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
    return http.get<Usuario>('/auth/me', { signal, sessionValidation: true })
  },

  /** PATCH /users/me — atualiza nome, telefone e/ou e-mail da própria conta. */
  updateProfile(input: UpdateUserInput): Promise<Usuario> {
    return http.patch<Usuario>('/users/me', input)
  },

  /** GET /users/me/export — retorna o corpo JSON autenticado sem materializá-lo. */
  exportPersonalData(signal?: AbortSignal): Promise<Response> {
    return http.getStream('/users/me/export', { signal })
  },

  async logout(): Promise<void> {
    const pushCleanup = pushSubscriptionService.clearLocalSubscription()
    const logoutRequest = http.post<AuthMessageResponse>(
      '/auth/logout',
      undefined,
    )
    authTokenStorage.clear()

    try {
      await pushCleanup
    } catch {
      console.warn('Falha ao cancelar inscrição push local durante logout.')
    }

    await logoutRequest
  },
}
