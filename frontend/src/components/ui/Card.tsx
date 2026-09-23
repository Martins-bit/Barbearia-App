import type { HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Realça a borda em tom dourado (destaque pontual). */
  highlighted?: boolean
  /** Leve elevação ao passar o mouse (uso em itens clicáveis). */
  interactive?: boolean
  children: ReactNode
}

/** Superfície base para agrupar conteúdo. Borda discreta, sombra suave. */
export function Card({
  highlighted = false,
  interactive = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={[
        styles.card,
        highlighted ? styles.highlighted : '',
        interactive ? styles.interactive : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className={styles.header}>
      <div>
        <h3 className={styles.title}>{title}</h3>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
