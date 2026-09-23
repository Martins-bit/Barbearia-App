import { Navigate, Route, Routes } from 'react-router-dom'
import { ClientLayout, BarberLayout } from '../layouts/AreaLayouts'
import { RedirectIfAuthenticated, RequireAuth } from './guards'
import { ROUTES } from './routes'
import { LoginPage } from '../pages/auth/LoginPage'
import { RegisterPage } from '../pages/auth/RegisterPage'
import {
  AgendamentoPage,
  BarbeirosPage,
  ClienteHomePage,
  ClienteMensagensPage,
  ClienteNotificacoesPage,
  ClientePerfilPage,
  MeusAgendamentosPage,
} from '../pages/cliente/ClientePages'
import {
  AgendaPage,
  BarbeiroHomePage,
  BarbeiroMensagensPage,
  BarbeiroNotificacoesPage,
  BarbeiroPerfilPage,
  BloqueiosPage,
  HorariosPage,
  ListaEsperaPage,
  ServicosPage,
} from '../pages/barbeiro/BarbeiroPages'
import { NotFoundPage } from '../pages/NotFoundPage'

/**
 * Árvore de rotas do app. Conceitualmente separada em:
 *   - públicas (login, cadastro);
 *   - protegidas do cliente (RequireAuth role="CLIENTE");
 *   - protegidas do barbeiro (RequireAuth role="BARBEIRO").
 * A autorização real é decidida pelo backend; aqui apenas refletimos o papel
 * já confirmado pelo servidor na sessão.
 */
export function AppRouter() {
  return (
    <Routes>
      <Route
        path={ROUTES.login}
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path={ROUTES.register}
        element={
          <RedirectIfAuthenticated>
            <RegisterPage />
          </RedirectIfAuthenticated>
        }
      />

      {/* Área do cliente */}
      <Route
        path={ROUTES.cliente.home}
        element={
          <RequireAuth role="CLIENTE">
            <ClientLayout>
              <ClienteHomePage />
            </ClientLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.cliente.barbeiros}
        element={
          <RequireAuth role="CLIENTE">
            <ClientLayout>
              <BarbeirosPage />
            </ClientLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.cliente.agendamento}
        element={
          <RequireAuth role="CLIENTE">
            <ClientLayout>
              <AgendamentoPage />
            </ClientLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.cliente.agendamentos}
        element={
          <RequireAuth role="CLIENTE">
            <ClientLayout>
              <MeusAgendamentosPage />
            </ClientLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.cliente.notificacoes}
        element={
          <RequireAuth role="CLIENTE">
            <ClientLayout>
              <ClienteNotificacoesPage />
            </ClientLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.cliente.mensagens}
        element={
          <RequireAuth role="CLIENTE">
            <ClientLayout>
              <ClienteMensagensPage />
            </ClientLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.cliente.perfil}
        element={
          <RequireAuth role="CLIENTE">
            <ClientLayout>
              <ClientePerfilPage />
            </ClientLayout>
          </RequireAuth>
        }
      />

      {/* Área do barbeiro */}
      <Route
        path={ROUTES.barbeiro.home}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <BarbeiroHomePage />
            </BarberLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.barbeiro.agenda}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <AgendaPage />
            </BarberLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.barbeiro.servicos}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <ServicosPage />
            </BarberLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.barbeiro.horarios}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <HorariosPage />
            </BarberLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.barbeiro.bloqueios}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <BloqueiosPage />
            </BarberLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.barbeiro.listaEspera}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <ListaEsperaPage />
            </BarberLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.barbeiro.notificacoes}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <BarbeiroNotificacoesPage />
            </BarberLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.barbeiro.mensagens}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <BarbeiroMensagensPage />
            </BarberLayout>
          </RequireAuth>
        }
      />
      <Route
        path={ROUTES.barbeiro.perfil}
        element={
          <RequireAuth role="BARBEIRO">
            <BarberLayout>
              <BarbeiroPerfilPage />
            </BarberLayout>
          </RequireAuth>
        }
      />

      <Route path="/" element={<Navigate to={ROUTES.login} replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}