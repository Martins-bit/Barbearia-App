import { http } from './http'
import type { Conversa, Mensagem } from '../../types/domain'

/**
 * Serviço REST de mensagens (CLIENTE <-> BARBEIRO).
 *
 * Contrato exato do backend (`MessagesController`, Etapas 7A/7B, mesma
 * camada já usada pelo cliente — nada aqui é específico do barbeiro):
 * - POST  /messages               { destinatarioId, conteudo } → Mensagem
 * - GET   /messages/conversations → Conversa[]
 * - GET   /messages/unread-count  → { count: number }
 * - GET   /messages/:userId       → Mensagem[] (ordem cronológica crescente)
 * - PATCH /messages/:id/read      → Mensagem
 *
 * O remetente NUNCA vem do payload: o servidor decide pelo JWT.
 */
export interface EnviarMensagemInput {
  /** ID do outro participante. */
  destinatarioId: number
  /** 1..500 caracteres (validado no servidor). */
  conteudo: string
}

export const messagesService = {
  /**
   * Conversas do usuário autenticado (identidade vinda do JWT no servidor).
   * Retorna o outro participante, a última mensagem e a contagem de não lidas.
   */
  listConversations(signal?: AbortSignal): Promise<Conversa[]> {
    return http.get<Conversa[]>('/messages/conversations', { signal })
  },

  /**
   * Histórico com o participante indicado, em ordem cronológica crescente
   * (mais antiga → mais recente), pronta para exibição em sequência.
   */
  listConversation(usuarioId: number, signal?: AbortSignal): Promise<Mensagem[]> {
    return http.get<Mensagem[]>(`/messages/${usuarioId}`, { signal })
  },

  /** Total de mensagens não lidas do usuário autenticado. */
  unreadCount(signal?: AbortSignal): Promise<{ count: number }> {
    return http.get<{ count: number }>('/messages/unread-count', { signal })
  },

  /** Envia uma mensagem (persistida no PostgreSQL; o remetente vem do JWT). */
  send(input: EnviarMensagemInput): Promise<Mensagem> {
    return http.post<Mensagem>('/messages', input)
  },

  /** Marca uma mensagem como lida (idempotente, do próprio destinatário). */
  markAsRead(id: number): Promise<Mensagem> {
    return http.patch<Mensagem>(`/messages/${id}/read`)
  },
}
