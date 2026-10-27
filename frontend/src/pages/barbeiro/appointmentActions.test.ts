import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canComplete, canNoShow, formatDateLabel } from './appointmentActions.ts'
import {
  appointmentEndInstant,
  appointmentStartInstant,
  zonedWallTimeToUtc,
} from '../../utils/date.ts'
import type { StatusAgendamento } from '../../types/domain.ts'

describe('appointmentActions — fusos e regras de conclusão e falta', () => {
  const agendamentoPadrao = {
    data: '2026-10-27',
    horaInicio: '10:00',
    horaFim: '10:30',
    status: 'CONFIRMADO' as StatusAgendamento,
  }

  // Em America/Sao_Paulo (UTC-3):
  // 10:00 SP = 13:00 UTC
  // 10:30 SP = 13:30 UTC
  const inicioUtcMs = Date.UTC(2026, 9, 27, 13, 0, 0)
  const fimUtcMs = Date.UTC(2026, 9, 27, 13, 30, 0)

  it('converte corretamente o horário da barbearia para o instante UTC absoluto', () => {
    const inicio = appointmentStartInstant(agendamentoPadrao.data, agendamentoPadrao.horaInicio)
    const fim = appointmentEndInstant(agendamentoPadrao.data, agendamentoPadrao.horaFim)

    assert.equal(inicio.getTime(), inicioUtcMs)
    assert.equal(fim.getTime(), fimUtcMs)
  })

  it('habilita concluir e falta quando o horário de término já passou', () => {
    // 1 minuto após o fim (10:31 SP = 13:31 UTC)
    const depoisDoFim = new Date(fimUtcMs + 60_000)

    assert.equal(canComplete(agendamentoPadrao, depoisDoFim), true)
    assert.equal(canNoShow(agendamentoPadrao, depoisDoFim), true)
  })

  it('desabilita concluir quando o horário de término ainda não chegou', () => {
    // 1 minuto antes do fim (10:29 SP = 13:29 UTC)
    const antesDoFim = new Date(fimUtcMs - 60_000)

    assert.equal(canComplete(agendamentoPadrao, antesDoFim), false)
    // Mas o atendimento já começou (10:29 > 10:00), então pode marcar falta se cliente não compareceu
    assert.equal(canNoShow(agendamentoPadrao, antesDoFim), true)
  })

  it('desabilita concluir e marcar falta quando o agendamento ainda nem começou', () => {
    // 10 minutos antes do início (09:50 SP = 12:50 UTC)
    const antesDoInicio = new Date(inicioUtcMs - 10 * 60_000)

    assert.equal(canComplete(agendamentoPadrao, antesDoInicio), false)
    assert.equal(canNoShow(agendamentoPadrao, antesDoInicio), false)
  })

  it('trata exatamente o instante de início e o instante de fim (fronteira exata)', () => {
    const exatamenteNoInicio = new Date(inicioUtcMs)
    const exatamenteNoFim = new Date(fimUtcMs)

    assert.equal(canNoShow(agendamentoPadrao, exatamenteNoInicio), true)
    assert.equal(canComplete(agendamentoPadrao, exatamenteNoFim), true)
  })

  it('compara corretamente horários próximos à meia-noite e na virada de dia', () => {
    // Agendamento terminando às 23:59 em 2026-10-27 (02:59 UTC em 2026-10-28)
    const agendamentoFimDoDia = {
      data: '2026-10-27',
      horaInicio: '23:30',
      horaFim: '23:59',
      status: 'CONFIRMADO' as StatusAgendamento,
    }

    const fimDoDiaUtcMs = Date.UTC(2026, 9, 28, 2, 59, 0)
    assert.equal(
      appointmentEndInstant(agendamentoFimDoDia.data, agendamentoFimDoDia.horaFim).getTime(),
      fimDoDiaUtcMs,
    )

    const umMinutoAntes = new Date(fimDoDiaUtcMs - 60_000)
    const doisMinutosDepois = new Date(fimDoDiaUtcMs + 2 * 60_000) // Já no dia 2026-10-28

    assert.equal(canComplete(agendamentoFimDoDia, umMinutoAntes), false)
    assert.equal(canComplete(agendamentoFimDoDia, doisMinutosDepois), true)

    // Agendamento começando na meia-noite 00:00 de 2026-10-28 (03:00 UTC de 2026-10-28)
    const agendamentoMeiaNoite = {
      data: '2026-10-28',
      horaInicio: '00:00',
      horaFim: '00:45',
      status: 'CONFIRMADO' as StatusAgendamento,
    }
    const meiaNoiteUtcMs = Date.UTC(2026, 9, 28, 3, 0, 0)
    assert.equal(
      appointmentStartInstant(agendamentoMeiaNoite.data, agendamentoMeiaNoite.horaInicio).getTime(),
      meiaNoiteUtcMs,
    )

    const antesMeiaNoite = new Date(meiaNoiteUtcMs - 60_000) // 23:59 do dia anterior
    const naMeiaNoite = new Date(meiaNoiteUtcMs)

    assert.equal(canNoShow(agendamentoMeiaNoite, antesMeiaNoite), false)
    assert.equal(canNoShow(agendamentoMeiaNoite, naMeiaNoite), true)
  })

  it('não habilita concluir ou falta se o status não for CONFIRMADO', () => {
    const muitoDepois = new Date(fimUtcMs + 3600_000)
    const statusNaoPermitidos: StatusAgendamento[] = [
      'CONCLUIDO',
      'CANCELADO',
      'NAO_COMPARECEU',
    ]

    for (const status of statusNaoPermitidos) {
      const agendamento = { ...agendamentoPadrao, status }
      assert.equal(canComplete(agendamento, muitoDepois), false)
      assert.equal(canNoShow(agendamento, muitoDepois), false)
    }
  })

  it('independe do fuso local do navegador pois a resolução baseia-se em America/Sao_Paulo', () => {
    // 14:00 SP = 17:00 UTC
    const dateUtc = zonedWallTimeToUtc('2026-10-27', '14:00')
    assert.equal(dateUtc.toISOString(), '2026-10-27T17:00:00.000Z')
  })

  it('formatDateLabel exibe a data correta ("27 de out.") para "2026-10-27" independente do fuso horário', () => {
    assert.equal(formatDateLabel('2026-10-27'), '27 de out.')
  })
})
