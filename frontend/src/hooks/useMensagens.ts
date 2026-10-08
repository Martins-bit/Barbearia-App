import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../services/api/ApiError'
import { messagesService } from '../services/api/messagesService'
import { messagesSocket } from '../services/api/messagesSocket'
import { messagesBadge } from '../services/api/messagesBadge'
import type { Conversa, Mensagem } from '../types/domain'

/** Mensagem pública de uma falha da camada de API. */
function mensagemDeErro(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/** Assinatura do callback opcional de feedback de nova mensagem. */
export type NovaMensagemHandler = (
  mensagem: Mensagem,
  naConversaAberta: boolean,
) => void

/**
 * Lógica compartilhada da tela de mensagens (CLIENTE e BARBEIRO — mesma
 * infraestrutura REST + WebSocket; `messagesSocket` é um singleton por aba).
 *
 * - histórico marcado como lido via PATCH idempotente (desconta do badge);
 * - tempo real via `message:received`, deduplicado por id;
 * - envio via `message:send` aguardando `message:sent`; o rascunho só é
 *   limpo APÓS a confirmação (falha preserva o texto);
 * - badge global sincronizado via `messagesBadge` (layout + páginas);
 * - novas mensagens reportadas por `onNovaMensagem` (toast/feedback).
 */
export function useMensagens(
  usuarioId: number | null,
  onNovaMensagem?: NovaMensagemHandler,
) {
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [selecionadaId, setSelecionadaId] = useState<number | null>(null)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [carregandoConversas, setCarregandoConversas] = useState(true)
  const [carregandoHistorico, setCarregandoHistorico] = useState(false)
  const [erroConversas, setErroConversas] = useState<string | null>(null)
  const [erroHistorico, setErroHistorico] = useState<string | null>(null)
  const [estadoConexao, setEstadoConexao] = useState<
    'conectado' | 'conectando' | 'desconectado'
  >('desconectado')
  const [rascunho, setRascunho] = useState('')
  const [enviando, setEnviando] = useState(false)

  const fimDaListaRef = useRef<HTMLDivElement | null>(null)
  const marcandoRef = useRef<Set<number>>(new Set())
  /** Evita abrir conexão do socket mais de uma vez por página. */
  const socketIniciadoRef = useRef(false)
  /** Callback mais recente sem recriar os listeners a cada render. */
  const notificacaoRef = useRef<NovaMensagemHandler | undefined>(onNovaMensagem)
  notificacaoRef.current = onNovaMensagem

  const selecionada = useMemo(
    () => conversas.find((c) => c.usuarioId === selecionadaId) ?? null,
    [conversas, selecionadaId],
  )

  /** Marca uma mensagem como lida uma única vez (dedupe entre caminhos). */
  const marcarComoLida = useCallback((id: number) => {
    if (marcandoRef.current.has(id)) return
    marcandoRef.current.add(id)
    void messagesService
      .markAsRead(id)
      .then((lida) => {
        setMensagens((atual) =>
          atual.map((item) => (item.id === lida.id ? lida : item)),
        )
        // A página confirmou a leitura: desconta do badge global.
        messagesBadge.descontar(1)
      })
      .catch(() => undefined) // silencioso: estado volta no próximo load
  }, [])

  const carregarConversas = useCallback(async (signal: AbortSignal) => {
    setErroConversas(null)
    setCarregandoConversas(true)
    try {
      const lista = await messagesService.listConversations(signal)
      setConversas(lista)
      return lista
    } catch (error) {
      if (signal.aborted) return []
      setErroConversas(
        mensagemDeErro(error, 'Não foi possível carregar as conversas.'),
      )
      return []
    } finally {
      if (!signal.aborted) setCarregandoConversas(false)
    }
  }, [])

  const carregarHistorico = useCallback(
    async (outraParteId: number, signal: AbortSignal) => {
      setErroHistorico(null)
      setCarregandoHistorico(true)
      setMensagens([])
      try {
        const lista = await messagesService.listConversation(outraParteId, signal)
        if (signal.aborted) return
        setMensagens(lista)
        for (const m of lista) {
          if (!m.lida && m.destinatarioUsuarioId === usuarioId) {
            marcarComoLida(m.id)
          }
        }
      } catch (error) {
        if (signal.aborted) return
        setErroHistorico(
          mensagemDeErro(error, 'Não foi possível carregar a conversa.'),
        )
      } finally {
        if (!signal.aborted) setCarregandoHistorico(false)
      }
    },
    [usuarioId, marcarComoLida],
  )

  // Abre uma conversa: troca a seleção e carrega o histórico correspondente.
  const abrirConversa = useCallback(
    (outraParteId: number) => {
      setSelecionadaId(outraParteId)
      const controller = new AbortController()
      void carregarHistorico(outraParteId, controller.signal)
    },
    [carregarHistorico],
  )

  // Carrega conversas na montagem e abre a primeira automaticamente.
  useEffect(() => {
    const controller = new AbortController()
    let cancelado = false
    void (async () => {
      const lista = await carregarConversas(controller.signal)
      if (cancelado || controller.signal.aborted) return
      if (lista.length > 0) {
        setSelecionadaId(lista[0].usuarioId)
        await carregarHistorico(lista[0].usuarioId, controller.signal)
      }
    })()
    return () => {
      cancelado = true
      controller.abort()
    }
  }, [carregarConversas, carregarHistorico])

  // WebSocket: conexão única (singleton) e recebimento em tempo real.
  useEffect(() => {
    const unsubscribeEstado = messagesSocket.onStateChange(setEstadoConexao)

    if (!socketIniciadoRef.current) {
      socketIniciadoRef.current = true
      void messagesSocket
        .connect()
        .catch(() => undefined) // silencioso: a UI segue funcionando pelo REST
    }
    if (messagesSocket.isConnected()) setEstadoConexao('conectado')

    // Sincroniza o badge global (fonte única para layout e páginas).
    messagesBadge.refresh(usuarioId)

    const unsubscribe = messagesSocket.subscribe((mensagem) => {
      const naConversaAberta =
        mensagem.remetenteUsuarioId === selecionadaId ||
        mensagem.destinatarioUsuarioId === selecionadaId
      const veioDeOutro =
        mensagem.remetenteUsuarioId !== usuarioId &&
        mensagem.destinatarioUsuarioId === usuarioId

      if (naConversaAberta) {
        setMensagens((atual) => {
          if (atual.some((m) => m.id === mensagem.id)) return atual
          return [...atual, mensagem]
        })
        if (veioDeOutro) {
          // Estou olhando a conversa: lida imediatamente (desconta do badge).
          marcarComoLida(mensagem.id)
          notificacaoRef.current?.(mensagem, true)
        }
      } else {
        // Conversa não aberta: atualiza a linha da lista.
        if (veioDeOutro) {
          // O badge global é incrementado pelo listener do próprio store.
          notificacaoRef.current?.(mensagem, false)
        }
        setConversas((atual) =>
          atual.map((c) => {
            const relevante =
              c.usuarioId === mensagem.remetenteUsuarioId ||
              c.usuarioId === mensagem.destinatarioUsuarioId
            if (!relevante) return c
            return {
              ...c,
              ultimaMensagem: mensagem.conteudo,
              ultimaMensagemDataCriacao: mensagem.dataCriacao,
              naoLidas: veioDeOutro ? c.naoLidas + 1 : c.naoLidas,
            }
          }),
        )
      }
    })

    return () => {
      unsubscribeEstado()
      unsubscribe()
      // A conexão singleton permanece (mesma aba compartilha entre páginas).
    }
  }, [selecionadaId, usuarioId, marcarComoLida])

  // Deduplicação defensiva + ordenação cronológica para exibição.
  const historico = useMemo(() => {
    const unicas = new Map<number, Mensagem>()
    for (const m of mensagens) unicas.set(m.id, m)
    return [...unicas.values()].sort(
      (a, b) =>
        new Date(a.dataCriacao).getTime() - new Date(b.dataCriacao).getTime(),
    )
  }, [mensagens])

  // Rolagem para a última mensagem quando o histórico muda.
  useEffect(() => {
    fimDaListaRef.current?.scrollIntoView({ block: 'end' })
  }, [historico.length])

  const enviar = useCallback(
    async (conteudo: string): Promise<boolean> => {
      if (!selecionada) return false
      const texto = conteudo.trim()
      if (!texto || enviando) return false
      setEnviando(true)
      try {
        const mensagem = await messagesSocket.send(selecionada.usuarioId, texto)
        // Sucesso confirmado: limpa o rascunho. Em falha, o texto é
        // preservado para o usuário tentar novamente sem digitar de novo.
        setRascunho('')
        setMensagens((atual) =>
          atual.some((m) => m.id === mensagem.id) ? atual : [...atual, mensagem],
        )
        setConversas((atual) =>
          atual.map((c) =>
            c.usuarioId === selecionada.usuarioId
              ? {
                  ...c,
                  ultimaMensagem: mensagem.conteudo,
                  ultimaMensagemDataCriacao: mensagem.dataCriacao,
                }
              : c,
          ),
        )
        return true
      } catch (error) {
        setErroHistorico(
          error instanceof Error
            ? error.message
            : 'Não foi possível enviar a mensagem.',
        )
        return false
      } finally {
        setEnviando(false)
      }
    },
    [selecionada, enviando],
  )

  /** Ressincroniza a lista de conversas (ex.: após iniciar uma conversa nova). */
  const recarregarConversas = useCallback(async (): Promise<Conversa[]> => {
    const controller = new AbortController()
    return carregarConversas(controller.signal)
  }, [carregarConversas])

  return {
    conversas,
    selecionada,
    selecionadaId,
    historico,
    carregandoConversas,
    carregandoHistorico,
    erroConversas,
    erroHistorico,
    estadoConexao,
    fimDaListaRef,
    rascunho,
    setRascunho,
    enviando,
    abrirConversa,
    enviar,
    marcarComoLida,
    recarregarConversas,
    limparErroHistorico: useCallback(() => setErroHistorico(null), []),
    tentarNovamente: useCallback(() => {
      const controller = new AbortController()
      void (async () => {
        const lista = await carregarConversas(controller.signal)
        if (controller.signal.aborted) return
        const alvo =
          lista.find((c) => c.usuarioId === selecionadaId) ?? lista[0] ?? null
        if (alvo) {
          setSelecionadaId(alvo.usuarioId)
          await carregarHistorico(alvo.usuarioId, controller.signal)
        } else {
          setSelecionadaId(null)
          setMensagens([])
        }
      })()
      return () => controller.abort()
    }, [carregarConversas, carregarHistorico, selecionadaId]),
  }
}
