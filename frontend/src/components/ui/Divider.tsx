import styles from './Divider.module.css'

interface DividerProps {
  /** Texto central opcional (ex.: "ou"). */
  label?: string
  vertical?: boolean
}

/** Separador discreto. Com `label`, vira um divisor rotulado. */
export function Divider({ label, vertical = false }: DividerProps) {
  if (vertical) {
    return <span className={styles.vertical} role="separator" aria-orientation="vertical" />
  }

  if (label) {
    return (
      <div className={styles.labeled} role="separator">
        <span className={styles.line} />
        <span className={styles.label}>{label}</span>
        <span className={styles.line} />
      </div>
    )
  }

  return <hr className={styles.hr} />
}
