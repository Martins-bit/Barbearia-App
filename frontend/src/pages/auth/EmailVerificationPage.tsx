import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { useAuth } from '../../contexts/useAuth'
import { useToast } from '../../contexts/useToast'
import { AuthLayout } from '../../layouts/AuthLayout'
import { authService } from '../../services/api/authService'
import { ROUTES } from '../../routes/routes'
import { authRequestErrorMessage } from './authValidation'
import styles from './LoginPage.module.css'

const EMAIL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function EmailVerificationPage() {
  const { status } = useAuth()
  const toast = useToast()
  const [token, setToken] = useState('')
  const [requestMessage, setRequestMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const [requesting, setRequesting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  async function requestConfirmation() {
    setError(undefined)
    setRequestMessage(undefined)
    setRequesting(true)
    try {
      const response = await authService.requestEmailVerification()
      setRequestMessage(response.message)
      toast.success(response.message)
    } catch (caught) {
      const message =
        caught instanceof Error && 'status' in caught && caught.status === 400
          ? 'Adicione um endereço de e-mail válido ao seu perfil antes de solicitar a confirmação.'
          : authRequestErrorMessage(
              caught,
              'Não foi possível solicitar a confirmação agora.',
            )
      setError(message)
    } finally {
      setRequesting(false)
    }
  }

  async function confirmAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)

    if (!EMAIL_TOKEN_PATTERN.test(token)) {
      setError('Informe o token de confirmação exatamente como recebido.')
      return
    }

    setConfirming(true)
    try {
      await authService.confirmEmail(token)
      setToken('')
      setConfirmed(true)
      toast.success('Endereço de e-mail confirmado.')
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
      subheading="A confirmação é feita com o token enviado ao e-mail da própria conta."
    >
      <div className={styles.header}>
        <span className={`eyebrow ${styles.eyebrow}`}>Conta</span>
        <h2 className={styles.title}>Confirmar e-mail</h2>
        <p className={styles.subtitle}>
          Solicite o envio enquanto estiver conectado ou informe abaixo o token recebido.
        </p>
      </div>

      {status === 'authenticated' ? (
        <div className={styles.form}>
          <Button
            type="button"
            variant="secondary"
            fullWidth
            loading={requesting}
            onClick={requestConfirmation}
          >
            Solicitar confirmação do meu e-mail
          </Button>
          {requestMessage && <p role="status">{requestMessage}</p>}
        </div>
      ) : status === 'loading' ? (
        <p className={styles.subtitle}>Verificando sua sessão.</p>
      ) : (
        <p className={styles.subtitle}>
          Para solicitar o envio, entre na sua conta. A confirmação do token continua disponível sem login.
        </p>
      )}

      {confirmed ? (
        <p className={styles.subtitle} role="status">
          Seu endereço de e-mail foi confirmado.
        </p>
      ) : (
        <form className={styles.form} onSubmit={confirmAddress} noValidate>
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
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <p className={styles.footerText}>
        <Link className={styles.link} to={ROUTES.login}>
          Voltar ao login
        </Link>
      </p>
    </AuthLayout>
  )
}