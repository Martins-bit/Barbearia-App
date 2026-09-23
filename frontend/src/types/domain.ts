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

export interface LoginResponse {
  user: Usuario
  token: string
  expiresIn: string
}

/** GET /barbers — barbeiro elegível para escolha. */
export interface Barbeiro {
  id: number
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

/** GET /availability — horários livres de um barbeiro para data + serviço. */
export interface Disponibilidade {
  data: string
  barbeiroId: number
  duracaoMinutos: number
  horariosLivres: string[]
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
