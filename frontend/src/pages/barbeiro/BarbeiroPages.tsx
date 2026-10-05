import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PageHeader, PagePlaceholder } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { Modal } from '../../components/ui/Modal'
import {
  AlertIcon,
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  PlusIcon,
  UserIcon,
} from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { useAuth } from '../../contexts/useAuth'
import { appointmentsService } from '../../services/api/appointmentsService'
import { barberScheduleService } from '../../services/api/barberScheduleService'
import { notificationsService } from '../../services/api/notificationsService'
import { scheduleBlocksService } from '../../services/api/scheduleBlocksService'
import { waitlistService } from '../../services/api/waitlistService'
import { servicesService } from '../../services/api/catalogService'
import { ApiError } from '../../services/api/ApiError'
import type { Agendamento, BloqueioAgenda, EntradaListaEspera, Servico } from '../../types/domain'
import type { HorarioFuncionamento } from '../../types/domain'
import { todayDateKey } from '../../utils/date'
import styles from './barbeiro.module.css'

function sortAppointments(a: Agendamento, b: Agendamento): number {
  const dateCompare = a.data.localeCompare(b.data)
  if (dateCompare !== 0) return dateCompare
  return a.horaInicio.localeCompare(b.horaInicio)
}

function formatStatus(status: Agendamento['status']): string {
  switch (status) {
    case 'CONFIRMADO':
      return 'Confirmado'
    case 'CONCLUIDO':
      return 'Concluído'
    case 'CANCELADO':
      return 'Cancelado'
    case 'NAO_COMPARECEU':
      return 'Não compareceu'
    default:
      return status
  }
}

function formatTimeRange(agendamento: Pick<Agendamento, 'horaInicio' | 'horaFim'>): string {
  return `${agendamento.horaInicio.slice(0, 5)} - ${agendamento.horaFim.slice(0, 5)}`
}

function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(date)
}

function canComplete(agendamento: Agendamento): boolean {
  if (agendamento.status !== 'CONFIRMADO') return false
  const horarioFim = new Date(`${agendamento.data}T${agendamento.horaFim}:00`)
  return new Date() >= horarioFim
}

function canNoShow(agendamento: Agendamento): boolean {
  if (agendamento.status !== 'CONFIRMADO') return false
  const horarioInicio = new Date(`${agendamento.data}T${agendamento.horaInicio}:00`)
  return new Date() >= horarioInicio
}

function formatWaitlistStatus(status: EntradaListaEspera['status']): string {
  switch (status) {
    case 'ATIVA':
      return 'Ativa'
    case 'NOTIFICADA':
      return 'Notificada'
    case 'ATENDIDA':
      return 'Atendida'
    case 'CANCELADA':
      return 'Cancelada'
    case 'EXPIRADA':
      return 'Expirada'
    default:
      return status
  }
}

function formatEntryTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Início do barbeiro — painel resumido da operação. */
export function BarbeiroHomePage() {
  const { user, status } = useAuth()
  const agenda = useApiResource('barbeiro:appointments:home', (signal) =>
    appointmentsService.listForBarber(signal),
  )
  const unread = useApiResource('barbeiro:notifications:unread-count', (signal) =>
    notificationsService.unreadCount(signal),
  )

  const nome = user?.nome.trim().split(/\s+/)[0] ?? 'Barbeiro'
  const hoje = todayDateKey()

  const agendamentos = agenda.data ? [...agenda.data].sort(sortAppointments) : []
  const agendaHoje = agendamentos.filter((item) => item.data === hoje)
  const proximos = agendamentos.filter(
    (item) => item.data >= hoje && item.status === 'CONFIRMADO',
  )
  const proximo = proximos[0] ?? null
  const atendimentosHoje = agendaHoje.filter(
    (item) => item.status === 'CONFIRMADO' || item.status === 'CONCLUIDO',
  ).length
  const concluidos = agendamentos.filter((item) => item.status === 'CONCLUIDO').length
  const cancelamentos = agendamentos.filter(
    (item) => item.status === 'CANCELADO',
  ).length
  const faltas = agendamentos.filter((item) => item.status === 'NAO_COMPARECEU').length
  const notificacoesNaoLidas = unread.data?.count ?? 0

  const loading = agenda.loading || unread.loading
  const error = agenda.error ?? unread.error

  const reloadAll = () => {
    agenda.reload()
    unread.reload()
  }

  if (status === 'loading') {
    return <Loading label="Validando sessão" fullArea />
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={`Olá, ${nome}.`}
        description="Resumo do dia e do movimento."
      />

      <section className={styles.section} aria-labelledby="resumo-dia">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Resumo do dia</span>
          <h2 id="resumo-dia" className={styles.sectionTitle}>
            Resumo do dia
          </h2>
        </div>

        {loading && <Loading label="Carregando resumo" />}

        {!loading && error && (
          <ErrorState
            title="Não foi possível carregar o resumo"
            description="Tente novamente em alguns instantes."
            icon={<AlertIcon size={22} />}
            action={
              <Button variant="secondary" onClick={reloadAll}>
                Tentar novamente
              </Button>
            }
          />
        )}

        {!loading && !error && (
          <div className={styles.summaryGrid}>
            <article className={styles.metricCard}>
              <div className={styles.metricHeader}>
                <span>Atendimentos</span>
                <CalendarIcon size={16} />
              </div>
              <strong className={styles.metricValue}>{atendimentosHoje}</strong>
              <span className={styles.metricSub}>Hoje</span>
            </article>

            <article className={styles.metricCard}>
              <div className={styles.metricHeader}>
                <span>Próximos</span>
                <ClockIcon size={16} />
              </div>
              <strong className={styles.metricValue}>{proximos.length}</strong>
              <span className={styles.metricSub}>Confirmados</span>
            </article>

            <article className={styles.metricCard}>
              <div className={styles.metricHeader}>
                <span>Concluídos</span>
                <CheckIcon size={16} />
              </div>
              <strong className={styles.metricValue}>{concluidos}</strong>
              <span className={styles.metricSub}>No período</span>
            </article>

            <article className={styles.metricCard}>
              <div className={styles.metricHeader}>
                <span>Notificações</span>
                <BellIcon size={16} />
              </div>
              <strong className={styles.metricValue}>
                {notificacoesNaoLidas > 0 ? notificacoesNaoLidas : 0}
              </strong>
              <span className={styles.metricSub}>
                {notificacoesNaoLidas > 0 ? 'Novas' : 'Nenhuma nova'}
              </span>
            </article>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="proximo-atendimento">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Próximo atendimento</span>
          <h2 id="proximo-atendimento" className={styles.sectionTitle}>
            Próximo atendimento
          </h2>
        </div>

        {loading && <Loading label="Buscando próximo atendimento" />}

        {!loading && !error && !proximo && (
          <EmptyState
            title="Você não tem próximos atendimentos."
            description="A agenda do dia ainda está vazia ou o próximo horário ainda não foi confirmado."
            icon={<CalendarIcon size={22} />}
          />
        )}

        {!loading && !error && proximo && (
          <article className={styles.nextCard}>
            <div className={styles.nextHeader}>
              <span className={styles.statusBadge}>{formatStatus(proximo.status)}</span>
              <span className={styles.dateText}>{formatDateLabel(proximo.data)}</span>
            </div>
            <div className={styles.nextBody}>
              <div className={styles.nextInfo}>
                <ClockIcon size={18} />
                <span>{formatTimeRange(proximo)}</span>
              </div>
              <div className={styles.nextInfo}>
                <UserIcon size={18} />
                <span>{proximo.cliente.nome}</span>
              </div>
              <div className={styles.nextInfo}>
                <CalendarIcon size={18} />
                <span>{proximo.servico.nome}</span>
              </div>
            </div>
          </article>
        )}
      </section>

      <section className={styles.section} aria-labelledby="agenda-do-dia">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Agenda</span>
          <h2 id="agenda-do-dia" className={styles.sectionTitle}>
            Agenda do dia
          </h2>
        </div>

        {loading && <Loading label="Carregando agenda do dia" />}

        {!loading && !error && agendaHoje.length === 0 && (
          <EmptyState
            title="Nenhum atendimento hoje"
            description="Ainda não há agendamentos registrados para o dia atual."
            icon={<CalendarIcon size={22} />}
          />
        )}

        {!loading && !error && agendaHoje.length > 0 && (
          <div className={styles.list}>
            {agendaHoje.map((item) => (
              <article key={item.id} className={styles.listItem}>
                <div className={styles.listMain}>
                  <div className={styles.timeBlock}>
                    <span>{item.horaInicio.slice(0, 5)}</span>
                    <span>{item.horaFim.slice(0, 5)}</span>
                  </div>
                  <div className={styles.itemContent}>
                    <h3>{item.cliente.nome}</h3>
                    <p>{item.servico.nome}</p>
                  </div>
                </div>
                <span className={styles.itemStatus}>{formatStatus(item.status)}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      {(cancelamentos > 0 || faltas > 0) && (
        <section className={styles.section} aria-labelledby="operacao">
          <div className={styles.sectionHead}>
            <span className="eyebrow">Operação</span>
            <h2 id="operacao" className={styles.sectionTitle}>
              Situação recente
            </h2>
          </div>
          <div className={styles.summaryGrid}>
            {cancelamentos > 0 && (
              <article className={styles.metricCard}>
                <div className={styles.metricHeader}>
                  <span>Cancelamentos</span>
                  <AlertIcon size={16} />
                </div>
                <strong className={styles.metricValue}>{cancelamentos}</strong>
                <span className={styles.metricSub}>Registrados</span>
              </article>
            )}
            {faltas > 0 && (
              <article className={styles.metricCard}>
                <div className={styles.metricHeader}>
                  <span>Faltas</span>
                  <AlertIcon size={16} />
                </div>
                <strong className={styles.metricValue}>{faltas}</strong>
                <span className={styles.metricSub}>Não compareceu</span>
              </article>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

export function AgendaPage() {
  const agenda = useApiResource('barbeiro:appointments', (signal) =>
    appointmentsService.listForBarber(signal),
  )

  const [selectedDate, setSelectedDate] = useState(todayDateKey())
  const [modalItem, setModalItem] = useState<Agendamento | null>(null)
  const [pendingAction, setPendingAction] = useState<
    'complete' | 'no-show' | 'cancel' | null
  >(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const items = useMemo(() => {
    const lista = agenda.data ?? []
    return [...lista].filter((item) => item.data === selectedDate).sort(sortAppointments)
  }, [agenda.data, selectedDate])

  function closeModal() {
    if (submitting) return
    setModalItem(null)
    setPendingAction(null)
    setErrorMessage(null)
  }

  async function confirmAction() {
    if (!modalItem || !pendingAction) return

    setSubmitting(true)
    setErrorMessage(null)

    try {
      switch (pendingAction) {
        case 'complete':
          await appointmentsService.complete(modalItem.id)
          break
        case 'no-show':
          await appointmentsService.noShow(modalItem.id)
          break
        case 'cancel':
          await appointmentsService.cancel(modalItem.id)
          break
        default:
          return
      }

      closeModal()
      agenda.reload()
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Não foi possível atualizar o agendamento.'
      setErrorMessage(message)
    } finally {
      setSubmitting(false)
    }
  }

  function openAction(agendamento: Agendamento, action: 'complete' | 'no-show' | 'cancel') {
    setModalItem(agendamento)
    setPendingAction(action)
    setErrorMessage(null)
  }

  const actionTitleMap = {
    complete: 'Concluir atendimento',
    'no-show': 'Marcar como não compareceu',
    cancel: 'Cancelar agendamento',
  } satisfies Record<'complete' | 'no-show' | 'cancel', string>

  const actionDescriptionMap = {
    complete: 'Ao concluir, o atendimento será marcado como finalizado.',
    'no-show': 'O agendamento será marcado como não compareceu.',
    cancel: 'O cancelamento libera o horário e altera o status no backend.',
  } satisfies Record<'complete' | 'no-show' | 'cancel', string>

  return (
    <div className={styles.page}>
      <PageHeader
        title="Agenda"
        description="Visualize e acompanhe seus atendimentos."
      />

      <section className={styles.section} aria-labelledby="agenda-data">
        <div className={styles.toolbar}>
          <label htmlFor="agenda-date" className={styles.dateField}>
            <span>Data</span>
            <input
              id="agenda-date"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value || todayDateKey())}
              className={styles.dateInput}
            />
          </label>
        </div>
      </section>

      {agenda.loading && <Loading label="Carregando agenda" />}

      {!agenda.loading && agenda.error && (
        <ErrorState
          title="Não foi possível carregar a agenda."
          description={agenda.error.message}
          icon={<AlertIcon size={22} />}
          action={
            <Button variant="secondary" onClick={agenda.reload}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!agenda.loading && !agenda.error && (
        <>
          {items.length === 0 ? (
            <EmptyState
              title="Nenhum atendimento nesta data."
              description="Não há agendamentos registrados para o dia selecionado."
              icon={<CalendarIcon size={22} />}
            />
          ) : (
            <div className={styles.list}>
              {items.map((agendamento) => (
                <article key={agendamento.id} className={styles.itemCard}>
                  <div className={styles.itemHeader}>
                    <div className={styles.itemMeta}>
                      <span className={styles.timeRange}>
                        {formatTimeRange(agendamento)}
                      </span>
                      <span className={styles.statusPill}>
                        {formatStatus(agendamento.status)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.itemBody}>
                    <div className={styles.row}>
                      <UserIcon size={16} />
                      <span>{agendamento.cliente.nome}</span>
                    </div>
                    <div className={styles.row}>
                      <CalendarIcon size={16} />
                      <span>{agendamento.servico.nome}</span>
                    </div>
                    <div className={styles.row}>
                      <ClockIcon size={16} />
                      <span>{formatDateLabel(agendamento.data)}</span>
                    </div>
                  </div>

                  {agendamento.status === 'CONFIRMADO' && (
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openAction(agendamento, 'complete')}
                        disabled={!canComplete(agendamento)}
                        title={
                          canComplete(agendamento)
                            ? 'Concluir atendimento'
                            : 'Disponível somente após o término do agendamento'
                        }
                      >
                        Concluir
                      </Button>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openAction(agendamento, 'no-show')}
                        disabled={!canNoShow(agendamento)}
                        title={
                          canNoShow(agendamento)
                            ? 'Marcar como não compareceu'
                            : 'Disponível somente após o início do agendamento'
                        }
                      >
                        Não compareceu
                      </Button>

                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => openAction(agendamento, 'cancel')}
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={modalItem !== null}
        onClose={closeModal}
        title={pendingAction ? actionTitleMap[pendingAction] : 'Atendimento'}
        description={
          modalItem && pendingAction
            ? `${modalItem.cliente.nome} · ${modalItem.servico.nome} · ${formatTimeRange(modalItem)}`
            : undefined
        }
        footer={
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={closeModal} disabled={submitting}>
              Voltar
            </Button>
            <Button
              variant={pendingAction === 'cancel' ? 'danger' : 'primary'}
              loading={submitting}
              onClick={confirmAction}
            >
              Confirmar
            </Button>
          </div>
        }
      >
        {errorMessage ? (
          <ErrorState
            title="Não foi possível atualizar o agendamento."
            description={errorMessage}
            icon={<AlertIcon size={22} />}
          />
        ) : (
          <div className={styles.modalBody}>
            <p>{pendingAction ? actionDescriptionMap[pendingAction] : ''}</p>
            {modalItem && (
              <div className={styles.modalSummary}>
                <div className={styles.row}>
                  <CalendarIcon size={16} />
                  <span>{formatDateLabel(modalItem.data)}</span>
                </div>
                <div className={styles.row}>
                  <ClockIcon size={16} />
                  <span>{formatTimeRange(modalItem)}</span>
                </div>
                <div className={styles.row}>
                  <UserIcon size={16} />
                  <span>{modalItem.cliente.nome}</span>
                </div>
                <div className={styles.row}>
                  <CheckIcon size={16} />
                  <span>{modalItem.servico.nome}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

type ServiceFormValue = {
  nome: string
  descricao: string
  duracaoMinutos: string
  preco: string
}

const emptyServiceForm = (): ServiceFormValue => ({
  nome: '',
  descricao: '',
  duracaoMinutos: '',
  preco: '',
})

function normalizePriceInput(value: string): string {
  const cleaned = value.trim().replace(',', '.')
  if (!cleaned) return '0.00'

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return '0.00'

  return parsed.toFixed(2)
}

function formatPrice(value: string): string {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return 'R$ 0,00'

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numberValue)
}

export function ServicosPage() {
  const [services, setServices] = useState<Servico[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ServiceFormValue>(emptyServiceForm)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ServiceFormValue, string>>>({})
  const [submitLoading, setSubmitLoading] = useState(false)
  const [toggleTarget, setToggleTarget] = useState<{ id: number; nome: string; ativo: boolean } | null>(null)
  const [toggleLoading, setToggleLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const loadServices = async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await servicesService.listOwn()
      setServices(data)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar os serviços.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadServices()
  }, [])

  const validateForm = (values: ServiceFormValue) => {
    const nextErrors: Partial<Record<keyof ServiceFormValue, string>> = {}
    const name = values.nome.trim()
    const description = values.descricao.trim()
    const duration = values.duracaoMinutos.trim()
    const price = values.preco.trim().replace(',', '.')

    if (!name) {
      nextErrors.nome = 'Informe o nome do serviço.'
    } else if (name.length < 2 || name.length > 100) {
      nextErrors.nome = 'O nome deve ter entre 2 e 100 caracteres.'
    }

    if (description.length > 500) {
      nextErrors.descricao = 'A descrição deve ter até 500 caracteres.'
    }

    if (!duration) {
      nextErrors.duracaoMinutos = 'Informe a duração em minutos.'
    } else {
      const durationValue = Number(duration)
      if (!Number.isInteger(durationValue) || durationValue < 5 || durationValue > 480) {
        nextErrors.duracaoMinutos = 'A duração deve estar entre 5 e 480 minutos.'
      }
    }

    if (!price) {
      nextErrors.preco = 'Informe o preço.'
    } else {
      const priceValue = Number(price)
      const validPricePattern = /^\d+(?:\.\d{1,2})?$/
      if (
        !validPricePattern.test(price) ||
        !Number.isFinite(priceValue) ||
        priceValue < 0
      ) {
        nextErrors.preco = 'Use um valor válido, como 42.00.'
      }
    }

    return nextErrors
  }

  const resetForm = () => {
    setFormMode('create')
    setEditingId(null)
    setForm(emptyServiceForm())
    setFormErrors({})
  }

  const startEdit = (service: Servico) => {
    setError(null)
    setSuccessMessage(null)
    setFormMode('edit')
    setEditingId(service.id)
    setForm({
      nome: service.nome,
      descricao: service.descricao ?? '',
      duracaoMinutos: String(service.duracaoMinutos),
      preco: service.preco,
    })
    setFormErrors({})
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateForm(form)
    setFormErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) return

    setSubmitLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const payload = {
        nome: form.nome.trim(),
        descricao: form.descricao.trim() || undefined,
        duracaoMinutos: Number(form.duracaoMinutos),
        preco: normalizePriceInput(form.preco),
      }

      if (formMode === 'create') {
        await servicesService.create(payload)
        setSuccessMessage('Serviço cadastrado com sucesso.')
      } else if (editingId !== null) {
        await servicesService.update(editingId, {
          ...payload,
          descricao: form.descricao.trim() || null,
        })
        setSuccessMessage('Serviço atualizado com sucesso.')
      }

      resetForm()
      await loadServices()
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível salvar o serviço.'
      setError(message)
    } finally {
      setSubmitLoading(false)
    }
  }

  const confirmToggle = async () => {
    if (!toggleTarget) return

    setToggleLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      await servicesService.updateStatus(toggleTarget.id, !toggleTarget.ativo)
      setSuccessMessage(
        toggleTarget.ativo
          ? 'Serviço desativado com sucesso.'
          : 'Serviço ativado com sucesso.',
      )
      setToggleTarget(null)
      await loadServices()
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível alterar o status do serviço.'
      setError(message)
    } finally {
      setToggleLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Serviços"
        description="Gerencie os serviços oferecidos pela sua barbearia."
        actions={
          <Button type="button" onClick={() => { resetForm(); setSuccessMessage(null) }} leftIcon={<PlusIcon size={16} />}>
            Novo serviço
          </Button>
        }
      />

      <section className={styles.section} aria-labelledby="servicos-gerenciamento">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Gerenciamento</span>
          <h2 id="servicos-gerenciamento" className={styles.sectionTitle}>
            Serviços da barbearia
          </h2>
        </div>

        {successMessage && (
          <div className={styles.successBanner} role="status">
            {successMessage}
          </div>
        )}

        <form className={styles.formCard} onSubmit={handleSubmit}>
          <div className={styles.formHeader}>
            <h3>{formMode === 'create' ? 'Novo serviço' : 'Editar serviço'}</h3>
            {formMode === 'edit' && (
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancelar
              </Button>
            )}
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Nome</span>
              <input
                className={styles.input}
                value={form.nome}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, nome: event.target.value }))
                }
                placeholder="Corte clássico"
                aria-invalid={Boolean(formErrors.nome)}
              />
              {formErrors.nome && <span className={styles.fieldError}>{formErrors.nome}</span>}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Descrição</span>
              <textarea
                className={styles.textarea}
                value={form.descricao}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, descricao: event.target.value }))
                }
                placeholder="Descreva o que inclui o serviço"
                rows={4}
                aria-invalid={Boolean(formErrors.descricao)}
              />
              {formErrors.descricao && (
                <span className={styles.fieldError}>{formErrors.descricao}</span>
              )}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Duração</span>
              <input
                className={styles.input}
                type="number"
                min={5}
                max={480}
                step={5}
                value={form.duracaoMinutos}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, duracaoMinutos: event.target.value }))
                }
                placeholder="30"
                aria-invalid={Boolean(formErrors.duracaoMinutos)}
              />
              {formErrors.duracaoMinutos && (
                <span className={styles.fieldError}>{formErrors.duracaoMinutos}</span>
              )}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Preço</span>
              <input
                className={styles.input}
                value={form.preco}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, preco: event.target.value }))
                }
                placeholder="42.00"
                aria-invalid={Boolean(formErrors.preco)}
              />
              {formErrors.preco && <span className={styles.fieldError}>{formErrors.preco}</span>}
            </label>
          </div>

          <div className={styles.formActions}>
            <Button type="submit" loading={submitLoading}>
              {formMode === 'create' ? 'Cadastrar serviço' : 'Salvar alterações'}
            </Button>
            {formMode === 'edit' && (
              <Button type="button" variant="secondary" onClick={resetForm}>
                Limpar
              </Button>
            )}
          </div>
        </form>

        {loading && <Loading label="Carregando serviços" />}

        {!loading && error && (
          <ErrorState
            title="Não foi possível carregar os serviços"
            description={error}
            icon={<AlertIcon size={22} />}
            action={
              <Button variant="secondary" onClick={() => void loadServices()}>
                Tentar novamente
              </Button>
            }
          />
        )}

        {!loading && !error && services.length === 0 && (
          <EmptyState
            title="Nenhum serviço cadastrado"
            description="Cadastre o primeiro serviço do seu atendimento para começar a operação."
            icon={<CalendarIcon size={22} />}
          />
        )}

        {!loading && !error && services.length > 0 && (
          <div className={styles.list}>
            {services.map((service) => (
              <article
                key={service.id}
                className={`${styles.serviceCard} ${!service.ativo ? styles.inactive : ''}`}
              >
                <div className={styles.serviceHeader}>
                  <div>
                    <h3 className={styles.serviceTitle}>{service.nome}</h3>
                    <span
                      className={`${styles.serviceStatus} ${service.ativo ? styles.active : styles.inactiveStatus}`}
                    >
                      {service.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className={styles.servicePrice}>{formatPrice(service.preco)}</div>
                </div>

                <div className={styles.serviceMeta}>
                  <span>
                    <strong>Duração:</strong> {service.duracaoMinutos} min
                  </span>
                  <span>
                    <strong>Preço:</strong> {formatPrice(service.preco)}
                  </span>
                </div>

                {service.descricao && (
                  <p className={styles.serviceDescription}>{service.descricao}</p>
                )}

                <div className={styles.serviceActions}>
                  <Button type="button" variant="secondary" onClick={() => startEdit(service)}>
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant={service.ativo ? 'ghost' : 'primary'}
                    onClick={() => setToggleTarget({ id: service.id, nome: service.nome, ativo: service.ativo })}
                  >
                    {service.ativo ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={Boolean(toggleTarget)}
        onClose={() => setToggleTarget(null)}
        title={toggleTarget?.ativo ? 'Desativar serviço' : 'Ativar serviço'}
        description={
          toggleTarget
            ? `Deseja ${toggleTarget.ativo ? 'desativar' : 'ativar'} o serviço “${toggleTarget.nome}”?`
            : ''
        }
        footer={
          <div className={styles.modalActions}>
            <Button type="button" variant="secondary" onClick={() => setToggleTarget(null)}>
              Cancelar
            </Button>
            <Button type="button" loading={toggleLoading} onClick={() => void confirmToggle()}>
              {toggleTarget?.ativo ? 'Desativar' : 'Ativar'}
            </Button>
          </div>
        }
      >
        <div className={styles.modalBody}>
          <p>
            {toggleTarget?.ativo
              ? 'Ao desativar, o serviço ficará indisponível para novos agendamentos, mas continuará preservado no sistema.'
              : 'Ao ativar, o serviço voltará a aparecer para os clientes e poderá ser agendado novamente.'}
          </p>
        </div>
      </Modal>
    </div>
  )
}

const weekdayNames = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]

type EditableBusinessHour = {
  key: number
  diaSemana: number
  horaInicio: string
  horaFim: string
  ativo: boolean
}

let nextBusinessHourKey = 0

function toEditableBusinessHours(
  records: HorarioFuncionamento[],
): EditableBusinessHour[] {
  return records.map((record) => ({
    ...record,
    key: nextBusinessHourKey++,
    horaInicio: record.horaInicio.slice(0, 5),
    horaFim: record.horaFim.slice(0, 5),
  }))
}

function minuteOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function validateBusinessHours(periods: EditableBusinessHour[]): string | null {
  if (periods.length === 0) {
    return 'Configure ao menos um período de funcionamento antes de salvar.'
  }

  if (periods.length > 70) {
    return 'A configuração aceita no máximo 70 períodos.'
  }

  for (const period of periods) {
    if (!period.horaInicio || !period.horaFim) {
      return `Preencha o início e o fim de todos os períodos de ${weekdayNames[period.diaSemana]}.`
    }

    if (minuteOfDay(period.horaInicio) >= minuteOfDay(period.horaFim)) {
      return `Em ${weekdayNames[period.diaSemana]}, o início deve ser anterior ao fim.`
    }
  }

  for (const day of weekdayNames.keys()) {
    const dayPeriods = periods
      .filter((period) => period.diaSemana === day)
      .sort((first, second) => first.horaInicio.localeCompare(second.horaInicio))

    for (let index = 1; index < dayPeriods.length; index += 1) {
      if (
        minuteOfDay(dayPeriods[index].horaInicio) <
        minuteOfDay(dayPeriods[index - 1].horaFim)
      ) {
        return `Os períodos de ${weekdayNames[day]} não podem se sobrepor.`
      }
    }
  }

  return null
}

export function HorariosPage() {
  const [periods, setPeriods] = useState<EditableBusinessHour[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const savingRef = useRef(false)

  const loadBusinessHours = async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const records = await barberScheduleService.listBusinessHours()
      setPeriods(toEditableBusinessHours(records))
    } catch (error) {
      setLoadError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível carregar os horários de funcionamento.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBusinessHours()
  }, [])

  const updatePeriod = (
    key: number,
    changes: Partial<Pick<EditableBusinessHour, 'horaInicio' | 'horaFim' | 'ativo'>>,
  ) => {
    setPeriods((current) =>
      current.map((period) =>
        period.key === key ? { ...period, ...changes } : period,
      ),
    )
    setValidationError(null)
    setSaveError(null)
    setSaved(false)
  }

  const addPeriod = (diaSemana: number) => {
    setPeriods((current) => [
      ...current,
      {
        key: nextBusinessHourKey++,
        diaSemana,
        horaInicio: '',
        horaFim: '',
        ativo: true,
      },
    ])
    setValidationError(null)
    setSaveError(null)
    setSaved(false)
  }

  const removePeriod = (key: number) => {
    setPeriods((current) => current.filter((period) => period.key !== key))
    setValidationError(null)
    setSaveError(null)
    setSaved(false)
  }

  const saveBusinessHours = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (savingRef.current) return

    const validationMessage = validateBusinessHours(periods)
    setValidationError(validationMessage)
    setSaveError(null)
    setSaved(false)
    if (validationMessage) return

    savingRef.current = true
    setSaving(true)

    try {
      const response = await barberScheduleService.replaceBusinessHours(
        periods.map(({ diaSemana, horaInicio, horaFim, ativo }) => ({
          diaSemana,
          horaInicio,
          horaFim,
          ativo,
        })),
      )
      setPeriods(toEditableBusinessHours(response))
      setSaved(true)
    } catch (error) {
      setSaveError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível salvar os horários.',
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const configuredCount = periods.length

  return (
    <div className={styles.page}>
      <PageHeader
        title="Horários"
        description="Defina os períodos em que sua barbearia recebe agendamentos."
      />

      <section className={styles.section} aria-labelledby="horarios-semanais">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Funcionamento</span>
          <h2 id="horarios-semanais" className={styles.sectionTitle}>
            Semana de atendimento
          </h2>
        </div>

        {loading && <Loading label="Carregando horários de funcionamento" />}

        {!loading && loadError && (
          <ErrorState
            title="Não foi possível carregar os horários"
            description={loadError}
            icon={<AlertIcon size={22} />}
            action={
              <Button variant="secondary" onClick={() => void loadBusinessHours()}>
                Tentar novamente
              </Button>
            }
          />
        )}

        {!loading && !loadError && (
          <>
            {configuredCount === 0 && (
              <EmptyState
                title="Nenhum horário configurado"
                description="Adicione períodos nos dias em que sua barbearia funciona. Nenhum horário foi preenchido automaticamente."
                icon={<ClockIcon size={22} />}
              />
            )}

            <form className={styles.scheduleForm} onSubmit={saveBusinessHours}>
              <div className={styles.scheduleDays}>
                {weekdayNames.map((weekday, day) => {
                  const dayPeriods = periods
                    .filter((period) => period.diaSemana === day)
                    .sort((first, second) => first.horaInicio.localeCompare(second.horaInicio))

                  return (
                    <section className={styles.scheduleDay} key={weekday} aria-labelledby={`weekday-${day}`}>
                      <div className={styles.scheduleDayHeader}>
                        <div>
                          <h3 id={`weekday-${day}`} className={styles.scheduleDayTitle}>
                            {weekday}
                          </h3>
                          <span className={styles.scheduleDaySummary}>
                            {dayPeriods.length === 0
                              ? 'Sem períodos configurados'
                              : `${dayPeriods.length} ${dayPeriods.length === 1 ? 'período' : 'períodos'}`}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => addPeriod(day)}
                          disabled={saving || configuredCount >= 70}
                          leftIcon={<PlusIcon size={15} />}
                          aria-label={`Adicionar período em ${weekday}`}
                        >
                          Adicionar período
                        </Button>
                      </div>

                      {dayPeriods.length > 0 && (
                        <div className={styles.schedulePeriods}>
                          {dayPeriods.map((period, index) => (
                            <div className={styles.schedulePeriod} key={period.key}>
                              <label className={styles.scheduleTimeField}>
                                <span>Início · período {index + 1}</span>
                                <input
                                  type="time"
                                  value={period.horaInicio}
                                  onChange={(event) =>
                                    updatePeriod(period.key, { horaInicio: event.target.value })
                                  }
                                  disabled={saving}
                                  required
                                />
                              </label>
                              <label className={styles.scheduleTimeField}>
                                <span>Fim · período {index + 1}</span>
                                <input
                                  type="time"
                                  value={period.horaFim}
                                  onChange={(event) =>
                                    updatePeriod(period.key, { horaFim: event.target.value })
                                  }
                                  disabled={saving}
                                  required
                                />
                              </label>
                              <label className={styles.scheduleActive}>
                                <input
                                  type="checkbox"
                                  checked={period.ativo}
                                  onChange={(event) =>
                                    updatePeriod(period.key, { ativo: event.target.checked })
                                  }
                                  disabled={saving}
                                />
                                <span>Ativo</span>
                              </label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removePeriod(period.key)}
                                disabled={saving}
                                aria-label={`Remover período ${index + 1} de ${weekday}`}
                              >
                                Remover
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>

              {validationError && (
                <p className={styles.scheduleError} role="alert">{validationError}</p>
              )}
              {saveError && (
                <ErrorState
                  title="Não foi possível salvar os horários"
                  description={saveError}
                  icon={<AlertIcon size={22} />}
                />
              )}
              {saved && (
                <p className={styles.scheduleSuccess} role="status">
                  Horários salvos com sucesso.
                </p>
              )}

              <div className={styles.scheduleActions}>
                <Button type="submit" loading={saving}>
                  Salvar horários
                </Button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

interface ScheduleBlockForm {
  data: string
  horaInicio: string
  horaFim: string
  motivo: string
}

const emptyScheduleBlockForm = (): ScheduleBlockForm => ({
  data: '',
  horaInicio: '',
  horaFim: '',
  motivo: '',
})

function formatScheduleBlockDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function BloqueiosPage() {
  const blocks = useApiResource('barbeiro:schedule-blocks', (signal) =>
    scheduleBlocksService.list(signal),
  )
  const [form, setForm] = useState<ScheduleBlockForm>(emptyScheduleBlockForm)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BloqueioAgenda | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const createPending = useRef(false)
  const deletePending = useRef(false)

  const updateForm = (changes: Partial<ScheduleBlockForm>) => {
    setForm((current) => ({ ...current, ...changes }))
    setCreateError(null)
    setSuccessMessage(null)
  }

  const submitBlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createPending.current) return

    if (timeToMinutes(form.horaInicio) >= timeToMinutes(form.horaFim)) {
      setCreateError('O bloqueio deve ter horaInicio menor que horaFim.')
      return
    }

    if (form.motivo.length > 500) {
      setCreateError('O motivo deve ter no máximo 500 caracteres.')
      return
    }

    createPending.current = true
    setCreating(true)
    setCreateError(null)
    setSuccessMessage(null)

    try {
      await scheduleBlocksService.create({
        data: form.data,
        horaInicio: form.horaInicio,
        horaFim: form.horaFim,
        ...(form.motivo.trim() ? { motivo: form.motivo.trim() } : {}),
      })
      setForm(emptyScheduleBlockForm())
      setSuccessMessage('Bloqueio criado com sucesso.')
      blocks.reload()
    } catch (error) {
      setCreateError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível criar o bloqueio.',
      )
    } finally {
      createPending.current = false
      setCreating(false)
    }
  }

  const closeDeleteConfirmation = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deletePending.current) return

    deletePending.current = true
    setDeleting(true)
    setDeleteError(null)

    try {
      await scheduleBlocksService.remove(deleteTarget.id)
      setDeleteTarget(null)
      setSuccessMessage('Bloqueio removido com sucesso.')
      blocks.reload()
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível remover o bloqueio.',
      )
    } finally {
      deletePending.current = false
      setDeleting(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Bloqueios"
        description="Gerencie períodos indisponíveis na sua agenda."
      />

      {successMessage && (
        <p className={styles.blockSuccess} role="status">
          {successMessage}
        </p>
      )}

      <section className={styles.section} aria-labelledby="novo-bloqueio">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Indisponibilidade</span>
          <h2 id="novo-bloqueio" className={styles.sectionTitle}>
            Criar bloqueio
          </h2>
        </div>

        <form className={styles.blockForm} onSubmit={submitBlock}>
          <div className={styles.blockFormGrid}>
            <label className={styles.blockField}>
              <span>Data</span>
              <input
                type="date"
                value={form.data}
                onChange={(event) => updateForm({ data: event.target.value })}
                required
                disabled={creating}
              />
            </label>
            <label className={styles.blockField}>
              <span>Horário inicial</span>
              <input
                type="time"
                value={form.horaInicio}
                onChange={(event) => updateForm({ horaInicio: event.target.value })}
                required
                disabled={creating}
              />
            </label>
            <label className={styles.blockField}>
              <span>Horário final</span>
              <input
                type="time"
                value={form.horaFim}
                onChange={(event) => updateForm({ horaFim: event.target.value })}
                required
                disabled={creating}
              />
            </label>
            <label className={`${styles.blockField} ${styles.blockReason}`}>
              <span>Motivo <small>opcional</small></span>
              <textarea
                value={form.motivo}
                onChange={(event) => updateForm({ motivo: event.target.value })}
                maxLength={500}
                rows={3}
                disabled={creating}
              />
            </label>
          </div>

          {createError && (
            <p className={styles.blockError} role="alert">{createError}</p>
          )}

          <div className={styles.blockFormActions}>
            <Button type="submit" loading={creating} leftIcon={<PlusIcon size={16} />}>
              Criar bloqueio
            </Button>
          </div>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="bloqueios-cadastrados">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Agenda</span>
          <h2 id="bloqueios-cadastrados" className={styles.sectionTitle}>
            Bloqueios cadastrados
          </h2>
        </div>

        {blocks.loading && <Loading label="Carregando bloqueios" />}

        {!blocks.loading && blocks.error && (
          <ErrorState
            title="Não foi possível carregar os bloqueios"
            description={blocks.error.message}
            icon={<AlertIcon size={22} />}
            action={
              <Button variant="secondary" onClick={blocks.reload}>
                Tentar novamente
              </Button>
            }
          />
        )}

        {!blocks.loading && !blocks.error && blocks.data?.length === 0 && (
          <EmptyState
            title="Nenhum bloqueio cadastrado"
            description="Os períodos indisponíveis que você criar aparecerão aqui."
            icon={<CalendarIcon size={22} />}
          />
        )}

        {!blocks.loading && !blocks.error && (blocks.data?.length ?? 0) > 0 && (
          <div className={styles.blockList}>
            {blocks.data?.map((block) => (
              <article className={styles.blockItem} key={block.id}>
                <div className={styles.blockDetails}>
                  <div className={styles.blockDateLine}>
                    <CalendarIcon size={17} />
                    <h3>{formatScheduleBlockDate(block.data)}</h3>
                  </div>
                  <div className={styles.blockTimeLine}>
                    <ClockIcon size={16} />
                    <span>{block.horaInicio.slice(0, 5)} – {block.horaFim.slice(0, 5)}</span>
                    <span className={block.ativo ? styles.blockActive : styles.blockInactive}>
                      {block.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  {block.motivo && <p className={styles.blockReasonText}>{block.motivo}</p>}
                </div>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setDeleteTarget(block)
                    setDeleteError(null)
                  }}
                  aria-label={`Remover bloqueio de ${formatScheduleBlockDate(block.data)}`}
                >
                  Remover
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={deleteTarget !== null}
        onClose={closeDeleteConfirmation}
        title="Remover bloqueio"
        description={
          deleteTarget
            ? `${formatScheduleBlockDate(deleteTarget.data)} · ${deleteTarget.horaInicio.slice(0, 5)}–${deleteTarget.horaFim.slice(0, 5)}`
            : undefined
        }
        footer={
          <div className={styles.blockModalActions}>
            <Button
              type="button"
              variant="secondary"
              onClick={closeDeleteConfirmation}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={deleting}
              onClick={() => void confirmDelete()}
            >
              Confirmar remoção
            </Button>
          </div>
        }
      >
        <div className={styles.blockModalBody}>
          <p>O período será removido da agenda.</p>
          {deleteError && <p className={styles.blockError} role="alert">{deleteError}</p>}
        </div>
      </Modal>
    </div>
  )
}

export function ListaEsperaPage() {
  const waitlist = useApiResource('barbeiro:waitlist', (signal) =>
    waitlistService.listForBarber(signal),
  )

  const entries = waitlist.data ?? []
  const unauthorized =
    waitlist.error?.status === 401 || waitlist.error?.status === 403
  const errorMessage = unauthorized
    ? 'Você não tem permissão para visualizar a lista de espera.'
    : waitlist.error?.message ?? 'Não foi possível carregar a lista de espera.'

  return (
    <div className={styles.page}>
      <PageHeader
        title="Lista de espera"
        description="Clientes aguardando um horário, na ordem de prioridade."
      />

      <section className={styles.section} aria-labelledby="lista-espera">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Solicitações</span>
          <h2 id="lista-espera" className={styles.sectionTitle}>
            Entradas aguardando
          </h2>
        </div>

        {waitlist.loading && <Loading label="Carregando lista de espera" />}

        {!waitlist.loading && waitlist.error && (
          <ErrorState
            title="Não foi possível carregar a lista de espera"
            description={errorMessage}
            icon={<AlertIcon size={22} />}
            action={
              <Button variant="secondary" onClick={waitlist.reload}>
                Tentar novamente
              </Button>
            }
          />
        )}

        {!waitlist.loading && !waitlist.error && entries.length === 0 && (
          <EmptyState
            title="Nenhuma solicitação na lista"
            description="Quando um cliente entrar na lista de espera, a solicitação aparecerá aqui."
            icon={<ClockIcon size={22} />}
          />
        )}

        {!waitlist.loading && !waitlist.error && entries.length > 0 && (
          <div className={styles.blockList}>
            {entries.map((entry) => (
              <article className={styles.blockItem} key={entry.id}>
                <div className={styles.blockDetails}>
                  <div className={styles.blockDateLine}>
                    <UserIcon size={17} />
                    <h3>{entry.cliente?.nome ?? 'Cliente'}</h3>
                  </div>
                  <div className={styles.blockTimeLine}>
                    <span>{entry.servico?.nome ?? 'Serviço'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Desejado: {formatDateLabel(entry.data)}</span>
                    {entry.horaInicio && entry.horaFim && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {entry.horaInicio.slice(0, 5)}–{entry.horaFim.slice(0, 5)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className={styles.blockTimeLine}>
                    <ClockIcon size={16} />
                    <span>Entrada: {formatEntryTimestamp(entry.dataEntrada)}</span>
                    <span
                      className={
                        entry.status === 'ATIVA'
                          ? styles.blockActive
                          : styles.blockInactive
                      }
                    >
                      {formatWaitlistStatus(entry.status)}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export function BarbeiroNotificacoesPage() {
  return (
    <PagePlaceholder
      title="Notificações"
      description="Avisos da sua operação."
      note="Lista de GET /notifications e marcação de leitura."
    />
  )
}

export function BarbeiroMensagensPage() {
  return (
    <PagePlaceholder
      title="Mensagens"
      description="Conversas com os clientes."
      note="Conversas e envio (GET /messages/conversations, POST /messages)."
    />
  )
}

export function BarbeiroPerfilPage() {
  return (
    <PagePlaceholder
      title="Perfil"
      description="Seus dados."
      note="Dados do usuário (GET /auth/me) e ajustes permitidos."
    />
  )
}