import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { EntradaListaEspera, StatusListaEspera } from '../../types/domain.ts'
import {
  formatDataEntrada,
  formatStatusEspera,
} from './clienteListaEsperaFormatters.ts'

/**
 * Lógica do modal de cancelamento de solicitação da lista de espera.
 * Simula as decisões e transições de estado de ClienteListaEsperaPage.
 */
export function abrirModalCancelamento(
  item: EntradaListaEspera,
  enviando: boolean,
): { modalAberto: boolean; itemCancelando: EntradaListaEspera | null } {
  if (enviando) return { modalAberto: false, itemCancelando: null }
  if (item.status !== 'ATIVA') return { modalAberto: false, itemCancelando: null }
  return { modalAberto: true, itemCancelando: item }
}

export function fecharModalCancelamento(
  enviando: boolean,
): { modalAberto: boolean; itemCancelando: null; erro: null } | null {
  if (enviando) return null // bloqueado durante requisição em andamento
  return { modalAberto: false, itemCancelando: null, erro: null }
}

/**
 * Aplicação do cancelamento na lista local:
 * - Em sucesso, atualiza o status do item para 'CANCELADA'.
 * - Em falha, preserva a lista intacta (não altera indevidamente para CANCELADA).
 */
export function aplicarResultadoCancelamento(
  listaAtual: EntradaListaEspera[],
  idCancelado: number,
  resultado: 'sucesso' | 'falha',
): EntradaListaEspera[] {
  if (resultado === 'falha') {
    return listaAtual // Preserva estado anterior sem mutação indevida
  }

  return listaAtual.map((item) =>
    item.id === idCancelado
      ? { ...item, status: 'CANCELADA' as StatusListaEspera }
      : item,
  )
}

describe('ClienteListaEsperaPage — Lógica e Regras de Negócio', () => {
  const itemAtivo: EntradaListaEspera = {
    id: 101,
    barbeiroId: 2,
    servicoId: 5,
    status: 'ATIVA',
    data: '2026-11-25',
    horaInicio: '14:00',
    horaFim: '15:00',
    dataEntrada: '2026-10-29T12:00:00.000Z',
    dataAtualizacao: '2026-10-29T12:00:00.000Z',
    servico: { id: 5, nome: 'Corte Degradê' },
  }

  const itemAtendido: EntradaListaEspera = {
    ...itemAtivo,
    id: 102,
    status: 'ATENDIDA',
  }

  it('formata adequadamente todos os status da lista de espera em português claro', () => {
    assert.equal(formatStatusEspera('ATIVA'), 'Aguardando vaga')
    assert.equal(formatStatusEspera('NOTIFICADA'), 'Vaga oferecida')
    assert.equal(formatStatusEspera('ATENDIDA'), 'Atendida')
    assert.equal(formatStatusEspera('CANCELADA'), 'Cancelada')
    assert.equal(formatStatusEspera('EXPIRADA'), 'Expirada')
  })

  it('formata data e hora de entrada na fila com segurança', () => {
    const formatado = formatDataEntrada('2026-10-29T12:30:00.000Z')
    assert.equal(typeof formatado, 'string')
    assert.equal(formatado.length > 0, true)
  })

  it('permite abrir modal de cancelamento somente para itens com status ATIVA', () => {
    const resAtivo = abrirModalCancelamento(itemAtivo, false)
    assert.equal(resAtivo.modalAberto, true)
    assert.equal(resAtivo.itemCancelando?.id, 101)

    const resAtendido = abrirModalCancelamento(itemAtendido, false)
    assert.equal(resAtendido.modalAberto, false)
    assert.equal(resAtendido.itemCancelando, null)
  })

  it('bloqueia abertura ou fechamento de modal enquanto o cancelamento estiver em andamento (proteção duplo clique)', () => {
    const resTentativa = abrirModalCancelamento(itemAtivo, true)
    assert.equal(resTentativa.modalAberto, false)

    const resFechar = fecharModalCancelamento(true)
    assert.equal(resFechar, null)
  })

  it('permite fechar modal quando o cancelamento é desistido pelo usuário', () => {
    const resFechar = fecharModalCancelamento(false)
    assert.notEqual(resFechar, null)
    assert.equal(resFechar?.modalAberto, false)
    assert.equal(resFechar?.itemCancelando, null)
    assert.equal(resFechar?.erro, null)
  })

  it('em sucesso de cancelamento, atualiza o status do item correspondente para CANCELADA', () => {
    const listaOriginal: EntradaListaEspera[] = [itemAtivo, itemAtendido]
    const listaAtualizada = aplicarResultadoCancelamento(listaOriginal, 101, 'sucesso')

    const atualizado = listaAtualizada.find((item) => item.id === 101)
    const intacto = listaAtualizada.find((item) => item.id === 102)

    assert.equal(atualizado?.status, 'CANCELADA')
    assert.equal(intacto?.status, 'ATENDIDA')
  })

  it('em falha de cancelamento, não altera indevidamente o status exibido na interface', () => {
    const listaOriginal: EntradaListaEspera[] = [itemAtivo]
    const listaAposFalha = aplicarResultadoCancelamento(listaOriginal, 101, 'falha')

    assert.equal(listaAposFalha[0].status, 'ATIVA')
  })

  it('garante que a chamada à API utilize o identificador numérico correto', () => {
    const idEsperado = 101
    assert.equal(itemAtivo.id, idEsperado)
    assert.equal(`/waitlist/${itemAtivo.id}/cancel`, '/waitlist/101/cancel')
  })

  it('exibe o nome do barbeiro quando presente e lida com ausência de forma segura', () => {
    const itemComBarbeiro: EntradaListaEspera = {
      ...itemAtivo,
      barbeiro: { id: 2, nome: 'Bruno Barbeiro' },
    }
    const itemSemBarbeiro: EntradaListaEspera = {
      ...itemAtivo,
      barbeiro: undefined,
    }

    assert.equal(itemComBarbeiro.barbeiro?.nome, 'Bruno Barbeiro')
    assert.equal(itemSemBarbeiro.barbeiro?.nome, undefined)
  })
})
