import { createContext } from 'react'
import type { LoginInput } from '../services/api/authService'
import type { Usuario } from '../types/domain'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  status: AuthStatus
  user: Usuario | null
  isCliente: boolean
  isBarbeiro: boolean
  login: (input: LoginInput) => Promise<Usuario>
  logout: () => void
}

/** Contexto da sessão (separado do Provider para o Fast Refresh). */
export const AuthContext = createContext<AuthContextValue | null>(null)
