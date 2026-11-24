export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

export function canShowPwaInstallOption(
  role: string | null,
  isInstalled: boolean,
): boolean {
  return role === 'BARBEIRO' && !isInstalled
}

export function isPwaInstalled(
  navigatorStandalone: boolean,
  displayModeStandalone: boolean,
): boolean {
  return navigatorStandalone || displayModeStandalone
}

export function isIosInstallPlatform(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === 'MacIntel' && maxTouchPoints > 1)
  )
}

export function getPwaInstallInstructions(isIos: boolean): string {
  return isIos
    ? 'No Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.'
    : 'Abra o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”, se a opção estiver disponível.'
}

export async function requestPwaInstall(
  event: BeforeInstallPromptEvent,
): Promise<'accepted' | 'dismissed'> {
  await event.prompt()
  const choice = await event.userChoice
  return choice.outcome
}

export function subscribePwaInstallEvents(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  onPromptAvailable: (event: BeforeInstallPromptEvent) => void,
  onInstalled: () => void,
): () => void {
  const handleBeforeInstallPrompt: EventListener = (event) => {
    if (
      !('prompt' in event) ||
      typeof event.prompt !== 'function' ||
      !('userChoice' in event)
    ) {
      return
    }

    event.preventDefault()
    onPromptAvailable(event as BeforeInstallPromptEvent)
  }
  const handleAppInstalled: EventListener = () => onInstalled()

  target.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  target.addEventListener('appinstalled', handleAppInstalled)

  return () => {
    target.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    target.removeEventListener('appinstalled', handleAppInstalled)
  }
}
