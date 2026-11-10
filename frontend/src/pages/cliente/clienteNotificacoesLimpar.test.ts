import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Notificacao } from '../../types/domain.ts'
import {
  clearAndLoadNotificationSnapshot,
  type NotificationClearApi,
} from '../../services/api/notificationSync.ts'

const comum: Notificacao = {
  id: 1,
  tipo: 'AGENDAMENTO',
  titulo: 'Agendamento confirmado',
  mensagem: 'Seu agendamento foi confirmado.',
  lida: false,
  dataCriacao: '2026-10-30T10:00:00.000Z',
  dataLeitura: null,
  agendamentoId: 10,
}

const oportunidadeProtegida: Notificacao = {
  id: 2,
  tipo: 'WAITLIST_OPPORTUNITY',
  titulo: 'Novo horário disponível',
  mensagem: 'Um horário ficou disponível.',
  lida: false,
  dataCriacao: '2026-10-30T11:00:00.000Z',
  dataLeitura: null,
  claimId: 42,
  claimStatus: 'ATIVO',
}

function createApi({
  cleared,
  notifications,
  unreadCount,
  clearError,
  listError,
  unreadError,
}: {
  cleared: number
  notifications: Notificacao[]
  unreadCount: number
  clearError?: Error
  listError?: Error
  unreadError?: Error
}) {
  const calls: string[] = []
  const api: NotificationClearApi = {
    async clearAll() {
      calls.push('clear')
      if (clearError) throw clearError
      return { cleared }
    },
    async list() {
      calls.push('list')
      if (listError) throw listError
      return notifications
    },
    async unreadCount() {
      calls.push('unreadCount')
      if (unreadError) throw unreadError
      return { count: unreadCount }
    },
  }

  return { api, calls }
}

describe('Sincronização de limpeza de notificações', () => {
  it('cliente: substitui a lista pela resposta do servidor quando todas foram limpas', async () => {
    const { api, calls } = createApi({
      cleared: 2,
      notifications: [],
      unreadCount: 0,
    })
    let itens = [comum, { ...comum, id: 3, lida: true }]

    const snapshot = await clearAndLoadNotificationSnapshot(api)
    itens = snapshot.notifications

    assert.deepEqual(itens, [])
    assert.equal(snapshot.cleared, 2)
    assert.equal(snapshot.unreadCount, 0)
    assert.deepEqual(calls, ['clear', 'list', 'unreadCount'])
  })

  it('barbeiro: mantém visíveis as notificações protegidas que o servidor retorna', async () => {
    const { api } = createApi({
      cleared: 1,
      notifications: [oportunidadeProtegida],
      unreadCount: 1,
    })
    let itens: Notificacao[] = [comum, oportunidadeProtegida]

    const snapshot = await clearAndLoadNotificationSnapshot(api)
    itens = snapshot.notifications

    assert.deepEqual(itens, [oportunidadeProtegida])
    assert.equal(snapshot.cleared, 1)
    assert.equal(snapshot.unreadCount, 1)
  })

  it('preserva a lista atual se a chamada de limpeza falhar', async () => {
    const { api, calls } = createApi({
      cleared: 0,
      notifications: [],
      unreadCount: 0,
      clearError: new Error('Falha ao limpar'),
    })
    const itensAntes = [comum, oportunidadeProtegida]
    let itens = [...itensAntes]

    await assert.rejects(async () => {
      const snapshot = await clearAndLoadNotificationSnapshot(api)
      itens = snapshot.notifications
    })

    assert.deepEqual(itens, itensAntes)
    assert.deepEqual(calls, ['clear'])
  })

  it('preserva a lista atual se não conseguir buscar o estado atualizado', async () => {
    const { api } = createApi({
      cleared: 1,
      notifications: [oportunidadeProtegida],
      unreadCount: 1,
      listError: new Error('Falha ao atualizar a lista'),
    })
    const itensAntes = [comum, oportunidadeProtegida]
    let itens = [...itensAntes]

    await assert.rejects(async () => {
      const snapshot = await clearAndLoadNotificationSnapshot(api)
      itens = snapshot.notifications
    })

    assert.deepEqual(itens, itensAntes)
  })

  it('preserva a lista atual se não conseguir atualizar o contador', async () => {
    const { api } = createApi({
      cleared: 1,
      notifications: [oportunidadeProtegida],
      unreadCount: 1,
      unreadError: new Error('Falha ao atualizar o contador'),
    })
    const itensAntes = [comum, oportunidadeProtegida]
    let itens = [...itensAntes]

    await assert.rejects(async () => {
      const snapshot = await clearAndLoadNotificationSnapshot(api)
      itens = snapshot.notifications
    })

    assert.deepEqual(itens, itensAntes)
  })

  it('substitui os itens em vez de anexar a resposta e criar duplicações', async () => {
    const notificacaoAtualizada = { ...oportunidadeProtegida, lida: true }
    const { api } = createApi({
      cleared: 1,
      notifications: [notificacaoAtualizada],
      unreadCount: 0,
    })
    let itens = [comum, oportunidadeProtegida]

    const snapshot = await clearAndLoadNotificationSnapshot(api)
    itens = snapshot.notifications

    assert.deepEqual(itens, [notificacaoAtualizada])
    assert.equal(new Set(itens.map((item) => item.id)).size, itens.length)
    assert.equal(snapshot.unreadCount, 0)
  })
})
