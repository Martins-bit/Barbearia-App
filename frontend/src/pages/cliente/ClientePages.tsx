import { PagePlaceholder } from '../../components/layout/PagePlaceholder'

/* Telas do cliente ainda não implementadas (escopo das próximas etapas).
   O Perfil vive em ClientePerfilPage.tsx e as Notificações em
   ClienteNotificacoesPage.tsx. O fluxo principal — Início, Barbeiros,
   Agendamento e Meus agendamentos — também tem arquivos próprios:
   ClienteHomePage, BarbeirosPage, AgendamentoPage e MeusAgendamentosPage. */

export function ClienteMensagensPage() {
  return (
    <PagePlaceholder
      title="Mensagens"
      description="Conversa direta com o barbeiro."
      note="Conversas, histórico e envio (GET /messages/conversations, POST /messages) — e tempo real na etapa de WebSocket."
    />
  )
}
