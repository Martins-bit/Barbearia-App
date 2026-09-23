import { BarbersService } from './barbers.service';
import { UsersService } from '../users/users.service';

describe('BarbersService', () => {
  let usersService: { findActiveBarbers: jest.Mock };
  let service: BarbersService;

  beforeEach(() => {
    usersService = { findActiveBarbers: jest.fn() };
    service = new BarbersService(usersService as unknown as UsersService);
  });

  it('delega a listagem ao UsersService (sem duplicar regra de elegibilidade)', async () => {
    usersService.findActiveBarbers.mockResolvedValue([
      { id: 3, nome: 'Barbeiro A' },
      { id: 5, nome: 'Barbeiro B' },
    ]);

    const result = await service.findActiveBarbers();

    expect(usersService.findActiveBarbers).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { id: 3, nome: 'Barbeiro A' },
      { id: 5, nome: 'Barbeiro B' },
    ]);
  });

  it('retorna array vazio quando não há barbeiros elegíveis', async () => {
    usersService.findActiveBarbers.mockResolvedValue([]);

    await expect(service.findActiveBarbers()).resolves.toEqual([]);
  });
});
