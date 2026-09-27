import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { Modal } from '../../components/ui/Modal'
import { Card } from '../../components/ui/Card'
import { AlertIcon, CalendarIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { appointmentsService } from '../../services/api/appointmentsService'
import { useToast } from '../../contexts/useToast'
import type { Agendamento } from '../../types/domain'
import { todayDateKey } from '../../utils/date'
import { AppointmentCard, PriceNotice } from './components'
import { formatDateKeyLong, statusLabel } from './presenters'
import { isDataPassada, mensagemDoErro } from './booking'
import styles from './cliente.module.css'

/**
 * Meus agendamentos — GET /appointments/my (somente do cliente autenticado).
 * A separação entre próximos e histórico usa exclusivamente a data devolvida
 * pela API. O cancelamento chama PATCH /appointments/:id/cancel e respeita as
 * regras do backend: nenhuma regra de negócio é duplicada aqui.
 */
export function MeusAgendamentosPage() {
  const toast = useToast()
  const agendamentos = useApiResource('appointments:my', (signal) =>
    appointmentsService.listMine(signal),
  )

  const [cancelando, setCancelando] = useState<Agendamento | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erroCancelamento, setErroCancelamento] = useState<string | null>(null)

  const hoje = todayDateKey()

  const { proximos, historico } = useMemo(() => {
    const lista = agendamentos.data ?? []
    const proximos: Agendamento[] = []
    const historico: Agendamento[] = []
    for (const item of lista) {
      if (isDataPassada(item.data, hoje)) historico.push(item)
      else proximos.push(item)
    }
    return { proximos, historico }
  }, [agendamentos.data, hoje])

  async function confirmarCancelamento() {
    if (!cancelando) return
    setEnviando(true)
    setErroCancelamento(null)
    try {
      await appointmentsService.cancel(cancelando.id)
      toast.success('O horário foi liberado na agenda.', 'Agendamento cancelado')
      setCancelando(null)
      agendamentos.reload()
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
        title="Meus agendamentos"
        description="Acompanhe seus horários e o histórico de atendimentos."
      />

      <PriceNotice />

      {agendamentos.loading && <Loading label="Carregando agendamentos" />}

      {!agendamentos.loading && agendamentos.error && (
        <ErrorState
          title="Não foi possível carregar seus agendamentos"
          description={agendamentos.error.message}
          icon={<AlertIcon size={22} />}
          action={
            <Button variant="secondary" onClick={agendamentos.reload}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!agendamentos.loading && !agendamentos.error && (
        <>
          {agendamentos.data?.length === 0 && (
            <EmptyState
              title="Você ainda não tem agendamentos"
              description="Escolha um barbeiro e um serviço para reservar seu primeiro horário."
              icon={<CalendarIcon size={22} />}
            />
          )}

          {proximos.length > 0 && (
            <section className={styles.section} aria-labelledby="proximos">
              <div className={styles.sectionHead}>
                <span className="eyebrow">Agenda</span>
                <h2 id="proximos" className={styles.sectionTitle}>
                  Próximos agendamentos
                </h2>
              </div>
              <div className={styles.appointmentList}>
                {proximos.map((agendamento) => (
                  <AppointmentCard
                    key={agendamento.id}
                    agendamento={agendamento}
                    aside={
                      agendamento.status === 'CONFIRMADO' ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setCancelando(agendamento)}
                        >
                          Cancelar
                        </Button>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {historico.length > 0 && (
            <section className={styles.section} aria-labelledby="historico">
              <div className={styles.sectionHead}>
                <span className="eyebrow">Histórico</span>
                <h2 id="historico" className={styles.sectionTitle}>
                  Atendimentos anteriores
                </h2>
                <p className={styles.sectionHint}>
                  Agendamentos com data anterior a hoje.
                </p>
              </div>
              <div className={styles.appointmentList}>
                {historico.map((agendamento) => (
                  <AppointmentCard
                    key={agendamento.id}
                    agendamento={agendamento}
                  />
                ))}
              </div>
            </section>
          )}

          {agendamentos.data && agendamentos.data.length > 0 && (
            <p className={styles.sectionHint}>
              {agendamentos.data.length}{' '}
              {agendamentos.data.length === 1
                ? 'agendamento registrado'
                : 'agendamentos registrados'}
              .
            </p>
          )}
        </>
      )}

      <Modal
        open={cancelando !== null}
        onClose={fecharModal}
        title="Cancelar agendamento"
        description={
          cancelando
            ? `${cancelando.servico.nome} com ${cancelando.barbeiro.nome} em ${formatDateKeyLong(cancelando.data)} às ${cancelando.horaInicio}.`
            : undefined
        }
        footer={
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={fecharModal}
              disabled={enviando}
            >
              Manter agendamento
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
        {erroCancelamento ? (
          <ErrorState
            title="Não foi possível cancelar"
            description={erroCancelamento}
            icon={<AlertIcon size={22} />}
          />
        ) : (
          <Card className={styles.section}>
            <p className={styles.sectionHint}>
              O cancelamento libera o horário para outros clientes e não pode
              ser desfeito. As regras de prazo da barbearia são aplicadas pelo
              servidor.
            </p>
            {cancelando && (
              <p className={styles.sectionHint}>
                Status atual: {statusLabel(cancelando.status)}.
              </p>
            )}
          </Card>
        )}
      </Modal>
    </div>
  )
}