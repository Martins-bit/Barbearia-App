import type { ReactNode } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { InfoIcon } from '../../components/ui/icons/Icon'
import { formatDateKeyLong, statusLabel, statusTone } from './presenters'
import { formatDuration, formatPrice, formatTime } from '../../utils/format'
import type { Agendamento, Barbeiro, Servico } from '../../types/domain'
import styles from './cliente.module.css'

interface BookingSummaryProps {
  barbeiro: Barbeiro | null
  servico: Servico | null
  data: string | null
  horaInicio: string | null
  /** Ação opcional no rodapé do resumo (ex.: confirmar). */
  action?: ReactNode
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span
        className={[styles.summaryValue, strong ? styles.summaryValueStrong : '']
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Revisão das escolhas do cliente antes da criação do agendamento. Exibe
 * apenas dados confirmados pela API; o preço é exclusivamente informativo e
 * nenhuma etapa financeira é oferecida aqui.
 */
export function BookingSummary({
  barbeiro,
  servico,
  data,
  horaInicio,
  action,
}: BookingSummaryProps) {
  return (
    <Card highlighted>
      <div className={styles.summary}>
        <Row label="Barbeiro" value={barbeiro?.nome ?? 'Não escolhido'} />
        <Row label="Serviço" value={servico?.nome ?? 'Não escolhido'} />
        {servico && (
          <Row label="Duração" value={formatDuration(servico.duracaoMinutos)} />
        )}
        <Row
          label="Data"
          value={data ? formatDateKeyLong(data) : 'Não escolhida'}
        />
        <Row
          label="Horário"
          value={horaInicio ? formatTime(horaInicio) : 'Não escolhido'}
          strong
        />
        {servico && (
          <Row
            label="Preço informativo"
            value={formatPrice(servico.preco)}
          />
        )}
      </div>

      {action && <div className={styles.actions}>{action}</div>}
    </Card>
  )
}

/** Aviso informativo de que o valor é apenas de referência. */
export function PriceNotice() {
  return (
    <p className={styles.note}>
      <span className={styles.noteIcon} aria-hidden="true">
        <InfoIcon size={16} />
      </span>
      <span>
        O valor exibido é apenas informativo. O atendimento é presencial e o
        pagamento é combinado diretamente na barbearia.
      </span>
    </p>
  )
}

interface AppointmentCardProps {
  agendamento: Agendamento
  /** Conteúdo adicional à direita (ex.: botão de cancelar). */
  aside?: ReactNode
}

/** Cartão de um agendamento real (GET /appointments/my). */
export function AppointmentCard({ agendamento, aside }: AppointmentCardProps) {
  return (
    <Card className={styles.appointment}>
      <div className={styles.appointmentDate}>
        <span className={styles.appointmentDay}>
          {agendamento.data.slice(8, 10)}
        </span>
        <span className={styles.appointmentMonth}>
          {agendamento.data.slice(5, 7)}/{agendamento.data.slice(0, 4)}
        </span>
      </div>

      <div className={styles.appointmentMain}>
        <span className={styles.appointmentService}>
          {agendamento.servico.nome}
        </span>
        <span className={styles.appointmentMeta}>
          {formatDateKeyLong(agendamento.data)} · com {agendamento.barbeiro.nome}
        </span>
        <span className={styles.appointmentMeta}>
          {formatTime(agendamento.horaInicio)} –{' '}
          {formatTime(agendamento.horaFim)} ·{' '}
          {formatDuration(agendamento.duracaoMinutos)} ·{' '}
          {formatPrice(agendamento.servico.precoInformativo)}
        </span>
      </div>

      <div className={styles.appointmentSide}>
        <span className={styles.appointmentTime}>
          {formatTime(agendamento.horaInicio)}
        </span>
        <Badge tone={statusTone(agendamento.status)}>
          {statusLabel(agendamento.status)}
        </Badge>
        {aside}
      </div>
    </Card>
  )
}