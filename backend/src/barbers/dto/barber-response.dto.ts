/**
 * Dados públicos de um barbeiro elegível para escolha pelo cliente
 * (GET /barbers). Expõe apenas o mínimo necessário para o frontend
 * identificar o barbeiro e usar o seu `barbeiroId` na consulta de
 * disponibilidade e na criação do agendamento.
 *
 * NUNCA expor: senhaHash, telefone, e-mail, tipoUsuario, ativo,
 * dataCriacao/dataAtualizacao, tokens ou qualquer dado administrativo.
 */
export interface BarberResponseDto {
  /** Barbeiro.id (usado em /availability?barbeiroId= e POST /appointments). */
  id: number;
  /** Nome público do barbeiro (Usuario.nome). */
  nome: string;
}
