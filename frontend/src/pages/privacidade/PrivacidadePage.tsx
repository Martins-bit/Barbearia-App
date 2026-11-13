import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Select } from '../../components/ui/Field'
import { useAuth } from '../../contexts/useAuth'
import { useToast } from '../../contexts/useToast'
import { ApiError } from '../../services/api/ApiError'
import { authService } from '../../services/api/authService'
import { privacyRequestsService } from '../../services/api/privacyRequestsService'
import type {
  CategoriaSolicitacaoTitular,
  SolicitacaoTitular,
} from '../../types/domain'
import { ROUTES } from '../../routes/routes'
import {
  downloadJsonFile,
  personalDataExportFilename,
} from '../../utils/downloadJson'
import {
  getOrCreatePrivacyRequestAttempt,
  privacyRequestCreatedMessage,
  privacyRequestErrorMessage,
  privacyRequestCategories,
  PrivacyRequestSubmissionGuard,
  type PrivacyRequestAttempt,
} from './privacyRequestsUi'
import { PrivacyRequestsHistory } from './PrivacyRequestsHistory'
import styles from './PrivacidadePage.module.css'

const PAGE_SIZE = 20

const etapasFuturas = [
  {
    nome: 'Em análise',
    descricao: 'Etapa futura, ainda não disponível para acompanhamento.',
  },
  {
    nome: 'Aguardando informações',
    descricao: 'Etapa futura, ainda não disponível para acompanhamento.',
  },
  {
    nome: 'Atendida',
    descricao: 'Etapa futura, ainda não disponível para acompanhamento.',
  },
  {
    nome: 'Encerrada',
    descricao: 'Etapa futura, ainda não disponível para acompanhamento.',
  },
]

