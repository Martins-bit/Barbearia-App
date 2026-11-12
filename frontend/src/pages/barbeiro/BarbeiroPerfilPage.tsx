import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorState } from '../../components/ui/States'
import { Input } from '../../components/ui/Field'
import { Loading } from '../../components/ui/Loading'
import { AlertIcon, CheckIcon, ClockIcon, EditIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { authService } from '../../services/api/authService'
import {
  downloadJsonFile,
  personalDataExportFilename,
} from '../../utils/downloadJson'
import { useToast } from '../../contexts/useToast'
import { ROUTES } from '../../routes/routes'
import type { Usuario, UpdateUserInput } from '../../types/domain'
import { formatDateFull, formatPhone } from '../../utils/format'
import styles from './barbeiro.module.css'

function ContaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{children}</span>
    </div>
  )
}

function papelLabel(tipoUsuario: Usuario['tipoUsuario']): string {
  return tipoUsuario === 'BARBEIRO' ? 'Barbeiro' : 'Cliente'
}

/**
 * Perfil do barbeiro — dados reais de GET /auth/me; edição via PATCH /users/me.
 */
export function BarbeiroPerfilPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const perfil = useApiResource('auth:me:perfil:barbeiro', (signal) =>
    authService.me(signal),
  )
  const user = perfil.data

  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState<UpdateUserInput>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const update = useAsyncAction(async (input: UpdateUserInput) => {
    return authService.updateProfile(input)
  })
  const dataExport = useAsyncAction(async () => authService.exportPersonalData())
  const exportInProgress = useRef(false)

  async function handleExportData() {
    if (exportInProgress.current) return
    exportInProgress.current = true
    try {
      const data = await dataExport.run()
      downloadJsonFile(data, personalDataExportFilename())
      toast.success('Sua cópia JSON foi baixada.', 'Dados exportados')
    } catch {
      toast.error(
        'Não foi possível exportar seus dados. Tente novamente.',
        'Falha ao exportar',
      )
    } finally {
      exportInProgress.current = false
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})

    const errors: Record<string, string> = {}
    const nome = formData.nome?.trim()
    const telefone = formData.telefone?.replace(/\D/g, '')
    const email = formData.email?.trim() ?? null

    if (nome !== undefined) {
      if (!nome) errors.nome = 'Informe o nome.'
      else if (nome.length < 2) errors.nome = 'O nome deve ter pelo menos 2 caracteres.'
      else if (nome.length > 120) errors.nome = 'O nome deve ter no máximo 120 caracteres.'
    }
    if (telefone !== undefined) {
      if (!telefone) errors.telefone = 'Informe o telefone.'
      else if (!/^\d{10,11}$/.test(telefone)) {
        errors.telefone = 'Telefone inválido (10 ou 11 dígitos).'
      }
    }
    if (email !== undefined && email !== null && email.length > 0) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'E-mail inválido.'
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    try {
      const updated = await update.run({
        nome,
        telefone,
        email: email === '' ? null : email,
      })
      if (updated.email && updated.email !== user?.email) {
        navigate(ROUTES.confirmEmail, {
          state: { email: updated.email },
          replace: true,
        })
        return
      }
      perfil.reload()
      toast.success('Perfil atualizado com sucesso.', 'Alterações salvas')
      setEditing(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Não foi possível atualizar o perfil.'
      toast.error(message, 'Falha ao salvar')
    }
  }

  function startEditing() {
    setFieldErrors({})
    setFormData({
      nome: user?.nome,
      telefone: user?.telefone,
      email: user?.email,
    })
    setEditing(true)
  }

  function cancelEditing() {
    setFieldErrors({})
    setFormData({})
    setEditing(false)
  }

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
          {!editing ? (
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
                  <ContaRow label="Confirmação do e-mail">
                    <span className={styles.emailVerification}>
                      {!user.email ? (
                        <Badge tone="neutral">Não informado</Badge>
                      ) : user.emailVerificadoEm ? (
                        <Badge tone="success">
                          <CheckIcon size={14} />
                          Confirmado
                        </Badge>
                      ) : (
                        <>
                          <Badge tone="warning">
                            <ClockIcon size={14} />
                            Pendente
                          </Badge>
                          <Button
                            className={styles.emailVerificationAction}
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(ROUTES.confirmEmail)}
                          >
                            Confirmar e-mail
                          </Button>
                        </>
                      )}
                    </span>
                  </ContaRow>
                </Card>
                <div className={styles.profileActions}>
                  <Button
                    variant="secondary"
                    onClick={startEditing}
                    leftIcon={<EditIcon size={18} />}
                    disabled={update.loading}
                  >
                    Editar dados
                  </Button>
                </div>
              </section>

              <section className={styles.section} aria-labelledby="perfil-conta">
                <div className={styles.sectionHead}>
                  <h2 id="perfil-conta" className={styles.sectionTitle}>
                    Informações da conta
                  </h2>
                </div>
                <Card className={styles.profileDetails}>
                  <ContaRow label="Tipo de conta">{papelLabel(user.tipoUsuario)}</ContaRow>
                  <ContaRow label="Situação">
                    <Badge tone={user.ativo ? 'success' : 'danger'}>
                      {user.ativo ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </ContaRow>
                  <ContaRow label="Membro desde">{formatDateFull(user.dataCriacao)}</ContaRow>
                  <ContaRow label="Última atualização">{formatDateFull(user.dataAtualizacao)}</ContaRow>
                </Card>
              </section>

              <section className={styles.section} aria-labelledby="perfil-dados">
                <div className={styles.sectionHead}>
                  <h2 id="perfil-dados" className={styles.sectionTitle}>
                    Seus dados
                  </h2>
                </div>
                <Card className={styles.profileDetails}>
                  <p className={styles.sectionHint}>
                    Baixe uma cópia JSON dos dados da sua conta que estão disponíveis
                    para você. Conteúdo de mensagens e observações livres não é
                    incluído nesta versão para reduzir a exposição de dados de outras
                    pessoas.
                  </p>
                  <div className={styles.profileActions}>
                    <Button
                      variant="secondary"
                      className={styles.profileExportButton}
                      onClick={handleExportData}
                      loading={dataExport.loading}
                      disabled={dataExport.loading}
                    >
                      Baixar cópia dos dados
                    </Button>
                  </div>
                </Card>
              </section>
            </>
          ) : (
            <form className={styles.editForm} onSubmit={handleSubmit} noValidate>
              <Card className={styles.profileDetails}>
                <div className={styles.sectionHead}>
                  <h2 className={styles.sectionTitle}>Editar perfil</h2>
                  <p className={styles.sectionHint}>
                    Preencha os campos que deseja alterar. Deixe em branco para manter o valor atual.
                  </p>
                </div>

                <Input
                  label="Nome"
                  name="nome"
                  placeholder="Seu nome"
                  value={formData.nome ?? ''}
                  onChange={(event) => setFormData({ ...formData, nome: event.target.value })}
                  error={fieldErrors.nome}
                  required
                  autoComplete="name"
                />

                <Input
                  label="Telefone"
                  name="telefone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="(11) 99999-9999"
                  value={formData.telefone ?? ''}
                  onChange={(event) => setFormData({ ...formData, telefone: event.target.value })}
                  error={fieldErrors.telefone}
                  required
                  autoComplete="tel"
                />

                <Input
                  label="E-mail"
                  name="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={formData.email ?? ''}
                  onChange={(event) =>
                    setFormData({ ...formData, email: event.target.value || null })
                  }
                  error={fieldErrors.email}
                  autoComplete="email"
                  hint="Deixe em branco para remover o e-mail da conta."
                />

                <div className={styles.formActions}>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={cancelEditing}
                    disabled={update.loading}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={update.loading}
                    disabled={update.loading}
                  >
                    Salvar alterações
                  </Button>
                </div>
              </Card>
            </form>
          )}
        </>
      )}
    </div>
  )
}
