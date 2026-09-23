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
