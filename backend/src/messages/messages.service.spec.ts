import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from './messages.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildPrismaMock(): any {
  return {
    usuario: { findUnique: jest.fn(), findMany: jest.fn() },
    barbeiro: { findUnique: jest.fn() },
    mensagem: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

const clientUser = {
  id: 10,
  tipoUsuario: TipoUsuario.CLIENTE,
  ativo: true,
  nome: 'Cliente A',
};
const barberUser = {
  id: 20,
  tipoUsuario: TipoUsuario.BARBEIRO,
  ativo: true,
  nome: 'Barbeiro A',
};
const otherClientUser = {
  id: 11,
  tipoUsuario: TipoUsuario.CLIENTE,
  ativo: true,
  nome: 'Cliente B',
};
const otherBarberUser = {
  id: 21,
  tipoUsuario: TipoUsuario.BARBEIRO,
  ativo: true,
  nome: 'Barbeiro B',
};

const messageRow = {
  id: 100,
  remetenteId: 10,
  destinatarioId: 20,
  conteudo: 'Olá',
  lida: false,
  dataCriacao: new Date('2099-01-01T10:00:00.000Z'),
  dataLeitura: null,
};

// mensagem criada pelo remetente 20 (barbeiro) para o destinatário 10 (cliente)
const barberToClientMessageRow = {
  id: 101,
  remetenteId: 20,
  destinatarioId: 10,
  conteudo: 'Resposta',
  lida: false,
  dataCriacao: new Date('2099-01-01T10:00:01.000Z'),
  dataLeitura: null,
};

describe('MessagesService', () => {
  let prisma: any;
  let service: MessagesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new MessagesService(prisma as unknown as PrismaService);
    prisma.mensagem.create.mockResolvedValue(messageRow);
  });

  const arrangeUsers = () =>
    prisma.usuario.findUnique.mockImplementation(({ where }: any) => {
      switch (where.id) {
        case 10:
          return clientUser;
        case 11:
          return otherClientUser;
        case 20:
          return barberUser;
        case 21:
          return otherBarberUser;
        default:
          return null;
      }
    });
  const arrangeBarberActive = (ativo: boolean) =>
    prisma.barbeiro.findUnique.mockResolvedValue({ ativo });

  describe('envio', () => {
    it('CLIENTE envia para BARBEIRO com remetente vindo do JWT', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

      const result = await service.sendMessage(clientUser.id, {
        destinatarioId: 20,
        conteudo: '  Olá  ',
      });

      expect(prisma.mensagem.create).toHaveBeenCalledWith({
        data: {
          remetenteId: 10,
          destinatarioId: 20,
          conteudo: 'Olá',
          lida: false,
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: 100,
          remetenteUsuarioId: 10,
          destinatarioUsuarioId: 20,
          conteudo: 'Olá',
          lida: false,
          dataLeitura: null,
        }),
      );
    });

    it('BARBEIRO ativo envia para CLIENTE', async () => {
      arrangeUsers();
      arrangeBarberActive(true);
      prisma.mensagem.create.mockResolvedValue(barberToClientMessageRow);

      const result = await service.sendMessage(barberUser.id, {
        destinatarioId: 10,
        conteudo: 'Resposta',
      });

      expect(prisma.mensagem.create).toHaveBeenCalledWith({
        data: {
          remetenteId: 20,
          destinatarioId: 10,
          conteudo: 'Resposta',
          lida: false,
        },
      });
      expect(result.remetenteUsuarioId).toBe(20);
    });

    it('CLIENTE -> CLIENTE rejeitado', async () => {
      arrangeUsers();

      await expect(
        service.sendMessage(clientUser.id, { destinatarioId: 11, conteudo: 'Oi' }),
      ).rejects.toThrow(
        new BadRequestException(
          'Mensagens são permitidas somente entre cliente e barbeiro.',
        ),
      );
    });

    it('BARBEIRO -> BARBEIRO rejeitado', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

      await expect(
        service.sendMessage(barberUser.id, { destinatarioId: 21, conteudo: 'Oi' }),
      ).rejects.toThrow(
        new BadRequestException(
          'Mensagens são permitidas somente entre cliente e barbeiro.',
        ),
      );
    });

    it('mensagem para si mesmo rejeitada', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

      await expect(
        service.sendMessage(clientUser.id, { destinatarioId: 10, conteudo: 'Oi' }),
      ).rejects.toThrow(
        new BadRequestException('Não é possível enviar mensagem para si mesmo.'),
      );
    });

    it('destinatário inexistente rejeitado', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

      await expect(
        service.sendMessage(clientUser.id, { destinatarioId: 999, conteudo: 'Oi' }),
      ).rejects.toThrow(new NotFoundException('Destinatário não encontrado.'));
    });

    it('destinatário inativo rejeitado', async () => {
      prisma.usuario.findUnique.mockImplementation(({ where }: any) =>
        where.id === 10
          ? clientUser
          : where.id === 20
            ? { ...barberUser, ativo: false }
            : null,
      );

      await expect(
        service.sendMessage(clientUser.id, { destinatarioId: 20, conteudo: 'Oi' }),
      ).rejects.toThrow(new NotFoundException('Destinatário não encontrado.'));
    });

    it('barbeiro sem perfil ativo rejeitado como destinatário e remetente', async () => {
      arrangeUsers();
      arrangeBarberActive(false);

      await expect(
        service.sendMessage(clientUser.id, { destinatarioId: 20, conteudo: 'Oi' }),
      ).rejects.toThrow(new NotFoundException('Destinatário não encontrado.'));

      await expect(
        service.sendMessage(barberUser.id, { destinatarioId: 10, conteudo: 'Oi' }),
      ).rejects.toThrow(new ForbiddenException('Remetente não autorizado.'));
    });

    it('conteúdo vazio (ou só espaços) rejeitado', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

      await expect(
        service.sendMessage(clientUser.id, { destinatarioId: 20, conteudo: '   ' }),
      ).rejects.toThrow(
        new BadRequestException('Conteúdo da mensagem é obrigatório.'),
      );
    });

    it('conteúdo > 500 rejeitado', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

      await expect(
        service.sendMessage(clientUser.id, {
          destinatarioId: 20,
          conteudo: 'a'.repeat(501),
        }),
      ).rejects.toThrow(new BadRequestException('Conteúdo excede 500 caracteres.'));
    });

    it('remetente inativo rejeitado', async () => {
      prisma.usuario.findUnique.mockImplementation(({ where }: any) =>
        where.id === 10 ? { ...clientUser, ativo: false } : null,
      );

      await expect(
        service.sendMessage(clientUser.id, { destinatarioId: 20, conteudo: 'Oi' }),
      ).rejects.toThrow(new ForbiddenException('Remetente não autorizado.'));
    });
  });

  describe('conversa', () => {
    it('retorna somente mensagens entre os dois participantes em ordem crescente', async () => {
      arrangeUsers();
      prisma.mensagem.findMany.mockResolvedValue([
        { ...messageRow, id: 100 },
        { ...messageRow, id: 101, remetenteId: 20, destinatarioId: 10 },
      ]);

      const result = await service.findConversation(clientUser.id, barberUser.id);

      expect(prisma.mensagem.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { remetenteId: 10, destinatarioId: 20 },
            { remetenteId: 20, destinatarioId: 10 },
          ],
        },
        orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
      });
      expect(result.map((message) => message.id)).toEqual([100, 101]);
      // terceiro usuário jamais aparece
      expect(
        result.every(
          (message) =>
            (message.remetenteUsuarioId === 10 &&
              message.destinatarioUsuarioId === 20) ||
            (message.remetenteUsuarioId === 20 &&
              message.destinatarioUsuarioId === 10),
        ),
      ).toBe(true);
    });

    it('conversa consigo mesmo e conversa com perfil igual rejeitadas', async () => {
      arrangeUsers();

      await expect(
        service.findConversation(clientUser.id, clientUser.id),
      ).rejects.toThrow(new BadRequestException('Conversa inválida.'));

      await expect(
        service.findConversation(clientUser.id, otherClientUser.id),
      ).rejects.toThrow(new NotFoundException('Conversa não encontrada.'));
    });
  });

  describe('lista de conversas', () => {
    const barberPartner = {
      id: 20,
      nome: 'Barbeiro A',
      tipoUsuario: TipoUsuario.BARBEIRO,
    };
    const barberPartnerB = {
      id: 21,
      nome: 'Barbeiro B',
      tipoUsuario: TipoUsuario.BARBEIRO,
    };
    const clientPartner = {
      id: 10,
      nome: 'Cliente A',
      tipoUsuario: TipoUsuario.CLIENTE,
    };

    const arrangeConversations = ({
      messages,
      partners,
    }: {
      messages: any[];
      partners: any[];
    }) => {
      arrangeUsers();
      prisma.mensagem.findMany.mockResolvedValue(messages);
      prisma.usuario.findMany.mockResolvedValue(partners);
    };

    it('CLIENTE lista barbeiros do perfil oposto com quem já trocou mensagem', async () => {
      arrangeConversations({
        messages: [messageRow],
        partners: [barberPartner],
      });

      const result = await service.findConversations(clientUser.id);

      expect(prisma.mensagem.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ remetenteId: 10 }, { destinatarioId: 10 }],
        },
        select: {
          id: true,
          remetenteId: true,
          destinatarioId: true,
          conteudo: true,
          lida: true,
          dataCriacao: true,
        },
      });
      expect(prisma.usuario.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [20] },
          tipoUsuario: TipoUsuario.BARBEIRO,
          ativo: true,
        },
        select: { id: true, nome: true, tipoUsuario: true },
      });
      expect(result).toEqual([
        {
          usuarioId: 20,
          nome: 'Barbeiro A',
          tipoUsuario: TipoUsuario.BARBEIRO,
          ultimaMensagem: 'Olá',
          ultimaMensagemDataCriacao: messageRow.dataCriacao,
          naoLidas: 0,
        },
      ]);
      // Não expõe dados sensíveis do parceiro nem das mensagens.
      expect(Object.keys(result[0]).sort()).toEqual([
        'naoLidas',
        'nome',
        'tipoUsuario',
        'ultimaMensagem',
        'ultimaMensagemDataCriacao',
        'usuarioId',
      ]);
    });

    it('última mensagem considera os dois sentidos e vem do par mais recente', async () => {
      arrangeConversations({
        // 10→20 ("Olá") e depois 20→10 ("Resposta"): a última é a resposta.
        messages: [messageRow, barberToClientMessageRow],
        partners: [barberPartner],
      });

      const result = await service.findConversations(clientUser.id);

      expect(result).toHaveLength(1);
      expect(result[0].usuarioId).toBe(20);
      expect(result[0].ultimaMensagem).toBe('Resposta');
      expect(result[0].ultimaMensagemDataCriacao).toEqual(
        barberToClientMessageRow.dataCriacao,
      );
      // Somente a mensagem RECEBIDA não lida conta para o cliente.
      expect(result[0].naoLidas).toBe(1);
    });

    it('BARBEIRO lista clientes (perfil oposto)', async () => {
      arrangeConversations({
        messages: [barberToClientMessageRow],
        partners: [clientPartner],
      });

      const result = await service.findConversations(barberUser.id);

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: [10] },
            tipoUsuario: TipoUsuario.CLIENTE,
          }),
        }),
      );
      expect(result[0].usuarioId).toBe(10);
      // Mensagem enviada pelo próprio barbeiro não conta como não lida dele.
      expect(result[0].naoLidas).toBe(0);
    });

    it('empate de dataCriacao desempata pelo id mais alto', async () => {
      const empate = {
        ...barberToClientMessageRow,
        id: 102,
        conteudo: 'Última no empate',
      };
      arrangeConversations({
        messages: [barberToClientMessageRow, empate],
        partners: [clientPartner],
      });

      const result = await service.findConversations(barberUser.id);

      expect(result[0].ultimaMensagem).toBe('Última no empate');
    });

    it('ordena as conversas pela mensagem mais recente primeiro', async () => {
      const antiga = {
        ...messageRow,
        id: 200,
        remetenteId: 10,
        destinatarioId: 20,
        dataCriacao: new Date('2099-01-01T09:00:00.000Z'),
      };
      const recente = {
        ...messageRow,
        id: 201,
        remetenteId: 10,
        destinatarioId: 21,
        dataCriacao: new Date('2099-01-01T10:00:00.000Z'),
      };
      arrangeConversations({
        messages: [antiga, recente],
        partners: [barberPartner, barberPartnerB],
      });

      const result = await service.findConversations(clientUser.id);

      expect(result.map((conversation) => conversation.usuarioId)).toEqual([
        21, 20,
      ]);
      expect(result[0].ultimaMensagemDataCriacao).toEqual(recente.dataCriacao);
      expect(result[1].ultimaMensagemDataCriacao).toEqual(antiga.dataCriacao);
    });

    it('naoLidas por conversa: mensagens lidas e as enviadas não contam', async () => {
      arrangeConversations({
        messages: [
          // 20→10 lida pelo cliente: não conta
          { ...barberToClientMessageRow, id: 300, lida: true },
          // 20→10 não lida: conta
          { ...barberToClientMessageRow, id: 301 },
          // 10→20 enviada pelo próprio cliente: não conta para ele
          { ...messageRow, id: 302, remetenteId: 10, destinatarioId: 20 },
        ],
        partners: [barberPartner],
      });

      const result = await service.findConversations(clientUser.id);

      expect(result).toHaveLength(1);
      expect(result[0].naoLidas).toBe(1);
    });

    it('usuário sem conversas retorna lista vazia (sem conversas artificiais)', async () => {
      arrangeConversations({
        messages: [],
        partners: [barberPartner],
      });

      const result = await service.findConversations(clientUser.id);

      expect(result).toEqual([]);
      // Sem mensagens, nenhum parceiro é consultado.
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
    });

    it('parceiro inativo não aparece (banco filtra usuários ativos)', async () => {
      arrangeConversations({
        messages: [messageRow],
        partners: [],
      });

      const result = await service.findConversations(clientUser.id);

      expect(result).toEqual([]);
    });

    it('usuário inativo é rejeitado', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        ...clientUser,
        ativo: false,
      });

      await expect(service.findConversations(clientUser.id)).rejects.toThrow(
        new ForbiddenException('Usuário não autorizado.'),
      );
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
    });

    it('usuário inexistente é rejeitado', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.findConversations(999)).rejects.toThrow(
        new ForbiddenException('Usuário não autorizado.'),
      );
    });
  });

  describe('contador global de não lidas (7B)', () => {
    it('conta somente destinatarioId do usuário autenticado e lida = false', async () => {
      prisma.usuario.findUnique.mockResolvedValue(clientUser);
      prisma.mensagem.count.mockResolvedValue(3);

      await expect(service.unreadCount(clientUser.id)).resolves.toEqual({
        count: 3,
      });
      expect(prisma.mensagem.count).toHaveBeenCalledWith({
        where: { destinatarioId: 10, lida: false },
      });
    });

    it('sem mensagens não lidas retorna zero', async () => {
      prisma.usuario.findUnique.mockResolvedValue(clientUser);
      prisma.mensagem.count.mockResolvedValue(0);

      await expect(service.unreadCount(clientUser.id)).resolves.toEqual({
        count: 0,
      });
    });

    it('usuário inativo é rejeitado', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        ...clientUser,
        ativo: false,
      });

      await expect(service.unreadCount(clientUser.id)).rejects.toThrow(
        new ForbiddenException('Usuário não autorizado.'),
      );
      expect(prisma.mensagem.count).not.toHaveBeenCalled();
    });

    it('usuário inexistente é rejeitado', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.unreadCount(999)).rejects.toThrow(
        new ForbiddenException('Usuário não autorizado.'),
      );
    });
  });

  describe('leitura', () => {
    it('destinatário marca como lida preservando dataLeitura na repetição', async () => {
      const firstReadAt = new Date('2099-01-01T11:00:00.000Z');
      prisma.mensagem.findUnique
        .mockResolvedValueOnce(messageRow)
        .mockResolvedValueOnce({ ...messageRow, lida: true, dataLeitura: firstReadAt });

      const result = await service.markAsRead(20, 100);

      expect(prisma.mensagem.updateMany).toHaveBeenCalledWith({
        where: { id: 100, destinatarioId: 20, lida: false },
        data: { lida: true, dataLeitura: expect.any(Date) },
      });
      expect(result.lida).toBe(true);
      expect(result.dataLeitura).toBe(firstReadAt);
    });

    it('segunda leitura não altera dataLeitura (update condicional)', async () => {
      const firstReadAt = new Date('2099-01-01T11:00:00.000Z');
      const alreadyRead = { ...messageRow, lida: true, dataLeitura: firstReadAt };
      prisma.mensagem.findUnique.mockResolvedValue(alreadyRead);

      const result = await service.markAsRead(20, 100);

      // update condicional por lida:false: repetida não atualiza nada
      expect(prisma.mensagem.updateMany).toHaveBeenCalledWith({
        where: { id: 100, destinatarioId: 20, lida: false },
        data: { lida: true, dataLeitura: expect.any(Date) },
      });
      expect(result.lida).toBe(true);
      expect(result.dataLeitura).toBe(firstReadAt);
    });

    it('remetente (não destinatário) não pode marcar como lida -> 404', async () => {
      prisma.mensagem.findUnique.mockResolvedValue(messageRow);

      await expect(service.markAsRead(10, 100)).rejects.toThrow(
        new NotFoundException('Mensagem não encontrada.'),
      );
      expect(prisma.mensagem.updateMany).not.toHaveBeenCalled();
    });

    it('mensagem inexistente -> 404', async () => {
      prisma.mensagem.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead(20, 999)).rejects.toThrow(
        new NotFoundException('Mensagem não encontrada.'),
      );
    });
  });
});
