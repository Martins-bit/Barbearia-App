import { PagePlaceholder } from '../../components/layout/PagePlaceholder'

/** Início do barbeiro — painel resumido da operação. */
export function BarbeiroHomePage() {
  return (
    <PagePlaceholder
      title="Início"
      description="Resumo do dia e do movimento."
      note="Próximos atendimentos, contagem do dia e pendências (lista de espera, oportunidades)."
    />
  )
}

export function AgendaPage() {
  return (
    <PagePlaceholder
      title="Agenda"
      description="Seus atendimentos por dia."
      note="Agenda (GET /appointments) com ações de concluir e marcar falta."
    />
  )
}

export function ServicosPage() {
  return (
    <PagePlaceholder
      title="Serviços"
      description="Gerencie os serviços que você oferece."
      note="Criar, editar e ativar/desativar serviços (POST/PATCH /services)."
    />
  )
}

export function HorariosPage() {
  return (
    <PagePlaceholder
      title="Horários"
      description="Defina seus horários de funcionamento."
      note="Semana de atendimento (GET/PUT /business-hours)."
    />
  )
}

export function BloqueiosPage() {
  return (
    <PagePlaceholder
      title="Bloqueios"
      description="Indisponibilidades pontuais na agenda."
      note="Bloqueios por período (GET/POST/DELETE /schedule-blocks)."
    />
  )
}

export function ListaEsperaPage() {
  return (
    <PagePlaceholder
      title="Lista de espera"
      description="Clientes aguardando um horário."
      note="Entradas e oportunidades de encaixe por ordem de chegada."
    />
  )
}

export function BarbeiroNotificacoesPage() {
  return (
    <PagePlaceholder
      title="Notificações"
      description="Avisos da sua operação."
      note="Lista de GET /notifications e marcação de leitura."
    />
  )
}

export function BarbeiroMensagensPage() {
  return (
    <PagePlaceholder
      title="Mensagens"
      description="Conversas com os clientes."
      note="Conversas e envio (GET /messages/conversations, POST /messages)."
    />
  )
}

export function BarbeiroPerfilPage() {
  return (
    <PagePlaceholder
      title="Perfil"
      description="Seus dados."
      note="Dados do usuário (GET /auth/me) e ajustes permitidos."
    />
  )
}