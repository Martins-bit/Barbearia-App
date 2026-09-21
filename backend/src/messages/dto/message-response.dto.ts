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

/**
 * Item da lista de conversas (ETAPA 7B): identifica o outro participante, a
 * última mensagem da conversa (conteúdo + data/hora) e a quantidade de
 * mensagens não lidas pelo usuário autenticado. Sem dados sensíveis
 * (telefone, e-mail, senha/hash).
 */
export interface ConversationPartnerDto {
  usuarioId: number;
  nome: string;
  tipoUsuario: TipoUsuario;
  ultimaMensagem: string;
  ultimaMensagemDataCriacao: Date;
  naoLidas: number;
}

/** Resposta de GET /messages/unread-count (ETAPA 7B). */
export interface UnreadCountDto {
  count: number;
}