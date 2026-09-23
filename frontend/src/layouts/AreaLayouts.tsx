import { useState } from 'react'
import type { ReactNode } from 'react'
import { AppLayout, type NavItem } from './AppLayout'
import { ROUTES } from '../routes/routes'
import {
  BellIcon,
  CalendarIcon,
  GridIcon,
  ListIcon,
  MessageIcon,
  ScissorsIcon,
  UserIcon,
  UsersIcon,
  ClockIcon,
  BlockIcon,
  TagIcon,
} from '../components/ui/icons/Icon'

const clientNav: NavItem[] = [
  { label: 'Início', to: ROUTES.cliente.home, icon: <GridIcon />, end: true },
  { label: 'Barbeiros', to: ROUTES.cliente.barbeiros, icon: <UsersIcon /> },
  { label: 'Agendar horário', to: ROUTES.cliente.agendamento, icon: <CalendarIcon /> },
  { label: 'Meus agendamentos', to: ROUTES.cliente.agendamentos, icon: <ListIcon /> },
  { label: 'Notificações', to: ROUTES.cliente.notificacoes, icon: <BellIcon /> },
  { label: 'Mensagens', to: ROUTES.cliente.mensagens, icon: <MessageIcon /> },
  { label: 'Perfil', to: ROUTES.cliente.perfil, icon: <UserIcon /> },
]

const barberNav: NavItem[] = [
  { label: 'Início', to: ROUTES.barbeiro.home, icon: <GridIcon />, end: true },
  { label: 'Agenda', to: ROUTES.barbeiro.agenda, icon: <CalendarIcon /> },
  { label: 'Serviços', to: ROUTES.barbeiro.servicos, icon: <TagIcon /> },
  { label: 'Horários', to: ROUTES.barbeiro.horarios, icon: <ClockIcon /> },
  { label: 'Bloqueios', to: ROUTES.barbeiro.bloqueios, icon: <BlockIcon /> },
  { label: 'Lista de espera', to: ROUTES.barbeiro.listaEspera, icon: <ScissorsIcon /> },
  { label: 'Notificações', to: ROUTES.barbeiro.notificacoes, icon: <BellIcon /> },
  { label: 'Mensagens', to: ROUTES.barbeiro.mensagens, icon: <MessageIcon /> },
  { label: 'Perfil', to: ROUTES.barbeiro.perfil, icon: <UserIcon /> },
]

function useMobileDrawer() {
  const [mobileOpen, setMobileOpen] = useState(false)
  return {
    mobileOpen,
    toggle: () => setMobileOpen((open) => !open),
  }
}

export function ClientLayout({ children }: { children: ReactNode }) {
  const drawer = useMobileDrawer()
  return (
    <AppLayout
      areaLabel="Área do cliente"
      navItems={clientNav}
      mobileOpen={drawer.mobileOpen}
      onToggleMobile={drawer.toggle}
    >
      {children}
    </AppLayout>
  )
}

export function BarberLayout({ children }: { children: ReactNode }) {
  const drawer = useMobileDrawer()
  return (
    <AppLayout
      areaLabel="Área do barbeiro"
      navItems={barberNav}
      mobileOpen={drawer.mobileOpen}
      onToggleMobile={drawer.toggle}
    >
      {children}
    </AppLayout>
  )
}