import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { AlertIcon, CalendarIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { appointmentsService } from '../../services/api/appointmentsService'
import { useAuth } from '../../contexts/useAuth'
import type { Agendamento } from '../../types/domain'
import { todayDateKey } from '../../utils/date'
import { ROUTES } from '../../routes/routes'
import { AppointmentCard } from './components'
import styles from './cliente.module.css'

function primeiroAgendamentoAtivo(
  agendamentos: Agendamento[],
  hoje: string,
): Agendamento | null {
  return (
    agendamentos.find(
      (item) => item.status === 'CONFIRMADO' && item.data >= hoje,
    ) ?? null
  )
}

/**
 * Início do cliente — resumo real: próximo agendamento confirmado
 * (GET /appointments/my) e atalho para agendar. Nenhum dado é estimado.
 */
export function ClienteHomePage() {
  const { user } = useAuth()
  const agendamentos = useApiResource('appointments:my:home', (signal) =>
    appointmentsService.listMine(signal),
  )

  const proximo = agendamentos.data
    ? primeiroAgendamentoAtivo(agendamentos.data, todayDateKey())
    : null

  const primeiroNome = user?.nome.trim().split(/\s+/)[0] ?? ''

  return (
    <div className={styles.page}>
      <PageHeader
        title={primeiroNome ? `Olá, ${primeiroNome}` : 'Início'}
        description="Sua agenda na Barbearia do Bruno."
        actions={
          <Link to={ROUTES.cliente.agendamento}>
            <Button leftIcon={<CalendarIcon size={16} />}>Agendar horário</Button>
          </Link>
        }
      />

      <section className={styles.section} aria-labelledby="proximo">
        <div className={styles.sectionHead}>
          <span className="eyebrow">Próximo</span>
          <h2 id="proximo" className={styles.sectionTitle}>
            Seu próximo agendamento
          </h2>
        </div>

        {agendamentos.loading && <Loading label="Carregando sua agenda" />}

        {!agendamentos.loading && agendamentos.error && (
          <ErrorState
            title="Não foi possível carregar sua agenda"
            description={agendamentos.error.message}
            icon={<AlertIcon size={22} />}
            action={
              <Button variant="secondary" onClick={agendamentos.reload}>
                Tentar novamente
              </Button>
            }
          />
        )}

        {!agendamentos.loading && !agendamentos.error && !proximo && (
          <EmptyState
            title="Nenhum horário marcado"
            description="Você não tem agendamentos confirmados a partir de hoje."
            icon={<CalendarIcon size={22} />}
            action={
              <Link to={ROUTES.cliente.agendamento}>
                <Button>Agendar horário</Button>
              </Link>
            }
          />
        )}

        {!agendamentos.loading && !agendamentos.error && proximo && (
          <AppointmentCard agendamento={proximo} />
        )}
      </section>

      <section className={styles.section} aria-labelledby="atalhos">
        <div className={styles.sectionHead}>
          <h2 id="atalhos" className={styles.sectionTitle}>
            Atalhos
          </h2>
        </div>
        <Card className={styles.actions}>
          <Link to={ROUTES.cliente.agendamento}>
            <Button variant="secondary">Agendar horário</Button>
          </Link>
          <Link to={ROUTES.cliente.agendamentos}>
            <Button variant="secondary">Meus agendamentos</Button>
          </Link>
        </Card>
      </section>
    </div>
  )
}