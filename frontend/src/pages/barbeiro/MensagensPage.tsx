import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { Avatar } from '../../components/ui/Avatar'
import { useAuth } from '../../contexts/useAuth'
import { useToast } from '../../contexts/useToast'
import { useMensagens } from '../../hooks/useMensagens'
import { formatTime } from '../../utils/format'
import styles from './mensagens.module.css'

/** Rótulo curto do item da lista (horário se hoje, "Ontem", ou dd/mm). */
function rotuloDaConversa(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hoje = new Date()
  const ontem = new Date(hoje)
  ontem.setDate(ontem.getDate() - 1)
  const mesmoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (mesmoDia(date, hoje)) return formatTime(date)
  if (mesmoDia(date, ontem)) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(date)
}

export function BarbeiroMensagensPage() {
  const { user } = useAuth()
  const usuarioId = user?.id ?? null
  const toast = useToast()

  // Toast somente para conversas NÃO abertas; na conversa aberta a mensagem
  // já aparece no histórico (toast seria redundante).
  const msg = useMensagens(usuarioId, (_mensagem, naConversaAberta) => {
    if (!naConversaAberta) {
      toast.notify('Nova mensagem recebida.', {
        tone: 'info',
        title: 'Mensagens',
      })
    }
  })

  const semConversas =
    !msg.carregandoConversas && !msg.erroConversas && msg.conversas.length === 0

  return (
    <div className={styles.page}>
      <PageHeader
        title="Mensagens"
        description="Conversas diretas com os clientes da barbearia."
      />

      <section className={styles.section} aria-label="Conversas">
        {msg.carregandoConversas && <Loading label="Carregando conversas" />}

        {!msg.carregandoConversas && msg.erroConversas && (
          <ErrorState
            title="Não foi possível carregar as conversas"
            description={msg.erroConversas}
            action={
              <Button variant="secondary" onClick={msg.tentarNovamente}>
                Tentar novamente
              </Button>
            }
          />
        )}

        {semConversas && (
          <EmptyState
            title="Nenhuma conversa ainda"
            description="Quando um cliente iniciar uma conversa, ela aparecerá aqui."
          />
        )}

        {!msg.carregandoConversas && !msg.erroConversas && msg.conversas.length > 0 && (
          <div className={styles.colunas}>
            <nav className={styles.lista} aria-label="Lista de conversas">
              {msg.conversas.map((conversa) => (
                <button
                  key={conversa.usuarioId}
                  type="button"
                  className={[
                    styles.itemConversa,
                    conversa.usuarioId === msg.selecionadaId ? styles.itemAtivo : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={
                    conversa.usuarioId === msg.selecionadaId ? 'true' : undefined
                  }
                  onClick={() => msg.abrirConversa(conversa.usuarioId)}
                >
                  <Avatar name={conversa.nome} size={40} />
                  <span className={styles.itemCorpo}>
                    <span className={styles.itemTopo}>
                      <span className={styles.itemNome}>{conversa.nome}</span>
                      <span className={styles.itemQuando}>
                        {rotuloDaConversa(conversa.ultimaMensagemDataCriacao)}
                      </span>
                    </span>
                    <span className={styles.itemResumo}>{conversa.ultimaMensagem}</span>
                  </span>
                  {conversa.naoLidas > 0 && (
                    <span className={styles.itemBadge}>
                      {conversa.naoLidas > 9 ? '9+' : conversa.naoLidas}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className={styles.conversa}>
              {!msg.selecionada ? (
                <div className={styles.conversaVazia}>
                  <EmptyState
                    title="Selecione uma conversa"
                    description="Escolha um cliente na lista para ver o histórico."
                  />
                </div>
              ) : (
                <>
                  <header className={styles.cabecalho}>
                    <Avatar name={msg.selecionada.nome} size={36} />
                    <div className={styles.cabecalhoNome}>
                      <span className={styles.cabecalhoTitulo}>
                        {msg.selecionada.nome}
                      </span>
                      <span
                        className={[
                          styles.cabecalhoEstado,
                          msg.estadoConexao === 'conectado' ? styles.cabecalhoEstadoOn : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {msg.estadoConexao === 'conectado'
                          ? 'Conectado'
                          : msg.estadoConexao === 'conectando'
                            ? 'Conectando…'
                            : 'Reconectando…'}
                      </span>
                    </div>
                  </header>

                  <div
                    className={styles.historico}
                    aria-live="polite"
                    aria-label="Histórico da conversa"
                  >
                    {msg.carregandoHistorico ? (
                      <Loading label="Carregando mensagens" />
                    ) : msg.erroHistorico ? (
                      <ErrorState
                        title="Não foi possível carregar a conversa"
                        description={msg.erroHistorico}
                        action={
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (!msg.selecionada) return
                              msg.abrirConversa(msg.selecionada.usuarioId)
                            }}
                          >
                            Tentar novamente
                          </Button>
                        }
                      />
                    ) : msg.historico.length === 0 ? (
                      <EmptyState
                        title="Nenhuma mensagem"
                        description="Envie a primeira mensagem para iniciar a conversa."
                      />
                    ) : (
                      msg.historico.map((mensagem) => {
                        const minha = mensagem.remetenteUsuarioId === usuarioId
                        return (
                          <div
                            key={mensagem.id}
                            className={[
                              styles.bolha,
                              minha ? styles.bolhaMinha : styles.bolhaDele,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <p className={styles.bolhaTexto}>{mensagem.conteudo}</p>
                            <time
                              className={styles.bolhaHora}
                              dateTime={mensagem.dataCriacao}
                            >
                              {formatTime(mensagem.dataCriacao)}
                              {!minha && !mensagem.lida ? ' · não lida' : ''}
                            </time>
                          </div>
                        )
                      })
                    )}
                    <div ref={msg.fimDaListaRef} />
                  </div>

                  <form
                    className={styles.compositor}
                    onSubmit={(evento) => {
                      evento.preventDefault()
                      void msg.enviar(msg.rascunho)
                    }}
                  >
                    <textarea
                      className={styles.compositorEntrada}
                      value={msg.rascunho}
                      onChange={(e) => msg.setRascunho(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void msg.enviar(msg.rascunho)
                        }
                      }}
                      placeholder="Escreva uma mensagem…"
                      maxLength={500}
                      rows={1}
                      aria-label="Nova mensagem"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      loading={msg.enviando}
                      disabled={!msg.rascunho.trim() || msg.enviando}
                    >
                      Enviar
                    </Button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
