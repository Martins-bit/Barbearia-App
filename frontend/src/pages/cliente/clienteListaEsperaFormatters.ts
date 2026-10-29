import type { StatusListaEspera } from '../../types/domain'

/**
 * Tradução e apresentação visual dos status de lista de espera do cliente.
 */
export function formatStatusEspera(status: StatusListaEspera): string {
  switch (status) {
    case 'ATIVA':
      return 'Aguardando vaga'
    case 'NOTIFICADA':
      return 'Vaga oferecida'
    case 'ATENDIDA':
      return 'Atendida'
    case 'CANCELADA':
      return 'Cancelada'
    case 'EXPIRADA':
      return 'Expirada'
    default:
      return status
  }
}

/** Formata data/hora de entrada na fila para leitura humana. */
export function formatDataEntrada(isoString: string): string {
  try {
    const d = new Date(isoString)
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return isoString
  }
}
