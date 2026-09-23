import { useContext } from 'react'
import { ToastContext, type ToastContextValue } from './toast-context'

/** Acessa o sistema de feedback global. Uso: dentro do ToastProvider. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast deve ser usado dentro de <ToastProvider>.')
  }
  return context
}