async function unsubscribeCurrentPushSubscription(): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return
  }

  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration || !('pushManager' in registration)) return

  const pushManager = registration.pushManager
  if (
    !pushManager ||
    typeof pushManager.getSubscription !== 'function'
  ) {
    return
  }

  const subscription = await pushManager.getSubscription()
  if (!subscription) return

  if (!(await subscription.unsubscribe())) {
    throw new Error('A inscrição push local não foi cancelada.')
  }
}

let cleanupInProgress: Promise<void> | null = null

export const pushSubscriptionService = {
  clearLocalSubscription(): Promise<void> {
    if (cleanupInProgress) return cleanupInProgress

    cleanupInProgress = unsubscribeCurrentPushSubscription()
    const cleanup = cleanupInProgress
    void cleanup.then(
      () => {
        if (cleanupInProgress === cleanup) cleanupInProgress = null
      },
      () => {
        if (cleanupInProgress === cleanup) cleanupInProgress = null
      },
    )
    return cleanup
  },
}
