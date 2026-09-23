import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/brand/BrandLogo'
import { Avatar } from '../components/ui/Avatar'
import { IconButton } from '../components/ui/IconButton'
import { LogoutIcon, MenuIcon, XIcon } from '../components/ui/icons/Icon'
import { useAuth } from '../contexts/useAuth'
import styles from './AppLayout.module.css'

export interface NavItem {
  label: string
  to: string
  icon: ReactNode
  end?: boolean
}

interface AppLayoutProps {
  /** Título curto da área (ex.: "Área do cliente"). */
  areaLabel: string
  navItems: NavItem[]
  /** Estado do menu lateral no mobile é controlado pelo próprio layout. */
  mobileOpen: boolean
  onToggleMobile: () => void
  children: ReactNode
}

/**
 * Casca de aplicação das áreas autenticadas (cliente e barbeiro): barra
 * lateral com navegação, cabeçalho e área de conteúdo. No mobile a barra
 * lateral abre como gaveta. A mesma casca serve às duas áreas — muda apenas
 * a lista de navegação, mantendo a experiência consistente.
 */
export function AppLayout({
  areaLabel,
  navItems,
  mobileOpen,
  onToggleMobile,
  children,
}: AppLayoutProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className={styles.shell}>
      {mobileOpen && (
        <div className={styles.scrim} onClick={onToggleMobile} aria-hidden="true" />
      )}

      <aside
        className={[styles.sidebar, mobileOpen ? styles.sidebarOpen : '']
          .filter(Boolean)
          .join(' ')}
        aria-label={`Navegação — ${areaLabel}`}
      >
        <div className={styles.sidebarTop}>
          <BrandLogo size={34} withWordmark />
          <IconButton
            label="Fechar menu"
            size="sm"
            className={styles.closeButton}
            onClick={onToggleMobile}
          >
            <XIcon size={18} />
          </IconButton>
        </div>

        <nav className={styles.nav}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [styles.navItem, isActive ? styles.navItemActive : '']
                  .filter(Boolean)
                  .join(' ')
              }
              onClick={() => mobileOpen && onToggleMobile()}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          {user && (
            <div className={styles.userBox}>
              <Avatar name={user.nome} size={36} />
              <div className={styles.userInfo}>
                <span className={styles.userName}>{user.nome}</span>
                <span className={styles.userRole}>
                  {user.tipoUsuario === 'BARBEIRO' ? 'Barbeiro' : 'Cliente'}
                </span>
              </div>
              <IconButton label="Sair" size="sm" onClick={handleLogout}>
                <LogoutIcon size={18} />
              </IconButton>
            </div>
          )}
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <IconButton
            label="Abrir menu"
            className={styles.menuButton}
            onClick={onToggleMobile}
          >
            <MenuIcon size={20} />
          </IconButton>
          <span className={styles.areaLabel}>{areaLabel}</span>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  )
}