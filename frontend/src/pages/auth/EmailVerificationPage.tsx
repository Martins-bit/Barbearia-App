import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { CheckIcon } from '../../components/ui/icons/Icon'
import { useAuth } from '../../contexts/useAuth'
import { AuthLayout } from '../../layouts/AuthLayout'
import { authService } from '../../services/api/authService'
import { ROUTES } from '../../routes/routes'
import { authRequestErrorMessage, isValidEmail } from './authValidation'
import styles from './LoginPage.module.css'

const EMAIL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

interface VerificationLocationState {
  email?: string
  emailConfirmationSent?: boolean
}

export function EmailVerificationPage() {
  const { user } = useAuth()
  const location = useLocation()
  const locationState =
    location.state as VerificationLocationState | null
  const [email, setEmail] = useState(
    locationState?.email ?? user?.email ?? '',
  )
  const [token, setToken] = useState('')
  const [requestMessage, setRequestMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const [requesting, setRequesting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!email && user?.email) setEmail(user.email)
  }, [email, user?.email])

  async function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setRequestMessage(undefined)
    const normalizedEmail = email.trim().toLowerCase()
    if (!isValidEmail(normalizedEmail)) {
      setError('Informe um endereço de e-mail válido.')
      return
    }

    setRequesting(true)
    try {
      await authService.requestEmailVerificationResend(normalizedEmail)
      const message =
        'Se o endereço estiver associado a uma conta pendente, enviaremos as instruções.'
      setRequestMessage(message)
    } catch (caught) {
      setError(
        authRequestErrorMessage(
          caught,
          'Não foi possível processar a solicitação agora.',
        ),
      )
    } finally {
      setRequesting(false)
    }
  }

  async function confirmAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setRequestMessage(undefined)

    if (!EMAIL_TOKEN_PATTERN.test(token)) {
      setError('Informe o token de confirmação exatamente como recebido.')
      return
    }

    setConfirming(true)
    try {
      await authService.confirmEmail(token)
      setToken('')
      setConfirmed(true)
    } catch (caught) {
      setError(
        authRequestErrorMessage(
          caught,
          'Não foi possível confirmar o endereço. Verifique o token e tente novamente.',
        ),
      )
    } finally {
      setConfirming(false)
    }
  }

  return (
    <AuthLayout
      heading="Confirme seu endereço."
      subheading="Confirme o e-mail para liberar o acesso à sua conta."
    >
      <div className={styles.header}>
        <span className={`eyebrow ${styles.eyebrow}`}>Conta</span>
        <h2 className={styles.title}>Confirmar e-mail</h2>
        <p className={styles.subtitle}>
          Confirme seu endereço para concluir a proteção da sua conta.
        </p>
      </div>

      {confirmed ? (
        <section className={styles.confirmedState} role="status">
          <span className={styles.confirmedIcon}>
            <CheckIcon size={28} />
          </span>
          <h3 className={styles.confirmedTitle}>E-mail confirmado</h3>
          <p className={styles.confirmedText}>
            Seu endereço está confirmado. Você já pode acessar sua conta.
          </p>
          <Link className={styles.successLink} to={ROUTES.login}>
            Ir para o login
          </Link>
        </section>
      ) : (
        <>
          {error ? (
            <p className={styles.verificationError} role="alert">
              {error}
            </p>
          ) : requestMessage ? (
            <p className={styles.notice} role="status">
              {requestMessage}
            </p>
          ) : locationState?.emailConfirmationSent === true ? (
            <p className={styles.notice} role="status">
              E-mail enviado. Confira sua caixa de entrada e o spam.
            </p>
          ) : locationState?.emailConfirmationSent === false ? (
            <p className={styles.verificationError} role="status">
              Conta criada, mas o e-mail não foi enviado. Você pode solicitar
              um novo envio abaixo.
            </p>
          ) : null}

          <form className={styles.formSection} onSubmit={confirmAddress} noValidate>
            <div className={styles.sectionHeading}>
              <h3 className={styles.sectionTitle}>Já recebeu o e-mail?</h3>
              <p className={styles.sectionDescription}>
                Cole aqui o token enviado para sua caixa de entrada.
              </p>
            </div>
            <Input
              label="Token de confirmação"
              name="token"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
            <Button type="submit" fullWidth loading={confirming}>
              Confirmar e-mail
            </Button>
          </form>

          <form className={styles.resendSection} onSubmit={requestConfirmation} noValidate>
            <div className={styles.sectionHeading}>
              <h3 className={styles.sectionTitle}>Não recebeu?</h3>
              <p className={styles.sectionDescription}>
                Solicite um novo envio quando precisar.
              </p>
            </div>
            <Input
              label="E-mail da conta"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Button
              type="submit"
              variant="secondary"
              fullWidth
              loading={requesting}
            >
              Solicitar novo e-mail
            </Button>
          </form>
        </>
      )}

      {!confirmed && (
        <p className={styles.footerText}>
          <Link className={styles.link} to={ROUTES.login}>
            Voltar ao login
          </Link>
        </p>
      )}
    </AuthLayout>
  )
}
