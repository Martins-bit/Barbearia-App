import { useEffect, useState } from 'react'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { AlertIcon, BellIcon, CheckIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { notificationsService } from '../../services/api/notificationsService'
import { waitlistService } from '../../services/api/waitlistService'
import { useToast } from '../../contexts/useToast'
import type { Notificacao } from '../../types/domain'
import { formatDateFull, formatTime } from '../../utils/format'
import { mensagemDoErro } from './booking'
import styles from './cliente.module.css'

/**
 * Notificações do cliente — dados reais de GET /notifications. A marcação de
 * leitura usa os retornos do próprio backend (PATCH /notifications/:id/read e
 * PATCH /notifications/read-all).
 *
 * Para notificações do tipo WAITLIST_OPPORTUNITY que possuem um claimId válido,
 * apresenta ações para aceitar (POST /waitlist/claims/:id/accept) ou recusar
 * (POST /waitlist/claims/:id/reject) a oportunidade.
 */
export function ClienteNotificacoesPage() {
  const toast = useToast()
  const carregamento = useApiResource('notifications:mine', (signal) =>
    notificationsService.list(signal),
  )

  // Cópia local da lista devolvida pela API; cada marcação de leitura
  // substitui o item pela resposta confirmada do servidor.
  const [itens, setItens] = useState<Notificacao[]>([])
  const [lendoId, setLendoId] = useState<number | null>(null)
  const [marcandoTodas, setMarcandoTodas] = useState(false)

  // Rastreamento de ações em andamento nos claims para prevenir cliques concorrentes
  const [processandoClaimId, setProcessandoClaimId] = useState<number | null>(null)
  const [claimAcao, setClaimAcao] = useState<'aceitar' | 'recusar' | null>(null)
  // Desfecho de claims nesta sessão (claimId -> 'aceito' | 'recusado')
  const [desfechosClaim, setDesfechosClaim] = useState<Record<number, 'aceito' | 'recusado'>>({})

  useEffect(() => {
    if (carregamento.data) setItens(carregamento.data)
  }, [carregamento.data])

  const naoLidas = itens.filter((item) => !item.lida)

  async function aceitarOportunidade(notificacao: Notificacao) {
    if (!notificacao.claimId || processandoClaimId !== null) return
    const claimId = notificacao.claimId
    setProcessandoClaimId(claimId)
    setClaimAcao('aceitar')
    try {
      const resposta = await waitlistService.acceptClaim(claimId)
      setDesfechosClaim((prev) => ({ ...prev, [claimId]: 'aceito' }))
      toast.success(
        `Agendamento confirmado para ${resposta.appointment.data} às ${resposta.appointment.horaInicio}.`,
        'Vaga aceita com sucesso',
      )

      // Se a notificação não estava lida, marca como lida no backend também
      if (!notificacao.lida) {
        notificationsService.markAsRead(notificacao.id).then((atualizada) => {
          setItens((atual) =>
            atual.map((item) => (item.id === atualizada.id ? atualizada : item)),
          )
        }).catch(() => undefined)
      }
    } catch (error) {
      toast.error(mensagemDoErro(error), 'Não foi possível aceitar a vaga')
    } finally {
      setProcessandoClaimId(null)
      setClaimAcao(null)
    }
  }

  async function recusarOportunidade(notificacao: Notificacao) {
    if (!notificacao.claimId || processandoClaimId !== null) return
    const claimId = notificacao.claimId
    setProcessandoClaimId(claimId)
    setClaimAcao('recusar')
    try {
      await waitlistService.rejectClaim(claimId)
      setDesfechosClaim((prev) => ({ ...prev, [claimId]: 'recusado' }))
      toast.notify('A oportunidade foi recusada. Você continua na lista de espera.', {
        tone: 'info',
        title: 'Vaga recusada',
      })

      // Se a notificação não estava lida, marca como lida no backend também
      if (!notificacao.lida) {
        notificationsService.markAsRead(notificacao.id).then((atualizada) => {
          setItens((atual) =>
            atual.map((item) => (item.id === atualizada.id ? atualizada : item)),
          )
        }).catch(() => undefined)
      }
    } catch (error) {
      toast.error(mensagemDoErro(error), 'Não foi possível recusar a vaga')
    } finally {
      setProcessandoClaimId(null)
      setClaimAcao(null)
    }
  }

  async function marcarComoLida(notificacao: Notificacao) {
    if (lendoId !== null) return
    setLendoId(notificacao.id)
    try {
      const atualizada = await notificationsService.markAsRead(notificacao.id)
      setItens((atual) =>
        atual.map((item) => (item.id === atualizada.id ? atualizada : item)),
      )
    } catch (error) {
      toast.error(mensagemDoErro(error), 'Não foi possível marcar como lida')
    } finally {
      setLendoId(null)
    }
  }

  async function marcarTodasComoLidas() {
    if (marcandoTodas) return
    setMarcandoTodas(true)
    try {
      await notificationsService.markAllAsRead()
      setItens((atual) =>
        atual.map((item) => (item.lida ? item : { ...item, lida: true })),
      )
    } catch (error) {
      toast.error(
        mensagemDoErro(error),
        'Não foi possível marcar todas como lidas',
      )
    } finally {
      setMarcandoTodas(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Notificações"
        description="Avisos sobre seus agendamentos e oportunidades."
        actions={
          itens.length > 0 &&
          naoLidas.length > 0 && (
            <Button
              variant="secondary"
              loading={marcandoTodas}
              onClick={marcarTodasComoLidas}
            >
              Marcar todas como lidas
            </Button>
          )
        }
      />

      {carregamento.loading && <Loading label="Carregando notificações" />}

      {!carregamento.loading && carregamento.error && (
        <ErrorState
          title="Não foi possível carregar as notificações"
          description={carregamento.error.message}
          icon={<AlertIcon size={22} />}
          action={
            <Button variant="secondary" onClick={carregamento.reload}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!carregamento.loading && !carregamento.error && itens.length === 0 && (
        <EmptyState
          title="Nenhuma notificação"
          description="Você não recebeu avisos até o momento. Novidades sobre seus agendamentos aparecem aqui."
          icon={<BellIcon size={22} />}
        />
      )}

      {!carregamento.loading && !carregamento.error && itens.length > 0 && (
        <Card className={styles.notificationList}>
          {itens.map((notificacao) => (
            <article
              key={notificacao.id}
              className={[
                styles.notificationRow,
                notificacao.lida ? '' : styles.notificationUnread,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.notificationBody}>
                <div className={styles.notificationTop}>
                  {!notificacao.lida && (
                    <>
                      <span
                        className={styles.notificationDot}
                        aria-hidden="true"
                      />
                      <span className="visually-hidden">Não lida.</span>
                    </>
                  )}
                  <span
                    className={[
                      styles.notificationTitle,
                      notificacao.lida ? styles.notificationTitleRead : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {notificacao.titulo}
                  </span>
                  {notificacao.tipo === 'WAITLIST_OPPORTUNITY' && notificacao.claimId && (
                    <span className={styles.notificationBadge}>Vaga disponível</span>
                  )}
                </div>
                <p className={styles.notificationMessage}>
                  {notificacao.mensagem}
                </p>
                <time
                  className={styles.notificationDate}
                  dateTime={notificacao.dataCriacao}
                >
                  {formatDateFull(notificacao.dataCriacao)} às{' '}
                  {formatTime(notificacao.dataCriacao)}
                </time>
              </div>

              <div className={styles.notificationSide}>
                {notificacao.tipo === 'WAITLIST_OPPORTUNITY' && notificacao.claimId ? (
                  <div className={styles.notificationActions}>
                    {desfechosClaim[notificacao.claimId] === 'aceito' && (
                      <span
                        className={`${styles.notificationOutcome} ${styles.notificationOutcomeSuccess}`}
                      >
                        <CheckIcon size={14} /> Vaga aceita
                      </span>
                    )}

                    {desfechosClaim[notificacao.claimId] === 'recusado' && (
                      <span
                        className={`${styles.notificationOutcome} ${styles.notificationOutcomeNeutral}`}
                      >
                        Vaga recusada
                      </span>
                    )}

                    {!desfechosClaim[notificacao.claimId] && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={
                            processandoClaimId === notificacao.claimId &&
                            claimAcao === 'aceitar'
                          }
                          disabled={processandoClaimId !== null}
                          onClick={() => aceitarOportunidade(notificacao)}
                        >
                          Aceitar vaga
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={
                            processandoClaimId === notificacao.claimId &&
                            claimAcao === 'recusar'
                          }
                          disabled={processandoClaimId !== null}
                          onClick={() => recusarOportunidade(notificacao)}
                        >
                          Recusar
                        </Button>
                      </>
                    )}

                    {!notificacao.lida && !desfechosClaim[notificacao.claimId] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={lendoId === notificacao.id}
                        disabled={lendoId !== null || processandoClaimId !== null}
                        onClick={() => marcarComoLida(notificacao)}
                      >
                        Marcar como lida
                      </Button>
                    )}
                  </div>
                ) : (
                  !notificacao.lida && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={lendoId === notificacao.id}
                      disabled={lendoId !== null || processandoClaimId !== null}
                      onClick={() => marcarComoLida(notificacao)}
                    >
                      Marcar como lida
                    </Button>
                  )
                )}
              </div>
            </article>
          ))}
        </Card>
      )}
    </div>
  )
}