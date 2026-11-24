import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canShowPwaInstallOption,
  getPwaInstallInstructions,
  isIosInstallPlatform,
  isPwaInstalled,
  requestPwaInstall,
  subscribePwaInstallEvents,
  type BeforeInstallPromptEvent,
} from './pwaInstall.ts'

describe('PWA install helpers', () => {
  it('only makes the install option eligible for a BARBEIRO account', () => {
    assert.equal(canShowPwaInstallOption('BARBEIRO', false), true)
    assert.equal(canShowPwaInstallOption('CLIENTE', false), false)
    assert.equal(canShowPwaInstallOption('ADMIN', false), false)
    assert.equal(canShowPwaInstallOption(null, false), false)
    assert.equal(canShowPwaInstallOption('BARBEIRO', true), false)
  })

  it('opens the native install flow and returns the user choice', async () => {
    let promptOpened = false
    const event = {
      prompt: async () => {
        promptOpened = true
      },
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    } as BeforeInstallPromptEvent

    assert.equal(await requestPwaInstall(event), 'accepted')
    assert.equal(promptOpened, true)
  })

  it('detects an installed standalone app through either browser signal', () => {
    assert.equal(isPwaInstalled(true, false), true)
    assert.equal(isPwaInstalled(false, true), true)
    assert.equal(isPwaInstalled(false, false), false)
  })

  it('provides instructions when the browser does not expose a native prompt', () => {
    assert.match(getPwaInstallInstructions(true), /Safari.*Compartilhar/)
    assert.match(getPwaInstallInstructions(false), /menu do navegador/)

    const target = new EventTarget()
    let promptAvailable = false
    const unsubscribe = subscribePwaInstallEvents(
      target,
      () => {
        promptAvailable = true
      },
      () => undefined,
    )

    assert.equal(promptAvailable, false)
    unsubscribe()
  })

  it('captures and suppresses the native beforeinstallprompt event', () => {
    const target = new EventTarget()
    let capturedEvent: BeforeInstallPromptEvent | null = null
    const unsubscribe = subscribePwaInstallEvents(
      target,
      (event) => {
        capturedEvent = event
      },
      () => undefined,
    )
    const event = Object.assign(
      new Event('beforeinstallprompt', { cancelable: true }),
      {
        prompt: async () => undefined,
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      },
    )

    target.dispatchEvent(event)

    assert.equal(event.defaultPrevented, true)
    assert.equal(capturedEvent, event)
    unsubscribe()
  })

  it('detects iOS devices, including touch-capable iPadOS desktop mode', () => {
    assert.equal(isIosInstallPlatform('Mozilla iPhone', 'iPhone', 1), true)
    assert.equal(isIosInstallPlatform('Mozilla', 'MacIntel', 5), true)
    assert.equal(isIosInstallPlatform('Mozilla Windows', 'Win32', 0), false)
  })

  it('handles appinstalled and removes its event listeners on cleanup', () => {
    const target = new EventTarget()
    let installedEvents = 0
    const unsubscribe = subscribePwaInstallEvents(
      target,
      () => undefined,
      () => {
        installedEvents += 1
      },
    )

    target.dispatchEvent(new Event('appinstalled'))
    unsubscribe()
    target.dispatchEvent(new Event('appinstalled'))

    assert.equal(installedEvents, 1)
  })
})
