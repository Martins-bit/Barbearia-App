import { useEffect, useState } from 'react'
import { API_AVAILABILITY_CHANGED_EVENT } from '../../services/api/ApiError'
import { AlertIcon } from '../ui/icons/Icon'
import styles from './ConnectionStatus.module.css'

interface ApiAvailabilityDetail {
  available: boolean
}

export function ConnectionStatus() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  )
  const [apiUnavailable, setApiUnavailable] = useState(false)

  useEffect(() => {
    const handleOffline = () => setOffline(true)
    const handleOnline = () => {
      setOffline(false)
      setApiUnavailable(false)
    }
    const handleApiAvailability = (event: Event) => {
      const detail = (event as CustomEvent<ApiAvailabilityDetail>).detail
      setApiUnavailable(detail?.available === false)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    window.addEventListener(
      API_AVAILABILITY_CHANGED_EVENT,
      handleApiAvailability,
    )

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener(
        API_AVAILABILITY_CHANGED_EVENT,
        handleApiAvailability,
      )
    }
  }, [])

  if (!offline && !apiUnavailable) return null

  return (
    <aside
      className={styles.banner}
      role="alert"
      aria-live="polite"
      aria-label={
        offline
          ? 'Você está sem conexão com a internet'
          : 'O serviço da Barbearia do Bruno está indisponível'
      }
    >
      <span className={styles.icon} aria-hidden="true">
        <AlertIcon size={20} />
      </span>
      <div className={styles.copy}>
        <strong className={styles.title}>
          {offline ? 'Sem conexão com a internet' : 'Serviço temporariamente indisponível'}
        </strong>
        <span className={styles.message}>
          {offline
            ? 'Verifique sua conexão. Você pode continuar navegando, mas algumas informações precisarão da internet.'
            : 'Não foi possível acessar o serviço agora. Tente novamente em alguns instantes.'}
        </span>
      </div>
    </aside>
  )
}
