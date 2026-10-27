/** Data de hoje no fuso da barbearia (America/Sao_Paulo) como "YYYY-MM-DD". */
export function todayDateKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return parts
}

/** Dia da semana (0=domingo..6=sábado) de uma data "YYYY-MM-DD" (calendário). */
export function weekdayFromDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export const SCHEDULE_TIMEZONE = 'America/Sao_Paulo'

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const zonedPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHEDULE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Partes de calendário do instante no fuso da barbearia. */
export function getZonedParts(instant: Date): ZonedParts {
  const parts = zonedPartsFormatter.formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((item) => item.type === type)
    return Number(part ? part.value : '0')
  }

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  }
}

/**
 * Converte um horário LOCAL da barbearia (data "YYYY-MM-DD" + "HH:mm") no instante real UTC.
 * Algoritmo idêntico ao do backend (tz.util.ts), sem presumir offset estático do navegador.
 */
export function zonedWallTimeToUtc(dateKey: string, hhmm: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = hhmm.split(':').map(Number)

  const requestedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0)

  const wallOf = (instantMs: number): number => {
    const parts = getZonedParts(new Date(instantMs))
    return Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    )
  }

  let guessMs = requestedAsUtc
  guessMs = requestedAsUtc - (wallOf(guessMs) - requestedAsUtc)
  if (wallOf(guessMs) !== requestedAsUtc) {
    guessMs -= wallOf(guessMs) - requestedAsUtc
  }

  return new Date(guessMs)
}

/** Instante UTC de início do agendamento no fuso da barbearia. */
export function appointmentStartInstant(data: string, horaInicio: string): Date {
  return zonedWallTimeToUtc(data, horaInicio.slice(0, 5))
}

/** Instante UTC de término do agendamento no fuso da barbearia. */
export function appointmentEndInstant(data: string, horaFim: string): Date {
  return zonedWallTimeToUtc(data, horaFim.slice(0, 5))
}
