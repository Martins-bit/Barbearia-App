import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import {
  AlertIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ScissorsIcon,
} from '../../components/ui/icons/Icon'
import {
  availabilityService,
  barbersService,
  servicesService,
} from '../../services/api/catalogService'
import { appointmentsService } from '../../services/api/appointmentsService'
import { ApiError } from '../../services/api/ApiError'
import { useApiResource } from '../../hooks/useApiResource'
import { useToast } from '../../contexts/useToast'
import type { Agendamento, Barbeiro, Servico } from '../../types/domain'
import { todayDateKey } from '../../utils/date'
import { formatDuration, formatPrice, formatTime } from '../../utils/format'
import { addDays, mensagemDoErro } from './booking'
import {
  formatDateKeyLong,
  formatDateKeyShort,
  weekdayInitial,
} from './presenters'
import {
  BookingConfirmed,
  BookingSteps,
  Choice,
  StepBarbeiro,
  StepRevisao,
} from './steps'
import styles from './cliente.module.css'

/** Janela de datas mostrada de uma vez no seletor. */
const DIAS_EXIBIDOS = 7
/** Antecedência máxima oferecida (o backend continua sendo a autoridade). */
const DIAS_ANTECEDENCIA = 90

interface FluxoState {
  barbeiroId?: number
}

/**
 * Fluxo real de agendamento do cliente:
 * barbeiro (GET /barbers) → serviços (GET /services?barbeiroId=) →
 * data + disponibilidade (GET /availability) → revisão → criação
 * (POST /appointments). Nenhum horário é gerado no frontend: apenas os
 * devolvidos pela API são apresentados.
 */
