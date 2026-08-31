import { StatusAgendamento } from '../../generated/prisma/enums';

export interface ServicoInformativoDto {
  id: number;
  nome: string;
  /** Preço EXCLUSIVAMENTE informativo ("xx.xx"). Nenhuma cobrança existe. */
  precoInformativo: string;
}

export interface BarbeiroResumoDto {
  id: number;
  nome: string;
}

export interface ClienteResumoDto {
  id: number;
  nome: string;
}

export class AppointmentResponseDto {
  id!: number;
  /** Data civil do agendamento ("YYYY-MM-DD", America/Sao_Paulo). */
  data!: string;
  /** Horário local da barbearia ("HH:mm"). */
  horaInicio!: string;
  horaFim!: string;
  duracaoMinutos!: number;
  status!: StatusAgendamento;
  observacoes!: string | null;
  servico!: ServicoInformativoDto;
  barbeiro!: BarbeiroResumoDto;
  cliente!: ClienteResumoDto;
}
