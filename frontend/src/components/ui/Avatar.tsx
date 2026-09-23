import styles from './Avatar.module.css'

interface AvatarProps {
  /** Nome completo: usado para compor as iniciais. */
  name: string
  /** Tamanho em px. */
  size?: number
}

/** Iniciais do nome em um disco discreto. Sem imagem, sem emoji. */
export function Avatar({ name, size = 40 }: AvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')

  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  )
}
