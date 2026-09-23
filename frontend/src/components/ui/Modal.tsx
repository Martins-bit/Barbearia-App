import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from './icons/Icon'
import { IconButton } from './IconButton'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  /** Ações no rodapé (ex.: botões de confirmar/cancelar). */
  footer?: ReactNode
}

/**
 * Diálogo modal acessível: fecha no Esc e no clique do overlay, trava o
 * scroll do body, move o foco para o diálogo e o devolve ao fechar.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h3 id="modal-title" className={styles.title}>
              {title}
            </h3>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          <IconButton label="Fechar" size="sm" onClick={onClose}>
            <XIcon size={18} />
          </IconButton>
        </div>

        {children && <div className={styles.body}>{children}</div>}

        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}