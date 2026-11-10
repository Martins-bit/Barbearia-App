export const DELETED_MESSAGE_TEXT = 'Esta mensagem foi apagada'

export interface MensagemExclusaoRegras {
  remetenteUsuarioId: number
  dataCriacao: string
  apagadaParaTodos?: boolean
}

export const MESSAGE_DELETION_LIMIT_MS = 60 * 60 * 1000

export function podeApagarParaTodos(
  mensagem: MensagemExclusaoRegras,
  usuarioId: number | null,
  agora: number = Date.now(),
): boolean {
  if (!usuarioId) return false
  if (mensagem.remetenteUsuarioId !== usuarioId) return false
  if (mensagem.apagadaParaTodos) return false
  const criacao = new Date(mensagem.dataCriacao).getTime()
  return agora - criacao <= MESSAGE_DELETION_LIMIT_MS
}
