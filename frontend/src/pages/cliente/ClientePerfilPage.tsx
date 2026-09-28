import type { ReactNode } from 'react'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorState } from '../../components/ui/States'
import { Loading } from '../../components/ui/Loading'
import { AlertIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { authService } from '../../services/api/authService'
import type { Usuario } from '../../types/domain'
import { formatDateFull, formatPhone } from '../../utils/format'
import styles from './cliente.module.css'

function ContaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{children}</span>
    </div>
  )
}

/** Rótulo legível do papel da conta (mesmo mapeamento do layout). */
function papelLabel(tipoUsuario: Usuario['tipoUsuario']): string {
  return tipoUsuario === 'BARBEIRO' ? 'Barbeiro' : 'Cliente'
}

/**
 * Perfil do cliente — dados reais de GET /auth/me. Somente leitura: o backend
 * ainda não expõe endpoint de edição de dados do usuário, portanto nenhuma
 * alteração é simulada aqui.
 */
export function ClientePerfilPage() {
  const perfil = useApiResource('auth:me:perfil', (signal) =>
    authService.me(signal),
  )
  const user = perfil.data

  return (
    <div className={styles.page}>
      <PageHeader
        title="Perfil"
        description="Dados da sua conta na Barbearia do Bruno."
        actions={
          <Button
            variant="secondary"
            onClick={perfil.reload}
            disabled={perfil.loading}
          >
            Atualizar
          </Button>
        }
      />

      {perfil.loading && <Loading label="Carregando seus dados" />}

      {!perfil.loading && perfil.error && (
        <ErrorState
          title="Não foi possível carregar seu perfil"
          description={perfil.error.message}
          icon={<AlertIcon size={22} />}
          action={
            <Button variant="secondary" onClick={perfil.reload}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!perfil.loading && !perfil.error && user && (
        <>
          <Card className={styles.profileIdentity}>
            <Avatar name={user.nome} size={56} />
            <div className={styles.profileIdentityInfo}>
              <span className={styles.profileName}>{user.nome}</span>
              <span className={styles.profileRole}>
                Conta de {papelLabel(user.tipoUsuario).toLowerCase()}
              </span>
            </div>
          </Card>

          <section className={styles.section} aria-labelledby="perfil-contato">
            <div className={styles.sectionHead}>
              <h2 id="perfil-contato" className={styles.sectionTitle}>
                Dados de contato
              </h2>
            </div>
            <Card className={styles.profileDetails}>
              <ContaRow label="Telefone">{formatPhone(user.telefone)}</ContaRow>
              <ContaRow label="E-mail">{user.email ?? 'Não informado'}</ContaRow>
            </Card>
          </section>

          <section className={styles.section} aria-labelledby="perfil-conta">
            <div className={styles.sectionHead}>
              <h2 id="perfil-conta" className={styles.sectionTitle}>
                Informações da conta
              </h2>
            </div>
            <Card className={styles.profileDetails}>
              <ContaRow label="Tipo de conta">
                {papelLabel(user.tipoUsuario)}
              </ContaRow>
              <ContaRow label="Situação">
                <Badge tone={user.ativo ? 'success' : 'danger'}>
                  {user.ativo ? 'Ativa' : 'Inativa'}
                </Badge>
              </ContaRow>
              <ContaRow label="Cliente desde">
                {formatDateFull(user.dataCriacao)}
              </ContaRow>
              <ContaRow label="Última atualização">
                {formatDateFull(user.dataAtualizacao)}
              </ContaRow>
            </Card>
          </section>
        </>
      )}
    </div>
  )
}