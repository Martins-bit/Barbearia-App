import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ToastContainer, ToastItem, type ToastData } from '../components/ui/Toast'
import { ToastContext, type ToastContextValue } from './toast-context'

const AUTO_DISMISS_MS = 4500

/** Provider de feedback global (toasts). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback<ToastContextValue['notify']>(
    (message, options) => {
      const id = crypto.randomUUID()
      const tone = options?.tone ?? 'info'
      setToasts((current) => [
        ...current,
        { id, tone, message, title: options?.title },
      ])
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      notify,
      success: (message, title) => notify(message, { tone: 'success', title }),
      error: (message, title) => notify(message, { tone: 'error', title }),
    }),
    [notify],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </ToastContainer>
    </ToastContext.Provider>
  )
}