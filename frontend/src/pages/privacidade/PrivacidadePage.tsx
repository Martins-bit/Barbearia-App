import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PagePlaceholder'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../contexts/useAuth'
import { useToast } from '../../contexts/useToast'
import { authService } from '../../services/api/authService'
import { ROUTES } from '../../routes/routes'
import {
  downloadJsonFile,
  personalDataExportFilename,
} from '../../utils/downloadJson'
import styles from './PrivacidadePage.module.css'

const etapasPrevistas = [
  {
    nome: 'Recebida',
    descricao: 'O pedido foi registrado para atendimento.',
  },
  {
    nome: 'Em análise',
    descricao: 'O pedido está sendo avaliado pela equipe responsável.',
  },
  {
    nome: 'Aguardando informações',
    descricao: 'São necessárias informações adicionais para continuar.',
  },
  {
    nome: 'Atendida',
    descricao: 'A solicitação teve uma resposta ou providência.',
  },
  {
    nome: 'Encerrada',
    descricao: 'O atendimento foi concluído.',
  },
]

export function PrivacidadePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const [exportando, setExportando] = useState(false)
  const exportEmAndamento = useRef(false)

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

  return (
    <div className={styles.page}>
      <PageHeader
        title="Privacidade e seus dados"
        description="Veja como consultar, corrigir e solicitar atendimento sobre seus dados pessoais."
      />

      <Card className={styles.introCard}>
        <Badge tone="info">Área informativa</Badge>
        <p>
          Você pode consultar e corrigir alguns dados diretamente no aplicativo.
          Outros pedidos precisam ser avaliados. Esta tela não envia nem registra
          solicitações de atendimento.
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
              O aplicativo não executa esses pedidos. Eles podem afetar
              agendamentos, históricos e dados compartilhados, e precisam de
              análise antes de qualquer medida.
            </p>
          </Card>

          <Card className={styles.rightCard}>
            <div className={styles.cardHeading}>
              <h3>Outras solicitações</h3>
              <Badge tone="neutral">Canal pendente</Badge>
            </div>
            <p>
              O canal oficial e o procedimento de atendimento ainda não foram
              definidos. Não há formulário nesta página e nenhuma solicitação
              será encaminhada por ela.
            </p>
          </Card>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="acompanhamento-titulo">
        <div className={styles.sectionHead}>
          <h2 id="acompanhamento-titulo">Acompanhamento de solicitações</h2>
          <p>
            O registro e a consulta de pedidos ainda não estão implementados.
          </p>
        </div>
        <Card className={styles.trackingCard}>
          <div className={styles.trackingNotice}>
            <Badge tone="warning">Indisponível</Badge>
            <p>
              O sistema ainda não registra nem consulta solicitações. Por isso,
              esta tela não informa se existe algum pedido em andamento. Nenhum
              status abaixo representa um pedido real.
            </p>
          </div>
          <div className={styles.stageHeading}>
            <h3>Etapas previstas para um fluxo futuro</h3>
            <span>São apenas definições de status, não protocolos ativos.</span>
          </div>
          <ol className={styles.stageList}>
            {etapasPrevistas.map((etapa) => (
              <li className={styles.stage} key={etapa.nome}>
                <span className={styles.stageName}>{etapa.nome}</span>
                <span className={styles.stageDescription}>{etapa.descricao}</span>
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
