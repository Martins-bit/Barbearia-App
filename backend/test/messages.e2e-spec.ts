import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TipoUsuario } from '../src/generated/prisma/enums';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';

interface MessageBody {
  id: number;
  remetenteUsuarioId: number;
  destinatarioUsuarioId: number;
  conteudo: string;
  lida: boolean;
  dataCriacao: string;
  dataLeitura: string | null;
  [key: string]: unknown;
}

 describe('Messages (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let clientAUserId: number;
  let clientBUserId: number;
  let barberAUserId: number;
  let barberBUserId: number;
  let barberBId: number;

  let clientAToken: string;
  let clientBToken: string;
  let barberAToken: string;
  let barberBToken: string;

  const userIds: number[] = [];
  const clientIds: number[] = [];
  const barberIds: number[] = [];
  const messageIds: number[] = [];
  const phoneBase = String(Date.now()).slice(-8);
  const password = 'messages-e2e-password';

  const createClient = async (name: string, phone: string) => {
    const user = await prisma.usuario.create({
      data: {
        nome: name,
        telefone: phone,
        senhaHash: await hashPassword(password),
        tipoUsuario: TipoUsuario.CLIENTE,
        cliente: { create: {} },
      },
      include: { cliente: true },
    });
    userIds.push(user.id);
    clientIds.push(user.cliente!.id);
    return { userId: user.id, phone };
  };

  const createBarber = async (name: string, phone: string) => {
    const user = await prisma.usuario.create({
      data: {
        nome: name,
        telefone: phone,
        senhaHash: await hashPassword(password),
        tipoUsuario: TipoUsuario.BARBEIRO,
        barbeiro: { create: {} },
      },
      include: { barbeiro: true },
    });
    userIds.push(user.id);
    barberIds.push(user.barbeiro!.id);
    return { userId: user.id, barbeiroId: user.barbeiro!.id, phone };
  };

  const login = async (phone: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ telefone: phone, senha: password })
      .expect(200);
    return response.body.token as string;
  };

  const sendMessage = (
    token: string,
    body: Record<string, unknown>,
    expectedStatus: number,
  ) =>
    request(app.getHttpServer())
      .post('/messages')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(expectedStatus);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const clientA = await createClient('Cliente A Messages', `${phoneBase}61`);
    const clientB = await createClient('Cliente B Messages', `${phoneBase}62`);
    const barberA = await createBarber('Barbeiro A Messages', `${phoneBase}63`);
    const barberB = await createBarber('Barbeiro B Messages', `${phoneBase}64`);

    clientAUserId = clientA.userId;
    clientBUserId = clientB.userId;
    barberAUserId = barberA.userId;
    barberBUserId = barberB.userId;
    barberBId = barberB.barbeiroId;

    clientAToken = await login(clientA.phone);
    clientBToken = await login(clientB.phone);
    barberAToken = await login(barberA.phone);
    barberBToken = await login(barberB.phone);
  });

  afterAll(async () => {
    if (prisma) {
      // Mensagem referencia Usuario (FK): apagar antes de cliente/barbeiro.
      await prisma.mensagem.deleteMany({
        where: { OR: [ { id: { in: messageIds } }, { remetenteId: { in: userIds } }, { destinatarioId: { in: userIds } } ] },
      });
      await prisma.barbeiro.deleteMany({ where: { id: { in: barberIds } }});
      await prisma.cliente.deleteMany({ where: { id: { in: clientIds } }});
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } }});
    }
    if (app) {
      await app.close();
    }
  });

  describe('autenticação', () => {
    it('exige autenticação nos três endpoints', async () => {
      await request(app.getHttpServer()).post('/messages').send({}).expect(401);
      await request(app.getHttpServer())
        .get(`/messages/${barberAUserId}`)
        .expect(401);
      await request(app.getHttpServer()).patch('/messages/1/read').expect(401);
    });
  });

  describe('envio', () => {
    it('CLIENTE envia para BARBEIRO com remetente vindo do JWT e sem dados sensíveis', async () => {
      const response = await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId, conteudo: '  Olá, barbeiro!  ' },
        201,
      );
      const message = response.body as MessageBody;

      expect(message).toEqual(
        expect.objectContaining({
          remetenteUsuarioId: clientAUserId,
          destinatarioUsuarioId: barberAUserId,
          conteudo: 'Olá, barbeiro!',
          lida: false,
          dataLeitura: null,
        }),
      );
      expect(message.id).toEqual(expect.any(Number));
      expect(message.dataCriacao).toBeTruthy();
      for (const forbidden of [
        'remetenteId',
        'destinatarioId',
        'senhaHash',
        'telefone',
        'email',
        'remetente',
        'destinatario',
      ]) {
        expect(message[forbidden]).toBeUndefined();
      }
      messageIds.push(message.id);
    });

    it('BARBEIRO ativo responde para CLIENTE', async () => {
      const response = await sendMessage(
        barberAToken,
        { destinatarioId: clientAUserId, conteudo: 'Resposta do barbeiro' },
        201,
      );
      const message = response.body as MessageBody;

      expect(message.remetenteUsuarioId).toBe(barberAUserId);
      expect(message.destinatarioUsuarioId).toBe(clientAUserId);
      messageIds.push(message.id);
    });

    it('não aceita remetenteUsuarioId vindo do frontend (remetente é o do JWT)', async () => {
      const response = await sendMessage(
        clientAToken,
        {
          destinatarioId: barberAUserId,
          conteudo: 'Tentativa de spoof',
          remetenteUsuarioId: barberBUserId,
        },
        400,
      );
      expect(response.body.message).toBeTruthy();

      // Nenhuma mensagem atribuída ao remetente forjado foi persistida.
      expect(
        await prisma.mensagem.count({
          where: { remetenteId: barberBUserId, conteudo: 'Tentativa de spoof' },
        }),
      ).toBe(0);
    });

    it('CLIENTE -> CLIENTE bloqueado', async () => {
      const response = await sendMessage(
        clientAToken,
        { destinatarioId: clientBUserId, conteudo: 'Oi' },
        400,
      );
      expect(response.body.message).toBe(
        'Mensagens são permitidas somente entre cliente e barbeiro.',
      );
    });

    it('BARBEIRO -> BARBEIRO bloqueado', async () => {
      const response = await sendMessage(
        barberAToken,
        { destinatarioId: barberBUserId, conteudo: 'Oi' },
        400,
      );
      expect(response.body.message).toBe(
        'Mensagens são permitidas somente entre cliente e barbeiro.',
      );
    });

    it('mensagem para si mesmo bloqueada', async () => {
      const response = await sendMessage(
        clientAToken,
        { destinatarioId: clientAUserId, conteudo: 'Oi' },
        400,
      );
      expect(response.body.message).toBe(
        'Não é possível enviar mensagem para si mesmo.',
      );
    });

    it('destinatário inexistente e destinatário inativo retornam 404', async () => {
      await sendMessage(
        clientAToken,
        { destinatarioId: 9_999_999, conteudo: 'Oi' },
        404,
      );

      await prisma.usuario.update({
        where: { id: barberBUserId },
        data: { ativo: false },
      });
      await sendMessage(
        clientAToken,
        { destinatarioId: barberBUserId, conteudo: 'Oi' },
        404,
      );
      await prisma.usuario.update({
        where: { id: barberBUserId },
        data: { ativo: true },
      });
    });

    it('barbeiro sem perfil ativo não envia (403) nem recebe (404)', async () => {
      await prisma.barbeiro.update({
        where: { id: barberBId },
        data: { ativo: false },
      });

      await sendMessage(
        barberBToken,
        { destinatarioId: clientAUserId, conteudo: 'Oi' },
        403,
      );
      await sendMessage(
        clientAToken,
        { destinatarioId: barberBUserId, conteudo: 'Oi' },
        404,
      );

      await prisma.barbeiro.update({
        where: { id: barberBId },
        data: { ativo: true },
      });
    });

    it('remetente inativo é bloqueado no guard (401) e não persiste mensagem', async () => {
      await prisma.usuario.update({
        where: { id: clientBUserId },
        data: { ativo: false },
      });

      try {
        await sendMessage(
          clientBToken,
          { destinatarioId: barberAUserId, conteudo: 'Oi' },
          401,
        );
        expect(
          await prisma.mensagem.count({
            where: { remetenteId: clientBUserId },
          }),
        ).toBe(0);
      } finally {
        await prisma.usuario.update({
          where: { id: clientBUserId },
          data: { ativo: true },
        });
      }
    });

    it('valida conteúdo: vazio, só espaços, > 500 e payload inválido', async () => {
      await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId, conteudo: '   ' },
        400,
      );
      await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId, conteudo: '' },
        400,
      );
      await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId, conteudo: 'a'.repeat(501) },
        400,
      );
      await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId, conteudo: ['a', 'b'] },
        400,
      );
      await sendMessage(clientAToken, { destinatarioId: 0, conteudo: 'Oi' }, 400);
      await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId },
        400,
      );
    });

    it('aceita exatamente 500 caracteres', async () => {
      const response = await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId, conteudo: 'b'.repeat(500) },
        201,
      );
      const message = response.body as MessageBody;
      expect(message.conteudo).toHaveLength(500);
      messageIds.push(message.id);
    });
  });

  describe('conversa', () => {
    it('retorna somente as mensagens dos dois participantes em ordem cronológica crescente', async () => {
      const other = await sendMessage(
        clientBToken,
        { destinatarioId: barberAUserId, conteudo: 'Conversa alheia' },
        201,
      );
      messageIds.push((other.body as MessageBody).id);

      const response = await request(app.getHttpServer())
        .get(`/messages/${barberAUserId}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const messages = response.body as MessageBody[];

      expect(messages.length).toBeGreaterThanOrEqual(2);
      for (const message of messages) {
        const pair = [
          message.remetenteUsuarioId,
          message.destinatarioUsuarioId,
        ];
        expect([
          `${clientAUserId}-${barberAUserId}`,
          `${barberAUserId}-${clientAUserId}`,
        ]).toContain(`${pair[0]}-${pair[1]}`);
        expect(message.senhaHash).toBeUndefined();
        expect(message.remetente).toBeUndefined();
        expect(message.destinatario).toBeUndefined();
        expect(message.remetenteId).toBeUndefined();
        expect(message.destinatarioId).toBeUndefined();
      }

      const timestamps = messages.map((message) =>
        new Date(message.dataCriacao).getTime(),
      );
      expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
    });

    it('barbeiro autenticado vê a mesma conversa', async () => {
      const response = await request(app.getHttpServer())
        .get(`/messages/${clientAUserId}`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .expect(200);
      expect((response.body as MessageBody[]).length).toBeGreaterThanOrEqual(2);
    });

    it('conversa consigo mesmo retorna 400 e com perfil igual retorna 404', async () => {
      await request(app.getHttpServer())
        .get(`/messages/${clientAUserId}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get(`/messages/${clientBUserId}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(404);
    });

    it('lista conversas: parceiro do perfil oposto, sem dados sensíveis', async () => {
      const response = await request(app.getHttpServer())
        .get('/messages/conversations')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      const partners = response.body as Array<Record<string, unknown>>;

      expect(partners.length).toBeGreaterThanOrEqual(1);
      const partner = partners.find(
        (item) => item.usuarioId === barberAUserId,
      );
      expect(partner).toBeTruthy();
      expect(partner!.tipoUsuario).toBe(TipoUsuario.BARBEIRO);
      // Apenas usuarioId, nome e tipoUsuario.
      expect(Object.keys(partner!).sort()).toEqual([
        'nome',
        'tipoUsuario',
        'usuarioId',
      ]);
      // Nunca expõe conversa de outro par como se fosse própria.
      expect(
        partners.every(
          (item) => item.tipoUsuario === TipoUsuario.BARBEIRO,
        ),
      ).toBe(true);
    });

    it('lista conversas do barbeiro retorna clientes (perfil oposto)', async () => {
      const response = await request(app.getHttpServer())
        .get('/messages/conversations')
        .set('Authorization', `Bearer ${barberAToken}`)
        .expect(200);
      const partners = response.body as Array<Record<string, unknown>>;

      expect(partners.length).toBeGreaterThanOrEqual(1);
      expect(
        partners.every(
          (item) => item.tipoUsuario === TipoUsuario.CLIENTE,
        ),
      ).toBe(true);
      expect(
        partners.some((item) => item.usuarioId === clientAUserId),
      ).toBe(true);
    });

    it('não retorna conversa de terceiros nem conversa inexistente', async () => {
      const response = await request(app.getHttpServer())
        .get(`/messages/${barberBUserId}`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(200);
      expect(response.body).toEqual([]);

      await request(app.getHttpServer())
        .get('/messages/9999')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(404);
    });

    it('userId inválido na rota retorna 400', async () => {
      await request(app.getHttpServer())
        .get('/messages/abc')
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(400);
    });
  });

  describe('leitura', () => {
    let messageId: number;

    beforeAll(async () => {
      const response = await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId, conteudo: 'Mensagem para leitura' },
        201,
      );
      messageId = (response.body as MessageBody).id;
      messageIds.push(messageId);
    });

    it('somente o destinatário pode marcar como lida', async () => {
      // remetente não marca a própria mensagem
      await request(app.getHttpServer())
        .patch(`/messages/${messageId}/read`)
        .set('Authorization', `Bearer ${clientAToken}`)
        .expect(404);

      // terceiro cliente (mesmo perfil do remetente)
      await request(app.getHttpServer())
        .patch(`/messages/${messageId}/read`)
        .set('Authorization', `Bearer ${clientBToken}`)
        .expect(404);

      // outro barbeiro: perfil correto, dono errado
      await request(app.getHttpServer())
        .patch(`/messages/${messageId}/read`)
        .set('Authorization', `Bearer ${barberBToken}`)
        .expect(404);

      const untouched = await prisma.mensagem.findUnique({
        where: { id: messageId },
      });
      expect(untouched?.lida).toBe(false);
      expect(untouched?.dataLeitura).toBeNull();
    });

    it('destinatário marca como lida e a repetição preserva o primeiro dataLeitura', async () => {
      const first = await request(app.getHttpServer())
        .patch(`/messages/${messageId}/read`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .expect(200);
      const firstBody = first.body as MessageBody;
      expect(firstBody.lida).toBe(true);
      expect(firstBody.dataLeitura).toBeTruthy();

      const second = await request(app.getHttpServer())
        .patch(`/messages/${messageId}/read`)
        .set('Authorization', `Bearer ${barberAToken}`)
        .expect(200);
      const secondBody = second.body as MessageBody;
      expect(secondBody.lida).toBe(true);
      expect(secondBody.dataLeitura).toBe(firstBody.dataLeitura);

      const persisted = await prisma.mensagem.findUnique({
        where: { id: messageId },
      });
      expect(persisted?.dataLeitura?.toISOString()).toBe(firstBody.dataLeitura);
    });

    it('duas leituras concorrentes mantêm um único dataLeitura', async () => {
      const created = await sendMessage(
        clientAToken,
        { destinatarioId: barberAUserId, conteudo: 'Leitura concorrente' },
        201,
      );
      const createdId = (created.body as MessageBody).id;
      messageIds.push(createdId);

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/messages/${createdId}/read`)
          .set('Authorization', `Bearer ${barberAToken}`)
          .expect(200),
        request(app.getHttpServer())
          .patch(`/messages/${createdId}/read`)
          .set('Authorization', `Bearer ${barberAToken}`)
          .expect(200),
      ]);

      const firstBody = first.body as MessageBody;
      const secondBody = second.body as MessageBody;
      expect(firstBody.dataLeitura).toBe(secondBody.dataLeitura);

      const persisted = await prisma.mensagem.findUnique({
        where: { id: createdId },
      });
      expect(persisted?.dataLeitura?.toISOString()).toBe(firstBody.dataLeitura);
    });

    it('mensagem inexistente retorna 404 e id inválido retorna 400', async () => {
      await request(app.getHttpServer())
        .patch('/messages/9999/read')
        .set('Authorization', `Bearer ${barberAToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch('/messages/abc/read')
        .set('Authorization', `Bearer ${barberAToken}`)
        .expect(400);
    });
  });

  it('persistência: nenhuma mensagem para si mesmo e envolvendo apenas usuários de teste', async () => {
    const stored = await prisma.mensagem.findMany({
      where: { id: { in: messageIds } },
      select: { remetenteId: true, destinatarioId: true },
    });
    expect(stored.length).toBe(messageIds.length);
    expect(
      stored.every((message) => message.remetenteId !== message.destinatarioId),
    ).toBe(true);
    expect(
      stored.every(
        (message) =>
          userIds.includes(message.remetenteId) &&
          userIds.includes(message.destinatarioId),
      ),
    ).toBe(true);
  });
});
