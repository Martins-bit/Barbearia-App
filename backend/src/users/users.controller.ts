import {
  Body,
  BadRequestException,
  Controller,
  ConflictException,
  Get,
  Headers,
  Header,
  HttpException,
  HttpCode,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { isUUID } from 'class-validator';
import { TipoUsuario } from '../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { CreatePrivacyRequestDto } from './privacy-requests/dto/create-privacy-request.dto';
import { ListPrivacyRequestsQueryDto } from './privacy-requests/dto/list-privacy-requests-query.dto';
import { PrivacyRequestsService } from './privacy-requests/privacy-requests.service';
import { TemporaryExportCleanupError } from './temporary-export-storage.service';
import {
  UserExportLockError,
  UserExportLockService,
} from '../common/redis/user-export-lock.service';
import type { UserExportLockAcquisition } from '../common/redis/user-export-lock.service';

const PERSONAL_DATA_EXPORT_LOCK_TTL_MS = 60_000;

const authenticatedUserTracker = (req: { user?: { sub?: unknown } }) =>
  `usuario:${String(req?.user?.sub ?? 'anon')}`;

/**
 * Recurso do próprio usuário autenticado (API.md §13).
 *
 * - A identidade vem SEMPRE do JWT (`@CurrentUser`), nunca de um ID enviado
 *   pelo cliente: não existe rota PATCH /users/:id, portanto IDOR por
 *   parâmetro é impossível por construção.
 * - Os guards são registrados como providers DESTE módulo (ver
 *   users.module.ts): RolesGuard revalida conta/perfil ativo no banco a cada
 *   request, igual ao resto do sistema.
 * - Campos editáveis são exclusivamente os do UpdateUserDto (nome, telefone,
 *   e-mail); id, tipoUsuario, ativo e senhaHash não existem no DTO e são
 *   rejeitados pelo ValidationPipe global (forbidNonWhitelisted) e ignorados
 *   em camada de serviço (whitelist explícita em UsersService.updateUser).
 * - O endpoint de leitura canônica da sessão permanece GET /auth/me, preservado
 *   por compatibilidade; GET /users/me expõe o mesmo dado sob o recurso de
 *   usuário.
 */
@Controller('users')
@UseGuards(JwtGuard, RolesGuard)
@Roles(TipoUsuario.CLIENTE, TipoUsuario.BARBEIRO)
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly privacyRequestsService: PrivacyRequestsService,
    private readonly userExportLockService: UserExportLockService,
  ) {}

  @Post('me/requests')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
      getTracker: authenticatedUserTracker,
    },
  })
  async createPrivacyRequest(
    @CurrentUser() userId: number,
    @Body() dto: CreatePrivacyRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey || !isUUID(idempotencyKey, '4')) {
      throw new BadRequestException('Cabeçalho Idempotency-Key inválido.');
    }

    return this.privacyRequestsService.create(userId, dto, idempotencyKey);
  }

  @Get('me/requests')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: 30,
      ttl: 60_000,
      getTracker: authenticatedUserTracker,
    },
  })
  async findMyPrivacyRequests(
    @CurrentUser() userId: number,
    @Query() query: ListPrivacyRequestsQueryDto,
  ) {
    return this.privacyRequestsService.findMine(userId, query);
  }

  /**
   * GET /users/me/export — gera um arquivo temporário JSON dos dados acessíveis
   * da própria conta e o transmite após concluir o snapshot. A identidade vem
   * do JWT e a resposta não é armazenável em cache.
   */
  @Get('me/export')
  @Header('Content-Disposition', 'attachment; filename="dados-pessoais.json"')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @Header('X-Content-Type-Options', 'nosniff')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: 3,
      ttl: 60_000,
      getTracker: authenticatedUserTracker,
    },
  })
  async exportMe(
    @CurrentUser() userId: number,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    let acquisition: UserExportLockAcquisition;
    try {
      acquisition = await this.userExportLockService.tryAcquire(userId, {
        ttlMs: PERSONAL_DATA_EXPORT_LOCK_TTL_MS,
      });
    } catch {
      this.logger.error('Falha ao adquirir o lock da exportação de dados.');
      throw new ServiceUnavailableException(
        'A exportação de dados está temporariamente indisponível.',
      );
    }

    if (!acquisition.acquired) {
      throw new ConflictException(
        'Já existe uma exportação de dados ativa para este usuário.',
      );
    }

    const lock = acquisition.lock;
    const cancellation = new AbortController();
    let clientDisconnected = false;
    let exportFile:
      | Awaited<ReturnType<UsersService['exportPersonalDataToTemporaryFile']>>
      | undefined;
    let cleanupPending = false;

    const onRequestAborted = (): void => {
      clientDisconnected = true;
      cancellation.abort(new Error('A requisição foi interrompida.'));
    };
    const onResponseClose = (): void => {
      if (!response.writableFinished) {
        clientDisconnected = true;
        cancellation.abort(new Error('A conexão foi interrompida.'));
      }
    };
    const onResponseError = (): void => {
      clientDisconnected = true;
      cancellation.abort(new Error('A resposta foi interrompida.'));
    };
    const onLockLost = (): void => {
      cancellation.abort(lock.lost.reason);
      if (response.headersSent && !response.writableFinished) {
        response.destroy(
          lock.lost.reason instanceof Error
            ? lock.lost.reason
            : new UserExportLockError(
                'A propriedade do lock da exportação foi perdida.',
              ),
        );
      }
    };
    request.once('aborted', onRequestAborted);
    response.once('close', onResponseClose);
    response.once('error', onResponseError);
    lock.lost.addEventListener('abort', onLockLost, { once: true });
    if (request.aborted || response.destroyed) {
      onRequestAborted();
    }

    try {
      exportFile = await this.usersService.exportPersonalDataToTemporaryFile(
        userId,
        cancellation.signal,
      );

      if (clientDisconnected) {
        return;
      }
      if (lock.lost.aborted) {
        throw new ServiceUnavailableException(
          'A propriedade da exportação foi perdida. Tente novamente.',
        );
      }
      if (cancellation.signal.aborted) {
        throw new ServiceUnavailableException(
          'A exportação de dados foi cancelada.',
        );
      }

      response.setHeader(
        'Content-Disposition',
        'attachment; filename="dados-pessoais.json"',
      );
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Content-Length', String(exportFile.sizeBytes));
      const readStream = await exportFile.openReadStream();
      await pipeline(readStream, response, { signal: cancellation.signal });
    } catch (error) {
      cleanupPending =
        !exportFile && error instanceof TemporaryExportCleanupError;
      if (clientDisconnected) {
        return;
      }
      if (lock.lost.aborted) {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        throw new ServiceUnavailableException(
          'A propriedade da exportação foi perdida. Tente novamente.',
        );
      }
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Falha ao gerar exportação de dados pessoais.');
      if (response.headersSent) {
        response.destroy();
      } else {
        throw new InternalServerErrorException(
          'Não foi possível gerar a exportação de dados pessoais.',
        );
      }
    } finally {
      request.off('aborted', onRequestAborted);
      response.off('close', onResponseClose);
      response.off('error', onResponseError);
      lock.lost.removeEventListener('abort', onLockLost);
      if (exportFile) {
        try {
          await exportFile.dispose();
        } catch {
          cleanupPending = true;
          this.logger.error(
            'A limpeza do arquivo temporário da exportação não foi confirmada.',
          );
        }
      }
      if (cleanupPending) {
        try {
          await lock.stopRenewal();
        } catch {
          this.logger.error(
            'Não foi possível interromper a renovação do lock após falha de limpeza.',
          );
        }
        this.logger.error(
          'O lock da exportação não foi liberado; o lease expirará naturalmente enquanto a limpeza permanece pendente.',
        );
      } else {
        try {
          const released = await lock.release();
          if (!released && !lock.lost.aborted) {
            this.logger.error(
              'Não foi possível confirmar a liberação do lock da exportação.',
            );
          }
        } catch {
          this.logger.error(
            'Não foi possível confirmar a liberação do lock da exportação.',
          );
        }
      }
    }
  }

  /**
   * GET /users/me — perfil do usuário autenticado.
   * Somente leitura, sem hash nem campos internos (publicUserSelect).
   */
  @Get('me')
  async findMe(@CurrentUser() userId: number): Promise<UserResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException(`Usuário com ID ${userId} não encontrado.`);
    }
    return user;
  }

  /**
   * PATCH /users/me — atualiza nome, telefone e/ou e-mail da própria conta.
   * Atualização vazia é rejeitada (400); conflitos de unicidade (telefone ou
   * e-mail já usados por outra conta) retornam 409.
   */
  @Patch('me')
  @HttpCode(200)
  async updateMe(
    @CurrentUser() userId: number,
    @CurrentUser('authVersion') authVersion: number,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateUser(userId, dto, authVersion);
  }
}
