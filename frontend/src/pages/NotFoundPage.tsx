import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { ROUTES } from '../routes/routes'
import styles from './NotFoundPage.module.css'

/** Página 404. */
export function NotFoundPage() {
  return (
    <div className={styles.wrapper}>
      <span className={`eyebrow ${styles.eyebrow}`}>Erro 404</span>
      <h1 className={styles.title}>Página não encontrada</h1>
      <p className={styles.text}>
        O endereço acessado não existe ou foi movido.
      </p>
      <div className={styles.action}>
        <Link to={ROUTES.login}>
          <Button variant="secondary">Voltar ao início</Button>
        </Link>
      </div>
    </div>
  )
}