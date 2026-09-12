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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TipoUsuario } from '../generated/prisma/enums';
import {
  ConversationPartnerDto,
  MessageResponseDto,
} from './dto/message-response.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

/**
 * Fundação de mensagens CLIENTE <-> BARBEIRO (ETAPA 7A). Sem tempo real.
 * usuarioId do remetente SEMPRE vem do JWT; o frontend informa somente
 * destinatarioId + conteudo.
 */
@Controller('messages')
@UseGuards(JwtGuard, RolesGuard)
@Roles(TipoUsuario.CLIENTE, TipoUsuario.BARBEIRO)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
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