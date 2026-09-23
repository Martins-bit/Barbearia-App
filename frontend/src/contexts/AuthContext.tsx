import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authService } from '../services/api/authService'
import { authTokenStorage } from '../services/api/http'
import type { LoginInput } from '../services/api/authService'
import type { Usuario } from '../types/domain'
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context'

/**
 * Sessão do usuário. A identidade e o papel vêm SEMPRE do backend
 * (GET /auth/me), nunca de dados guardados no cliente — o token é apenas um
 * portador. Ao iniciar, se houver token, revalida a sessão no servidor.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<Usuario | null>(null)

  useEffect(() => {
    let active = true

    async function restoreSession() {
      if (!authTokenStorage.get()) {
        if (active) setStatus('unauthenticated')
        return
      }
      try {
        const currentUser = await authService.me()
        if (!active) return
        setUser(currentUser)
        setStatus('authenticated')
      } catch {
        if (!active) return
        authTokenStorage.clear()
        setUser(null)
        setStatus('unauthenticated')
      }
    }

    void restoreSession()
    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    const response = await authService.login(input)
    setUser(response.user)
    setStatus('authenticated')
    return response.user
  }, [])

  const logout = useCallback(() => {
    authService.logout()
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const userRole = user?.tipoUsuario ?? null

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isCliente: userRole === 'CLIENTE',
      isBarbeiro: userRole === 'BARBEIRO',
      login,
      logout,
    }),
    [status, user, userRole, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
