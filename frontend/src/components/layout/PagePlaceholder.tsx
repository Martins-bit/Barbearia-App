import type { ReactNode } from 'react'
import styles from './PagePlaceholder.module.css'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

/** Cabeçalho padrão de página das áreas autenticadas. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}

interface PagePlaceholderProps {
  title: string
  description: string
  /** O que será construído aqui, em uma linha. */
  note?: string
}

/**
 * Marcador de página das telas ainda não implementadas. Não é conteúdo final:
 * serve para validar a navegação, o layout e a hierarquia visual da fundação.
 */
export function PagePlaceholder({ title, description, note }: PagePlaceholderProps) {
  return (
    <div className={styles.page}>
      <PageHeader title={title} description={description} />
      <div className={styles.body}>
        <span className={styles.badge}>Em construção</span>
        {note && <p className={styles.note}>{note}</p>}
      </div>
    </div>
  )
}