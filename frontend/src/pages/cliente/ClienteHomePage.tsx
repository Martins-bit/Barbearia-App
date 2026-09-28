import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
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

/** Período do dia no fuso da barbearia, para a saudação do início. */
function saudacaoDoDia(): string {
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()),
  )
  if (Number.isNaN(hora)) return 'Olá'
  if (hora < 12) return 'Bom dia'
  if (hora < 18) return 'Boa tarde'
  return 'Boa noite'
}

/**
 * Início do cliente — resumo real: próximo agendamento confirmado
 * (GET /appointments/my) e acesso rápido às principais telas (agendar,
 * meus agendamentos e perfil). Nenhum dado é estimado.
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
        title={primeiroNome ? `${saudacaoDoDia()}, ${primeiroNome}` : 'Início'}
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

      <section className={styles.section} aria-labelledby="acesso-rapido">
        <div className={styles.sectionHead}>
          <h2 id="acesso-rapido" className={styles.sectionTitle}>
            Acesso rápido
          </h2>
        </div>
        <div className={styles.quickLinks}>
          <Link className={styles.quickLink} to={ROUTES.cliente.agendamento}>
            <span className={styles.quickLinkTitle}>Agendar horário</span>
            <span className={styles.quickLinkDescription}>
              Escolha o barbeiro, o serviço e o horário.
            </span>
          </Link>
          <Link className={styles.quickLink} to={ROUTES.cliente.agendamentos}>
            <span className={styles.quickLinkTitle}>Meus agendamentos</span>
            <span className={styles.quickLinkDescription}>
              Próximos horários e histórico de atendimentos.
            </span>
          </Link>
          <Link className={styles.quickLink} to={ROUTES.cliente.perfil}>
            <span className={styles.quickLinkTitle}>Perfil</span>
            <span className={styles.quickLinkDescription}>
              Dados da sua conta.
            </span>
          </Link>
        </div>
      </section>
    </div>
  )
}