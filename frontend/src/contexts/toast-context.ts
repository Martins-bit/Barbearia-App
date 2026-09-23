import { createContext } from 'react'
import type { ToastTone } from '../components/ui/Toast'

export interface ToastContextValue {
  notify: (message: string, options?: { tone?: ToastTone; title?: string }) => void
  success: (message: string, title?: string) => void
  error: (message: string, title?: string) => void
}

/** Contexto do feedback global (separado do Provider para o Fast Refresh). */
export const ToastContext = createContext<ToastContextValue | null>(null)
