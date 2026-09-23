/* Utilitários de formatação — pt-BR. Sem dependências externas. */

/** Formata "HH:mm" ou uma data ISO como horário local legível. */
export function formatTime(value: string | Date): string {
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
    return value
  }
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Formata "YYYY-MM-DD" (calendário) como "dd/mm/aaaa" sem deslocar o fuso. */
export function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-')
  if (!year || !month || !day) return dateKey
  return `${day}/${month}/${year}`
}

/** Duração em minutos → "1h30" / "45min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`
}

/** Preço informativo ("xx.xx") → "R$ xx,xx". */
export function formatPrice(value: string): string {
  const number = Number(value)
  if (Number.isNaN(number)) return value
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(number)
}

/** Telefone apenas dígitos → "(11) 99999-9999". */
export function formatPhone(digits: string): string {
  const clean = digits.replace(/\D/g, '')
  if (clean.length === 11) {
    return clean.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  }
  if (clean.length === 10) {
    return clean.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  }
  return digits
}
