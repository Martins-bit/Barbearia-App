import { useState } from 'react'
import { useAuth } from '../../contexts/useAuth'
import { usePwaInstall } from '../../contexts/usePwaInstall'
import {
  canShowPwaInstallOption,
  getPwaInstallInstructions,
  isIosInstallPlatform,
} from '../../services/pwa/pwaInstall'
import styles from './PwaInstallOption.module.css'

export function PwaInstallOption() {
  const { user } = useAuth()
  const { isInstalled, hasNativePrompt, install } = usePwaInstall()
  const [showInstructions, setShowInstructions] = useState(false)
  const [installFailed, setInstallFailed] = useState(false)

  if (!canShowPwaInstallOption(user?.tipoUsuario ?? null, isInstalled)) {
    return null
  }

  const isIos = isIosInstallPlatform(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  )
  const instructions = getPwaInstallInstructions(isIos)

  async function handleInstall() {
    setInstallFailed(false)
    if (!hasNativePrompt) {
      setShowInstructions((visible) => !visible)
      return
    }

    try {
      const outcome = await install()
      if (outcome !== 'accepted') setShowInstructions(true)
    } catch {
      setInstallFailed(true)
      setShowInstructions(true)
    }
  }

  return (
    <section className={styles.container} aria-label="Instalação do aplicativo">
      <button
        className={styles.installButton}
        type="button"
        aria-expanded={showInstructions}
        aria-controls="pwa-install-instructions"
        onClick={() => void handleInstall()}
      >
        Instalar aplicativo
      </button>
      <div
        className={styles.instructions}
        id="pwa-install-instructions"
        role="status"
        aria-live="polite"
        hidden={!showInstructions}
      >
        <p>
          {installFailed ? 'Não foi possível abrir a instalação. ' : ''}
          {instructions}
        </p>
        <button
          className={styles.dismissButton}
          type="button"
          onClick={() => setShowInstructions(false)}
        >
          Fechar instruções
        </button>
      </div>
    </section>
  )
}
