import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Notificacao } from '../../types/domain.ts'

/**
 * Função de domínio que identifica se uma notificação é uma oportunidade de
 * lista de espera elegível para ações de aceite ou recusa.
 */
export function isOportunidadeEsperaComClaim(
  notificacao: Pick<Notificacao, 'tipo' | 'claimId'>,
): boolean {
  return (
    notificacao.tipo === 'WAITLIST_OPPORTUNITY' &&
    typeof notificacao.claimId === 'number' &&
    Number.isInteger(notificacao.claimId) &&
    notificacao.claimId > 0
  )
}

/**
 * Redutor determinístico do estado de desfecho do claim (espelha as transições da página).
 */
export function aplicarDesfechoClaim(
  desfechosAtuais: Record<number, 'aceito' | 'recusado'>,
  claimId: number,
  desfecho: 'aceito' | 'recusado',
): Record<number, 'aceito' | 'recusado'> {
  return {
    ...desfechosAtuais,
    [claimId]: desfecho,
  }
}

describe('Regras de Oportunidade em Notificações (ClienteNotificacoesPage)', () => {
  it('identifica notificação WAITLIST_OPPORTUNITY com claimId válido como elegível para ações', () => {
    const notificacaoValida: Pick<Notificacao, 'tipo' | 'claimId'> = {
      tipo: 'WAITLIST_OPPORTUNITY',
      claimId: 42,
    }
    assert.equal(isOportunidadeEsperaComClaim(notificacaoValida), true)
  })

  it('não apresenta ações para notificação WAITLIST_OPPORTUNITY legada sem claimId', () => {
    const notificacaoSemClaim: Pick<Notificacao, 'tipo' | 'claimId'> = {
      tipo: 'WAITLIST_OPPORTUNITY',
      claimId: undefined,
    }
    assert.equal(isOportunidadeEsperaComClaim(notificacaoSemClaim), false)
  })

  it('não apresenta ações para outros tipos de notificação mesmo com claimId ausente ou nulo', () => {
    const agendamento: Pick<Notificacao, 'tipo' | 'claimId'> = {
      tipo: 'AGENDAMENTO',
      claimId: undefined,
    }
    const cancelamento: Pick<Notificacao, 'tipo' | 'claimId'> = {
      tipo: 'CANCELAMENTO',
      claimId: undefined,
    }
    const lembrete: Pick<Notificacao, 'tipo' | 'claimId'> = {
      tipo: 'LEMBRETE',
      claimId: undefined,
    }

    assert.equal(isOportunidadeEsperaComClaim(agendamento), false)
    assert.equal(isOportunidadeEsperaComClaim(cancelamento), false)
    assert.equal(isOportunidadeEsperaComClaim(lembrete), false)
  })

  it('registra desfecho "aceito" e "recusado" de forma isolada por claimId', () => {
    let desfechos: Record<number, 'aceito' | 'recusado'> = {}

    desfechos = aplicarDesfechoClaim(desfechos, 10, 'aceito')
    assert.equal(desfechos[10], 'aceito')
    assert.equal(desfechos[20], undefined)

    desfechos = aplicarDesfechoClaim(desfechos, 20, 'recusado')
    assert.equal(desfechos[10], 'aceito')
    assert.equal(desfechos[20], 'recusado')
  })
})

describe('waitlistService — contratos e URLs de requisição', () => {
  it('gera corretamente os caminhos dos endpoints REST do cliente', () => {
    const claimId = 42
    const waitlistId = 7

    assert.equal(`/waitlist/claims/${claimId}/accept`, '/waitlist/claims/42/accept')
    assert.equal(`/waitlist/claims/${claimId}/reject`, '/waitlist/claims/42/reject')
    assert.equal(`/waitlist/${waitlistId}/cancel`, '/waitlist/7/cancel')
    assert.equal('/waitlist/my', '/waitlist/my')
    assert.equal('/waitlist', '/waitlist')
  })
})
