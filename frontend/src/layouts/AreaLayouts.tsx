import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppLayout, type NavItem } from './AppLayout'
import { ROUTES } from '../routes/routes'
import { UnreadNotificationsContext } from '../contexts/unread-notifications'
import { notificationsService } from '../services/api/notificationsService'
import { messagesBadge } from '../services/api/messagesBadge'
import { useMensagensNaoLidas } from '../hooks/useMensagensNaoLidas'
import { useAuth } from '../contexts/useAuth'
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
  { label: 'Minha lista de espera', to: ROUTES.cliente.listaEspera, icon: <ClockIcon /> },
  { label: 'Notificações', to: ROUTES.cliente.notificacoes, icon: <BellIcon /> },
  { label: 'Mensagens', to: ROUTES.cliente.mensagens, icon: <MessageIcon />, badge: -1 },
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
  { label: 'Mensagens', to: ROUTES.barbeiro.mensagens, icon: <MessageIcon />, badge: -1 },
  { label: 'Perfil', to: ROUTES.barbeiro.perfil, icon: <UserIcon /> },
]

function useMobileDrawer() {
  const [mobileOpen, setMobileOpen] = useState(false)
  return {
    mobileOpen,
    toggle: () => setMobileOpen((open) => !open),
  }
}

/**
 * Aplica o badge de MENSAGENS não lidas ao item "Mensagens" do menu.
 * Fonte única: `messagesBadge` (REST inicial + tempo real via socket).
 * Independente do contador de NOTIFICAÇÕES, que continua separado.
 */
function useNavComBadgeMensagens(itens: NavItem[], rotaMensagens: string): NavItem[] {
  const naoLidas = useMensagensNaoLidas()
  const { user } = useAuth()

  useEffect(() => {
    messagesBadge.refresh(user?.id ?? null)
  }, [user?.id])

  return useMemo(
    () =>
      itens.map((item) =>
        item.to === rotaMensagens ? { ...item, badge: naoLidas } : item,
      ),
    [itens, rotaMensagens, naoLidas],
  )
}

export function ClientLayout({ children }: { children: ReactNode }) {
  const drawer = useMobileDrawer()
  const navItems = useNavComBadgeMensagens(clientNav, ROUTES.cliente.mensagens)
  return (
    <AppLayout
      areaLabel="Área do cliente"
      navItems={navItems}
      mobileOpen={drawer.mobileOpen}
      onToggleMobile={drawer.toggle}
    >
      {children}
    </AppLayout>
  )
}

export function BarberLayout({ children }: { children: ReactNode }) {
  const drawer = useMobileDrawer()

  // Contador do menu — GET /notifications/unread-count buscado UMA vez na
  // montagem. Sem polling e sem laço: só volta ao backend quando a página de
  // notificações pede uma ressincronização após marcar algo como lido. O
  // AbortController descarta requisições obsoletas (assim uma resposta atrasada
  // nunca sobrescreve um contador mais novo) e evita acúmulo de chamadas em
  // ações rápidas. Uma falha aqui é silenciosa porque o indicador é
  // decorativo — o conteúdo em si é carregado pela própria página, que mostra
  // erro e retentativa.
  const [naoLidas, setNaoLidas] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)

  const refresh = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    notificationsService
      .unreadCount(controller.signal)
      .then((resultado) => {
        if (!controller.signal.aborted) setNaoLidas(resultado.count)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
    return () => controllerRef.current?.abort()
  }, [refresh])

  const navItems = useMemo(
    () =>
      barberNav.map((item) =>
        item.to === ROUTES.barbeiro.notificacoes
          ? { ...item, badge: naoLidas }
          : item,
      ),
    [naoLidas],
  )
  const navComMensagens = useNavComBadgeMensagens(navItems, ROUTES.barbeiro.mensagens)

  const contexto = useMemo(
    () => ({ count: naoLidas, refresh }),
    [naoLidas, refresh],
  )

  return (
    <UnreadNotificationsContext.Provider value={contexto}>
      <AppLayout
        areaLabel="Área do barbeiro"
        navItems={navComMensagens}
        mobileOpen={drawer.mobileOpen}
        onToggleMobile={drawer.toggle}
      >
        {children}
      </AppLayout>
    </UnreadNotificationsContext.Provider>
  )
}