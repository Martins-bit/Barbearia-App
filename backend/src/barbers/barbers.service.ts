import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { BarberResponseDto } from './dto/barber-response.dto';

/**
 * Listagem de barbeiros ELEGÍVEIS para agendamento (GET /barbers).
 *
 * Reutiliza `UsersService` (dono dos dados públicos de Usuario/Barbeiro) — não
 * há lógica de elegibilidade duplicada nem novo modelo: a listagem é um filtro
 * sobre os dados existentes (perfil de barbeiro ativo + usuário ativo). Nada é
 * persistido e nenhuma permissão administrativa é introduzida.
 */
@Injectable()
export class BarbersService {
  constructor(private readonly usersService: UsersService) {}

  async findActiveBarbers(): Promise<BarberResponseDto[]> {
    return this.usersService.findActiveBarbers();
  }
}
