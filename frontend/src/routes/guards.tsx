import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'
import { Loading } from '../components/ui/Loading'
import { ROUTES } from './routes'

interface RequireAuthProps {
  children: ReactNode
  /** Papel exigido pela rota; ausente = qualquer usuário autenticado. */
  role?: 'CLIENTE' | 'BARBEIRO'
}

/**
 * Protege rotas privadas. Enquanto a sessão é revalidada, exibe carregamento.
 * Sem sessão → redireciona para o login guardando a origem. Papel divergente →
 * redireciona para a área correta do usuário (sem laço de redirecionamento).
 */
export function RequireAuth({ children, role }: RequireAuthProps) {
  const { status, user, isCliente } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <Loading fullArea label="Verificando sessão" />
  }

  if (status === 'unauthenticated' || !user) {
    return <Navigate to={ROUTES.login} state={{ from: location.pathname }} replace />
  }

  if (role && user.tipoUsuario !== role) {
    // Usuário autenticado, mas na área errada: envia para a sua própria área.
    return <Navigate to={isCliente ? ROUTES.cliente.home : ROUTES.barbeiro.home} replace />
  }

  return <>{children}</>
}

/** Impede acesso às rotas públicas quando já autenticado. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { status, user, isCliente } = useAuth()

  if (status === 'loading') {
    return <Loading fullArea label="Verificando sessão" />
  }

  if (status === 'authenticated' && user) {
    return <Navigate to={isCliente ? ROUTES.cliente.home : ROUTES.barbeiro.home} replace />
  }

  return <>{children}</>
}