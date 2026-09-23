import type { ReactNode } from 'react'
import styles from './Toast.module.css'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastData {
  id: string
  tone: ToastTone
  message: string
  title?: string
}

interface ToastItemProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const TONE_LABEL: Record<ToastTone, string> = {
  success: 'Sucesso',
  error: 'Erro',
  info: 'Informação',
}

/** Item de feedback. Região aria-live é fornecida pelo container. */
export function ToastItem({ toast, onDismiss }: ToastItemProps) {
  return (
    <div className={`${styles.toast} ${styles[toast.tone]}`} role="status">
      <span className={styles.accent} aria-hidden="true" />
      <div className={styles.content}>
        <span className={styles.srTone}>{TONE_LABEL[toast.tone]}</span>
        {toast.title && <p className={styles.title}>{toast.title}</p>}
        <p className={styles.message}>{toast.message}</p>
      </div>
      <button
        type="button"
        className={styles.close}
        onClick={() => onDismiss(toast.id)}
        aria-label="Fechar aviso"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6 6 18 18M18 6 6 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}

/** Container fixo que agrupa os itens de toast. */
export function ToastContainer({ children }: { children: ReactNode }) {
  return (
    <div className={styles.container} aria-live="polite" aria-atomic="false">
      {children}
    </div>
  )
}