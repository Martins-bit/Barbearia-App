import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { useAuth } from '../../contexts/useAuth'
import { useToast } from '../../contexts/useToast'
import { AuthLayout } from '../../layouts/AuthLayout'
import { authService } from '../../services/api/authService'
import { ROUTES } from '../../routes/routes'
import { authRequestErrorMessage, validatePasswordReset } from './authValidation'
import styles from './LoginPage.module.css'

const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function ResetPasswordPage() {
  const { logout } = useAuth()
  const toast = useToast()
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)

    if (!RESET_TOKEN_PATTERN.test(token)) {
      setError('Informe o código de recuperação exatamente como recebido.')
      return
    }

    const validationError = validatePasswordReset(password, confirmation)
    if (validationError) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    try {
      await authService.resetPassword(token, password)
      setToken('')
      setPassword('')
      setConfirmation('')
      logout()
      setCompleted(true)
      toast.success('Senha redefinida com sucesso.')
    } catch (caught) {
      setError(
        authRequestErrorMessage(
          caught,
          'Não foi possível redefinir a senha. Confira os dados e tente novamente.',
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      heading="Escolha uma nova senha."
      subheading="Use o código recebido e defina uma senha para voltar à sua conta."
    >
      <div className={styles.header}>
        <span className={`eyebrow ${styles.eyebrow}`}>Acesso</span>
        <h2 className={styles.title}>Redefinir senha</h2>
        <p className={styles.subtitle}>
          A senha deve ter pelo menos 8 caracteres e respeitar o limite de 72 bytes.
        </p>
      </div>

      {completed ? (
        <div role="status">
          <p className={styles.subtitle}>
            Sua senha foi alterada. Entre novamente com a nova senha.
          </p>
          <p className={styles.footerText}>
            <Link className={styles.link} to={ROUTES.login}>
              Voltar ao login
            </Link>
          </p>
        </div>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Input
            label="Código de recuperação"
            name="token"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
          <Input
            label="Nova senha"
            name="senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <Input
            label="Confirme a nova senha"
            name="confirmacao"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Redefinir senha
          </Button>
        </form>
      )}

      <p className={styles.footerText}>
        <Link className={styles.link} to={ROUTES.recoverPassword}>
          Solicitar outro código
        </Link>
      </p>
    </AuthLayout>
  )
}