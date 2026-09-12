import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConversationPartnerDto,
  MessageResponseDto,
} from './dto/message-response.dto';
import { SendMessageDto, MAX_MESSAGE_LENGTH } from './dto/send-message.dto';

/**
 * Fundação de mensagens CLIENTE <-> BARBEIRO (ETAPA 7A). Sem tempo real.
 *
 * - Identidade do remetente SEMPRE vem do JWT (usuarioId do token).
 * - Permitido somente CLIENTE <-> BARBEIRO, usuários ativos e destinatário
 *   existente. Cliente↔Cliente, Barbeiro↔Barbeiro, auto-mensagem, usuário
 *   inexistente/inativo e barbeiro sem perfil ativo são rejeitados.
 * - Recurso inexistente/não autorizado retorna 404 genérico (padrão do
 *   projeto); regras violadas retornam erro 400/403 específico.
 */
@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(message: any): MessageResponseDto {
    return {
      id: message.id,
      remetenteUsuarioId: message.remetenteId,
      destinatarioUsuarioId: message.destinatarioId,
      conteudo: message.conteudo,
      lida: message.lida,
      dataCriacao: message.dataCriacao,
      dataLeitura: message.dataLeitura ?? null,
    };
  }

  /**
   * Valida destinatário: existe, ativo, perfil oposto ao remetente e (para
   * BARBEIRO) perfil de barbeiro ativo. Sem advisory lock: envio é append-only.
   */
  private async resolveValidDestination(
    remetenteTipoUsuario: TipoUsuario,
    destinatarioId: number,
  ) {
    const destinatario = await this.prisma.usuario.findUnique({
      where: { id: destinatarioId },
    });

    if (!destinatario || !destinatario.ativo) {
      throw new NotFoundException('Destinatário não encontrado.');
    }

    if (destinatario.tipoUsuario === remetenteTipoUsuario) {
      throw new BadRequestException(
        'Mensagens são permitidas somente entre cliente e barbeiro.',
      );
    }

    if (destinatario.tipoUsuario === TipoUsuario.BARBEIRO) {
      const barbeiro = await this.prisma.barbeiro.findUnique({
        where: { usuarioId: destinatario.id },
        select: { ativo: true },
      });
      if (!barbeiro || !barbeiro.ativo) {
        throw new NotFoundException('Destinatário não encontrado.');
      }
    }

    return destinatario;
  }

  async sendMessage(
    remetenteUsuarioId: number,
    dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    const conteudo = dto.conteudo?.trim();
    if (!conteudo || conteudo.length === 0) {
      throw new BadRequestException('Conteúdo da mensagem é obrigatório.');
    }
    if (conteudo.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException('Conteúdo excede 500 caracteres.');
    }

    const remetente = await this.prisma.usuario.findUnique({
      where: { id: remetenteUsuarioId },
    });
    if (!remetente || !remetente.ativo) {
      throw new ForbiddenException('Remetente não autorizado.');
    }

    if (remetente.id === dto.destinatarioId) {
      throw new BadRequestException(
        'Não é possível enviar mensagem para si mesmo.',
      );
    }

    if (remetente.tipoUsuario === TipoUsuario.BARBEIRO) {
      const barbeiro = await this.prisma.barbeiro.findUnique({
        where: { usuarioId: remetente.id },
        select: { ativo: true },
      });
      if (!barbeiro || !barbeiro.ativo) {
        throw new ForbiddenException('Remetente não autorizado.');
      }
    }

    const destinatario = await this.resolveValidDestination(
      remetente.tipoUsuario,
      dto.destinatarioId,
    );

    const created = await this.prisma.mensagem.create({
      data: {
        remetenteId: remetente.id,
        destinatarioId: destinatario.id,
        conteudo,
        lida: false,
      },
    });

    return this.toResponse(created);
  }

  async findConversation(
    usuarioId: number,
    outroUsuarioId: number,
  ): Promise<MessageResponseDto[]> {
    if (usuarioId === outroUsuarioId) {
      throw new BadRequestException('Conversa inválida.');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
    });
    if (!usuario || !usuario.ativo) {
      throw new ForbiddenException('Usuário não autorizado.');
    }

    // Participantes precisam ser do perfil oposto (CLIENTE <-> BARBEIRO).
    const outro = await this.prisma.usuario.findUnique({
      where: { id: outroUsuarioId },
    });
    if (!outro || !outro.ativo || outro.tipoUsuario === usuario.tipoUsuario) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    const messages = await this.prisma.mensagem.findMany({
      where: {
        OR: [
          { remetenteId: usuarioId, destinatarioId: outroUsuarioId },
          { remetenteId: outroUsuarioId, destinatarioId: usuarioId },
        ],
      },
      orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
    });

    return messages.map((message) => this.toResponse(message));
  }

  /**
   * Marcação idempotente como lida. Somente o DESTINATÁRIO pode marcar;
   * repetir a operação é sucesso sem alterar o primeiro dataLeitura
   * (update condicional por `lida: false` — sem advisory lock).
   */
  async markAsRead(
    usuarioId: number,
    messageId: number,
  ): Promise<MessageResponseDto> {
    const message = await this.prisma.mensagem.findUnique({
      where: { id: messageId },
    });
    // 404 genérico para inexistente, de outro usuário ou enviada pelo próprio
    // remetente (remetente não pode marcar a própria mensagem como lida).
    if (!message || message.destinatarioId !== usuarioId) {
      throw new NotFoundException('Mensagem não encontrada.');
    }

    await this.prisma.mensagem.updateMany({
      where: { id: messageId, destinatarioId: usuarioId, lida: false },
      data: { lida: true, dataLeitura: new Date() },
    });

    const updated = await this.prisma.mensagem.findUnique({
      where: { id: messageId },
    });

    return this.toResponse(updated!);
  }

  async findConversations(
    usuarioId: number,
  ): Promise<ConversationPartnerDto[]> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
    });
    if (!usuario || !usuario.ativo) {
      throw new ForbiddenException('Usuário não autorizado.');
    }

    const oppositeTipoUsuario =
      usuario.tipoUsuario === TipoUsuario.CLIENTE
        ? TipoUsuario.BARBEIRO
        : TipoUsuario.CLIENTE;

    const partners = await this.prisma.usuario.findMany({
      where: {
        tipoUsuario: oppositeTipoUsuario,
        ativo: true,
        OR: [
          { mensagensEnviadas: { some: { destinatarioId: usuarioId } } },
          { mensagensRecebidas: { some: { remetenteId: usuarioId } } },
        ],
      },
      select: { id: true, nome: true, tipoUsuario: true },
      orderBy: { nome: 'asc' },
    });

    return partners.map((partner) => ({
      usuarioId: partner.id,
      nome: partner.nome,
      tipoUsuario: partner.tipoUsuario,
    }));
  }
}