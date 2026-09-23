import { PagePlaceholder } from '../../components/layout/PagePlaceholder'

/** Início do cliente — receberá resumo de próximos agendamentos na 8.2. */
export function ClienteHomePage() {
  return (
    <PagePlaceholder
      title="Início"
      description="Visão geral dos seus próximos horários e atalhos."
      note="Aqui entrarão o próximo agendamento, atalhos para agendar e o resumo da sua atividade."
    />
  )
}

export function BarbeirosPage() {
  return (
    <PagePlaceholder
      title="Barbeiros"
      description="Escolha com quem você quer cortar."
      note="Lista dos barbeiros ativos (GET /barbers) com seleção para seguir ao agendamento."
    />
  )
}

export function AgendamentoPage() {
  return (
    <PagePlaceholder
      title="Agendar horário"
      description="Barbeiro, serviço e horário — em sequência."
      note="Fluxo: escolher barbeiro, carregar serviços (GET /services), consultar disponibilidade (GET /availability) e criar o agendamento (POST /appointments)."
    />
  )
}

export function MeusAgendamentosPage() {
  return (
    <PagePlaceholder
      title="Meus agendamentos"
      description="Seus horários agendados e o histórico."
      note="Listagem de GET /appointments/my, com destaque para o próximo e ação de cancelamento."
    />
  )
}

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