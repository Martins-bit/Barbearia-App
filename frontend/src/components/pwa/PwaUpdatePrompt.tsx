import { useRegisterSW } from 'virtual:pwa-register/react'
import { useToast } from '../../contexts/useToast'
import styles from './PwaUpdatePrompt.module.css'

export function PwaUpdatePrompt() {
  const { error } = useToast()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: () => {
      error('Não foi possível registrar a atualização do aplicativo.')
    },
  })

  if (!needRefresh) return null

  const applyUpdate = () => {
    void updateServiceWorker().catch(() => {
      error('Não foi possível atualizar o aplicativo. Tente novamente.')
    })
  }

  return (
    <aside className={styles.prompt} role="status" aria-live="polite">
      <p>Uma nova versão do aplicativo está disponível.</p>
      <button type="button" onClick={applyUpdate}>
        Atualizar
      </button>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => setNeedRefresh(false)}
      >
        Depois
      </button>
    </aside>
  )
}
