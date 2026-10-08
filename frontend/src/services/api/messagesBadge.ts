import { messagesService } from './messagesService'
import { messagesSocket } from './messagesSocket'
import { authTokenStorage } from './http'
import type { Mensagem } from '../../types/domain'

/**
 * Store mínimo do total de MENSAGENS não lidas (fonte única para o badge do
 * menu e para a página de mensagens — evita contadores divergentes).
 *
 * - `refresh()`: busca GET /messages/unread-count e publica;
 * - o singleton do socket alimenta o store em tempo real: mensagem recebida
 *   de outro usuário soma 1 (o desconto acontece quando a página marcar
 *   como lida, via `descontar`).
 *
 * Não é estado React: é um observable simples, uma única fonte de verdade
 * por aba, compartilhada entre layout e páginas sem props/contexto novo.
 */
type Listener = (total: number) => void

let total = 0
const listeners = new Set<Listener>()
/** Usuario.id do dono da sessão (definido em refresh). */
let donoSessaoId: number | null = null
let iniciado = false

function publicar(valor: number): void {
  total = Math.max(0, valor)
  for (const listener of [...listeners]) listener(total)
}

function iniciar(): void {
  if (iniciado) return
  iniciado = true
  messagesSocket.subscribe((mensagem: Mensagem) => {
    // Só mensagens RECEBIDAS do outro participante somam ao total.
    if (
      donoSessaoId !== null &&
      mensagem.destinatarioUsuarioId === donoSessaoId &&
      mensagem.remetenteUsuarioId !== donoSessaoId
    ) {
      publicar(total + 1)
    }
  })
  void messagesSocket.connect().catch(() => undefined)
}

export const messagesBadge = {
  get(): number {
    return total
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(total)
    return () => {
      listeners.delete(listener)
    }
  },
  /** Busca o total no backend e passa a acompanhar em tempo real. */
  refresh(usuarioId: number | null): void {
    if (!usuarioId || !authTokenStorage.get()) return
    donoSessaoId = usuarioId
    iniciar()
    const controller = new AbortController()
    messagesService
      .unreadCount(controller.signal)
      .then((res) => publicar(res.count))
      .catch(() => undefined)
  },
  /** A página marcou mensagem(s) como lida(s): desconta do total. */
  descontar(quantidade = 1): void {
    publicar(total - quantidade)
  },
}
