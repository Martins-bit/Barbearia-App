import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { TipoUsuario } from '../generated/prisma/enums';
import { UsersService } from '../users/users.service';
import { MessageResponseDto } from './dto/message-response.dto';
import { SendMessageSocketDto } from './dto/send-message-socket.dto';
import { MessagesService } from './messages.service';
import { MessagesSocketRegistry } from './messages.socket-registry';

/** Identidade anexada ao socket exclusivamente a partir do JWT validado. */
export interface SocketIdentity {
  usuarioId: number;
  tipoUsuario: TipoUsuario;
}

/** Payload do evento de handshake autenticado (echo de identidade). */
interface PingPongDto {
  usuarioId: number;
  tipoUsuario: TipoUsuario;
}

/**
 * Fundação WebSocket do módulo de mensagens (ETAPA 7C.1) — namespace dedicado
 * `/messages`.
 *
 * - Autenticação obrigatória no HANDSHAKE, via middleware: JWT válido
 *   (`auth.token`, com ou sem prefixo `Bearer`) ou header `Authorization`.
 *   O JWT é verificado com o MESMO JwtService/segredo do sistema
 *   (AuthModule) e a validação de conta/perfil reutiliza o MESMO serviço do
 *   RolesGuard (`UsersService.findAuthorizationStateById`): usuário
 *   inexistente, inativo ou BARBEIRO sem perfil ativo é rejeitado.
 * - A identidade (usuarioId/tipoUsuario) vem EXCLUSIVAMENTE do JWT; nada
 *   enviado pelo cliente pode defini-la.
 * - Registra conexão/desconexão em memória (`MessagesSocketRegistry`) para
 *   permitir, futuramente, localizar os sockets de um usuário. Nada é
 *   persistido no PostgreSQL.
 * - Eventos: `ping` → ack `pong` (handshake autenticado, ETAPA 7C.1) e
 *   `message:send` (ETAPA 7C.2), que persiste via `MessagesService` — as
 *   MESMAS regras do POST /messages — e só então emite `message:sent` ao
 *   remetente e `message:received` a cada conexão ativa do destinatário.
 * - NÃO há read/unread-count via socket, fila offline, presença,
 *   typing indicator, Redis, push, e-mail ou WhatsApp nesta etapa.
 */
