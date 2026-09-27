import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Card } from '../../components/ui/Card'
import { Loading } from '../../components/ui/Loading'
import {
  AlertIcon,
  CheckIcon,
  ChevronLeftIcon,
  UsersIcon,
} from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { barbersService } from '../../services/api/catalogService'
import type { Barbeiro, Servico } from '../../types/domain'
import { ROUTES } from '../../routes/routes'
import { BookingSummary, PriceNotice } from './components'
import styles from './cliente.module.css'

const STEPS = ['Barbeiro', 'Serviço', 'Data e horário', 'Revisão'] as const

interface StepProps {
  current: number
  concluidos: number
}

/** Indicador de progresso do fluxo de agendamento. */
export function BookingSteps({ current, concluidos }: StepProps) {
  return (
    <ol className={styles.steps}>
      {STEPS.map((label, index) => {
        const isCurrent = index === current
        const isDone = index < concluidos
        return (
          <li
            key={label}
            className={[
              styles.step,
              isCurrent ? styles.stepCurrent : '',
              !isCurrent && isDone ? styles.stepDone : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className={styles.stepNumber}>{index + 1}</span>
            <span>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

interface ChoiceProps {
  selected: boolean
  onClick: () => void
  children: ReactNode
  ariaLabel: string
}

/** Item de escolha (barbeiro/serviço) como botão acessível. */
export function Choice({ selected, onClick, children, ariaLabel }: ChoiceProps) {
  return (
    <button
      type="button"
      className={[styles.choice, selected ? styles.choiceSelected : '']
        .filter(Boolean)
        .join(' ')}
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className={styles.choiceBody}>{children}</span>
      {selected && (
        <span className={styles.choiceMark} aria-hidden="true">
          <CheckIcon size={14} />
        </span>
      )}
    </button>
  )
}

/** Bloco 1 — escolha real do barbeiro (GET /barbers). */
export function StepBarbeiro({
  barbeiro,
  onSelect,
}: {
  barbeiro: Barbeiro | null
  onSelect: (barbeiro: Barbeiro) => void
}) {
  const barbeiros = useApiResource(
    'barbers',
    (signal) => barbersService.list(signal),
  )

  return (
    <section className={styles.section} aria-labelledby="etapa-barbeiro">
      <div className={styles.sectionHead}>
        <h2 id="etapa-barbeiro" className={styles.sectionTitle}>
          Escolha o barbeiro
        </h2>
        <p className={styles.sectionHint}>
          Os barbeiros disponíveis para agendamento na barbearia.
        </p>
      </div>

      {barbeiros.loading && <Loading label="Carregando barbeiros" />}

      {!barbeiros.loading && barbeiros.error && (
        <ErrorState
          title="Não foi possível carregar os barbeiros"
          description={barbeiros.error.message}
          icon={<AlertIcon size={22} />}
          action={
            <Button variant="secondary" onClick={barbeiros.reload}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!barbeiros.loading && !barbeiros.error && barbeiros.data && (
        barbeiros.data.length === 0 ? (
          <EmptyState
            title="Nenhum barbeiro disponível"
            description="No momento não há barbeiros ativos para agendamento."
            icon={<UsersIcon size={22} />}
          />
        ) : (
          <div className={styles.choiceList}>
            {barbeiros.data.map((item) => (
              <Choice
                key={item.id}
                selected={barbeiro?.id === item.id}
                onClick={() => onSelect(item)}
                ariaLabel={`Escolher ${item.nome}`}
              >
                <span className={styles.choiceTitle}>{item.nome}</span>
              </Choice>
            ))}
          </div>
        )
      )}
    </section>
  )
}

/** Bloco 4 — revisão final com as escolhas do cliente. */
export function StepRevisao({
  barbeiro,
  servico,
  data,
  horaInicio,
  submitting,
  errorMessage,
  onVoltar,
  onConfirmar,
}: {
  barbeiro: Barbeiro | null
  servico: Servico | null
  data: string | null
  horaInicio: string | null
  submitting: boolean
  errorMessage: string | null
  onVoltar: () => void
  onConfirmar: () => void
}) {
  return (
    <section className={styles.section} aria-labelledby="etapa-revisao">
      <div className={styles.sectionHead}>
        <h2 id="etapa-revisao" className={styles.sectionTitle}>
          Revise e confirme
        </h2>
        <p className={styles.sectionHint}>
          Confira os dados abaixo antes de confirmar o agendamento.
        </p>
      </div>

      <BookingSummary
        barbeiro={barbeiro}
        servico={servico}
        data={data}
        horaInicio={horaInicio}
      />

      <PriceNotice />

      {errorMessage && (
        <ErrorState
          title="Não foi possível confirmar"
          description={errorMessage}
          icon={<AlertIcon size={22} />}
        />
      )}

      <div className={styles.actions}>
        <Button
          variant="secondary"
          leftIcon={<ChevronLeftIcon size={16} />}
          onClick={onVoltar}
          disabled={submitting}
        >
          Voltar e alterar
        </Button>
        <Button loading={submitting} onClick={onConfirmar}>
          Confirmar agendamento
        </Button>
      </div>
    </section>
  )
}

/** Bloco 5 — confirmação após a criação real do agendamento. */
export function BookingConfirmed({
  onNovoAgendamento,
}: {
  onNovoAgendamento: () => void
}) {
  return (
    <Card highlighted className={styles.confirm}>
      <span className={styles.confirmMark} aria-hidden="true">
        <CheckIcon size={22} />
      </span>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Agendamento confirmado</h2>
        <p className={styles.sectionHint}>
          Seu horário está reservado. Você pode acompanhar ou cancelar em Meus
          agendamentos.
        </p>
      </div>
      <div className={styles.actions}>
        <Link to={ROUTES.cliente.agendamentos}>
          <Button>Ver meus agendamentos</Button>
        </Link>
        <Button variant="secondary" onClick={onNovoAgendamento}>
          Agendar outro horário
        </Button>
      </div>
    </Card>
  )
}

