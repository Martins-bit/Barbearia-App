import type { BadgeProps } from '../../components/ui/Badge'
import type { StatusAgendamento } from '../../types/domain'

/** Rótulo do status vindo do backend (StatusAgendamento). Sem status inventado. */
const STATUS_LABEL: Record<StatusAgendamento, string> = {
  CONFIRMADO: 'Confirmado',
  CANCELADO: 'Cancelado',
  CONCLUIDO: 'Concluído',
  NAO_COMPARECEU: 'Não compareceu',
}

const STATUS_TONE: Record<StatusAgendamento, BadgeProps['tone']> = {
  CONFIRMADO: 'success',
  CANCELADO: 'danger',
  CONCLUIDO: 'neutral',
  NAO_COMPARECEU: 'warning',
}

export function statusLabel(status: StatusAgendamento): string {
  return STATUS_LABEL[status] ?? status
}

export function statusTone(status: StatusAgendamento): BadgeProps['tone'] {
  return STATUS_TONE[status] ?? 'neutral'
}

const WEEKDAY_LABEL = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
]

const MONTH_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

const MONTH_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** Partes numéricas de uma data de calendário "YYYY-MM-DD" (sem fuso). */
export function splitDateKey(dateKey: string): {
  day: number
  month: number
  year: number
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

/** "2026-09-27" → "domingo, 27 de setembro". */
export function formatDateKeyLong(dateKey: string): string {
  const parts = splitDateKey(dateKey)
  if (!parts) return dateKey
  const weekday = WEEKDAY_LABEL[
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  ]
  return `${weekday}, ${parts.day} de ${MONTH_LONG[parts.month - 1]}`
}

/** "2026-09-27" → "27 set" (compacto, para listas e seletor de datas). */
export function formatDateKeyShort(dateKey: string): string {
  const parts = splitDateKey(dateKey)
  if (!parts) return dateKey
  return `${parts.day} ${MONTH_SHORT[parts.month - 1]}`
}

/** Inicial curta do dia da semana: "D", "S", "T", "Q", "Q", "S", "S". */
export function weekdayInitial(dateKey: string): string {
  const parts = splitDateKey(dateKey)
  if (!parts) return '·'
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay()
  return WEEKDAY_LABEL[weekday].charAt(0).toUpperCase()
}