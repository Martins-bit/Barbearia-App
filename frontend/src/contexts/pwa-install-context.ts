import { createContext } from 'react'

export interface PwaInstallContextValue {
  isInstalled: boolean
  hasNativePrompt: boolean
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

export const PwaInstallContext = createContext<PwaInstallContextValue | null>(
  null,
)
