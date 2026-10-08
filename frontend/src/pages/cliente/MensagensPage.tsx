import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { Avatar } from '../../components/ui/Avatar'
import { barbersService } from '../../services/api/catalogService'
import { messagesSocket } from '../../services/api/messagesSocket'
import { useAuth } from '../../contexts/useAuth'
import { useToast } from '../../contexts/useToast'
import { useMensagens } from '../../hooks/useMensagens'
import type { Barbeiro } from '../../types/domain'
import styles from '../barbeiro/mensagens.module.css'

/** Rótulo curto do item da lista ("Hoje", "Ontem" ou data completa). */
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
  if (mesmoDia(date, hoje)) return 'Hoje'
  if (mesmoDia(date, ontem)) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(date)
}

export function ClienteMensagensPage() {
  const { user } = useAuth()
  const usuarioId = user?.id ?? null
  const toast = useToast()

  // Toast somente para conversas NÃO abertas; na conversa aberta a mensagem
  // já aparece no histórico (toast seria redundante).
  const msg = useMensagens(usuarioId, (mensagem, naConversaAberta) => {
    if (!naConversaAberta && mensagem.remetenteUsuarioId !== usuarioId) {
      const nome =
        msg.conversas.find((c) => c.usuarioId === mensagem.remetenteUsuarioId)
          ?.nome ?? 'seu barbeiro'
      toast.notify(`Nova mensagem de ${nome}.`, {
        tone: 'info',
        title: 'Mensagens',
      })
    }
  })

  // ---- Fluxo "iniciar conversa" ----
  const [iniciando, setIniciando] = useState(false) // painel aberto?
  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([])
  const [carregandoBarbeiros, setCarregandoBarbeiros] = useState(false)
  const [erroBarbeiros, setErroBarbeiros] = useState<string | null>(null)
  const [barbeiroEscolhido, setBarbeiroEscolhido] = useState<Barbeiro | null>(null)
  const [primeiraMensagem, setPrimeiraMensagem] = useState('')
  const [enviandoPrimeira, setEnviandoPrimeira] = useState(false)
  const [erroPrimeira, setErroPrimeira] = useState<string | null>(null)

  const abrirPainel = useCallback(() => {
    setIniciando(true)
    setBarbeiroEscolhido(null)
    setPrimeiraMensagem('')
    setErroPrimeira(null)
    setErroBarbeiros(null)
    setCarregandoBarbeiros(true)
    const controller = new AbortController()
    barbersService
      .list(controller.signal)
      .then((lista) => setBarbeiros(lista))
      .catch(() => setErroBarbeiros('Não foi possível carregar os barbeiros.'))
      .finally(() => setCarregandoBarbeiros(false))
    return () => controller.abort()
  }, [])

  const fecharPainel = useCallback(() => {
    setIniciando(false)
    setBarbeiroEscolhido(null)
    setPrimeiraMensagem('')
    setErroPrimeira(null)
  }, [])

  // Garante que a conexão WebSocket exista também nesta página (singleton).
  useEffect(() => {
    void messagesSocket.connect().catch(() => undefined)
  }, [])

  /**
   * Envia a primeira mensagem pelo MESMO caminho real (WebSocket + persistência
   * no backend). O POST do gateway cria a conversa; depois recarregamos a
   * lista via REST — a conversa nova aparece como qualquer outra.
   */
  const iniciarConversa = useCallback(
    async (evento?: FormEvent) => {
      evento?.preventDefault()
      const barbeiro = barbeiroEscolhido
      const texto = primeiraMensagem.trim()
      if (!barbeiro || !texto || enviandoPrimeira) return

      setEnviandoPrimeira(true)
      setErroPrimeira(null)
      try {
        // Destinatário é o Usuario.id do barbeiro (destino do domínio de
        // mensagens) — NÃO o Barbeiro.id usado em agendamentos.
        await messagesSocket.send(barbeiro.usuarioId, texto)
        setPrimeiraMensagem('')
        setIniciando(false)

        const lista = await msg.recarregarConversas()
        const nova = lista.find((c) => c.usuarioId === barbeiro.usuarioId)
        if (nova) msg.abrirConversa(nova.usuarioId)
      } catch (error) {
        setErroPrimeira(
          error instanceof Error
            ? error.message
            : 'Não foi possível enviar a mensagem.',
        )
      } finally {
        setEnviandoPrimeira(false)
      }
    },
    [barbeiroEscolhido, primeiraMensagem, enviandoPrimeira, msg],
  )

  const semConversas =
    !msg.carregandoConversas && !msg.erroConversas && msg.conversas.length === 0

  return (
    <div className={styles.page}>
      <PageHeader
        title="Mensagens"
        description="Converse diretamente com o seu barbeiro."
        actions={
          !iniciando ? (
            <Button variant="secondary" size="sm" onClick={abrirPainel}>
              Nova conversa
            </Button>
          ) : null
        }
      />

      {/* ---- Painel: iniciar nova conversa ---- */}
      {iniciando && (
        <section className={styles.painelNovo} aria-label="Iniciar nova conversa">
          <div className={styles.painelTopo}>
            <h2 className={styles.painelTitulo}>Nova conversa</h2>
            <Button variant="ghost" size="sm" onClick={fecharPainel}>
              Cancelar
            </Button>
          </div>

          {carregandoBarbeiros && <Loading label="Carregando barbeiros" />}

          {erroBarbeiros && !carregandoBarbeiros && (
            <ErrorState
              title="Não foi possível carregar os barbeiros"
              description={erroBarbeiros}
              action={
                <Button variant="secondary" onClick={abrirPainel}>
                  Tentar novamente
                </Button>
              }
            />
          )}

          {!carregandoBarbeiros && !erroBarbeiros && barbeiros.length === 0 && (
            <EmptyState
              title="Nenhum barbeiro disponível"
              description="Não há barbeiros ativos para iniciar uma conversa agora."
            />
          )}

          {!carregandoBarbeiros && !erroBarbeiros && barbeiros.length > 0 && (
            <form className={styles.painelCorpo} onSubmit={iniciarConversa}>
              <div className={styles.painelBarbeiros} role="radiogroup" aria-label="Escolha o barbeiro">
                {barbeiros.map((barbeiro) => (
                  <button
                    key={barbeiro.id}
                    type="button"
                    role="radio"
                    aria-checked={barbeiroEscolhido?.id === barbeiro.id}
                    className={[
                      styles.painelBarbeiro,
                      barbeiroEscolhido?.id === barbeiro.id ? styles.painelBarbeiroAtivo : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setBarbeiroEscolhido(barbeiro)}
                  >
                    <Avatar name={barbeiro.nome} size={32} />
                    <span className={styles.painelBarbeiroNome}>{barbeiro.nome}</span>
                  </button>
                ))}
              </div>

              <textarea
                className={styles.compositorEntrada}
                value={primeiraMensagem}
                onChange={(e) => setPrimeiraMensagem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void iniciarConversa()
                  }
                }}
                placeholder={
                  barbeiroEscolhido
                    ? `Escreva a primeira mensagem para ${barbeiroEscolhido.nome}…`
                    : 'Escolha um barbeiro e escreva a primeira mensagem…'
                }
                maxLength={500}
                rows={3}
                aria-label="Primeira mensagem"
              />

              {erroPrimeira && (
                <p className={styles.painelErro} role="alert">
                  {erroPrimeira}
                </p>
              )}

              <div className={styles.painelAcoes}>
                <Button
                  type="submit"
                  size="sm"
                  loading={enviandoPrimeira}
                  disabled={!barbeiroEscolhido || !primeiraMensagem.trim() || enviandoPrimeira}
                >
                  Enviar primeira mensagem
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

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

        {semConversas && !iniciando && (
          <EmptyState
            title="Nenhuma conversa ainda"
            description="Inicie uma conversa com um dos nossos barbeiros para tirar dúvidas sobre serviços, horários ou o seu agendamento."
            action={
              <Button variant="secondary" onClick={abrirPainel}>
                Iniciar conversa
              </Button>
            }
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
                    description="Escolha uma conversa na lista para ver o histórico."
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
                              {new Intl.DateTimeFormat('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              }).format(new Date(mensagem.dataCriacao))}
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
