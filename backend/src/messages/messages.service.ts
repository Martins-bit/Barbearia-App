import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TipoUsuario } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConversationPartnerDto,
  MessageResponseDto,
  UnreadCountDto,
} from './dto/message-response.dto';
import { SendMessageDto, MAX_MESSAGE_LENGTH } from './dto/send-message.dto';
import {
  DeleteMessageDto,
  ModoExclusaoMensagem,
} from './dto/delete-message.dto';
import { MessageDeletedEventPayload } from './dto/message-deleted-event.dto';

export const MESSAGE_DELETION_WINDOW_MS = 60 * 60 * 1000;
export const DELETED_MESSAGE_TEXT = 'Esta mensagem foi apagada';

/**
 * Mensagens CLIENTE <-> BARBEIRO (ETAPAS 7A/7B). Sem tempo real.
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private toResponse(message: any): MessageResponseDto {
    const apagadaParaTodos = Boolean(message.apagadaParaTodos);
    return {
      id: message.id,
      remetenteUsuarioId: message.remetenteId,
      destinatarioUsuarioId: message.destinatarioId,
      conteudo: apagadaParaTodos ? DELETED_MESSAGE_TEXT : message.conteudo,
      lida: message.lida,
      dataCriacao: message.dataCriacao,
      dataLeitura: message.dataLeitura ?? null,
      ...(apagadaParaTodos ? { apagadaParaTodos: true } : {}),
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

  private async hasActiveBarberProfile(usuarioId: number): Promise<boolean> {
    const barbeiro = await this.prisma.barbeiro.findUnique({
      where: { usuarioId },
      select: { ativo: true },
    });
    return Boolean(barbeiro?.ativo);
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

    if (
      remetente.tipoUsuario === TipoUsuario.BARBEIRO &&
      !(await this.hasActiveBarberProfile(remetente.id))
    ) {
      throw new ForbiddenException('Remetente não autorizado.');
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
    if (
      usuario.tipoUsuario === TipoUsuario.BARBEIRO &&
      !(await this.hasActiveBarberProfile(usuario.id))
    ) {
      throw new ForbiddenException('Usuário não autorizado.');
    }

    // Participantes precisam ser do perfil oposto (CLIENTE <-> BARBEIRO).
    const outro = await this.prisma.usuario.findUnique({
      where: { id: outroUsuarioId },
    });
    if (!outro || !outro.ativo || outro.tipoUsuario === usuario.tipoUsuario) {
      throw new NotFoundException('Conversa não encontrada.');
    }
    if (
      outro.tipoUsuario === TipoUsuario.BARBEIRO &&
      !(await this.hasActiveBarberProfile(outro.id))
    ) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    const messages = await this.prisma.mensagem.findMany({
      where: {
        OR: [
          {
            remetenteId: usuarioId,
            destinatarioId: outroUsuarioId,
            excluidaPeloRemetente: false,
          },
          {
            remetenteId: outroUsuarioId,
            destinatarioId: usuarioId,
            excluidaPeloDestinatario: false,
          },
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

  /**
   * Lista de conversas (ETAPA 7B): somente conversas em que o usuário
   * autenticado participa, sempre CLIENTE <-> BARBEIRO, com conta ativa e,
   * para barbeiros, perfil ativo nos dois lados da conversa. Retorna a última
   * mensagem (conteúdo + data/hora) e a quantidade de não lidas da conversa,
   * ordenada pela mensagem mais recente primeiro. Nenhuma conversa artificial
   * é criada: sem mensagens, lista vazia. Nenhum dado sensível é exposto.
   */
  async findConversations(
    usuarioId: number,
  ): Promise<ConversationPartnerDto[]> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
    });
    if (!usuario || !usuario.ativo) {
      throw new ForbiddenException('Usuário não autorizado.');
    }
    if (
      usuario.tipoUsuario === TipoUsuario.BARBEIRO &&
      !(await this.hasActiveBarberProfile(usuario.id))
    ) {
      throw new ForbiddenException('Usuário não autorizado.');
    }

    // Leitura única das mensagens visíveis do usuário (sem paginação nesta etapa). A
    // agregação (última mensagem e não lidas por parceiro) é feita em
    // aplicação sobre as linhas já cobertas pelos índices de remetente e
    // destinatário.
    const messages = await this.prisma.mensagem.findMany({
      where: {
        OR: [
          { remetenteId: usuarioId, excluidaPeloRemetente: false },
          { destinatarioId: usuarioId, excluidaPeloDestinatario: false },
        ],
      },
      select: {
        id: true,
        remetenteId: true,
        destinatarioId: true,
        conteudo: true,
        lida: true,
        dataCriacao: true,
        apagadaParaTodos: true,
        excluidaPeloRemetente: true,
        excluidaPeloDestinatario: true,
      },
    });

    if (messages.length === 0) {
      return [];
    }

    const ultimaMensagemPorParceiro = new Map<
      number,
      { id: number; conteudo: string; dataCriacao: Date }
    >();
    const naoLidasPorParceiro = new Map<number, number>();

    for (const message of messages) {
      const parceiroId =
        message.remetenteId === usuarioId
          ? message.destinatarioId
          : message.remetenteId;
      if (parceiroId === usuarioId) {
        continue; // auto-mensagem não deve existir; ignorada por segurança
      }

      const conteudoFinal = message.apagadaParaTodos
        ? DELETED_MESSAGE_TEXT
        : message.conteudo;

      const atual = ultimaMensagemPorParceiro.get(parceiroId);
      const maisRecente =
        !atual ||
        message.dataCriacao > atual.dataCriacao ||
        (message.dataCriacao.getTime() === atual.dataCriacao.getTime() &&
          message.id > atual.id);
      if (maisRecente) {
        ultimaMensagemPorParceiro.set(parceiroId, {
          id: message.id,
          conteudo: conteudoFinal,
          dataCriacao: message.dataCriacao,
        });
      }

      // Não lidas: somente mensagens recebidas pelo usuário autenticado,
      // não lidas e não excluídas pelo destinatário.
      if (
        message.destinatarioId === usuarioId &&
        !message.lida &&
        !message.excluidaPeloDestinatario
      ) {
        naoLidasPorParceiro.set(
          parceiroId,
          (naoLidasPorParceiro.get(parceiroId) ?? 0) + 1,
        );
      }
    }

    const oppositeTipoUsuario =
      usuario.tipoUsuario === TipoUsuario.CLIENTE
        ? TipoUsuario.BARBEIRO
        : TipoUsuario.CLIENTE;

    const partners = await this.prisma.usuario.findMany({
      where: {
        id: { in: [...ultimaMensagemPorParceiro.keys()] },
        tipoUsuario: oppositeTipoUsuario,
        ativo: true,
      },
      select: {
        id: true,
        nome: true,
        tipoUsuario: true,
        barbeiro: { select: { ativo: true } },
      },
    });

    const activePartners = partners.filter(
      (partner) =>
        partner.tipoUsuario !== TipoUsuario.BARBEIRO ||
        partner.barbeiro?.ativo,
    );
    const conversations = activePartners.map((partner) => {
      const ultima = ultimaMensagemPorParceiro.get(partner.id)!;
      return {
        partner,
        ultima,
        naoLidas: naoLidasPorParceiro.get(partner.id) ?? 0,
      };
    });

    // Mensagem mais recente primeiro; empate resolvido pelo id da mensagem.
    conversations.sort((a, b) => {
      const tempo =
        b.ultima.dataCriacao.getTime() - a.ultima.dataCriacao.getTime();
      return tempo !== 0 ? tempo : b.ultima.id - a.ultima.id;
    });

    return conversations.map(({ partner, ultima, naoLidas }) => ({
      usuarioId: partner.id,
      nome: partner.nome,
      tipoUsuario: partner.tipoUsuario,
      ultimaMensagem: ultima.conteudo,
      ultimaMensagemDataCriacao: ultima.dataCriacao,
      naoLidas,
    }));
  }

  /**
   * Contador global de não lidas (ETAPA 7B): considera somente mensagens com
   * destinatarioId = usuário autenticado (identidade SEMPRE do JWT, nunca do
   * frontend), lida = false e não excluída pelo destinatário.
   */
  async unreadCount(usuarioId: number): Promise<UnreadCountDto> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { ativo: true },
    });
    if (!usuario || !usuario.ativo) {
      throw new ForbiddenException('Usuário não autorizado.');
    }

    const count = await this.prisma.mensagem.count({
      where: {
        destinatarioId: usuarioId,
        lida: false,
        excluidaPeloDestinatario: false,
      },
    });
    return { count };
  }

  /**
   * Exclusão de mensagem (Apagar para mim / Apagar para todos).
   *
   * Ordem estrita de validação e idempotência:
   * 1. Buscar a mensagem.
   * 2. Validar se o usuário participa da conversa (remetente ou destinatário).
   * 3. Validar autoria quando o modo for PARA_TODOS (apenas remetente pode).
   * 4. Verificar se a operação solicitada já foi concluída:
   *    - Se PARA_MIM pelo remetente e já está excluidaPeloRemetente -> retorno imediato (idempotente).
   *    - Se PARA_MIM pelo destinatário e já está excluidaPeloDestinatario -> retorno imediato (idempotente).
   *    - Se PARA_TODOS pelo remetente e já está apagadaParaTodos -> retorno imediato (idempotente).
   * 5. Se ainda não estiver concluída, validar o prazo de 60 minutos (inclusivo).
   * 6. Executar a operação de forma segura em transação atômica ($transaction)
   *    com updateMany condicional para evitar race conditions e não sobrescrever estados consolidados.
   *    - PARA_MIM nunca preenche dataExclusao (reservada exclusivamente para PARA_TODOS).
   *    - PARA_TODOS preenche apagadaParaTodos = true e dataExclusao (se ainda nulo).
   */
  async deleteMessage(
    usuarioId: number,
    messageId: number,
    dto: DeleteMessageDto,
  ): Promise<MessageResponseDto> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, ativo: true },
    });
    if (!usuario || !usuario.ativo) {
      throw new ForbiddenException('Usuário não autorizado.');
    }

    // 1. Buscar a mensagem
    const message = await this.prisma.mensagem.findUnique({
      where: { id: messageId },
    });
    if (!message) {
      throw new NotFoundException('Mensagem não encontrada.');
    }

    // 2. Validar se o usuário participa da conversa
    const isRemetente = message.remetenteId === usuarioId;
    const isDestinatario = message.destinatarioId === usuarioId;

    if (!isRemetente && !isDestinatario) {
      throw new NotFoundException('Mensagem não encontrada.');
    }

    // 3. Validar autoria quando o modo for PARA_TODOS
    if (dto.modo === ModoExclusaoMensagem.PARA_TODOS && !isRemetente) {
      throw new ForbiddenException(
        'Somente o autor da mensagem pode apagá-la para todos.',
      );
    }

    // 4. Verificar se a operação solicitada já foi concluída (Idempotência pré-prazo)
    if (dto.modo === ModoExclusaoMensagem.PARA_MIM) {
      if (isRemetente && message.excluidaPeloRemetente) {
        return this.toResponse(message);
      }
      if (isDestinatario && message.excluidaPeloDestinatario) {
        return this.toResponse(message);
      }
    } else if (dto.modo === ModoExclusaoMensagem.PARA_TODOS) {
      if (message.apagadaParaTodos) {
        return this.toResponse(message);
      }
    } else {
      throw new BadRequestException('Modo de exclusão inválido.');
    }

    // 5. Se ainda não estiver concluída, validar o prazo de 60 minutos (inclusivo)
    const agora = Date.now();
    const criacao = new Date(message.dataCriacao).getTime();
    if (agora - criacao > MESSAGE_DELETION_WINDOW_MS) {
      throw new BadRequestException(
        'Mensagens só podem ser apagadas até 60 minutos após o envio.',
      );
    }

    // 6. Executar em transação atômica com updateMany condicional
    let apagadaAgoraParaTodos = false;
    let dataExclusaoEfetiva: Date | null = null;

    await this.prisma.$transaction(async (tx) => {
      if (dto.modo === ModoExclusaoMensagem.PARA_TODOS) {
        dataExclusaoEfetiva = new Date();
        const updated = await tx.mensagem.updateMany({
          where: {
            id: messageId,
            remetenteId: usuarioId,
            apagadaParaTodos: false,
          },
          data: {
            apagadaParaTodos: true,
            dataExclusao: dataExclusaoEfetiva,
          },
        });
        if (updated.count === 1) {
          apagadaAgoraParaTodos = true;
        }
      } else if (dto.modo === ModoExclusaoMensagem.PARA_MIM) {
        if (isRemetente) {
          // Atualiza SOMENTE excluidaPeloRemetente; dataExclusao permanece intacta
          await tx.mensagem.updateMany({
            where: {
              id: messageId,
              remetenteId: usuarioId,
              excluidaPeloRemetente: false,
            },
            data: {
              excluidaPeloRemetente: true,
            },
          });
        } else {
          // Atualiza SOMENTE excluidaPeloDestinatario; dataExclusao permanece intacta
          await tx.mensagem.updateMany({
            where: {
              id: messageId,
              destinatarioId: usuarioId,
              excluidaPeloDestinatario: false,
            },
            data: {
              excluidaPeloDestinatario: true,
            },
          });
        }
      }
    });

    const updated = await this.prisma.mensagem.findUnique({
      where: { id: messageId },
    });

    // 7. Notificação Socket.IO (ETAPA 3):
    // Somente emite message:deleted se a exclusão PARA_TODOS foi efetivamente
    // gravada no banco de dados agora (updated.count === 1).
    // Se for retry idempotente ou falha na transação, nenhuma emissão duplicada ocorre.
    if (apagadaAgoraParaTodos && updated && updated.apagadaParaTodos) {
      this.triggerSocketMessageDeleted(updated.remetenteId, updated.destinatarioId, {
        messageId: updated.id,
        apagadaParaTodos: true,
        dataExclusao: updated.dataExclusao ?? dataExclusaoEfetiva ?? new Date(),
      });
    }

    return this.toResponse(updated!);
  }

  private triggerSocketMessageDeleted(
    remetenteId: number,
    destinatarioId: number,
    payload: MessageDeletedEventPayload,
  ): void {
    if (!this.moduleRef) {
      return;
    }

    try {
      const gateway = this.moduleRef.get<any>('MESSAGES_GATEWAY', {
        strict: false,
      });
      if (gateway && typeof gateway.notifyMessageDeleted === 'function') {
        gateway.notifyMessageDeleted(remetenteId, destinatarioId, payload);
      }
    } catch {
      // Falha ao obter o gateway não impede nem desfaz a exclusão confirmada no banco
    }
  }
}
