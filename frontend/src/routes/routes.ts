/**
 * Mapa central de rotas — evita strings soltas pelo código e documenta a
 * estrutura da navegação. Os caminhos respeitam a futura integração com o
 * backend; nenhuma regra de negócio é definida aqui.
 */
export const ROUTES = {
  // Público
  login: '/login',
  register: '/cadastro',

  // Área do cliente (protegida)
  cliente: {
    home: '/cliente',
    barbeiros: '/cliente/barbeiros',
    agendamento: '/cliente/agendamento',
    agendamentos: '/cliente/agendamentos',
    notificacoes: '/cliente/notificacoes',
    mensagens: '/cliente/mensagens',
    perfil: '/cliente/perfil',
  },

  // Área do barbeiro (protegida)
  barbeiro: {
    home: '/barbeiro',
    agenda: '/barbeiro/agenda',
    servicos: '/barbeiro/servicos',
    horarios: '/barbeiro/horarios',
    bloqueios: '/barbeiro/bloqueios',
    listaEspera: '/barbeiro/lista-espera',
    notificacoes: '/barbeiro/notificacoes',
    mensagens: '/barbeiro/mensagens',
    perfil: '/barbeiro/perfil',
  },
} as const
