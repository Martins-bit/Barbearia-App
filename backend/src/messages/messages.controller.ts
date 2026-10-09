import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TipoUsuario } from '../generated/prisma/enums';
import {
  ConversationPartnerDto,
  MessageResponseDto,
  UnreadCountDto,
} from './dto/message-response.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

/**
 * Mensagens CLIENTE <-> BARBEIRO (ETAPAS 7A/7B). Sem tempo real.
 * usuarioId do remetente SEMPRE vem do JWT; o frontend informa somente
 * destinatarioId + conteudo. A lista de conversas e o contador de não lidas
 * também derivam a identidade exclusivamente do JWT.
 */
@Controller('messages')
@UseGuards(JwtGuard, RolesGuard)
@Roles(TipoUsuario.CLIENTE, TipoUsuario.BARBEIRO)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  // Rate limit (ETAPA 2): 30 envios / minuto, rastreados pelo usuário
  // autenticado (req.user.sub), não por IP — mesma semântica do evento
  // message:send do WebSocket. O JwtGuard (nível de classe) popula req.user
  // ANTES deste guard, por isso o tracker por usuário é seguro aqui.
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: 30,
      ttl: 60_000,
      getTracker: (req: { user?: { sub?: unknown } }) =>
        `usuario:${String(req?.user?.sub ?? 'anon')}`,
    },
  })
  async sendMessage(
    @CurrentUser() usuarioId: number,
    @Body() dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messagesService.sendMessage(usuarioId, dto);
  }

  @Get('conversations')
  async findConversations(
    @CurrentUser() usuarioId: number,
  ): Promise<ConversationPartnerDto[]> {
    return this.messagesService.findConversations(usuarioId);
  }

  // Declarado ANTES de @Get(':userId') para não ser capturado como parâmetro.
  @Get('unread-count')
  async unreadCount(
    @CurrentUser() usuarioId: number,
  ): Promise<UnreadCountDto> {
    return this.messagesService.unreadCount(usuarioId);
  }

  @Get(':userId')
  async findConversation(
    @CurrentUser() usuarioId: number,
    @Param('userId', ParseIntPipe) outroUsuarioId: number,
  ): Promise<MessageResponseDto[]> {
    return this.messagesService.findConversation(usuarioId, outroUsuarioId);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() usuarioId: number,
    @Param('id', ParseIntPipe) messageId: number,
  ): Promise<MessageResponseDto> {
    return this.messagesService.markAsRead(usuarioId, messageId);
  }
}