@WebSocketGateway({ namespace: '/messages' })
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(MessagesGateway.name);

  @WebSocketServer()
  server?: Server;

  constructor(
    private readonly socketRegistry: MessagesSocketRegistry,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly messagesService: MessagesService,
  ) {}

  /**
   * Middleware de handshake: rejeita a conexão ANTES de registrá-la quando a
   * autenticação falha (o cliente recebe `connect_error: Não autorizado.`).
   */
  afterInit(server: Server): void {
    server.use((client: Socket, next: (err?: Error) => void) =>
      this.authenticate(client)
        .then(() => next())
        .catch((error: unknown) =>
          next(error instanceof Error ? error : new Error('Não autorizado.')),
        ),
    );
  }

  /**
   * Valida o handshake: token presente, JWT válido, usuário existente e
   * ativo e (para BARBEIRO) perfil de barbeiro ativo — mesmas regras do
   * RolesGuard. Anexa a identidade do JWT ao socket em caso de sucesso.
   */
  async authenticate(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      throw new Error('Não autorizado.');
    }

    let payload: { sub?: unknown };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      // JWT ausente/inválido/expirado: motivo genérico, sem detalhes internos.
      throw new Error('Não autorizado.');
    }

    const usuarioId = Number(payload?.sub);
    if (!Number.isInteger(usuarioId) || usuarioId < 1) {
      throw new Error('Não autorizado.');
    }

    // Mesma validação de conta/perfil usada pelo RolesGuard (usuários ativos,
    // barbeiro com perfil ativo). Nunca confia em dado enviado pelo cliente.
    const authorizationState =
      await this.usersService.findAuthorizationStateById(usuarioId);
    if (!authorizationState || !authorizationState.ativo) {
      throw new Error('Não autorizado.');
    }
    if (
      authorizationState.tipoUsuario === TipoUsuario.BARBEIRO &&
      (!authorizationState.barbeiro || !authorizationState.barbeiro.ativo)
    ) {
      throw new Error('Não autorizado.');
    }

    client.data.usuarioId = usuarioId;
    client.data.tipoUsuario = authorizationState.tipoUsuario;
  }

  /** Registra a conexão autenticada (identidade já validada no handshake). */
  handleConnection(client: Socket): void {
    const identity = this.getIdentity(client);
    if (!identity) {
      // Defesa adicional: conexão sem identidade não deve existir aqui.
      client.disconnect(true);
      return;
    }
    this.socketRegistry.add(identity.usuarioId, client.id);
    // Sala por usuário: permite entregar um evento a todas as conexões dele
    // com um único emit (múltiplos dispositivos/abas).
    void client.join(this.userRoom(identity.usuarioId));
    this.logger.debug(
      `WebSocket conectado: usuarioId=${identity.usuarioId} socketId=${client.id}`,
    );
  }

  /** Remove a conexão do registro (idempotente). */
  handleDisconnect(client: Socket): void {
    const identity = this.getIdentity(client);
    if (identity) {
      this.socketRegistry.remove(identity.usuarioId, client.id);
    }
    this.logger.debug(`WebSocket desconectado: socketId=${client.id}`);
  }

  /**
   * Handshake de teste autenticado: ecoa apenas a identidade validada do
   * JWT. Não envia, não persiste e não dispara nenhuma mensagem.
   */
  @SubscribeMessage('ping')
  handlePing(
    @ConnectedSocket() client: Socket,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @MessageBody() _body?: unknown,
  ): { event: string; data: PingPongDto } {
    const identity = this.getIdentity(client);
    if (!identity) {
      throw new WsException('Não autorizado.');
    }
    return {
      event: 'pong',
      data: {
        usuarioId: identity.usuarioId,
        tipoUsuario: identity.tipoUsuario,
      },
    };
  }

  /**
   * Envio de mensagem em tempo real (ETAPA 7C.2).
   *
   * ORDEM CRÍTICA: (1) identidade já autenticada no handshake; (2) validação do
   * payload; (3) persistência via `MessagesService.sendMessage` (as MESMAS
   * regras do POST /messages); (4) só então `message:sent` ao remetente;
   * (5) só então `message:received` a cada conexão ativa do destinatário.
   *
   * Nunca emite sucesso antes da persistência. Exatamente uma persistência por
   * chamada — a emissão não grava nada.
   */
  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const identity = this.getIdentity(client);
    if (!identity) {
      throw new WsException('Não autorizado.');
    }

    // Validação estrita: campos de identidade enviados pelo cliente são
    // rejeitados (forbidNonWhitelisted) — o remetente vem só do JWT.
    const dto = await this.parseSendPayload(body);

    let message: MessageResponseDto;
    try {
      // Reutiliza as regras de negócio existentes (CLIENTE <-> BARBEIRO,
      // usuários ativos, barbeiro com perfil ativo, 1..500 caracteres) e a
      // persistência no PostgreSQL.
      message = await this.messagesService.sendMessage(identity.usuarioId, dto);
    } catch (error) {
      throw this.toWsException(error);
    }

    // Persistido com sucesso: agora sim pode emitir. O handler NÃO retorna
    // valor — o Nest converteria o retorno em um segundo evento (duplicando
    // message:sent), então a emissão explícita abaixo é a única origem.
    client.emit('message:sent', message);
    this.emitToUser(message.destinatarioUsuarioId, 'message:received', message);
  }

  /**
   * Entrega um evento a TODAS as conexões ativas do usuário (um usuário pode
   * ter vários dispositivos/abas). Destinatário offline não é erro: a mensagem
   * já está persistida e será recuperada via REST (sem fila offline nesta
   * etapa).
   */
  private emitToUser(
    usuarioId: number,
    event: string,
    data: unknown,
  ): void {
    const socketIds = this.socketRegistry.getSocketIds(usuarioId);
    if (socketIds.length === 0 || !this.server) {
      return;
    }
    // Sala por usuário: um único `to()` atinge todas as conexões dele.
    this.server.to(this.userRoom(usuarioId)).emit(event, data);
  }

  /** Nome da sala Socket.IO que agrupa todas as conexões de um usuário. */
  private userRoom(usuarioId: number): string {
    return `usuario:${usuarioId}`;
  }

  /**
   * Valida o payload cru usando as MESMAS regras de DTO do REST
   * (`class-validator`), com whitelist estrita. Erros são convertidos em
   * `WsException` genérica, sem detalhes internos.
   */
  private async parseSendPayload(body: unknown): Promise<SendMessageSocketDto> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new WsException('Dados inválidos.');
    }

    const dto = plainToInstance(SendMessageSocketDto, body);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new WsException('Dados inválidos.');
    }
    return dto;
  }

  /**
   * Converte exceções de negócio em `WsException` segura: preserva a mensagem
   * pública (já genérica no service) e nunca vaza stack trace, SQL, JWT ou
   * qualquer detalhe interno do banco.
   */
  private toWsException(error: unknown): WsException {
    if (error instanceof WsException) {
      return error;
    }
    const status = (error as { getStatus?: () => number })?.getStatus?.();
    const publicMessage =
      typeof status === 'number' ? (error as Error).message : undefined;
    return new WsException(publicMessage || 'Não foi possível enviar a mensagem.');
  }

  private getIdentity(client: Socket): SocketIdentity | null {
    const { usuarioId, tipoUsuario } = client.data ?? {};
    if (typeof usuarioId !== 'number' || !tipoUsuario) {
      return null;
    }
    return { usuarioId, tipoUsuario };
  }

  /** Token do handshake: `auth.token` ou header `Authorization` (Bearer). */
  private extractToken(client: Socket): string | undefined {
    const handshake = client.handshake;
    const fromAuth = handshake?.auth?.token;
    const fromHeader = handshake?.headers?.authorization;
    const raw =
      typeof fromAuth === 'string' && fromAuth.trim().length > 0
        ? fromAuth
        : typeof fromHeader === 'string' && fromHeader.trim().length > 0
          ? fromHeader
          : undefined;
    if (!raw) {
      return undefined;
    }
    const withoutBearer = raw.startsWith('Bearer ')
      ? raw.slice('Bearer '.length)
      : raw;
    const token = withoutBearer.trim();
    return token.length > 0 ? token : undefined;
  }
}
