import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, type ComponentType, type Context } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer, type ViteDevServer } from 'vite'
import type { AuthContextValue } from '../../contexts/auth-context'
import type { ToastContextValue } from '../../contexts/toast-context'
import type { Usuario } from '../../types/domain'
import type { PrivacyRequestsHistoryProps } from './PrivacyRequestsHistory'

test('renders the request form and approved options for clients and barbers', async () => {
  const server: ViteDevServer = await createServer({
    configFile: `${process.cwd()}/vite.config.ts`,
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  })

  try {
    const { PrivacidadePage } = (await server.ssrLoadModule(
      '/src/pages/privacidade/PrivacidadePage.tsx',
    )) as { PrivacidadePage: ComponentType }
    const { AuthContext } = (await server.ssrLoadModule(
      '/src/contexts/auth-context.ts',
    )) as { AuthContext: Context<AuthContextValue | null> }
    const { ToastContext } = (await server.ssrLoadModule(
      '/src/contexts/toast-context.ts',
    )) as { ToastContext: Context<ToastContextValue | null> }
    const { PrivacyRequestsHistory } = (await server.ssrLoadModule(
      '/src/pages/privacidade/PrivacyRequestsHistory.tsx',
    )) as {
      PrivacyRequestsHistory: ComponentType<PrivacyRequestsHistoryProps>
    }
    const toast: ToastContextValue = {
      notify: () => {},
      success: () => {},
      error: () => {},
    }

    for (const tipoUsuario of ['CLIENTE', 'BARBEIRO'] as const) {
      const user: Usuario = {
        id: 12,
        nome: 'Titular de teste',
        telefone: '11999999999',
        email: 'titular@example.test',
        tipoUsuario,
        ativo: true,
        dataCriacao: '2026-01-01T00:00:00.000Z',
        dataAtualizacao: '2026-01-01T00:00:00.000Z',
      }
      const auth: AuthContextValue = {
        status: 'authenticated',
        user,
        isCliente: tipoUsuario === 'CLIENTE',
        isBarbeiro: tipoUsuario === 'BARBEIRO',
        login: async () => user,
        logout: () => {},
      }
      const markup = renderToStaticMarkup(
        createElement(
          MemoryRouter,
          null,
          createElement(
            AuthContext.Provider,
            { value: auth },
            createElement(
              ToastContext.Provider,
              { value: toast },
              createElement(PrivacidadePage),
            ),
          ),
        ),
      )

      assert.match(markup, /Registrar uma solicitação/)
      assert.match(markup, /Categoria da solicitação/)
      assert.match(markup, /Acesso e exportação/)
      assert.match(markup, /Correção/)
      assert.match(markup, /Exclusão ou anonimização/)
      assert.match(markup, /Outras solicitações/)
    }

    const emptyHistory = renderToStaticMarkup(
      createElement(PrivacyRequestsHistory, {
        requests: [],
        loading: false,
        error: null,
        cursor: null,
        loadingMore: false,
        moreError: null,
        onRetry: () => {},
        onLoadMore: () => {},
      }),
    )
    assert.match(emptyHistory, /Nenhuma solicitação registrada/)

    const populatedHistory = renderToStaticMarkup(
      createElement(PrivacyRequestsHistory, {
        requests: [
          {
            id: 33,
            categoria: 'CORRECAO',
            status: 'RECEBIDA',
            dataCriacao: '2026-11-12T10:00:00.000Z',
          },
        ],
        loading: false,
        error: null,
        cursor: 33,
        loadingMore: false,
        moreError: null,
        onRetry: () => {},
        onLoadMore: () => {},
      }),
    )
    assert.match(populatedHistory, /Correção/)
    assert.match(populatedHistory, /Recebida/)
    assert.match(populatedHistory, /Registrada em/)
    assert.match(populatedHistory, /Carregar mais solicitações/)
    assert.doesNotMatch(populatedHistory, /Excluir solicitação|Alterar status/)
  } finally {
    await server.close()
  }
})
