import { TipoUsuario } from '../../generated/prisma/enums';

export interface MessageResponseDto {
  id: number;
  remetenteUsuarioId: number;
  destinatarioUsuarioId: number;
  conteudo: string;
  lida: boolean;
  dataCriacao: Date;
  dataLeitura: Date | null;
}

export interface ConversationPartnerDto {
  usuarioId: number;
  nome: string;
  tipoUsuario: TipoUsuario;
}