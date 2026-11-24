import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { authService } from '../services/api/authService'
import { ApiError } from '../services/api/ApiError'
import {
  authTokenStorage,
  subscribeToAuthSessionRevalidationRequests,
  subscribeToAuthSessionChanges,
} from '../services/api/http'
import { messagesSocket } from '../services/api/messagesSocket'
import { messagesBadge } from '../services/api/messagesBadge'
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
  const [validationAttempt, setValidationAttempt] = useState(0)
  const validationId = useRef(0)
  const revalidationInProgress = useRef(false)

  useEffect(() => {
    let active = true

    async function validateSession() {
      const currentValidationId = ++validationId.current
      messagesSocket.disconnect()
      messagesBadge.reset()
      setUser(null)
      setStatus('loading')

      const tokenAtStart = authTokenStorage.get()
      if (!tokenAtStart) {
        if (active && currentValidationId === validationId.current) {
          setStatus('unauthenticated')
        }
        return
      }

      try {
        const currentUser = await authService.me()
        if (!active || currentValidationId !== validationId.current) return
        if (authTokenStorage.get() !== tokenAtStart) return
        setUser(currentUser)
        setStatus('authenticated')
      } catch (error) {
        if (!active || currentValidationId !== validationId.current) return
        if (authTokenStorage.get() !== tokenAtStart) return

        if (error instanceof ApiError && error.status === 401) {
          authTokenStorage.clear()
          setUser(null)
          setStatus('unauthenticated')
        } else {
          setUser(null)
          setStatus('error')
        }
      }
    }

    const unsubscribe = subscribeToAuthSessionChanges(() => {
      void validateSession()
    })
    const unsubscribeRevalidation =
      subscribeToAuthSessionRevalidationRequests(() => {
        const tokenAtStart = authTokenStorage.get()
        if (!active || !tokenAtStart || revalidationInProgress.current) return

        revalidationInProgress.current = true
        void authService
          .me()
          .then((currentUser) => {
            if (!active || authTokenStorage.get() !== tokenAtStart) return
            setUser(currentUser)
            setStatus('authenticated')
          })
          .catch(() => {
            // A 401 from /auth/me clears the matching token in the HTTP layer.
            // Other failures leave the current session untouched.
          })
          .finally(() => {
            revalidationInProgress.current = false
          })
      })
    void validateSession()

    return () => {
      active = false
      unsubscribe()
      unsubscribeRevalidation()
    }
  }, [validationAttempt])

  const login = useCallback(async (input: LoginInput) => {
    const response = await authService.login(input)
    // Sessão nova: derruba qualquer socket herdado da sessão anterior. A
    // identidade do socket vem do JWT do handshake — mantê-la causaria envios
    // atribuídos ao usuário anterior (Etapa 8.9).
    messagesSocket.disconnect()
    messagesBadge.reset()
    setUser(response.user)
    setStatus('authenticated')
    return response.user
  }, [])

  const logout = useCallback(async () => {
    const logoutRequest = authService.logout()
    messagesSocket.disconnect()
    messagesBadge.reset()
    setUser(null)
    setStatus('unauthenticated')

    try {
      await logoutRequest
    } catch {
      // A limpeza local é obrigatória mesmo quando a API não confirmar a
      // revogação. Nenhum toast de sucesso deve ser mostrado por este fluxo.
    }
  }, [])

  const retrySessionValidation = useCallback(() => {
    setValidationAttempt((attempt) => attempt + 1)
  }, [])

  const userRole = user?.tipoUsuario ?? null

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isCliente: userRole === 'CLIENTE',
      isBarbeiro: userRole === 'BARBEIRO',
      isAdmin: userRole === 'ADMIN',
      login,
      logout,
      retrySessionValidation,
    }),
    [status, user, userRole, login, logout, retrySessionValidation],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
