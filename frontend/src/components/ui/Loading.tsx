import styles from './Loading.module.css'

interface LoadingProps {
  /** Texto exibido sob o indicador. */
  label?: string
  /** Ocupa a área disponível centralizando o indicador. */
  fullArea?: boolean
}

/** Indicador de carregamento acessível. */
export function Loading({ label = 'Carregando', fullArea = false }: LoadingProps) {
  return (
    <div
      className={[styles.wrapper, fullArea ? styles.fullArea : '']
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
    >
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  )
}