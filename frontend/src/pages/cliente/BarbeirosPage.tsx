import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Button } from '../../components/ui/Button'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { AlertIcon, UsersIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { barbersService } from '../../services/api/catalogService'
import { ROUTES } from '../../routes/routes'
import { Choice } from './steps'
import styles from './cliente.module.css'

/**
 * Barbeiros — listagem real (GET /barbers). Ao escolher um profissional, o
 * cliente segue para o fluxo de agendamento com a seleção preservada no
 * estado de navegação.
 */
export function BarbeirosPage() {
  const navigate = useNavigate()
  const barbeiros = useApiResource('barbers', (signal) =>
    barbersService.list(signal),
  )

  return (
    <div className={styles.page}>
      <PageHeader
        title="Barbeiros"
        description="Escolha com quem você quer cortar."
      />

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
            {barbeiros.data.map((barbeiro) => (
              <Choice
                key={barbeiro.id}
                selected={false}
                ariaLabel={`Agendar com ${barbeiro.nome}`}
                onClick={() =>
                  navigate(ROUTES.cliente.agendamento, {
                    state: { barbeiroId: barbeiro.id },
                  })
                }
              >
                <span className={styles.choiceTitle}>{barbeiro.nome}</span>
                <span className={styles.choiceDescription}>
                  Ver serviços e horários disponíveis
                </span>
              </Choice>
            ))}
          </div>
        )
      )}
    </div>
  )
}