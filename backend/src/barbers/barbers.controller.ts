import { Controller, Get, UseGuards } from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BarbersService } from './barbers.service';
import { BarberResponseDto } from './dto/barber-response.dto';

/**
 * GET /barbers — lista os barbeiros que podem ser escolhidos para agendamento.
 *
 * Primeiro passo do fluxo do cliente (escolher barbeiro → serviços do barbeiro
 * → disponibilidade → agendamento). Reutiliza autenticação/autorização do
 * projeto: `JwtGuard` + `RolesGuard` (`@Roles`), com revalidação do estado
 * ATUAL do usuário no banco — usuário inativo é rejeitado (401) e BARBEIRO sem
 * perfil ativo é rejeitado (403). Retorna apenas barbeiros elegíveis.
 */
@Controller('barbers')
export class BarbersController {
  constructor(private readonly barbersService: BarbersService) {}

  @Get()
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(TipoUsuario.CLIENTE, TipoUsuario.BARBEIRO)
  async findActiveBarbers(): Promise<BarberResponseDto[]> {
    return this.barbersService.findActiveBarbers();
  }
}
