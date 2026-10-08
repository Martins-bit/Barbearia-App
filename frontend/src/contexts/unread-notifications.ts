import { createContext, useContext } from 'react'

/**
 * Contador de notificações não lidas do menu da área do barbeiro.
 *
 * Quem busca `GET /notifications/unread-count` é o BarberLayout (dono do menu
 * lateral), que também fornece este contexto às páginas filhas. Assim a página
 * de notificações consegue ressincronizar o indicador após uma marcação de
 * leitura, sem polling, sem laço de requisições e sem novo endpoint.
 */
export interface UnreadNotificationsValue {
  /** Quantidade atual de notificações não lidas. */
  count: number
  /** Ressincroniza o contador junto ao backend (após uma ação do usuário). */
  refresh: () => void
}

export const UnreadNotificationsContext =
  createContext<UnreadNotificationsValue | null>(null)

/** Acessa o contador dentro da área do barbeiro (dentro de <BarberLayout>). */
export function useUnreadNotifications(): UnreadNotificationsValue {
  const context = useContext(UnreadNotificationsContext)
  if (!context) {
    throw new Error(
      'useUnreadNotifications deve ser usado dentro de <BarberLayout>.',
    )
  }
  return context
}
