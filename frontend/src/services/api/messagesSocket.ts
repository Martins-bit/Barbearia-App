import { io, type Socket } from 'socket.io-client'
import { authTokenStorage } from './http'
import type { Mensagem } from '../../types/domain'

/**
 * Origem do backend: a MESMA usada pelo REST (VITE_API_URL). O Socket.IO
 * precisa de um destino explícito — sem ele, conectaria à origem da própria
 * página (ex.: http://localhost:5173), onde não existe servidor de socket.
 */
const SOCKET_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/**
 * Conexão WebSocket com o namespace `/messages` do backend (Etapa 7C).
 *
 * - Singleton: UMA conexão por aba — páginas diferentes compartilham a mesma
 *   instância via listeners, sem abrir sockets paralelos.
 * - Autenticação no handshake com `auth.token` (o MESMO JWT do REST, lido de
 *   `authTokenStorage`). O servidor revalida a autorização a cada evento e
 *   desconecta o socket quando o token expira ou a conta é desativada.
 * - Reconexão é da própria socket.io (`reconnection`); ao reconectar, o
 *   handshake revalida o token atual do armazenamento.
 * - Sem polling e sem fila offline: mensagens perdidas ficam no servidor e
 *   voltam pelo REST (GET /messages/:userId) quando a página recarrega.
 *
 * Eventos reais do `MessagesGateway` (backend/src/messages/messages.gateway.ts):
 * - envio:   `message:send`    { destinatarioId, conteudo }
 * - retorno: `message:sent`    MessageResponseDto (confirmação do próprio envio)
 * - entrega: `message:received` MessageResponseDto (mensagem do outro participante)
 * - erro:    `exception`        { status, message } (validação/autorização)
 */
export type MensagemHandler = (mensagem: Mensagem) => void
export type EstadoHandler = (estado: 'conectando' | 'conectado' | 'desconectado') => void

export interface MensajesSocketApi {
  connect(): Promise<void>
  disconnect(): void
  /** Escuta `message:received` (e entrega pendentes). Retorna o unsubscribe. */
  subscribe(handler: MensagemHandler): () => void
  onStateChange(handler: EstadoHandler): () => void
  /** Envia por `message:send` e resolve com a confirmação `message:sent`. */
  send(destinatarioId: number, conteudo: string): Promise<Mensagem>
  isConnected(): boolean
}

/** Timeout de espera pela confirmação do próprio envio (message:sent). */
const SEND_ACK_TIMEOUT_MS = 15_000

export const messagesSocket: MensajesSocketApi = (() => {
  let socket: Socket | null = null
  let estado: 'conectando' | 'conectado' | 'desconectado' = 'desconectado'
  const listenersRecebidos = new Set<MensagemHandler>()
  const listenersEstado = new Set<EstadoHandler>()

  function notificarEstado(): void {
    for (const handler of [...listenersEstado]) handler(estado)
  }

  function setEstado(proximo: typeof estado): void {
    if (estado === proximo) return
    estado = proximo
    notificarEstado()
  }

  function entregar(mensagem: Mensagem): void {
    for (const handler of [...listenersRecebidos]) handler(mensagem)
  }

  const api: MensajesSocketApi = {
    connect(): Promise<void> {
      if (estado === 'conectado' && socket?.connected) {
        return Promise.resolve()
      }

      if (socket) {
        // Reconexão em curso (da própria socket.io): aguarda o connect.
        return new Promise((resolve) => {
          socket?.once('connect', () => resolve())
        })
      }

      const token = authTokenStorage.get()
      if (!token) {
        return Promise.reject(new Error('Sessão não encontrada.'))
      }

      setEstado('conectando')

      // Destino explícito: origem do backend (VITE_API_URL) + namespace
      // dedicado `/messages`, igual ao gateway. `withCredentials` alinha o
      // handshake com o CORS (credentials: true) já configurado no backend.
      const instancia = io(`${SOCKET_URL}/messages`, {
        auth: { token },
        withCredentials: true,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000,
        timeout: 10_000,
      })
      socket = instancia

      instancia.on('connect', () => setEstado('conectado'))
      instancia.io.on('reconnect_attempt', () => setEstado('conectando'))
      instancia.on('disconnect', () => setEstado('desconectado'))
      // Log técnico seguro: motivo da falha do handshake (nunca o JWT).
      instancia.on('connect_error', (erro: Error) => {
        console.warn('[mensagens] connect_error:', erro.message)
        setEstado('desconectado')
      })

      instancia.on('message:received', (mensagem: Mensagem) => {
        if (mensagem && typeof mensagem === 'object' && 'id' in mensagem) {
          entregar(mensagem)
        }
      })

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Não foi possível conectar ao servidor de mensagens.'))
        }, 10_000)
        instancia.once('connect', () => {
          clearTimeout(timer)
          resolve()
        })
        instancia.once('connect_error', () => {
          clearTimeout(timer)
          reject(new Error('Não autorizado para o servidor de mensagens.'))
        })
      })
    },

    disconnect(): void {
      if (socket) {
        socket.removeAllListeners()
        socket.disconnect()
        socket = null
      }
      setEstado('desconectado')
    },

    subscribe(handler: MensagemHandler): () => void {
      listenersRecebidos.add(handler)
      return () => {
        listenersRecebidos.delete(handler)
      }
    },

    onStateChange(handler: EstadoHandler): () => void {
      listenersEstado.add(handler)
      return () => {
        listenersEstado.delete(handler)
      }
    },

    send(destinatarioId: number, conteudo: string): Promise<Mensagem> {
      if (!socket || !socket.connected) {
        return Promise.reject(new Error('Sem conexão com o servidor de mensagens.'))
      }
      // Referência não-nula e imutável para uso dentro da Promise.
      const conexaoAtiva: Socket = socket

      return new Promise((resolve, reject) => {
        let finalizado = false

        const limpar = () => {
          conexaoAtiva.off('message:sent', onSent)
          conexaoAtiva.off('exception', onException)
          conexaoAtiva.off('disconnect', onDisconnect)
        }
        const timer = setTimeout(() => {
          if (finalizado) return
          finalizado = true
          limpar()
          reject(new Error('Tempo de espera excedido ao enviar a mensagem.'))
        }, SEND_ACK_TIMEOUT_MS)

        function onSent(mensagem: Mensagem): void {
          if (finalizado) return
          finalizado = true
          clearTimeout(timer)
          limpar()
          resolve(mensagem)
        }
        function onException(erro: { message?: string } | string): void {
          if (finalizado) return
          finalizado = true
          clearTimeout(timer)
          limpar()
          const mensagem =
            typeof erro === 'string' ? erro : erro?.message ?? 'Não foi possível enviar a mensagem.'
          reject(new Error(mensagem))
        }
        function onDisconnect(): void {
          if (finalizado) return
          finalizado = true
          clearTimeout(timer)
          limpar()
          reject(new Error('Conexão interrompida ao enviar a mensagem.'))
        }

        conexaoAtiva.on('message:sent', onSent)
        conexaoAtiva.on('exception', onException)
        conexaoAtiva.once('disconnect', onDisconnect)
        conexaoAtiva.emit('message:send', { destinatarioId, conteudo })
      })
    },

    isConnected(): boolean {
      return estado === 'conectado'
    },
  }

  return api
})()
