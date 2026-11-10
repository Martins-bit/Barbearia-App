import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { useToast } from '../../contexts/useToast'
import { authService } from '../../services/api/authService'
import { ROUTES } from '../../routes/routes'
import { authRequestErrorMessage, isValidEmail } from './authValidation'
import styles from './LoginPage.module.css'

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
  const [emailError, setEmailError] = useState<string | undefined>()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setEmailError(undefined)
    const normalizedEmail = email.trim().toLowerCase()
    if (!isValidEmail(normalizedEmail)) {
      setEmailError('Informe um endereço de e-mail válido.')
      return
    }
    setSubmitting(true)
    try {
      await authService.register({
        nome: nome.trim(),
        telefone: telefone.trim(),
        senha,
        email: normalizedEmail,
      })
      toast.success(
        'Cadastro criado. Entre na conta para solicitar a confirmação do e-mail.',
      )
      navigate(ROUTES.login, { replace: true })
    } catch (err) {
      const message = authRequestErrorMessage(
        err,
        'Não foi possível concluir o cadastro.',
      )
      setError(message)
      toast.error(message, 'Falha no cadastro')
    } finally {
      setSubmitting(false)
    }
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
          onChange={(event) => setNome(event.target.value)}
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
          onChange={(event) => setTelefone(event.target.value)}
          required
        />
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
        <Input
          label="Senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          placeholder="Crie uma senha"
          value={senha}
          onChange={(event) => setSenha(event.target.value)}
          required
        />

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Criar conta
        </Button>
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