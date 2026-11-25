import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  NavigateFunction,
  NavigateOptions,
  To,
} from 'react-router-dom'
import { createServer, type ViteDevServer } from 'vite'
import { ROUTES } from '../../routes/routes.ts'

test('navigates to email confirmation before the success notification', async () => {
  const server: ViteDevServer = await createServer({
    configFile: `${process.cwd()}/vite.config.ts`,
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  })

  try {
    const { completeConfirmedRegistration } = (await server.ssrLoadModule(
      '/src/pages/auth/RegisterPage.tsx',
    )) as {
      completeConfirmedRegistration: (
        navigate: NavigateFunction,
        email: string,
        emailConfirmationSent: boolean,
        notifySuccess: () => void,
      ) => void
    }

    for (const emailConfirmationSent of [true, false]) {
      const actions: Array<{
        type: 'navigate' | 'notify'
        to?: unknown
        options?: unknown
      }> = []
      const navigate: NavigateFunction = (
        to: To | number,
        options?: NavigateOptions,
      ) => {
        actions.push({ type: 'navigate', to, options })
      }

      completeConfirmedRegistration(
        navigate,
        'cliente@example.com',
        emailConfirmationSent,
        () => actions.push({ type: 'notify' }),
      )

      assert.deepEqual(actions, [
        {
          type: 'navigate',
          to: ROUTES.confirmEmail,
          options: {
            replace: true,
            state: {
              email: 'cliente@example.com',
              emailConfirmationSent,
            },
          },
        },
        { type: 'notify' },
      ])
    }

    const actionsAfterNotificationFailure: string[] = []
    const navigate: NavigateFunction = (
      to: To | number,
      _options?: NavigateOptions,
    ) => {
      actionsAfterNotificationFailure.push(`navigate:${String(to)}`)
    }

    assert.throws(
      () =>
        completeConfirmedRegistration(
          navigate,
          'cliente@example.com',
          true,
          () => {
            actionsAfterNotificationFailure.push('notify')
            throw new Error('Toast indisponível.')
          },
        ),
      /Toast indisponível/,
    )
    assert.deepEqual(actionsAfterNotificationFailure, [
      `navigate:${ROUTES.confirmEmail}`,
      'notify',
    ])
  } finally {
    await server.close()
  }
})
