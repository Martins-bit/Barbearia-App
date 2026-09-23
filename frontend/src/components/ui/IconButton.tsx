import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './IconButton.module.css'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Rótulo acessível obrigatório (o botão é apenas ícone). */
  label: string
  size?: 'sm' | 'md'
  children: ReactNode
}

/** Botão somente-ícone, com rótulo acessível. Uso contido. */
export function IconButton({
  label,
  size = 'md',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={[styles.iconButton, styles[size], className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  )
}