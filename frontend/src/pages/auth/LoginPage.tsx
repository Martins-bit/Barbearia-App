import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { useAuth } from '../../contexts/useAuth'
import { useToast } from '../../contexts/useToast'
import { ApiError } from '../../services/api/ApiError'
import { ROUTES } from '../../routes/routes'
import styles from './LoginPage.module.css'

interface LocationState {
  from?: string
}

/**
 * Tela de login — conceito próprio da Barbearia do Bruno. A identidade fica no
 * painel institucional (AuthLayout); aqui reside apenas o formulário. O papel
 * do usuário e o destino pós-login vêm do backend (nunca do cliente).
 */
export function LoginPage() {
  const { login } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [telefone, setTelefone] = useState('')
  const [senha, setSenha] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const user = await login({ telefone: telefone.trim(), senha })
      const from = (location.state as LocationState | null)?.from
      const fallback =
        user.tipoUsuario === 'BARBEIRO' ? ROUTES.barbeiro.home : ROUTES.cliente.home
      navigate(from ?? fallback, { replace: true })
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível entrar. Tente novamente.'
      setError(message)
      toast.error(message, 'Falha ao entrar')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      heading="Seu horário, no seu tempo."
      subheading="Entre para acompanhar seus agendamentos, falar com o barbeiro e reservar o próximo corte."
    >
      <div className={styles.header}>
        <span className={`eyebrow ${styles.eyebrow}`}>Acesso</span>
        <h2 className={styles.title}>Entrar</h2>
        <p className={styles.subtitle}>Informe seus dados de acesso.</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
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
          autoComplete="current-password"
          placeholder="Sua senha"
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
          Entrar
        </Button>
      </form>

      <p className={styles.footerText}>
        Ainda não tem conta?{' '}
        <Link className={styles.link} to={ROUTES.register}>
          Criar cadastro
        </Link>
      </p>
    </AuthLayout>
  )
}