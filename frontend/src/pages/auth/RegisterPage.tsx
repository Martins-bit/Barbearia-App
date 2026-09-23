import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { useToast } from '../../contexts/useToast'
import { authService } from '../../services/api/authService'
import { ApiError } from '../../services/api/ApiError'
import { ROUTES } from '../../routes/routes'
import styles from './LoginPage.module.css'

/**
 * Cadastro de cliente — usa o endpoint real POST /auth/register. Mantido
 * simples nesta etapa; o fluxo completo (verificação, onboarding) virá depois.
 */
export function RegisterPage() {
  const toast = useToast()
  const navigate = useNavigate()

  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [senha, setSenha] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await authService.register({
        nome: nome.trim(),
        telefone: telefone.trim(),
        senha,
      })
      toast.success('Cadastro criado. Faça login para continuar.')
      navigate(ROUTES.login, { replace: true })
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível concluir o cadastro.'
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