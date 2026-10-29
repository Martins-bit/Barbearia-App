import { useState } from 'react'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { Modal } from '../../components/ui/Modal'
import { Card } from '../../components/ui/Card'
import { AlertIcon, ClockIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { waitlistService } from '../../services/api/waitlistService'
import { useToast } from '../../contexts/useToast'
import type { EntradaListaEspera } from '../../types/domain'
import { formatDateKeyLong } from './presenters'
import { mensagemDoErro } from './booking'
import { formatDataEntrada, formatStatusEspera } from './clienteListaEsperaFormatters.ts'
import styles from './cliente.module.css'

/**
 * Minha Lista de Espera — GET /waitlist/my (somente do cliente autenticado).
 * Permite visualizar todas as solicitações registradas e cancelar aquelas
 * com status ATIVA através de confirmação prévia em Modal.
 */
export function ClienteListaEsperaPage() {
  const toast = useToast()
  const esperaResource = useApiResource('waitlist:my', (signal) =>
    waitlistService.listMine(signal),
  )

  const [cancelando, setCancelando] = useState<EntradaListaEspera | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erroCancelamento, setErroCancelamento] = useState<string | null>(null)

  const solicitacoes = esperaResource.data ?? []

  async function confirmarCancelamento() {
    if (!cancelando) return
    setEnviando(true)
    setErroCancelamento(null)
    try {
      await waitlistService.cancel(cancelando.id)
      toast.success(
        'Sua solicitação foi cancelada e você não receberá mais notificações para ela.',
        'Espera cancelada',
      )
      setCancelando(null)
      esperaResource.reload()
    } catch (error) {
      const mensagem = mensagemDoErro(error)
      setErroCancelamento(mensagem)
      toast.error(mensagem, 'Não foi possível cancelar')
    } finally {
      setEnviando(false)
    }
  }

  function fecharModal() {
    if (enviando) return
    setCancelando(null)
    setErroCancelamento(null)
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Minha lista de espera"
        description="Acompanhe suas solicitações de vaga e o status na fila."
      />

      {esperaResource.loading && <Loading label="Carregando sua lista de espera" />}

      {!esperaResource.loading && esperaResource.error && (
        <ErrorState
          title="Não foi possível carregar suas solicitações"
          description={esperaResource.error.message}
          icon={<AlertIcon size={22} />}
          action={
            <Button variant="secondary" onClick={esperaResource.reload}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!esperaResource.loading && !esperaResource.error && (
        <>
          {solicitacoes.length === 0 && (
            <EmptyState
              title="Você não está em nenhuma lista de espera"
              description="Quando você tentar agendar em um dia sem horários livres, poderá entrar na lista para ser avisado se surgir uma vaga."
              icon={<ClockIcon size={22} />}
            />
          )}

          {solicitacoes.length > 0 && (
            <section className={styles.section} aria-labelledby="solicitacoes-espera">
              <div className={styles.sectionHead}>
                <span className="eyebrow">Fila de espera</span>
                <h2 id="solicitacoes-espera" className={styles.sectionTitle}>
                  Solicitações registradas
                </h2>
                <p className={styles.sectionHint}>
                  Suas entradas ativas e o histórico de solicitações.
                </p>
              </div>

              <div className={styles.appointmentList}>
                {solicitacoes.map((item) => {
                  const parts = (formatDateKeyLong(item.data) || '').split(' de ')
                  const mes = parts[1]
                  return (
                    <Card key={item.id} className={styles.appointment}>
                      <div className={styles.appointmentDate}>
                        <span className={styles.appointmentDay}>
                          {item.data.slice(8, 10)}
                        </span>
                        <span className={styles.appointmentMonth}>
                          {mes ? mes.slice(0, 3).toUpperCase() : item.data.slice(5, 7)}
                        </span>
                      </div>

                      <div className={styles.appointmentMain}>
                        <div className={styles.appointmentService}>
                          {item.servico?.nome ?? 'Serviço solicitado'}
                          {item.barbeiro?.nome && (
                            <span> · {item.barbeiro.nome}</span>
                          )}
                        </div>
                        <div className={styles.appointmentBarber}>
                          <span>Data desejada: {formatDateKeyLong(item.data)}</span>
                          {item.horaInicio && item.horaFim && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {item.horaInicio.slice(0, 5)}–{item.horaFim.slice(0, 5)}
                              </span>
                            </>
                          )}
                        </div>
                        <div className={styles.appointmentMeta}>
                          <span>Solicitado em: {formatDataEntrada(item.dataEntrada)}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              item.status === 'ATIVA'
                                ? styles.statusActive
                                : styles.statusMuted
                            }
                          >
                            {formatStatusEspera(item.status)}
                          </span>
                        </div>
                      </div>

                      <div className={styles.appointmentAside}>
                        {item.status === 'ATIVA' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={enviando && cancelando?.id === item.id}
                            onClick={() => setCancelando(item)}
                          >
                            Cancelar espera
                          </Button>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>

              <p className={styles.sectionHint}>
                {solicitacoes.length}{' '}
                {solicitacoes.length === 1
                  ? 'solicitação registrada'
                  : 'solicitações registradas'}
                .
              </p>
            </section>
          )}
        </>
      )}

      <Modal
        open={cancelando !== null}
        onClose={fecharModal}
        title="Cancelar solicitação da lista de espera"
        description={
          cancelando
            ? `Deseja retirar sua solicitação de vaga para ${cancelando.servico?.nome ?? 'o serviço'}${cancelando.barbeiro?.nome ? ` com ${cancelando.barbeiro.nome}` : ''} em ${formatDateKeyLong(cancelando.data)}? Você deixará de concorrer a horários liberados para este dia.`
            : undefined
        }
        footer={
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={fecharModal}
              disabled={enviando}
            >
              Manter solicitação
            </Button>
            <Button
              variant="danger"
              loading={enviando}
              onClick={confirmarCancelamento}
            >
              Confirmar cancelamento
            </Button>
          </div>
        }
      >
        {erroCancelamento && (
          <ErrorState
            title="Não foi possível cancelar"
            description={erroCancelamento}
            icon={<AlertIcon size={22} />}
          />
        )}
      </Modal>
    </div>
  )
}
