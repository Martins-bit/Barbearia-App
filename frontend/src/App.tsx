import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { AppRouter } from './routes/AppRouter'

/**
 * Raiz do app: provedores globais (sessão + feedback) e a árvore de rotas.
 * Ordem: Router → Auth → Toast → rotas.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRouter />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
