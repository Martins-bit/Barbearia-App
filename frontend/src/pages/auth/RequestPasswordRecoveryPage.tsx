import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { useToast } from '../../contexts/useToast'
import { AuthLayout } from '../../layouts/AuthLayout'
import { authService } from '../../services/api/authService'
import { ROUTES } from '../../routes/routes'
import {
  authRequestErrorMessage,
  isValidEmail,
  PASSWORD_RECOVERY_ACCEPTED_MESSAGE,
} from './authValidation'
import styles from './LoginPage.module.css'

export function RequestPasswordRecoveryPage() {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string>()
  const [error, setError] = useState<string>()
  const [requestAccepted, setRequestAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEmailError(undefined)
    setError(undefined)

    const normalizedEmail = email.trim().toLowerCase()
    if (!isValidEmail(normalizedEmail)) {
      setEmailError('Informe um endereço de e-mail válido.')
      return
    }

    setSubmitting(true)
    try {
      await authService.requestPasswordRecovery(normalizedEmail)
      setRequestAccepted(true)
      toast.success('Solicitação de recuperação processada.')
    } catch (caught) {
      setError(
        authRequestErrorMessage(
          caught,
          'Não foi possível solicitar a recuperação agora.',
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      heading="Recupere seu acesso."
      subheading="Informe o e-mail associado à sua conta para solicitar a redefinição da senha."
    >
      <div className={styles.header}>
        <span className={`eyebrow ${styles.eyebrow}`}>Acesso</span>
        <h2 className={styles.title}>Esqueci minha senha</h2>
        <p className={styles.subtitle}>
          A solicitação não informa se existe uma conta para o endereço digitado.
        </p>
      </div>

      {requestAccepted ? (
        <div role="status">
          <p className={styles.subtitle}>
            {PASSWORD_RECOVERY_ACCEPTED_MESSAGE}
          </p>
          <p className={styles.footerText}>
            Ao receber o código,{' '}
            <Link className={styles.link} to={ROUTES.resetPassword}>
              redefina sua senha
            </Link>
            .
          </p>
        </div>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Input
            label="E-mail"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setEmailError(undefined)
            }}
            error={emailError}
            required
          />

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Solicitar recuperação
          </Button>
        </form>
      )}

      <p className={styles.footerText}>
        <Link className={styles.link} to={ROUTES.login}>
          Voltar ao login
        </Link>
      </p>
    </AuthLayout>
  )
}