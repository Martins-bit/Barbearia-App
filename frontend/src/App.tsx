import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { AppRouter } from './routes/AppRouter'
import { PwaUpdatePrompt } from './components/pwa/PwaUpdatePrompt'
import { ConnectionStatus } from './components/pwa/ConnectionStatus'
import { PwaInstallProvider } from './contexts/PwaInstallContext'

/**
 * Raiz do app: provedores globais (sessão + feedback) e a árvore de rotas.
 * Ordem: Router → Auth → Toast → rotas.
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <PwaInstallProvider>
            <ConnectionStatus />
            <PwaUpdatePrompt />
            <AppRouter />
          </PwaInstallProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
