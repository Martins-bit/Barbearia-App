import styles from './BrandLogo.module.css'

interface BrandLogoProps {
  /** Tamanho do emblema em px. */
  size?: number
  /** Exibe o wordmark "BARBEARIA DO BRUNO" ao lado do emblema. */
  withWordmark?: boolean
  /** Classe extra para ajustes de layout do consumidor. */
  className?: string
}

/**
 * Emblema da Barbearia do Bruno — monograma circular com tesoura/navalha.
 * SVG inline (sem dependência externa, sem arquivo binário): escala em
 * qualquer resolução e herda cor via currentColor quando necessário.
 * Cartão de visitas da marca; usado com moderação (login, cabeçalho, rodapé).
 */
export function BrandLogo({
  size = 40,
  withWordmark = false,
  className,
}: BrandLogoProps) {
  return (
    <span className={`${styles.brand} ${className ?? ''}`}>
      <svg
        className={styles.emblem}
        width={size}
        height={size}
        viewBox="0 0 64 64"
        role="img"
        aria-label="Barbearia do Bruno"
      >
        <circle
          cx="32"
          cy="32"
          r="30"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        <circle
          cx="32"
          cy="32"
          r="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="24" cy="40" r="4.5" />
          <circle cx="40" cy="40" r="4.5" />
          <path d="M27 37 L41 19" />
          <path d="M37 37 L23 19" />
        </g>
      </svg>

      {withWordmark && (
        <span className={styles.wordmark}>
          <span className={styles.wordmarkTop}>Barbearia</span>
          <span className={styles.wordmarkBottom}>do Bruno</span>
        </span>
      )}
    </span>
  )
}