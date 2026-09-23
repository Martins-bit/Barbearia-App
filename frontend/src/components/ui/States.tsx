import type { ReactNode } from 'react'
import styles from './States.module.css'

interface StateProps {
  title: string
  description?: string
  /** Ícone opcional (do componente Icon). */
  icon?: ReactNode
  /** Ação opcional (ex.: um Button). */
  action?: ReactNode
}

/** Estado vazio: comunica ausência de conteúdo e oferece um próximo passo. */
export function EmptyState({ title, description, icon, action }: StateProps) {
  return (
    <div className={styles.state} role="status">
      {icon && <span className={styles.icon}>{icon}</span>}
      <h4 className={styles.title}>{title}</h4>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}

/** Estado de erro: mensagem clara e ação de recuperação. */
export function ErrorState({ title, description, icon, action }: StateProps) {
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert">
      {icon && <span className={styles.icon}>{icon}</span>}
      <h4 className={styles.title}>{title}</h4>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}