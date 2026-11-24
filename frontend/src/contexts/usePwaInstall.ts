import { useContext } from 'react'
import { PwaInstallContext } from './pwa-install-context'

export function usePwaInstall() {
  const context = useContext(PwaInstallContext)
  if (!context) {
    throw new Error('usePwaInstall deve ser usado dentro de <PwaInstallProvider>.')
  }
  return context
}
