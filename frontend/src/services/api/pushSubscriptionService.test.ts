import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { pushSubscriptionService } from './pushSubscriptionService.ts'

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator',
)

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  })
}

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator)
  } else {
    Reflect.deleteProperty(globalThis, 'navigator')
  }
})

describe('pushSubscriptionService', () => {
  it('cancels the current service worker push subscription', async () => {
    let unsubscribeCalls = 0
    const subscription = {
      unsubscribe: async () => {
        unsubscribeCalls++
        return true
      },
    }
    setNavigator({
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => subscription,
          },
        }),
      },
    })

    await pushSubscriptionService.clearLocalSubscription()

    assert.equal(unsubscribeCalls, 1)
  })

  it('does nothing when there is no current push subscription', async () => {
    let unsubscribeCalls = 0
    setNavigator({
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => null,
          },
        }),
      },
    })

    await pushSubscriptionService.clearLocalSubscription()

    assert.equal(unsubscribeCalls, 0)
  })

  it('does nothing when Service Worker exists without PushManager', async () => {
    setNavigator({
      serviceWorker: {
        getRegistration: async () => ({}),
      },
    })

    await assert.doesNotReject(
      pushSubscriptionService.clearLocalSubscription(),
    )
  })

  it('rejects when the browser cannot cancel an existing subscription', async () => {
    setNavigator({
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({
              unsubscribe: async () => false,
            }),
          },
        }),
      },
    })

    await assert.rejects(
      pushSubscriptionService.clearLocalSubscription(),
      /inscrição push local não foi cancelada/,
    )
  })

  it('propagates failure to inspect an existing push subscription', async () => {
    setNavigator({
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => {
              throw new Error('Falha ao consultar inscrição')
            },
          },
        }),
      },
    })

    await assert.rejects(
      pushSubscriptionService.clearLocalSubscription(),
      /Falha ao consultar inscrição/,
    )
  })

  it('propagates failure to cancel an existing push subscription', async () => {
    setNavigator({
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({
              unsubscribe: async () => {
                throw new Error('Falha ao cancelar inscrição')
              },
            }),
          },
        }),
      },
    })

    await assert.rejects(
      pushSubscriptionService.clearLocalSubscription(),
      /Falha ao cancelar inscrição/,
    )
  })

  it('does nothing when Service Worker is unavailable', async () => {
    setNavigator({})

    await assert.doesNotReject(
      pushSubscriptionService.clearLocalSubscription(),
    )
  })
})
