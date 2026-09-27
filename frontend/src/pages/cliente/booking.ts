import { ApiError } from '../../services/api/ApiError'

/**
 * Helpers do fluxo de agendamento do cliente. Ficam fora dos módulos de
 * componentes para não misturar componentes e funções (Fast Refresh) e para
 * serem reutilizados por todas as telas do fluxo.
 */

/** Mensagem pública de um erro da camada de API, pronta para exibição. */
export function mensagemDoErro(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Ocorreu um erro inesperado. Tente novamente.'
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Soma (ou subtrai) dias a uma data "YYYY-MM-DD" sem deslocar o fuso. */
export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const base = new Date(Date.UTC(year, month - 1, day))
  base.setUTCDate(base.getUTCDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`
}

/** Dias entre duas datas "YYYY-MM-DD" (b - a). */
export function diffInDays(a: string, b: string): number {
  if (!DATE_KEY_PATTERN.test(a) || !DATE_KEY_PATTERN.test(b)) return 0
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const start = Date.UTC(ay, am - 1, ad)
  const end = Date.UTC(by, bm - 1, bd)
  return Math.round((end - start) / 86_400_000)
}

/** A data é anterior a hoje (agendamento já encerrado)? */
export function isDataPassada(dateKey: string, hoje: string): boolean {
  return dateKey < hoje
}