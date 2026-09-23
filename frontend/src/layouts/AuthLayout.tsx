import type { ReactNode } from 'react'
import { BrandLogo } from '../components/brand/BrandLogo'
import styles from './AuthLayout.module.css'

interface AuthLayoutProps {
  /** Título editorial da área institucional (lado esquerdo). */
  heading: string
  /** Frase de apoio curta e humana. */
  subheading: string
  /** Formulário (lado direito). */
  children: ReactNode
}

/**
 * Layout de autenticação — composição assimétrica: um painel institucional
 * da marca (textura de barbearia, emblema, tipografia editorial) à esquerda e
 * um painel de autenticação moderno à direita. Em telas pequenas, o painel
 * institucional vira um cabeçalho compacto e o formulário ocupa a tela.
 */
export function AuthLayout({ heading, subheading, children }: AuthLayoutProps) {
  return (
    <div className={styles.layout}>
      <aside className={styles.institutional}>
        <div className={styles.grain} aria-hidden="true" />

        <header className={styles.brandHeader}>
          <BrandLogo size={52} withWordmark />
        </header>

        <div className={styles.statementBlock}>
          <span className={styles.eyebrow}>Barbearia do Bruno</span>
          <h1 className={styles.heading}>{heading}</h1>
          <p className={styles.subheading}>{subheading}</p>
        </div>

        <footer className={styles.institutionalFooter}>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.estd}>Tradição e cuidado desde sempre</p>
        </footer>
      </aside>

      <main className={styles.formSide}>
        <div className={styles.formCard}>{children}</div>
      </main>
    </div>
  )
}