import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

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
  constructor(private readonly usersService: UsersService) {}

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
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateUser(userId, dto);
  }
}
