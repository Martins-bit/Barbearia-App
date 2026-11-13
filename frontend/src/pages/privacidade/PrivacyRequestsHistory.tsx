import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import type { SolicitacaoTitular } from '../../types/domain'
import {
  formatPrivacyRequestDate,
  privacyRequestCategoryLabel,
  privacyRequestStatusLabel,
} from './privacyRequestsUi'
import styles from './PrivacidadePage.module.css'

export interface PrivacyRequestsHistoryProps {
  requests: SolicitacaoTitular[]
  loading: boolean
  error: string | null
  cursor: number | null
  loadingMore: boolean
  moreError: string | null
  onRetry: () => void
  onLoadMore: () => void
}

export function PrivacyRequestsHistory({
  requests,
  loading,
  error,
  cursor,
  loadingMore,
  moreError,
  onRetry,
  onLoadMore,
}: PrivacyRequestsHistoryProps) {
  return (
    <Card className={styles.trackingCard}>
      <p className={styles.receivedNotice}>
        O status <strong>Recebida</strong> significa apenas que a solicitação
        foi registrada. Não indica que ela foi analisada, aprovada ou concluída.
      </p>
      {loading ? (
        <Loading label="Carregando suas solicitações" />
      ) : error ? (
        <ErrorState
          title="Não foi possível carregar as solicitações"
          description={error}
          action={
            <Button variant="secondary" onClick={onRetry}>
              Tentar novamente
            </Button>
          }
        />
      ) : requests.length === 0 ? (
        <EmptyState
          title="Nenhuma solicitação registrada"
          description="Quando você registrar um pedido, ele aparecerá aqui."
        />
      ) : (
        <>
          <ol className={styles.requestList}>
            {requests.map((request) => (
              <li key={request.id}>
                <Card className={styles.requestItem}>
                  <div className={styles.requestItemHeading}>
                    <h3>{privacyRequestCategoryLabel(request.categoria)}</h3>
                    <Badge tone="info">
                      {privacyRequestStatusLabel(request.status)}
                    </Badge>
                  </div>
                  <time
                    className={styles.requestDate}
                    dateTime={request.dataCriacao}
                  >
                    Registrada em {formatPrivacyRequestDate(request.dataCriacao)}
                  </time>
                </Card>
              </li>
            ))}
          </ol>
          {moreError && (
            <p className={styles.requestError} role="alert">
              {moreError}
            </p>
          )}
          {cursor !== null && (
            <Button
              variant="secondary"
              onClick={onLoadMore}
              loading={loadingMore}
              disabled={loadingMore}
            >
              {moreError
                ? 'Tentar carregar novamente'
                : 'Carregar mais solicitações'}
            </Button>
          )}
        </>
      )}
    </Card>
  )
}
