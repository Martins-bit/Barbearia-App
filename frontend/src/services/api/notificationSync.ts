import type { Notificacao } from '../../types/domain'

export interface NotificationClearApi {
  clearAll: () => Promise<{ cleared: number }>
  list: () => Promise<Notificacao[]>
  unreadCount: () => Promise<{ count: number }>
}

export interface NotificationSnapshot {
  cleared: number
  notifications: Notificacao[]
  unreadCount: number
}

export async function clearAndLoadNotificationSnapshot(
  api: NotificationClearApi,
): Promise<NotificationSnapshot> {
  const { cleared } = await api.clearAll()
  const [notifications, unread] = await Promise.all([
    api.list(),
    api.unreadCount(),
  ])

  return {
    cleared,
    notifications,
    unreadCount: unread.count,
  }
}
