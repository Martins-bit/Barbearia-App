import { useEffect, useState } from 'react'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { AlertIcon, BellIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { notificationsService } from '../../services/api/notificationsService'
import { useToast } from '../../contexts/useToast'
import type { Notificacao } from '../../types/domain'
import { formatDateFull, formatTime } from '../../utils/format'
import { mensagemDoErro } from './booking'
import styles from './cliente.module.css'

/**
 * Notificações do cliente — dados reais de GET /notifications. A marcação de
 * leitura usa os retornos do próprio backend (PATCH /notifications/:id/read e
 * PATCH /notifications/read-all): a lista local é atualizada com a resposta do
 * servidor, sem refetch que recarregue toda a tela. Nenhum dado é inventado.
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

  useEffect(() => {
    if (carregamento.data) setItens(carregamento.data)
  }, [carregamento.data])

  const naoLidas = itens.filter((item) => !item.lida)

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

              {!notificacao.lida && (
                <div className={styles.notificationSide}>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={lendoId === notificacao.id}
                    disabled={lendoId !== null}
                    onClick={() => marcarComoLida(notificacao)}
                  >
                    Marcar como lida
                  </Button>
                </div>
              )}
            </article>
          ))}
        </Card>
      )}
    </div>
  )
}