export function PrivacidadePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const titularId = user?.id ?? null
  const [exportando, setExportando] = useState(false)
  const exportEmAndamento = useRef(false)
  const [categoria, setCategoria] = useState<CategoriaSolicitacaoTitular | ''>(
    '',
  )
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false)
  const envioEmAndamento = useRef(new PrivacyRequestSubmissionGuard())
  const tentativaRef = useRef<PrivacyRequestAttempt | null>(null)
  const [feedbackEnvio, setFeedbackEnvio] = useState<{
    tipo: 'sucesso' | 'erro'
    mensagem: string
  } | null>(null)
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoTitular[]>([])
  const [titularDaLista, setTitularDaLista] = useState<number | null>(null)
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [proximoCursor, setProximoCursor] = useState<number | null>(null)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const carregamentoMaisEmAndamento = useRef(false)
  const carregamentoMaisAbort = useRef<AbortController | null>(null)
  const [erroMais, setErroMais] = useState<string | null>(null)
  const [versaoLista, setVersaoLista] = useState(0)

  useEffect(() => {
    tentativaRef.current = null
    setCategoria('')
    setFeedbackEnvio(null)
    carregamentoMaisAbort.current?.abort()
    carregamentoMaisAbort.current = null
    carregamentoMaisEmAndamento.current = false
    setCarregandoMais(false)

    if (titularId === null) {
      setSolicitacoes([])
      setTitularDaLista(null)
      setProximoCursor(null)
      setErroLista(null)
      setErroMais(null)
      setCarregandoLista(false)
      return
    }

    const controller = new AbortController()
    let active = true
    setTitularDaLista(titularId)
    setSolicitacoes([])
    setProximoCursor(null)
    setErroLista(null)
    setErroMais(null)
    setCarregandoLista(true)

    void privacyRequestsService
      .listMine({ limit: PAGE_SIZE, signal: controller.signal })
      .then((page) => {
        if (!active) return
        setSolicitacoes(page.solicitacoes)
        setProximoCursor(page.proximoCursor)
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        setErroLista(privacyRequestErrorMessage(error))
      })
      .finally(() => {
        if (active) setCarregandoLista(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [titularId, versaoLista])

  async function handleExportarDados() {
    if (exportEmAndamento.current) return
    exportEmAndamento.current = true
    setExportando(true)

    try {
      const dados = await authService.exportPersonalData()
      downloadJsonFile(dados, personalDataExportFilename())
      toast.success('Sua cópia JSON foi baixada.', 'Dados exportados')
    } catch {
      toast.error(
        'Não foi possível exportar seus dados. Tente novamente.',
        'Falha ao exportar',
      )
    } finally {
      exportEmAndamento.current = false
      setExportando(false)
    }
  }

  function handleCategoriaChange(value: string) {
    const selectedCategory = privacyRequestCategories.find(
      (option) => option.value === value,
    )
    const nextCategory = selectedCategory?.value ?? ''
    if (nextCategory !== categoria) tentativaRef.current = null
    setCategoria(nextCategory)
    setFeedbackEnvio(null)
  }

  async function handleRegistrarSolicitacao(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    if (
      titularId === null ||
      categoria === ''
    ) {
      return
    }
    if (!envioEmAndamento.current.acquire()) return

    setEnviandoSolicitacao(true)
    setFeedbackEnvio(null)

    try {
      const attempt = getOrCreatePrivacyRequestAttempt(
        categoria,
        tentativaRef.current,
      )
      tentativaRef.current = attempt
      const created = await privacyRequestsService.create(
        attempt.categoria,
        attempt.idempotencyKey,
      )
      tentativaRef.current = null
      setCategoria('')
      setFeedbackEnvio({
        tipo: 'sucesso',
        mensagem: privacyRequestCreatedMessage(created),
      })
      setVersaoLista((current) => current + 1)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        tentativaRef.current = null
      }
      setFeedbackEnvio({
        tipo: 'erro',
        mensagem: privacyRequestErrorMessage(error),
      })
    } finally {
      envioEmAndamento.current.release()
      setEnviandoSolicitacao(false)
    }
  }

  async function handleCarregarMais() {
    if (
      proximoCursor === null ||
      carregamentoMaisEmAndamento.current ||
      titularId === null
    ) {
      return
    }

    const controller = new AbortController()
    carregamentoMaisAbort.current = controller
    carregamentoMaisEmAndamento.current = true
    setCarregandoMais(true)
    setErroMais(null)

    try {
      const page = await privacyRequestsService.listMine({
        limit: PAGE_SIZE,
        cursor: proximoCursor,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setSolicitacoes((current) => [...current, ...page.solicitacoes])
      setProximoCursor(page.proximoCursor)
    } catch (error) {
      if (!controller.signal.aborted) {
        setErroMais(privacyRequestErrorMessage(error))
      }
    } finally {
      if (carregamentoMaisAbort.current === controller) {
        carregamentoMaisAbort.current = null
        carregamentoMaisEmAndamento.current = false
        setCarregandoMais(false)
      }
    }
  }

  const listaDoTitularAtual =
    titularDaLista === titularId ? solicitacoes : []
  const listaInicialCarregando =
    titularId !== null &&
    (titularDaLista !== titularId || carregandoLista)
  const erroDaLista = titularDaLista === titularId ? erroLista : null
  const cursorAtual =
    titularDaLista === titularId ? proximoCursor : null

  return (
    <div className={styles.page}>
      <PageHeader
        title="Privacidade e seus dados"
        description="Consulte, corrija e registre solicitações sobre seus dados pessoais."
      />

      <Card className={styles.introCard}>
        <Badge tone="info">Registro disponível</Badge>
        <p>
          Você pode registrar uma solicitação e acompanhar o status e a data de
          criação nesta página. O registro não significa que o pedido já foi
          analisado ou concluído.
        </p>
      </Card>

      <section className={styles.section} aria-labelledby="direitos-titulo">
        <div className={styles.sectionHead}>
          <h2 id="direitos-titulo">O que você pode fazer agora</h2>
          <p>As ações abaixo usam recursos já disponíveis na sua conta.</p>
        </div>
        <div className={styles.rightsGrid}>
          <Card className={styles.rightCard}>
            <div className={styles.cardHeading}>
              <h3>Acessar e exportar</h3>
              <Badge tone="success">Disponível</Badge>
            </div>
            <p>
              Baixe um arquivo JSON com os dados da sua conta que estão
              disponíveis para você. A exportação tem limitações: não inclui
              conteúdo de mensagens nem textos livres.
            </p>
            <Button
              onClick={() => void handleExportarDados()}
              loading={exportando}
              disabled={exportando}
            >
              {exportando ? 'Preparando arquivo' : 'Baixar meus dados'}
            </Button>
          </Card>

          <Card className={styles.rightCard}>
            <div className={styles.cardHeading}>
              <h3>Corrigir dados do perfil</h3>
              <Badge tone="success">Disponível</Badge>
            </div>
            <p>
              Nome, telefone e e-mail podem ser atualizados no seu perfil,
              sujeitos às validações da conta e à confirmação do novo e-mail.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                navigate(
                  user?.tipoUsuario === 'BARBEIRO'
                    ? ROUTES.barbeiro.perfil
                    : ROUTES.cliente.perfil,
                )
              }
            >
              Ir para meu perfil
            </Button>
          </Card>

          <Card className={styles.rightCard}>
            <div className={styles.cardHeading}>
              <h3>Exclusão ou anonimização</h3>
              <Badge tone="warning">Requer análise</Badge>
            </div>
            <p>
              Você pode registrar esse tipo de pedido, mas a tela não apaga ou
              anonimiza dados. Qualquer medida depende de análise e procedimento
              específico.
            </p>
          </Card>

          <Card className={styles.rightCard}>
            <div className={styles.cardHeading}>
              <h3>Outras solicitações</h3>
              <Badge tone="info">Registro disponível</Badge>
            </div>
            <p>
              O formulário registra somente a categoria do pedido. O canal
              operacional e os prazos de atendimento ainda estão pendentes de
              definição.
            </p>
          </Card>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="registrar-titulo">
        <div className={styles.sectionHead}>
          <h2 id="registrar-titulo">Registrar uma solicitação</h2>
          <p>
            Escolha uma categoria. Não inclua dados pessoais adicionais: a
            primeira fase não recebe descrição nem anexos.
          </p>
        </div>
        <Card className={styles.requestFormCard}>
          <form onSubmit={(event) => void handleRegistrarSolicitacao(event)}>
            <Select
              label="Categoria da solicitação"
              options={[...privacyRequestCategories]}
              placeholder="Selecione uma categoria"
              value={categoria}
              onChange={(event) =>
                handleCategoriaChange(event.currentTarget.value)
              }
              disabled={enviandoSolicitacao || titularId === null}
              required
            />
            <Button
              type="submit"
              loading={enviandoSolicitacao}
              disabled={enviandoSolicitacao || categoria === '' || titularId === null}
            >
              Registrar solicitação
            </Button>
            {feedbackEnvio && (
              <p
                className={
                  feedbackEnvio.tipo === 'erro'
                    ? styles.requestError
                    : styles.requestSuccess
                }
                role={feedbackEnvio.tipo === 'erro' ? 'alert' : 'status'}
              >
                {feedbackEnvio.mensagem}
              </p>
            )}
          </form>
        </Card>
      </section>

      <section className={styles.section} aria-labelledby="acompanhamento-titulo">
        <div className={styles.sectionHead}>
          <h2 id="acompanhamento-titulo">Minhas solicitações</h2>
          <p>
            Esta lista contém somente solicitações da sessão autenticada. Não é
            possível alterar status ou excluir registros nesta tela.
          </p>
        </div>
        <PrivacyRequestsHistory
          requests={listaDoTitularAtual}
          loading={listaInicialCarregando}
          error={erroDaLista}
          cursor={cursorAtual}
          loadingMore={carregandoMais}
          moreError={erroMais}
          onRetry={() => setVersaoLista((current) => current + 1)}
          onLoadMore={() => void handleCarregarMais()}
        />
      </section>

      <section className={styles.section} aria-labelledby="etapas-futuras-titulo">
        <div className={styles.sectionHead}>
          <h2 id="etapas-futuras-titulo">Etapas futuras do atendimento</h2>
          <p>
            Os status abaixo não são usados para as solicitações registradas
            nesta primeira fase.
          </p>
        </div>
        <Card className={styles.trackingCard}>
          <ol className={styles.stageList}>
            {etapasFuturas.map((etapa) => (
              <li className={styles.stage} key={etapa.nome}>
                <span className={styles.stageName}>{etapa.nome}</span>
                <span className={styles.stageDescription}>
                  {etapa.descricao}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <p className={styles.pendingNote}>
        A identidade do controlador, o canal de contato, os prazos, a verificação
        de identidade e as regras de retenção permanecem pendentes de definição.
      </p>
    </div>
  )
}
