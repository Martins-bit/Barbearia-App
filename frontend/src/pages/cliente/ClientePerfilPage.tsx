import { useState, type FormEvent, type ReactNode } from 'react'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Avatar } from '../../components/ui/Avatar'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorState } from '../../components/ui/States'
import { Input } from '../../components/ui/Field'
import { Loading } from '../../components/ui/Loading'
import { AlertIcon, EditIcon } from '../../components/ui/icons/Icon'
import { useApiResource } from '../../hooks/useApiResource'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { authService } from '../../services/api/authService'
import { useToast } from '../../contexts/useToast'
import type { Usuario, UpdateUserInput } from '../../types/domain'
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
 * Perfil do cliente — dados reais de GET /auth/me; edição via PATCH /users/me.
 */
export function ClientePerfilPage() {
  const toast = useToast()
  const perfil = useApiResource('auth:me:perfil', (signal) => authService.me(signal))
  const user = perfil.data

  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState<UpdateUserInput>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const update = useAsyncAction(async (input: UpdateUserInput) => {
    const updated = await authService.updateProfile(input)
    perfil.reload()
    return updated
  })

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
      await update.run({ nome, telefone, email: email === '' ? null : email })
      toast.success('Perfil atualizado com sucesso.', 'Alterações salvas')
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível atualizar o perfil.'
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
                  <ContaRow label="Cliente desde">{formatDateFull(user.dataCriacao)}</ContaRow>
                  <ContaRow label="Última atualização">{formatDateFull(user.dataAtualizacao)}</ContaRow>
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