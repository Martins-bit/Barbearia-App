import { PagePlaceholder } from '../../components/layout/PagePlaceholder'

/* Telas do cliente ainda não implementadas (escopo das próximas etapas).
   O fluxo principal — Início, Barbeiros, Agendamento e Meus agendamentos —
   vive em seus próprios arquivos: ClienteHomePage, BarbeirosPage,
   AgendamentoPage e MeusAgendamentosPage. */

export function ClienteNotificacoesPage() {
  return (
    <PagePlaceholder
      title="Notificações"
      description="Avisos de agendamento, cancelamento e lembretes."
      note="Lista de GET /notifications, contador de não lidas e marcação de leitura."
    />
  )
}

export function ClienteMensagensPage() {
  return (
    <PagePlaceholder
      title="Mensagens"
      description="Conversa direta com o barbeiro."
      note="Conversas, histórico e envio (GET /messages/conversations, POST /messages) — e tempo real na etapa de WebSocket."
    />
  )
}

export function ClientePerfilPage() {
  return (
    <PagePlaceholder
      title="Perfil"
      description="Seus dados de contato."
      note="Dados do usuário (GET /auth/me) e ajustes permitidos."
    />
  )
}