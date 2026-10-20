/**
 * Dados públicos de um barbeiro elegível para escolha pelo cliente
 * (GET /barbers). Expõe apenas o mínimo necessário para o frontend
 * identificar o barbeiro e usar o seu `barbeiroId` na consulta de
 * disponibilidade e na criação do agendamento.
 *
 * `usuarioId` expõe o Usuario.id do barbeiro — necessário para o fluxo de
 * MENSAGENS (o domínio de mensagens opera com Usuario.id, não com Barbeiro.id).
 * NÃO é dado sensível: é o mesmo identificador público usado em conversas.
 *
 * NUNCA expor: senhaHash, telefone, e-mail, tipoUsuario, ativo,
 * dataCriacao/dataAtualizacao, tokens ou qualquer dado administrativo.
 */
export interface BarberResponseDto {
  /** Barbeiro.id (usado em /availability?barbeiroId= e POST /appointments). */
  id: number;
  /** Usuario.id do barbeiro (usado em /messages como destinatarioId). */
  usuarioId: number;
  /** Nome público do barbeiro (Usuario.nome). */
  nome: string;
}
