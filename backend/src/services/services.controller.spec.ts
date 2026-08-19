import { TipoUsuario } from '../generated/prisma/enums';
import { CreateServiceDto } from './dto/create-service.dto';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

describe('ServicesController', () => {
  let controller: ServicesController;
  let servicesService: Record<string, jest.Mock>;

  beforeEach(() => {
    servicesService = {
      findActiveServices: jest.fn(),
      findOwnServicesByUserId: jest.fn(),
      findActiveServiceById: jest.fn(),
      createService: jest.fn(),
      updateOwnService: jest.fn(),
      updateOwnServiceStatus: jest.fn(),
    };
    controller = new ServicesController(servicesService as unknown as ServicesService);
  });

  it('encaminha consulta administrativa para o usuário autenticado', async () => {
    servicesService.findOwnServicesByUserId.mockResolvedValue([]);

    await controller.findOwnServices(8);

    expect(servicesService.findOwnServicesByUserId).toHaveBeenCalledWith(8);
  });

  it('encaminha criação sem aceitar barbeiroId', async () => {
    const data: CreateServiceDto = {
      nome: 'Corte',
      duracaoMinutos: 30,
      preco: '35.00',
    };
    servicesService.createService.mockResolvedValue({});

    await controller.createService(8, data);

    expect(servicesService.createService).toHaveBeenCalledWith(8, data);
    expect(data).not.toHaveProperty('barbeiroId');
    expect(TipoUsuario.BARBEIRO).toBe('BARBEIRO');
  });

  it('encaminha atualização de status somente com ativo', async () => {
    servicesService.updateOwnServiceStatus.mockResolvedValue({});

    await controller.updateServiceStatus(8, 3, { ativo: false });

    expect(servicesService.updateOwnServiceStatus).toHaveBeenCalledWith(8, 3, false);
  });
});