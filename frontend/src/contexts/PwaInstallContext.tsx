import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  isPwaInstalled,
  requestPwaInstall,
  subscribePwaInstallEvents,
  type BeforeInstallPromptEvent,
} from '../services/pwa/pwaInstall'
import { PwaInstallContext } from './pwa-install-context'

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    const displayMode = window.matchMedia?.('(display-mode: standalone)')
    const updateInstalledState = () => {
      const navigatorStandalone =
        (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true
      setIsInstalled(
        isPwaInstalled(navigatorStandalone, displayMode?.matches ?? false),
      )
    }

    updateInstalledState()
    displayMode?.addEventListener('change', updateInstalledState)

    const unsubscribe = subscribePwaInstallEvents(
      window,
      setDeferredPrompt,
      () => {
        setDeferredPrompt(null)
        setIsInstalled(true)
      },
    )

    return () => {
      displayMode?.removeEventListener('change', updateInstalledState)
      unsubscribe()
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferredPrompt) return 'unavailable'

    try {
      const outcome = await requestPwaInstall(deferredPrompt)
      if (outcome === 'accepted') setIsInstalled(true)
      return outcome
    } finally {
      setDeferredPrompt(null)
    }
  }, [deferredPrompt])

  const value = useMemo(
    () => ({
      isInstalled,
      hasNativePrompt: deferredPrompt !== null,
      install,
    }),
    [isInstalled, deferredPrompt, install],
  )

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
    </PwaInstallContext.Provider>
  )
}
