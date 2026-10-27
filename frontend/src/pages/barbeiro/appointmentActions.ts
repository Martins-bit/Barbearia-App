import type { Agendamento } from '../../types/domain'
import { appointmentEndInstant, appointmentStartInstant } from '../../utils/date.ts'

/**
 * Verifica se um agendamento pode ser concluído pelo barbeiro.
 * Regra idêntica ao backend: status deve ser CONFIRMADO e o instante atual deve ser
 * maior ou igual ao instante de término (horaFim) no fuso da barbearia (America/Sao_Paulo).
 */
export function canComplete(
  agendamento: Pick<Agendamento, 'status' | 'data' | 'horaFim'>,
  now: Date = new Date(),
): boolean {
  if (agendamento.status !== 'CONFIRMADO') return false
  const horarioFim = appointmentEndInstant(agendamento.data, agendamento.horaFim)
  return now.getTime() >= horarioFim.getTime()
}

/**
 * Verifica se um agendamento pode ser marcado como falta (não compareceu) pelo barbeiro.
 * Regra idêntica ao backend: status deve ser CONFIRMADO e o instante atual deve ser
 * maior ou igual ao instante de início (horaInicio) no fuso da barbearia (America/Sao_Paulo).
 */
export function canNoShow(
  agendamento: Pick<Agendamento, 'status' | 'data' | 'horaInicio'>,
  now: Date = new Date(),
): boolean {
  if (agendamento.status !== 'CONFIRMADO') return false
  const horarioInicio = appointmentStartInstant(agendamento.data, agendamento.horaInicio)
  return now.getTime() >= horarioInicio.getTime()
}

/**
 * Formata "YYYY-MM-DD" como data curta ("dd de mmm.") garantindo que
 * a data civil seja interpretada em UTC, sem recuar um dia no fuso brasileiro.
 */
export function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
  }).format(date)
}
