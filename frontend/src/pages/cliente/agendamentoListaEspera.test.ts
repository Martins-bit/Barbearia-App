import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Barbeiro, CreateWaitlistInput, Servico } from '../../types/domain.ts'

/**
 * Validação de dados antes de submeter a entrada na lista de espera.
 * Garante que barbeiro, serviço e data sejam válidos e retorna mensagem de erro ou null.
 */
export function validarEntradaListaEspera(
  barbeiro: Barbeiro | null,
  servico: Servico | null,
  data: string | null,
): { valida: true; payload: CreateWaitlistInput } | { valida: false; erro: string } {
  if (!barbeiro || typeof barbeiro.id !== 'number' || barbeiro.id < 1) {
    return { valida: false, erro: 'Escolha um barbeiro antes de entrar na lista de espera.' }
  }
  if (!servico || typeof servico.id !== 'number' || servico.id < 1) {
    return { valida: false, erro: 'Escolha um serviço antes de entrar na lista de espera.' }
  }
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return { valida: false, erro: 'Escolha uma data antes de entrar na lista de espera.' }
  }

  return {
    valida: true,
    payload: {
      barbeiroId: barbeiro.id,
      servicoId: servico.id,
      data,
    },
  }
}

/**
 * Redutor de estado da lista de espera local da tela de agendamento.
 * Controla os registros confirmados e duplicados (409) por chave única "barbeiroId:servicoId:data".
 */
export function registrarRespostaEspera(
  estadoAtual: {
    esperaRegistrada: Record<string, boolean>
    esperaJaExiste: Record<string, boolean>
  },
  chave: string,
  tipo: 'sucesso' | 'duplicado',
) {
  if (tipo === 'sucesso') {
    return {
      esperaRegistrada: { ...estadoAtual.esperaRegistrada, [chave]: true },
      esperaJaExiste: estadoAtual.esperaJaExiste,
    }
  }

  return {
    esperaRegistrada: estadoAtual.esperaRegistrada,
    esperaJaExiste: { ...estadoAtual.esperaJaExiste, [chave]: true },
  }
}

/**
 * Trava de submissão (guard contra envio duplo / cliques repetidos).
 */
export function podeSubmeterEntrada(entrando: boolean): boolean {
  return !entrando
}

describe('AgendamentoPage — Fluxo de Entrada na Lista de Espera', () => {
  const mockBarbeiro: Barbeiro = { id: 3, usuarioId: 10, nome: 'Bruno Barbeiro' }
  const mockServico: Servico = {
    id: 15,
    nome: 'Barba e Cabelo',
    descricao: 'Completo',
    duracaoMinutos: 45,
    preco: '60.00',
    ativo: true,
  }
  const dataValida = '2026-11-20'

  it('valida com sucesso quando barbeiro, serviço e data estão presentes e consistentes', () => {
    const resultado = validarEntradaListaEspera(mockBarbeiro, mockServico, dataValida)
    assert.equal(resultado.valida, true)
    if (resultado.valida) {
      assert.equal(resultado.payload.barbeiroId, 3)
      assert.equal(resultado.payload.servicoId, 15)
      assert.equal(resultado.payload.data, '2026-11-20')
      assert.equal(resultado.payload.horaInicio, undefined)
      assert.equal(resultado.payload.horaFim, undefined)
    }
  })

  it('impede submissão e explica erro caso barbeiro não esteja selecionado', () => {
    const resultado = validarEntradaListaEspera(null, mockServico, dataValida)
    assert.equal(resultado.valida, false)
    if (!resultado.valida) {
      assert.equal(resultado.erro, 'Escolha um barbeiro antes de entrar na lista de espera.')
    }
  })

  it('impede submissão e explica erro caso serviço não esteja selecionado', () => {
    const resultado = validarEntradaListaEspera(mockBarbeiro, null, dataValida)
    assert.equal(resultado.valida, false)
    if (!resultado.valida) {
      assert.equal(resultado.erro, 'Escolha um serviço antes de entrar na lista de espera.')
    }
  })

  it('impede submissão e explica erro caso data seja inválida ou ausente', () => {
    const resultado = validarEntradaListaEspera(mockBarbeiro, mockServico, '')
    assert.equal(resultado.valida, false)
    if (!resultado.valida) {
      assert.equal(resultado.erro, 'Escolha uma data antes de entrar na lista de espera.')
    }
  })

  it('protege contra cliques repetidos enquanto uma submissão estiver em andamento', () => {
    assert.equal(podeSubmeterEntrada(false), true)
    assert.equal(podeSubmeterEntrada(true), false)
  })

  it('registra sucesso por chave única sem impactar outras combinações', () => {
    const estadoInicial = { esperaRegistrada: {}, esperaJaExiste: {} }
    const chave1 = '3:15:2026-11-20'
    const chave2 = '3:15:2026-11-21'

    const atualizado = registrarRespostaEspera(estadoInicial, chave1, 'sucesso')
    assert.equal(atualizado.esperaRegistrada[chave1], true)
    assert.equal(atualizado.esperaRegistrada[chave2], undefined)
    assert.equal(atualizado.esperaJaExiste[chave1], undefined)
  })

  it('registra duplicidade (HTTP 409) informando que o cliente já possui solicitação ativa', () => {
    const estadoInicial = { esperaRegistrada: {}, esperaJaExiste: {} }
    const chave = '3:15:2026-11-20'

    const atualizado = registrarRespostaEspera(estadoInicial, chave, 'duplicado')
    assert.equal(atualizado.esperaJaExiste[chave], true)
    assert.equal(atualizado.esperaRegistrada[chave], undefined)
  })
})
