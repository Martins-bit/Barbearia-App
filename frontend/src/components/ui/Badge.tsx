import type { ReactNode } from 'react'
import styles from './Badge.module.css'

type Tone = 'neutral' | 'gold' | 'success' | 'danger' | 'warning' | 'info'

interface BadgeProps {
  tone?: Tone
  children: ReactNode
}

/** Rótulo compacto para status e categorias. Uso textual, sem emojis. */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>
}
