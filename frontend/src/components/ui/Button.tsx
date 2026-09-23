import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Ocupa a largura disponível. */
  fullWidth?: boolean
  /** Estado de carregamento: desabilita e exibe indicador. */
  loading?: boolean
  /** Ícone opcional à esquerda do rótulo. */
  leftIcon?: ReactNode
  /** Ícone opcional à direita do rótulo. */
  rightIcon?: ReactNode
}

/**
 * Botão base do design system. Variantes:
 * - primary: dourado (ação principal)
 * - secondary: superfície com borda
 * - ghost: transparente (ações discretas)
 * - danger: ação destrutiva (cancelar)
 * Sempre com estados de hover/focus/disabled/loading acessíveis.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  leftIcon,
  rightIcon,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        styles.button,
        styles[variant],
        styles[size],
        fullWidth ? styles.fullWidth : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        leftIcon && <span className={styles.icon}>{leftIcon}</span>
      )}
      <span className={styles.label}>{children}</span>
      {!loading && rightIcon && <span className={styles.icon}>{rightIcon}</span>}
    </button>
  )
}