export function AgendamentoPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const hoje = todayDateKey()
  const limite = addDays(hoje, DIAS_ANTECEDENCIA)

  const [barbeiro, setBarbeiro] = useState<Barbeiro | null>(null)
  const [servico, setServico] = useState<Servico | null>(null)
  const [data, setData] = useState(hoje)
  const [pagina, setPagina] = useState(0)
  const [horaInicio, setHoraInicio] = useState<string | null>(null)

  const [revisando, setRevisando] = useState(false)
  const [criando, setCriando] = useState(false)
  const [erroCriacao, setErroCriacao] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState<Agendamento | null>(null)

  // Serviços do barbeiro escolhido.
  const servicos = useApiResource(
    barbeiro ? `services:${barbeiro.id}` : null,
    (signal) => servicesService.listByBarber(barbeiro!.id, signal),
  )

  // Disponibilidade REAL: barbeiro + serviço + data.
  const disponibilidade = useApiResource(
    barbeiro && servico && data
      ? `availability:${barbeiro.id}:${servico.id}:${data}`
      : null,
    (signal) =>
      availabilityService.get(
        { data, servicoId: servico!.id, barbeiroId: barbeiro!.id },
        signal,
      ),
  )

  // Preserva o barbeiro escolhido na tela de Barbeiros (estado de navegação).
  useEffect(() => {
    const barbeiroId = (location.state as FluxoState | null)?.barbeiroId
    if (!barbeiroId) return

    let ativo = true
    barbersService
      .list()
      .then((lista) => {
        if (!ativo) return
        const encontrado = lista.find((item) => item.id === barbeiroId) ?? null
        if (encontrado) setBarbeiro(encontrado)
      })
      .catch(() => undefined)
    navigate(location.pathname, { replace: true, state: null })

    return () => {
      ativo = false
    }
    // Executa apenas na entrada da rota.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Trocar de barbeiro reinicia serviço, horário e revisão.
  useEffect(() => {
    setServico(null)
    setHoraInicio(null)
    setRevisando(false)
    setErroCriacao(null)
  }, [barbeiro])

  // Trocar de serviço ou de data invalida o horário escolhido.
  useEffect(() => {
    setHoraInicio(null)
    setRevisando(false)
    setErroCriacao(null)
  }, [servico, data])

  // Janela de datas da página atual do seletor. A janela é ancorada em `hoje`
  // + `pagina * DIAS_EXIBIDOS` — nunca na data selecionada, para que avançar
  // um dia não desloque/remova os chips já visíveis.
  const datas = useMemo(() => {
    const inicio = addDays(hoje, pagina * DIAS_EXIBIDOS)
    return Array.from({ length: DIAS_EXIBIDOS }, (_, index) =>
      addDays(inicio, index),
    ).filter((dateKey) => dateKey <= limite)
  }, [hoje, pagina, limite])
  const temPaginaAnterior = pagina > 0
  const temProximaPagina = addDays(hoje, (pagina + 1) * DIAS_EXIBIDOS) <= limite

  const horarios = disponibilidade.data?.horariosLivres ?? []

  async function confirmar() {
    if (!barbeiro || !servico || !horaInicio) return
    setCriando(true)
    setErroCriacao(null)
    try {
      const criado = await appointmentsService.create({
        barbeiroId: barbeiro.id,
        servicoId: servico.id,
        data,
        horaInicio,
      })
      setConfirmado(criado)
      toast.success('Seu horário está reservado.', 'Agendamento confirmado')
    } catch (error) {
      const mensagem = mensagemDoErro(error)
      setErroCriacao(mensagem)
      toast.error(mensagem, 'Não foi possível confirmar')

      // Horário ocupado/conflito ou indisponível: a grade mudou — reconsulta.
      if (
        error instanceof ApiError &&
        (error.status === 409 || error.status === 400)
      ) {
        disponibilidade.reload()
      }
    } finally {
      setCriando(false)
    }
  }

  function novoAgendamento() {
    setConfirmado(null)
    setServico(null)
    setHoraInicio(null)
    setRevisando(false)
    setErroCriacao(null)
    setData(hoje)
  }

  if (confirmado) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Agendar horário"
          description="Seu horário está reservado na Barbearia do Bruno."
        />
        <BookingConfirmed onNovoAgendamento={novoAgendamento} />
      </div>
    )
  }

  const etapaConcluida = revisando || horaInicio ? 3 : servico ? 2 : barbeiro ? 1 : 0
  const etapaAtual = etapaConcluida === 3 && !horaInicio ? 2 : etapaConcluida

  return (
    <div className={styles.page}>
      <PageHeader
        title="Agendar horário"
        description="Escolha o barbeiro, o serviço e o horário disponível."
      />

      <BookingSteps current={etapaAtual} concluidos={etapaConcluida} />

      <StepBarbeiro barbeiro={barbeiro} onSelect={setBarbeiro} />

      {barbeiro && (
        <section className={styles.section} aria-labelledby="etapa-servico">
          <div className={styles.sectionHead}>
            <h2 id="etapa-servico" className={styles.sectionTitle}>
              Escolha o serviço
            </h2>
            <p className={styles.sectionHint}>
              Serviços oferecidos por {barbeiro.nome}.
            </p>
          </div>

          {servicos.loading && <Loading label="Carregando serviços" />}

          {!servicos.loading && servicos.error && (
            <ErrorState
              title="Não foi possível carregar os serviços"
              description={servicos.error.message}
              icon={<AlertIcon size={22} />}
              action={
                <Button variant="secondary" onClick={servicos.reload}>
                  Tentar novamente
                </Button>
              }
            />
          )}

          {!servicos.loading &&
            !servicos.error &&
            servicos.data &&
            (servicos.data.length === 0 ? (
              <EmptyState
                title="Nenhum serviço disponível"
                description="Este barbeiro não possui serviços ativos no momento."
                icon={<ScissorsIcon size={22} />}
              />
            ) : (
              <div className={styles.choiceList}>
                {servicos.data.map((item) => (
                  <Choice
                    key={item.id}
                    selected={servico?.id === item.id}
                    onClick={() => setServico(item)}
                    ariaLabel={`Escolher ${item.nome}`}
                  >
                    <span className={styles.choiceTitle}>{item.nome}</span>
                    <span className={styles.choiceMeta}>
                      {formatDuration(item.duracaoMinutos)} ·{' '}
                      {formatPrice(item.preco)}
                    </span>
                    {item.descricao && (
                      <span className={styles.choiceDescription}>
                        {item.descricao}
                      </span>
                    )}
                  </Choice>
                ))}
              </div>
            ))}
        </section>
      )}

      {barbeiro && servico && !revisando && (
        <section className={styles.section} aria-labelledby="etapa-horario">
          <div className={styles.sectionHead}>
            <h2 id="etapa-horario" className={styles.sectionTitle}>
              Escolha a data e o horário
            </h2>
            <p className={styles.sectionHint}>
              Horários livres informados pela barbearia para o serviço
              escolhido.
            </p>
          </div>

          <div className={styles.dateList} role="group" aria-label="Datas">
            {datas.map((dateKey) => {
              const [dia, mes] = formatDateKeyShort(dateKey).split(' ')
              return (
                <button
                  key={dateKey}
                  type="button"
                  className={[
                    styles.dateChip,
                    dateKey === data ? styles.dateChipSelected : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-pressed={dateKey === data}
                  onClick={() => setData(dateKey)}
                >
                  <span className={styles.dateChipWeekday}>
                    {weekdayInitial(dateKey)}
                  </span>
                  <span className={styles.dateChipDay}>{dia}</span>
                  <span className={styles.dateChipMonth}>{mes}</span>
                </button>
              )
            })}
          </div>

          <div className={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ChevronLeftIcon size={16} />}
              disabled={!temPaginaAnterior}
              onClick={() => {
                const destino = addDays(hoje, (pagina - 1) * DIAS_EXIBIDOS)
                setPagina(pagina - 1)
                setData(destino)
              }}
            >
              Semana anterior
            </Button>
            <Button
              variant="ghost"
              size="sm"
              rightIcon={<ChevronRightIcon size={16} />}
              disabled={!temProximaPagina}
              onClick={() => {
                const destino = addDays(hoje, (pagina + 1) * DIAS_EXIBIDOS)
                setPagina(pagina + 1)
                setData(destino)
              }}
            >
              Próxima semana
            </Button>
          </div>

          <p className={styles.sectionHint}>{formatDateKeyLong(data)}</p>

          {disponibilidade.loading && <Loading label="Consultando horários" />}

          {!disponibilidade.loading && disponibilidade.error && (
            <ErrorState
              title="Não foi possível consultar os horários"
              description={
                disponibilidade.error.status === 404
                  ? 'Este serviço não está mais disponível para o barbeiro escolhido.'
                  : disponibilidade.error.message
              }
              icon={<AlertIcon size={22} />}
              action={
                <Button variant="secondary" onClick={disponibilidade.reload}>
                  Tentar novamente
                </Button>
              }
            />
          )}

          {!disponibilidade.loading &&
            !disponibilidade.error &&
            horarios.length === 0 && (
              <EmptyState
                title="Nenhum horário disponível"
                description="Não há horários livres nesta data para o serviço escolhido. Tente outro dia."
                icon={<ClockIcon size={22} />}
              />
            )}

          {!disponibilidade.loading &&
            !disponibilidade.error &&
            horarios.length > 0 && (
              <>
                <div
                  className={styles.slotGrid}
                  role="group"
                  aria-label="Horários disponíveis"
                >
                  {horarios.map((horario) => (
                    <button
                      key={horario}
                      type="button"
                      className={[
                        styles.slot,
                        horario === horaInicio ? styles.slotSelected : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={horario === horaInicio}
                      onClick={() => setHoraInicio(horario)}
                    >
                      {formatTime(horario)}
                    </button>
                  ))}
                </div>

                <div className={`${styles.actions} ${styles.actionsEnd}`}>
                  <Button
                    disabled={!horaInicio}
                    onClick={() => setRevisando(true)}
                  >
                    Revisar agendamento
                  </Button>
                </div>
              </>
            )}
        </section>
      )}

      {revisando && (
        <StepRevisao
          barbeiro={barbeiro}
          servico={servico}
          data={data}
          horaInicio={horaInicio}
          submitting={criando}
          errorMessage={erroCriacao}
          onVoltar={() => setRevisando(false)}
          onConfirmar={confirmar}
        />
      )}

      {!barbeiro && (
        <p className={styles.note}>
          <span className={styles.noteIcon} aria-hidden="true">
            <CalendarIcon size={16} />
          </span>
          <span>
            Escolha um barbeiro para ver os serviços e os horários disponíveis.
          </span>
        </p>
      )}
    </div>
  )
}