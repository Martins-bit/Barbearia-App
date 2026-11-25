import { useState, type FormEvent } from 'react'
import {
  Link,
  useNavigate,
  type NavigateFunction,
} from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { useToast } from '../../contexts/useToast'
import {
  authService,
  type RegisterResult,
} from '../../services/api/authService'
import { ROUTES } from '../../routes/routes'
import {
  authRequestErrorMessage,
  isValidEmail,
  normalizePhone,
  registrationNameError,
  registrationPhoneError,
} from './authValidation'
import styles from './LoginPage.module.css'

export function completeConfirmedRegistration(
  navigate: NavigateFunction,
  email: string,
  emailConfirmationSent: boolean,
  notifySuccess: () => void,
): void {
  navigate(ROUTES.confirmEmail, {
    replace: true,
    state: { email, emailConfirmationSent },
  })
  notifySuccess()
}

/**
 * Cadastro de cliente — usa o endpoint real POST /auth/register.
 */
export function RegisterPage() {
  const toast = useToast()
  const navigate = useNavigate()

  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertainEmail, setUncertainEmail] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | undefined>()
  const [phoneError, setPhoneError] = useState<string | undefined>()
  const [emailError, setEmailError] = useState<string | undefined>()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (uncertainEmail) return

    setError(null)
    setNameError(undefined)
    setPhoneError(undefined)
    setEmailError(undefined)

    const normalizedName = nome.trim()
    const normalizedPhone = normalizePhone(telefone)
    const normalizedEmail = email.trim().toLowerCase()
    const nextNameError = registrationNameError(nome)
    const nextPhoneError = registrationPhoneError(telefone)
    const nextEmailError = isValidEmail(normalizedEmail)
      ? undefined
      : 'Informe um endereço de e-mail válido.'

    setNameError(nextNameError ?? undefined)
    setPhoneError(nextPhoneError ?? undefined)
    setEmailError(nextEmailError)
    if (nextNameError || nextPhoneError || nextEmailError) {
      return
    }

    setSubmitting(true)
    const result = await authService
      .register({
        nome: normalizedName,
        telefone: normalizedPhone,
        senha,
        email: normalizedEmail,
      })
      .catch((err): RegisterResult | null => {
        setSubmitting(false)
        const message = authRequestErrorMessage(
          err,
          'Não foi possível concluir o cadastro.',
        )
        setError(message)
        toast.error(message, 'Falha no cadastro')
        return null
      })

    setSubmitting(false)
    if (result === null) return

    if (result.outcome === 'unknown') {
      setUncertainEmail(normalizedEmail)
      setError(
        'Não foi possível confirmar o resultado do cadastro. A conta pode ter sido criada. Para evitar duplicidade, não tente cadastrar novamente agora.',
      )
      return
    }

    completeConfirmedRegistration(
      navigate,
      normalizedEmail,
      result.response.emailConfirmationSent,
      () => toast.success('Cadastro criado. Confirme seu e-mail para entrar.'),
    )
  }

  return (
    <AuthLayout
      heading="Comece pelo seu cadastro."
      subheading="Crie sua conta para agendar horários e acompanhar seus atendimentos."
    >
      <div className={styles.header}>
        <span className={`eyebrow ${styles.eyebrow}`}>Cadastro</span>
        <h2 className={styles.title}>Criar conta</h2>
        <p className={styles.subtitle}>Leva menos de um minuto.</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Input
          label="Nome"
          name="nome"
          autoComplete="name"
          placeholder="Seu nome"
          value={nome}
          disabled={uncertainEmail !== null}
          onChange={(event) => {
            setNome(event.target.value)
            setNameError(undefined)
          }}
          error={nameError}
          required
        />
        <Input
          label="Telefone"
          name="telefone"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          placeholder="11 99999-9999"
          value={telefone}
          disabled={uncertainEmail !== null}
          onChange={(event) => {
            setTelefone(event.target.value)
            setPhoneError(undefined)
          }}
          error={phoneError}
          required
        />
        <Input
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="seu@email.com"
          value={email}
          disabled={uncertainEmail !== null}
          onChange={(event) => {
            setEmail(event.target.value)
            setEmailError(undefined)
          }}
          error={emailError}
          required
        />
        <Input
          label="Senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          placeholder="Crie uma senha"
          value={senha}
          disabled={uncertainEmail !== null}
          onChange={(event) => setSenha(event.target.value)}
          required
        />

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {uncertainEmail ? (
          <Link
            className={styles.link}
            to={ROUTES.confirmEmail}
            state={{ email: uncertainEmail }}
          >
            Continuar para confirmação ou reenvio do e-mail
          </Link>
        ) : (
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Criar conta
          </Button>
        )}
      </form>

      <p className={styles.footerText}>
        Já tem conta?{' '}
        <Link className={styles.link} to={ROUTES.login}>
          Entrar
        </Link>
      </p>
    </AuthLayout>
  )
}