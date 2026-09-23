import { http, authTokenStorage } from './http'
import type { LoginResponse, Usuario } from '../../types/domain'

export interface LoginInput {
  telefone: string
  senha: string
}

export interface RegisterInput {
  nome: string
  telefone: string
  senha: string
}

/**
 * Serviço de autenticação — endpoints reais do backend.
 * POST /auth/login, POST /auth/register, GET /auth/me.
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

  me(): Promise<Usuario> {
    return http.get<Usuario>('/auth/me')
  },

  logout(): void {
    authTokenStorage.clear()
  },
}
