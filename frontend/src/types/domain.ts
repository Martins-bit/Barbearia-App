/* =============================================================================
   Tipos compartilhados do domínio — espelham os contratos REAIS do backend
   (DTOs em backend/src). Não inventar campos: cada tipo reflete exatamente o
   que a API devolve hoje. Novos tipos devem ser adicionados conforme as
   etapas de integração avançarem.
   ============================================================================= */

export type TipoUsuario = 'CLIENTE' | 'BARBEIRO'

export type StatusAgendamento =
  | 'CONFIRMADO'
  | 'CANCELADO'
  | 'CONCLUIDO'
  | 'NAO_COMPARECEU'

export type StatusListaEspera =
  | 'ATIVA'
  | 'NOTIFICADA'
  | 'ATENDIDA'
  | 'CANCELADA'
  | 'EXPIRADA'

export type StatusWaitlistClaim = 'ATIVO' | 'EXPIRADO' | 'ACEITO' | 'RECUSADO'

export type TipoNotificacao =
  | 'WAITLIST_OPPORTUNITY'
  | 'AGENDAMENTO'
  | 'CANCELAMENTO'
  | 'LEMBRETE'
  | 'LISTA_ESPERA'
  | 'EMERGENCIA'
  | 'AVISO'
  | 'ALTERACAO_HORARIO'

/** Usuário autenticado (POST /auth/login → user, GET /auth/me). */
export interface Usuario {
  id: number
  nome: string
  telefone: string
  email: string | null
  tipoUsuario: TipoUsuario
  ativo: boolean
  dataCriacao: string
  dataAtualizacao: string
}

/** Dados editáveis de perfil (PATCH /users/me — espelha UpdateUserDto do backend). */
export interface UpdateUserInput {
  nome?: string
  telefone?: string
  email?: string | null
}

export interface LoginResponse {
  user: Usuario
  token: string
  expiresIn: string
}

/** GET /barbers — barbeiro elegível para escolha. */
export interface Barbeiro {
  /** Barbeiro.id (usado em agendamentos). */
  id: number
  /** Usuario.id (usado como destinatarioId em mensagens). */
  usuarioId: number
  nome: string
}

/** GET /services?barbeiroId= — serviço ativo de um barbeiro. */
export interface Servico {
  id: number
  nome: string
  descricao: string | null
  duracaoMinutos: number
  preco: string
  ativo: boolean
}

/** Mensagem CLIENTE <-> BARBEIRO (`MessageResponseDto`). */
export interface Mensagem {
  id: number
  /** Usuário que enviou (vindo do JWT no servidor). */
  remetenteUsuarioId: number
  /** Usuário que recebeu. */
  destinatarioUsuarioId: number
  /** Conteúdo (1..500 caracteres no servidor). */
  conteudo: string
  /** `true` quando o destinatário já leu. */
  lida: boolean
  dataCriacao: string
  dataLeitura: string | null
}

/** `GET /messages/conversations` — outro participante de uma conversa. */
export interface Conversa {
  usuarioId: number
  nome: string
  /** `CLIENTE` ou `BARBEIRO`. */
  tipoUsuario: TipoUsuario
  ultimaMensagem: string
  ultimaMensagemDataCriacao: string
  /** Mensagens não lidas pelo usuário autenticado nesta conversa. */
  naoLidas: number
}

/** GET /availability — horários livres de um barbeiro para data + serviço. */
export interface Disponibilidade {
  data: string
  barbeiroId: number
  duracaoMinutos: number
  horariosLivres: string[]
}

/** GET/PUT /business-hours — janela semanal de funcionamento do barbeiro. */
export interface HorarioFuncionamento {
  id: number
  diaSemana: number
  horaInicio: string
  horaFim: string
  ativo: boolean
}

/** GET/POST /schedule-blocks — bloqueio pontual da agenda do barbeiro. */
export interface BloqueioAgenda {
  id: number
  data: string
  horaInicio: string
  horaFim: string
  motivo: string | null
  ativo: boolean
}

/** GET /waitlist — lista de espera do BARBEIRO autenticado (ordem de prioridade). */
export interface EntradaListaEspera {
  id: number
  barbeiroId: number
  servicoId: number
  status: StatusListaEspera
  data: string
  horaInicio: string | null
  horaFim: string | null
  dataEntrada: string
  dataAtualizacao: string
  servico?: { id: number; nome: string }
  cliente?: { id: number; nome: string } | null
}

export interface ServicoInformativo {
  id: number
  nome: string
  precoInformativo: string
}

export interface BarbeiroResumo {
  id: number
  nome: string
}

export interface ClienteResumo {
  id: number
  usuarioId?: number
  nome: string
}

/** GET /appointments/my | /appointments/:id | /appointments */
export interface Agendamento {
  id: number
  data: string
  horaInicio: string
  horaFim: string
  duracaoMinutos: number
  status: StatusAgendamento
  observacoes: string | null
  servico: ServicoInformativo
  barbeiro: BarbeiroResumo
  cliente: ClienteResumo
}

/**
 * Notificação do usuário autenticado — espelha o NotificationResponse real do
 * backend (GET /notifications, PATCH /notifications/:id/read). Datas chegam
 * serializadas como ISO; `claimId`/`agendamentoId` só existem quando não nulos.
 */
export interface Notificacao {
  id: number
  tipo: TipoNotificacao
  titulo: string
  mensagem: string
  lida: boolean
  dataCriacao: string
  dataLeitura: string | null
  claimId?: number
  agendamentoId?: number
}
