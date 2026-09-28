import { http } from './http'
import type { Notificacao } from '../../types/domain'

/**
 * Notificações do usuário autenticado — endpoints reais do backend.
 * GET /notifications, GET /notifications/unread-count,
 * PATCH /notifications/:id/read, PATCH /notifications/read-all.
 * A titularidade é sempre validada no servidor a partir do JWT.
 */
export const notificationsService = {
  /** GET /notifications — todas as notificações, mais recentes primeiro. */
  list(signal?: AbortSignal): Promise<Notificacao[]> {
    return http.get<Notificacao[]>('/notifications', { signal })
  },

  /** GET /notifications/unread-count — contador de notificações não lidas. */
  unreadCount(signal?: AbortSignal): Promise<{ count: number }> {
    return http.get<{ count: number }>('/notifications/unread-count', { signal })
  },

  /**
   * PATCH /notifications/:id/read — marca UMA notificação como lida e devolve
   * a versão atualizada. 404 quando não existe ou não pertence ao usuário.
   */
  markAsRead(id: number): Promise<Notificacao> {
    return http.patch<Notificacao>(`/notifications/${id}/read`)
  },

  /** PATCH /notifications/read-all — marca todas as não lidas como lidas. */
  markAllAsRead(): Promise<{ updated: number }> {
    return http.patch<{ updated: number }>('/notifications/read-all')
  },
}