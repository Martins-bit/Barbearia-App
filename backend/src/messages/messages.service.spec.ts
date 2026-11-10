import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TipoUsuario } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService, DELETED_MESSAGE_TEXT } from './messages.service';
import { ModoExclusaoMensagem } from './dto/delete-message.dto';

function buildPrismaMock(): any {
  const prismaMock: any = {
    usuario: { findUnique: jest.fn(), findMany: jest.fn() },
    barbeiro: { findUnique: jest.fn() },
    mensagem: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  };
  prismaMock.$transaction = jest.fn(async (callback: any) =>
    callback(prismaMock),
  );
  return prismaMock;
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
    service = new MessagesService(prisma);
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
        service.sendMessage(clientUser.id, {
          destinatarioId: 11,
          conteudo: 'Oi',
        }),
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
        service.sendMessage(barberUser.id, {
          destinatarioId: 21,
          conteudo: 'Oi',
        }),
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
        service.sendMessage(clientUser.id, {
          destinatarioId: 10,
          conteudo: 'Oi',
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Não é possível enviar mensagem para si mesmo.',
        ),
      );
    });

    it('destinatário inexistente rejeitado', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

      await expect(
        service.sendMessage(clientUser.id, {
          destinatarioId: 999,
          conteudo: 'Oi',
        }),
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
        service.sendMessage(clientUser.id, {
          destinatarioId: 20,
          conteudo: 'Oi',
        }),
      ).rejects.toThrow(new NotFoundException('Destinatário não encontrado.'));
    });

    it('barbeiro sem perfil ativo rejeitado como destinatário e remetente', async () => {
      arrangeUsers();
      arrangeBarberActive(false);

      await expect(
        service.sendMessage(clientUser.id, {
          destinatarioId: 20,
          conteudo: 'Oi',
        }),
      ).rejects.toThrow(new NotFoundException('Destinatário não encontrado.'));

      await expect(
        service.sendMessage(barberUser.id, {
          destinatarioId: 10,
          conteudo: 'Oi',
        }),
      ).rejects.toThrow(new ForbiddenException('Remetente não autorizado.'));
    });

    it('conteúdo vazio (ou só espaços) rejeitado', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

      await expect(
        service.sendMessage(clientUser.id, {
          destinatarioId: 20,
          conteudo: '   ',
        }),
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
      ).rejects.toThrow(
        new BadRequestException('Conteúdo excede 500 caracteres.'),
      );
    });

    it('remetente inativo rejeitado', async () => {
      prisma.usuario.findUnique.mockImplementation(({ where }: any) =>
        where.id === 10 ? { ...clientUser, ativo: false } : null,
      );

      await expect(
        service.sendMessage(clientUser.id, {
          destinatarioId: 20,
          conteudo: 'Oi',
        }),
      ).rejects.toThrow(new ForbiddenException('Remetente não autorizado.'));
    });
  });

  describe('conversa', () => {
    it('retorna somente mensagens entre os dois participantes em ordem crescente', async () => {
      arrangeUsers();
      arrangeBarberActive(true);
      prisma.mensagem.findMany.mockResolvedValue([
        { ...messageRow, id: 100 },
        { ...messageRow, id: 101, remetenteId: 20, destinatarioId: 10 },
      ]);

      const result = await service.findConversation(
        clientUser.id,
        barberUser.id,
      );

      expect(prisma.mensagem.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { remetenteId: 10, destinatarioId: 20, excluidaPeloRemetente: false },
            { remetenteId: 20, destinatarioId: 10, excluidaPeloDestinatario: false },
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

    it('cliente não acessa conversa com perfil de barbeiro desativado', async () => {
      arrangeUsers();
      arrangeBarberActive(false);

      await expect(
        service.findConversation(clientUser.id, barberUser.id),
      ).rejects.toThrow(new NotFoundException('Conversa não encontrada.'));
      expect(prisma.mensagem.findMany).not.toHaveBeenCalled();
    });

    it('barbeiro ativo acessa conversa autorizada com cliente', async () => {
      arrangeUsers();
      arrangeBarberActive(true);
      prisma.mensagem.findMany.mockResolvedValue([barberToClientMessageRow]);

      await expect(
        service.findConversation(barberUser.id, clientUser.id),
      ).resolves.toHaveLength(1);
      expect(prisma.barbeiro.findUnique).toHaveBeenCalledWith({
        where: { usuarioId: barberUser.id },
        select: { ativo: true },
      });
    });

    it('conta inativa não acessa conversa', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        ...clientUser,
        ativo: false,
      });

      await expect(
        service.findConversation(clientUser.id, barberUser.id),
      ).rejects.toThrow(new ForbiddenException('Usuário não autorizado.'));
      expect(prisma.mensagem.findMany).not.toHaveBeenCalled();
    });

    it('terceiro usuário consulta somente seu próprio par de participantes', async () => {
      arrangeUsers();
      arrangeBarberActive(true);
      prisma.mensagem.findMany.mockResolvedValue([]);

      await expect(
        service.findConversation(otherClientUser.id, barberUser.id),
      ).resolves.toEqual([]);
      expect(prisma.mensagem.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            {
              remetenteId: otherClientUser.id,
              destinatarioId: barberUser.id,
              excluidaPeloRemetente: false,
            },
            {
              remetenteId: barberUser.id,
              destinatarioId: otherClientUser.id,
              excluidaPeloDestinatario: false,
            },
          ],
        },
        orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
      });
    });

    it('conversa consigo mesmo e conversa com perfil igual rejeitadas', async () => {
      arrangeUsers();
      arrangeBarberActive(true);

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
      barbeiro: { ativo: true },
    };
    const barberPartnerB = {
      id: 21,
      nome: 'Barbeiro B',
      tipoUsuario: TipoUsuario.BARBEIRO,
      barbeiro: { ativo: true },
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
      arrangeBarberActive(true);
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
          OR: [
            { remetenteId: 10, excluidaPeloRemetente: false },
            { destinatarioId: 10, excluidaPeloDestinatario: false },
          ],
        },
        select: {
          id: true,
          remetenteId: true,
          destinatarioId: true,
          conteudo: true,
          lida: true,
          dataCriacao: true,
          apagadaParaTodos: true,
          excluidaPeloRemetente: true,
          excluidaPeloDestinatario: true,
        },
      });
      expect(prisma.usuario.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [20] },
          tipoUsuario: TipoUsuario.BARBEIRO,
          ativo: true,
        },
        select: {
          id: true,
          nome: true,
          tipoUsuario: true,
          barbeiro: { select: { ativo: true } },
        },
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

    it('barbeiro com perfil desativado não aparece na lista', async () => {
      arrangeConversations({
        messages: [messageRow],
        partners: [{ ...barberPartner, barbeiro: { ativo: false } }],
      });

      const result = await service.findConversations(clientUser.id);

      expect(result).toEqual([]);
    });

    it('barbeiro com perfil desativado não pode listar conversas', async () => {
      arrangeUsers();
      arrangeBarberActive(false);

      await expect(service.findConversations(barberUser.id)).rejects.toThrow(
        new ForbiddenException('Usuário não autorizado.'),
      );
      expect(prisma.mensagem.findMany).not.toHaveBeenCalled();
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
    it('conta somente destinatarioId do usuário autenticado, lida = false e não excluída pelo destinatário', async () => {
      prisma.usuario.findUnique.mockResolvedValue(clientUser);
      prisma.mensagem.count.mockResolvedValue(3);

      await expect(service.unreadCount(clientUser.id)).resolves.toEqual({
        count: 3,
      });
      expect(prisma.mensagem.count).toHaveBeenCalledWith({
        where: {
          destinatarioId: 10,
          lida: false,
          excluidaPeloDestinatario: false,
        },
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
        .mockResolvedValueOnce({
          ...messageRow,
          lida: true,
          dataLeitura: firstReadAt,
        });

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
      const alreadyRead = {
        ...messageRow,
        lida: true,
        dataLeitura: firstReadAt,
      };
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

  describe('exclusão de mensagens', () => {
    const agora = Date.now();
    const mensagemRecente = {
      ...messageRow,
      id: 500,
      remetenteId: 10,
      destinatarioId: 20,
      dataCriacao: new Date(agora - 10 * 60 * 1000), // 10 minutos atrás
      apagadaParaTodos: false,
      excluidaPeloRemetente: false,
      excluidaPeloDestinatario: false,
    };

    it('1. Remetente apagando para si: atualiza somente excluidaPeloRemetente e NÃO preenche dataExclusao', async () => {
      arrangeUsers();
      prisma.mensagem.findUnique
        .mockResolvedValueOnce(mensagemRecente)
        .mockResolvedValueOnce({
          ...mensagemRecente,
          excluidaPeloRemetente: true,
          dataExclusao: null,
        });
      prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteMessage(10, 500, {
        modo: ModoExclusaoMensagem.PARA_MIM,
      });

      expect(prisma.mensagem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 500,
          remetenteId: 10,
          excluidaPeloRemetente: false,
        },
        data: {
          excluidaPeloRemetente: true,
        },
      });
      expect(result.id).toBe(500);
      expect(result.dataLeitura).toBeNull();
    });

    it('2. Destinatário apagando para si: atualiza somente excluidaPeloDestinatario e NÃO preenche dataExclusao', async () => {
      arrangeUsers();
      prisma.mensagem.findUnique
        .mockResolvedValueOnce(mensagemRecente)
        .mockResolvedValueOnce({
          ...mensagemRecente,
          excluidaPeloDestinatario: true,
          dataExclusao: null,
        });
      prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteMessage(20, 500, {
        modo: ModoExclusaoMensagem.PARA_MIM,
      });

      expect(prisma.mensagem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 500,
          destinatarioId: 20,
          excluidaPeloDestinatario: false,
        },
        data: {
          excluidaPeloDestinatario: true,
        },
      });
      expect(result.id).toBe(500);
    });

    it('3. Remetente apagando para todos: preenche apagadaParaTodos e dataExclusao', async () => {
      arrangeUsers();
      prisma.mensagem.findUnique
        .mockResolvedValueOnce(mensagemRecente)
        .mockResolvedValueOnce({
          ...mensagemRecente,
          apagadaParaTodos: true,
          dataExclusao: new Date(),
        });
      prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteMessage(10, 500, {
        modo: ModoExclusaoMensagem.PARA_TODOS,
      });

      expect(prisma.mensagem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 500,
          remetenteId: 10,
          apagadaParaTodos: false,
        },
        data: {
          apagadaParaTodos: true,
          dataExclusao: expect.any(Date),
        },
      });
      expect(result.conteudo).toBe(DELETED_MESSAGE_TEXT);
      expect(result.apagadaParaTodos).toBe(true);
    });

    it('4. Destinatário tentando apagar para todos -> 403 Forbidden', async () => {
      arrangeUsers();
      prisma.mensagem.findUnique.mockResolvedValue(mensagemRecente);

      await expect(
        service.deleteMessage(20, 500, {
          modo: ModoExclusaoMensagem.PARA_TODOS,
        }),
      ).rejects.toThrow(
        new ForbiddenException(
          'Somente o autor da mensagem pode apagá-la para todos.',
        ),
      );
      expect(prisma.mensagem.updateMany).not.toHaveBeenCalled();
    });

    it('5. Mensagem com mais de 60 minutos -> 400 BadRequest', async () => {
      arrangeUsers();
      const mensagemAntiga = {
        ...mensagemRecente,
        dataCriacao: new Date(Date.now() - 61 * 60 * 1000), // 61 minutos atrás
      };
      prisma.mensagem.findUnique.mockResolvedValue(mensagemAntiga);

      await expect(
        service.deleteMessage(10, 500, {
          modo: ModoExclusaoMensagem.PARA_TODOS,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Mensagens só podem ser apagadas até 60 minutos após o envio.',
        ),
      );
      expect(prisma.mensagem.updateMany).not.toHaveBeenCalled();
    });

    it('6. Mensagem exatamente no limite de 60 minutos é permitida (inclusivo)', async () => {
      arrangeUsers();
      const agoraExato = Date.now();
      const mensagemLimite = {
        ...mensagemRecente,
        dataCriacao: new Date(agoraExato - 60 * 60 * 1000), // exatamente 60 min
      };
      prisma.mensagem.findUnique
        .mockResolvedValueOnce(mensagemLimite)
        .mockResolvedValueOnce({
          ...mensagemLimite,
          apagadaParaTodos: true,
          dataExclusao: new Date(),
        });
      prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteMessage(10, 500, {
        modo: ModoExclusaoMensagem.PARA_TODOS,
      });

      expect(prisma.mensagem.updateMany).toHaveBeenCalled();
      expect(result.apagadaParaTodos).toBe(true);
    });

    it('7. Usuário que não participa tentando apagar -> 404 NotFound', async () => {
      arrangeUsers();
      // Usuário 11 é ativo (Cliente B), mas a mensagem foi entre 10 e 20
      prisma.mensagem.findUnique.mockResolvedValue(mensagemRecente);

      await expect(
        service.deleteMessage(11, 500, {
          modo: ModoExclusaoMensagem.PARA_MIM,
        }),
      ).rejects.toThrow(new NotFoundException('Mensagem não encontrada.'));
      expect(prisma.mensagem.updateMany).not.toHaveBeenCalled();
    });

    it('8. Mensagem já apagada para todos: chamada repetida preserva dataExclusao e retorna sucesso idempotente', async () => {
      arrangeUsers();
      const dataOriginalExclusao = new Date(Date.now() - 5 * 60 * 1000);
      const mensagemJaApagada = {
        ...mensagemRecente,
        apagadaParaTodos: true,
        dataExclusao: dataOriginalExclusao,
      };
      prisma.mensagem.findUnique.mockResolvedValue(mensagemJaApagada);

      const result = await service.deleteMessage(10, 500, {
        modo: ModoExclusaoMensagem.PARA_TODOS,
      });

      // Como já estava apagada, o retorno é imediato e idempotente (sem update no banco)
      expect(prisma.mensagem.updateMany).not.toHaveBeenCalled();
      expect(result.conteudo).toBe(DELETED_MESSAGE_TEXT);
      expect(result.apagadaParaTodos).toBe(true);
    });

    it('8b. Retry após 60 minutos quando a operação já foi concluída retorna sucesso idempotente', async () => {
      arrangeUsers();
      const dataAntigaCriacao = new Date(Date.now() - 75 * 60 * 1000); // enviada há 75 min
      const mensagemJaExcluidaRemetente = {
        ...mensagemRecente,
        dataCriacao: dataAntigaCriacao,
        excluidaPeloRemetente: true,
      };
      prisma.mensagem.findUnique.mockResolvedValue(mensagemJaExcluidaRemetente);

      const result = await service.deleteMessage(10, 500, {
        modo: ModoExclusaoMensagem.PARA_MIM,
      });

      expect(prisma.mensagem.updateMany).not.toHaveBeenCalled();
      expect(result.id).toBe(500);
    });

    it('8c. PARA_MIM seguido de PARA_TODOS: remetente apaga para si e depois apaga para todos com sucesso', async () => {
      arrangeUsers();
      const mensagemExcluidaParaMim = {
        ...mensagemRecente,
        excluidaPeloRemetente: true,
        apagadaParaTodos: false,
        dataExclusao: null,
      };
      prisma.mensagem.findUnique
        .mockResolvedValueOnce(mensagemExcluidaParaMim)
        .mockResolvedValueOnce({
          ...mensagemExcluidaParaMim,
          apagadaParaTodos: true,
          dataExclusao: new Date(),
        });
      prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteMessage(10, 500, {
        modo: ModoExclusaoMensagem.PARA_TODOS,
      });

      expect(prisma.mensagem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 500,
          remetenteId: 10,
          apagadaParaTodos: false,
        },
        data: {
          apagadaParaTodos: true,
          dataExclusao: expect.any(Date),
        },
      });
      expect(result.apagadaParaTodos).toBe(true);
    });

    it('8d. PARA_TODOS seguido de PARA_MIM: participante oculta de sua visão mensagem já apagada globalmente sem alterar dataExclusao', async () => {
      arrangeUsers();
      const dataOriginalExclusao = new Date(Date.now() - 10 * 60 * 1000);
      const mensagemApagadaGlobalmente = {
        ...mensagemRecente,
        apagadaParaTodos: true,
        dataExclusao: dataOriginalExclusao,
        excluidaPeloDestinatario: false,
      };
      prisma.mensagem.findUnique
        .mockResolvedValueOnce(mensagemApagadaGlobalmente)
        .mockResolvedValueOnce({
          ...mensagemApagadaGlobalmente,
          excluidaPeloDestinatario: true,
        });
      prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteMessage(20, 500, {
        modo: ModoExclusaoMensagem.PARA_MIM,
      });

      // Atualiza somente excluidaPeloDestinatario; dataExclusao NÃO é alterada
      expect(prisma.mensagem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 500,
          destinatarioId: 20,
          excluidaPeloDestinatario: false,
        },
        data: {
          excluidaPeloDestinatario: true,
        },
      });
      expect(result.id).toBe(500);
    });

    it('9. Histórico após exclusão: mensagem apagada para mim não aparece; apagada para todos oculta conteúdo original', async () => {
      arrangeUsers();
      arrangeBarberActive(true);
      // O banco filtra excluidaPeloRemetente / excluidaPeloDestinatario na query findMany
      prisma.mensagem.findMany.mockResolvedValue([
        {
          ...messageRow,
          id: 501,
          conteudo: 'Texto original',
          apagadaParaTodos: false,
        },
        {
          ...messageRow,
          id: 502,
          conteudo: 'Segredo antigo',
          apagadaParaTodos: true,
        },
      ]);

      const result = await service.findConversation(10, 20);

      expect(result).toHaveLength(2);
      expect(result[0].conteudo).toBe('Texto original');
      expect(result[1].conteudo).toBe(DELETED_MESSAGE_TEXT);
      expect(result[1].apagadaParaTodos).toBe(true);
    });

    it('10. Última mensagem da conversa ignora mensagem apagada para mim e exibe texto padrão se apagada para todos', async () => {
      arrangeUsers();
      prisma.usuario.findMany.mockResolvedValue([
        {
          id: 20,
          nome: 'Barbeiro A',
          tipoUsuario: TipoUsuario.BARBEIRO,
          barbeiro: { ativo: true },
        },
      ]);
      prisma.mensagem.findMany.mockResolvedValue([
        {
          ...messageRow,
          id: 601,
          destinatarioId: 20,
          remetenteId: 10,
          conteudo: 'Oi',
          apagadaParaTodos: true,
          excluidaPeloRemetente: false,
          excluidaPeloDestinatario: false,
          dataCriacao: new Date('2099-01-01T10:00:00.000Z'),
        },
      ]);

      const result = await service.findConversations(10);

      expect(result).toHaveLength(1);
      expect(result[0].ultimaMensagem).toBe(DELETED_MESSAGE_TEXT);
    });

    it('11. Contador de não lidas não contabiliza mensagens excluídas pelo destinatário', async () => {
      prisma.usuario.findUnique.mockResolvedValue(clientUser);
      prisma.mensagem.count.mockResolvedValue(2);

      const result = await service.unreadCount(10);

      expect(result.count).toBe(2);
      expect(prisma.mensagem.count).toHaveBeenCalledWith({
        where: {
          destinatarioId: 10,
          lida: false,
          excluidaPeloDestinatario: false,
        },
      });
    });

    it('12. Concorrência controlada: chamadas simultâneas utilizam updateMany com condição de estado', async () => {
      arrangeUsers();
      prisma.mensagem.findUnique.mockResolvedValue(mensagemRecente);
      prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

      const [res1, res2] = await Promise.all([
        service.deleteMessage(10, 500, {
          modo: ModoExclusaoMensagem.PARA_MIM,
        }),
        service.deleteMessage(10, 500, {
          modo: ModoExclusaoMensagem.PARA_MIM,
        }),
      ]);

      expect(res1.id).toBe(500);
      expect(res2.id).toBe(500);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.mensagem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 500,
          remetenteId: 10,
          excluidaPeloRemetente: false,
        },
        data: {
          excluidaPeloRemetente: true,
        },
      });
    });

    describe('notificações Socket.IO após exclusão (ETAPA 3)', () => {
      let mockGateway: any;
      let mockModuleRef: any;

      beforeEach(() => {
        mockGateway = {
          notifyMessageDeleted: jest.fn(),
        };
        mockModuleRef = {
          get: jest.fn((token: string) => {
            if (token === 'MESSAGES_GATEWAY') {
              return mockGateway;
            }
            return null;
          }),
        };
        service = new MessagesService(prisma, mockModuleRef);
      });

      it('1. Exclusão PARA_TODOS com persistência bem-sucedida emite message:deleted para remetente e destinatário', async () => {
        arrangeUsers();
        const dataExclusaoEsperada = new Date();
        prisma.mensagem.findUnique
          .mockResolvedValueOnce(mensagemRecente)
          .mockResolvedValueOnce({
            ...mensagemRecente,
            apagadaParaTodos: true,
            dataExclusao: dataExclusaoEsperada,
          });
        prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

        await service.deleteMessage(10, 500, {
          modo: ModoExclusaoMensagem.PARA_TODOS,
        });

        expect(mockGateway.notifyMessageDeleted).toHaveBeenCalledTimes(1);
        expect(mockGateway.notifyMessageDeleted).toHaveBeenCalledWith(
          10,
          20,
          expect.objectContaining({
            messageId: 500,
            apagadaParaTodos: true,
            dataExclusao: dataExclusaoEsperada,
          }),
        );
      });

      it('2. Exclusão PARA_MIM não emite evento Socket.IO para o outro participante', async () => {
        arrangeUsers();
        prisma.mensagem.findUnique
          .mockResolvedValueOnce(mensagemRecente)
          .mockResolvedValueOnce({
            ...mensagemRecente,
            excluidaPeloRemetente: true,
          });
        prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

        await service.deleteMessage(10, 500, {
          modo: ModoExclusaoMensagem.PARA_MIM,
        });

        expect(mockGateway.notifyMessageDeleted).not.toHaveBeenCalled();
      });

      it('3. Exclusão PARA_TODOS repetida (idempotente) não emite eventos duplicados', async () => {
        arrangeUsers();
        const mensagemJaApagada = {
          ...mensagemRecente,
          apagadaParaTodos: true,
          dataExclusao: new Date(Date.now() - 5 * 60 * 1000),
        };
        prisma.mensagem.findUnique.mockResolvedValue(mensagemJaApagada);

        await service.deleteMessage(10, 500, {
          modo: ModoExclusaoMensagem.PARA_TODOS,
        });

        expect(mockGateway.notifyMessageDeleted).not.toHaveBeenCalled();
      });

      it('4. Falha na persistência (transação rejeitada) não emite evento Socket.IO', async () => {
        arrangeUsers();
        prisma.mensagem.findUnique.mockResolvedValue(mensagemRecente);
        prisma.$transaction.mockRejectedValueOnce(
          new Error('Falha de banco na transação'),
        );

        await expect(
          service.deleteMessage(10, 500, {
            modo: ModoExclusaoMensagem.PARA_TODOS,
          }),
        ).rejects.toThrow('Falha de banco na transação');

        expect(mockGateway.notifyMessageDeleted).not.toHaveBeenCalled();
      });

      it('5. Usuário que não participa da conversa não consegue provocar emissão de eventos', async () => {
        arrangeUsers();
        prisma.mensagem.findUnique.mockResolvedValue(mensagemRecente);

        // Usuário 11 não é nem remetente (10) nem destinatário (20)
        await expect(
          service.deleteMessage(11, 500, {
            modo: ModoExclusaoMensagem.PARA_TODOS,
          }),
        ).rejects.toThrow(NotFoundException);

        expect(mockGateway.notifyMessageDeleted).not.toHaveBeenCalled();
      });

      it('6. O payload do evento de exclusão não contém o conteúdo original da mensagem', async () => {
        arrangeUsers();
        prisma.mensagem.findUnique
          .mockResolvedValueOnce(mensagemRecente)
          .mockResolvedValueOnce({
            ...mensagemRecente,
            apagadaParaTodos: true,
            dataExclusao: new Date(),
          });
        prisma.mensagem.updateMany.mockResolvedValue({ count: 1 });

        await service.deleteMessage(10, 500, {
          modo: ModoExclusaoMensagem.PARA_TODOS,
        });

        expect(mockGateway.notifyMessageDeleted).toHaveBeenCalledTimes(1);
        const [remetenteId, destinatarioId, payload] =
          mockGateway.notifyMessageDeleted.mock.calls[0];

        expect(remetenteId).toBe(10);
        expect(destinatarioId).toBe(20);
        expect(payload).not.toHaveProperty('conteudo');
        expect(payload).toEqual({
          messageId: 500,
          apagadaParaTodos: true,
          dataExclusao: expect.any(Date),
        });
      });
    });
  });
});
