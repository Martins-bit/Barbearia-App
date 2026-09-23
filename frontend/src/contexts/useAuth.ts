import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './auth-context'

/** Acessa a sessão do usuário. Uso: dentro do AuthProvider. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>.')
  }
  return context
}