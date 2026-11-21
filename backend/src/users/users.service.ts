import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  CategoriaSolicitacaoTitular,
  StatusSolicitacaoTitular,
  TipoUsuario,
} from '../generated/prisma/enums';
import { normalizeEmail } from '../common/utils/email.util';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { BarberResponseDto } from '../barbers/dto/barber-response.dto';
import { dateKeyFromUtcMidnight, formatLocalHHmm } from '../schedule/tz.util';
import {
  TemporaryExportCleanupError,
  TemporaryExportStorageService,
  type TemporaryExportFile,
} from './temporary-export-storage.service';

export interface PersonalDataExport {
  formato: 'Barbearia-App personal data v1';
  geradoEm: string;
  limitacoes: string[];
  conta: {
    nome: string;
    telefone: string;
    email: string | null;
    tipoUsuario: TipoUsuario;
    ativo: boolean;
    criadoEm: string;
    atualizadoEm: string;
    confirmacaoEmail: {
      confirmadoEm: string | null;
      confirmacaoObrigatoria: boolean;
    };
    perfil: Record<string, unknown>;
  };
  agendamentos: Array<{
    data: string;
    horaInicio: string;
    horaFim: string;
    status: string;
    criadoEm: string;
    atualizadoEm: string;
    servico: { nome: string; duracaoMinutos: number };
  }>;
  listaEspera: Array<{
    dataDesejada: string;
    horaInicio: string | null;
    horaFim: string | null;
    status: string;
    dataEntrada: string;
    atualizadoEm: string;
    servico: { nome: string };
    claims: Array<{
      data: string;
      horaInicio: string;
      horaFim: string;
      status: string;
      expiraEm: string;
      criadoEm: string;
    }>;
  }>;
  mensagens: {
    conteudoIncluido: false;
    registros: Array<{
      direcao: 'ENVIADA' | 'RECEBIDA';
      dataCriacao: string;
      dataLeitura: string | null;
      lida: boolean;
      apagadaParaTodos: boolean;
      dataExclusao: string | null;
    }>;
  };
  notificacoes: Array<{
    tipo: string;
    lida: boolean;
    dataCriacao: string;
    dataLeitura: string | null;
    claimStatus?: string;
    claimExpiraEm?: string;
  }>;
  solicitacoes: Array<{
    categoria: CategoriaSolicitacaoTitular;
    status: StatusSolicitacaoTitular;
    dataCriacao: string;
  }>;
}

export class PersonalDataExportCancelledError extends Error {
  constructor() {
    super('A geração da exportação foi cancelada.');
    this.name = 'PersonalDataExportCancelledError';
  }
}

const PERSONAL_DATA_EXPORT_PAGE_SIZE = 100;
const PERSONAL_DATA_EXPORT_TRANSACTION_TIMEOUT_MS = 60_000;

type ExportScheduleCursor = {
  diaSemana: number;
  horaInicio: string;
  id: number;
};

type ExportDateAndTimeCursor = {
  data: Date;
  horaInicio: Date;
  id: number;
};

type ExportDateCursor = {
  dataInicio: Date;
  id: number;
};

type ExportWaitlistCursor = {
  dataDesejada: Date;
  dataEntrada: Date;
  id: number;
};

type ExportCreatedAtCursor = {
  dataCriacao: Date;
  id: number;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly temporaryExportStorage: TemporaryExportStorageService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private readonly publicUserSelect = {
    id: true,
    nome: true,
    telefone: true,
    email: true,
    tipoUsuario: true,
    ativo: true,
    dataCriacao: true,
    dataAtualizacao: true,
  } as const;

  private sanitizeUser<T extends Record<string, any>>(
    usuario: T | null,
  ): UserResponseDto | null {
    if (!usuario) {
      return null;
    }

    const { senhaHash: _senhaHash, ...publicUser } = usuario;
    return publicUser as unknown as UserResponseDto;
  }

  async findById(id: number): Promise<UserResponseDto | null> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id },
      select: {
        ...this.publicUserSelect,
        emailVerificadoEm: true,
      },
    });

    if (!usuario) {
      throw new NotFoundException(`Usuário com ID ${id} não encontrado.`);
    }

    return this.sanitizeUser(usuario);
  }

  async exportPersonalData(
    userId: number,
    signal?: AbortSignal,
  ): Promise<TemporaryExportFile> {
    return this.exportPersonalDataToTemporaryFile(userId, signal);
  }

  async exportPersonalDataToTemporaryFile(
    userId: number,
    signal?: AbortSignal,
  ): Promise<TemporaryExportFile> {
    this.throwIfExportCancelled(signal);
    const file = await this.temporaryExportStorage.create(signal);

    try {
      await this.prisma.$transaction(
        (transaction) =>
          this.writePersonalDataExport(transaction, userId, file, signal),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: PERSONAL_DATA_EXPORT_TRANSACTION_TIMEOUT_MS,
        },
      );
      this.throwIfExportCancelled(signal);
      await file.finalize();
      return file;
    } catch (error) {
      try {
        await file.cancel();
      } catch (cleanupError) {
        throw new TemporaryExportCleanupError([error, cleanupError]);
      }
      throw error instanceof TemporaryExportCleanupError
        ? (error.errors[0] ?? error)
        : error;
    }
  }

  private async writePersonalDataExport(
    transaction: Prisma.TransactionClient,
    userId: number,
    file: TemporaryExportFile,
    signal?: AbortSignal,
  ): Promise<void> {
    const write = async (value: string): Promise<void> => {
      this.throwIfExportCancelled(signal);
      await file.write(Buffer.from(value, 'utf8'));
      this.throwIfExportCancelled(signal);
    };
    const writeJson = (value: unknown): Promise<void> => {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new TypeError(
          'Não foi possível serializar um trecho da exportação.',
        );
      }
      return write(serialized);
    };

    this.throwIfExportCancelled(signal);
    const user = await transaction.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nome: true,
        telefone: true,
        email: true,
        emailVerificadoEm: true,
        emailConfirmacaoObrigatoria: true,
        tipoUsuario: true,
        ativo: true,
        dataCriacao: true,
        dataAtualizacao: true,
        cliente: {
          select: {
            id: true,
            dataCriacao: true,
            dataAtualizacao: true,
          },
        },
        barbeiro: {
          select: {
            id: true,
            ativo: true,
            dataCriacao: true,
            dataAtualizacao: true,
          },
        },
      },
    });
    this.throwIfExportCancelled(signal);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    await write(
      `{"formato":${JSON.stringify('Barbearia-App personal data v1')},` +
        `"geradoEm":${JSON.stringify(new Date().toISOString())},` +
        `"limitacoes":${JSON.stringify([
          'O conteúdo das mensagens, observações de agendamentos, motivos de bloqueios/emergências e textos livres de notificações foram omitidos para reduzir a exposição de dados de terceiros; o escopo ainda depende de decisão do responsável pelo tratamento.',
          'Mensagens apagadas para todos ou ocultadas para este usuário não são incluídas.',
          'Tokens, hashes de senha, identificadores internos de autenticação, credenciais e segredos não são incluídos.',
          'Preferências não persistidas não estão disponíveis para exportação.',
          'Notificações já limpas não são incluídas, pois não são exibidas pelo endpoint atual do usuário.',
        ])},"conta":{` +
        `"nome":${JSON.stringify(user.nome)},` +
        `"telefone":${JSON.stringify(user.telefone)},` +
        `"email":${JSON.stringify(user.email)},` +
        `"tipoUsuario":${JSON.stringify(user.tipoUsuario)},` +
        `"ativo":${JSON.stringify(user.ativo)},` +
        `"criadoEm":${JSON.stringify(user.dataCriacao.toISOString())},` +
        `"atualizadoEm":${JSON.stringify(user.dataAtualizacao.toISOString())},` +
        `"confirmacaoEmail":${JSON.stringify({
          confirmadoEm: user.emailVerificadoEm?.toISOString() ?? null,
          confirmacaoObrigatoria: user.emailConfirmacaoObrigatoria,
        })},"perfil":`,
    );

    if (user.barbeiro) {
      const barberId = user.barbeiro.id;
      await write(
        `{"ativo":${JSON.stringify(user.barbeiro.ativo)},` +
          `"criadoEm":${JSON.stringify(user.barbeiro.dataCriacao.toISOString())},` +
          `"atualizadoEm":${JSON.stringify(user.barbeiro.dataAtualizacao.toISOString())},` +
          '"horarios":',
      );
      await this.writePagedExportArray(
        file,
        signal,
        (cursor: ExportScheduleCursor | undefined) =>
          transaction.horarioFuncionamento.findMany({
            where: cursor
              ? {
                  barbeiroId: barberId,
                  OR: [
                    { diaSemana: { gt: cursor.diaSemana } },
                    {
                      diaSemana: cursor.diaSemana,
                      horaInicio: { gt: cursor.horaInicio },
                    },
                    {
                      diaSemana: cursor.diaSemana,
                      horaInicio: cursor.horaInicio,
                      id: { gt: cursor.id },
                    },
                  ],
                }
              : { barbeiroId: barberId },
            orderBy: [
              { diaSemana: 'asc' },
              { horaInicio: 'asc' },
              { id: 'asc' },
            ],
            take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
            select: {
              id: true,
              diaSemana: true,
              horaInicio: true,
              horaFim: true,
              ativo: true,
            },
          }),
        (hour) => ({
          diaSemana: hour.diaSemana,
          horaInicio: hour.horaInicio,
          id: hour.id,
        }),
        (hour) =>
          writeJson({
            diaSemana: hour.diaSemana,
            horaInicio: hour.horaInicio,
            horaFim: hour.horaFim,
            ativo: hour.ativo,
          }),
      );
      await write(',"bloqueios":');
      await this.writePagedExportArray(
        file,
        signal,
        (cursor: ExportDateAndTimeCursor | undefined) =>
          transaction.bloqueioAgenda.findMany({
            where: cursor
              ? {
                  barbeiroId: barberId,
                  OR: [
                    { data: { gt: cursor.data } },
                    {
                      data: cursor.data,
                      horaInicio: { gt: cursor.horaInicio },
                    },
                    {
                      data: cursor.data,
                      horaInicio: cursor.horaInicio,
                      id: { gt: cursor.id },
                    },
                  ],
                }
              : { barbeiroId: barberId },
            orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }, { id: 'asc' }],
            take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
            select: {
              id: true,
              data: true,
              horaInicio: true,
              horaFim: true,
              ativo: true,
              dataCriacao: true,
            },
          }),
        (block) => ({
          data: block.data,
          horaInicio: block.horaInicio,
          id: block.id,
        }),
        (block) =>
          writeJson({
            data: dateKeyFromUtcMidnight(block.data),
            horaInicio: formatLocalHHmm(block.horaInicio),
            horaFim: formatLocalHHmm(block.horaFim),
            ativo: block.ativo,
            dataCriacao: block.dataCriacao.toISOString(),
          }),
      );
      await write(',"emergencias":');
      await this.writePagedExportArray(
        file,
        signal,
        (cursor: ExportDateCursor | undefined) =>
          transaction.emergencia.findMany({
            where: cursor
              ? {
                  barbeiroId: barberId,
                  OR: [
                    { dataInicio: { gt: cursor.dataInicio } },
                    {
                      dataInicio: cursor.dataInicio,
                      id: { gt: cursor.id },
                    },
                  ],
                }
              : { barbeiroId: barberId },
            orderBy: [{ dataInicio: 'asc' }, { id: 'asc' }],
            take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
            select: {
              id: true,
              dataInicio: true,
              dataFim: true,
              status: true,
              dataCriacao: true,
            },
          }),
        (emergency) => ({
          dataInicio: emergency.dataInicio,
          id: emergency.id,
        }),
        (emergency) =>
          writeJson({
            dataInicio: emergency.dataInicio.toISOString(),
            dataFim: emergency.dataFim.toISOString(),
            status: emergency.status,
            dataCriacao: emergency.dataCriacao.toISOString(),
          }),
      );
      await write('}');
    } else {
      await writeJson(
        user.cliente
          ? {
              criadoEm: user.cliente.dataCriacao.toISOString(),
              atualizadoEm: user.cliente.dataAtualizacao.toISOString(),
            }
          : {},
      );
    }

    await write('},"agendamentos":');
    const ownership = [
      ...(user.cliente ? [{ clienteId: user.cliente.id }] : []),
      ...(user.barbeiro ? [{ barbeiroId: user.barbeiro.id }] : []),
    ];
    await this.writePagedExportArray(
      file,
      signal,
      (cursor: ExportDateAndTimeCursor | undefined) =>
        transaction.agendamento.findMany({
          where: cursor
            ? {
                AND: [
                  { OR: ownership },
                  {
                    OR: [
                      { data: { gt: cursor.data } },
                      {
                        data: cursor.data,
                        horaInicio: { gt: cursor.horaInicio },
                      },
                      {
                        data: cursor.data,
                        horaInicio: cursor.horaInicio,
                        id: { gt: cursor.id },
                      },
                    ],
                  },
                ],
              }
            : { OR: ownership },
          orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }, { id: 'asc' }],
          take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
          select: {
            id: true,
            data: true,
            horaInicio: true,
            horaFim: true,
            status: true,
            dataCriacao: true,
            dataAtualizacao: true,
            servico: { select: { nome: true, duracaoMinutos: true } },
          },
        }),
      (appointment) => ({
        data: appointment.data,
        horaInicio: appointment.horaInicio,
        id: appointment.id,
      }),
      (appointment) =>
        writeJson({
          data: dateKeyFromUtcMidnight(appointment.data),
          horaInicio: formatLocalHHmm(appointment.horaInicio),
          horaFim: formatLocalHHmm(appointment.horaFim),
          status: appointment.status,
          criadoEm: appointment.dataCriacao.toISOString(),
          atualizadoEm: appointment.dataAtualizacao.toISOString(),
          servico: appointment.servico,
        }),
    );

    await write(',"listaEspera":');
    await this.writePagedExportArray(
      file,
      signal,
      (cursor: ExportWaitlistCursor | undefined) =>
        transaction.listaEspera.findMany({
          where: cursor
            ? {
                AND: [
                  { OR: ownership },
                  {
                    OR: [
                      { dataDesejada: { gt: cursor.dataDesejada } },
                      {
                        dataDesejada: cursor.dataDesejada,
                        dataEntrada: { gt: cursor.dataEntrada },
                      },
                      {
                        dataDesejada: cursor.dataDesejada,
                        dataEntrada: cursor.dataEntrada,
                        id: { gt: cursor.id },
                      },
                    ],
                  },
                ],
              }
            : { OR: ownership },
          orderBy: [
            { dataDesejada: 'asc' },
            { dataEntrada: 'asc' },
            { id: 'asc' },
          ],
          take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
          select: {
            id: true,
            dataDesejada: true,
            horaInicio: true,
            horaFim: true,
            status: true,
            dataEntrada: true,
            dataAtualizacao: true,
            servico: { select: { nome: true } },
          },
        }),
      (entry) => ({
        dataDesejada: entry.dataDesejada,
        dataEntrada: entry.dataEntrada,
        id: entry.id,
      }),
      async (entry) => {
        const base = JSON.stringify({
          dataDesejada: dateKeyFromUtcMidnight(entry.dataDesejada),
          horaInicio: entry.horaInicio,
          horaFim: entry.horaFim,
          status: entry.status,
          dataEntrada: entry.dataEntrada.toISOString(),
          atualizadoEm: entry.dataAtualizacao.toISOString(),
          servico: entry.servico,
        });
        await write(`${base.slice(0, -1)},"claims":`);
        await this.writePagedExportArray(
          file,
          signal,
          (cursor: ExportCreatedAtCursor | undefined) =>
            transaction.waitlistClaim.findMany({
              where: {
                listaEsperaId: entry.id,
                ...(cursor
                  ? {
                      OR: [
                        { dataCriacao: { gt: cursor.dataCriacao } },
                        {
                          dataCriacao: cursor.dataCriacao,
                          id: { gt: cursor.id },
                        },
                      ],
                    }
                  : {}),
              },
              orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
              take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
              select: {
                id: true,
                data: true,
                horaInicio: true,
                horaFim: true,
                status: true,
                expiraEm: true,
                dataCriacao: true,
              },
            }),
          (claim) => ({ dataCriacao: claim.dataCriacao, id: claim.id }),
          (claim) =>
            writeJson({
              data: dateKeyFromUtcMidnight(claim.data),
              horaInicio: claim.horaInicio,
              horaFim: claim.horaFim,
              status: claim.status,
              expiraEm: claim.expiraEm.toISOString(),
              criadoEm: claim.dataCriacao.toISOString(),
            }),
        );
        await write('}');
      },
    );

    const counterpart =
      user.tipoUsuario === TipoUsuario.CLIENTE
        ? {
            ativo: true,
            tipoUsuario: TipoUsuario.BARBEIRO,
            barbeiro: { is: { ativo: true } },
          }
        : { ativo: true, tipoUsuario: TipoUsuario.CLIENTE };
    const messageOwnership = [
      {
        remetenteId: userId,
        excluidaPeloRemetente: false,
        destinatario: { is: counterpart },
      },
      {
        destinatarioId: userId,
        excluidaPeloDestinatario: false,
        remetente: { is: counterpart },
      },
    ];
    await write(',"mensagens":{"conteudoIncluido":false,"registros":');
    await this.writePagedExportArray(
      file,
      signal,
      (cursor: ExportCreatedAtCursor | undefined) =>
        transaction.mensagem.findMany({
          where: {
            apagadaParaTodos: false,
            OR: messageOwnership,
            ...(cursor
              ? {
                  AND: [
                    {
                      OR: [
                        { dataCriacao: { gt: cursor.dataCriacao } },
                        {
                          dataCriacao: cursor.dataCriacao,
                          id: { gt: cursor.id },
                        },
                      ],
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
          take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
          select: {
            id: true,
            remetenteId: true,
            lida: true,
            dataCriacao: true,
            dataLeitura: true,
            apagadaParaTodos: true,
            dataExclusao: true,
          },
        }),
      (message) => ({ dataCriacao: message.dataCriacao, id: message.id }),
      (message) =>
        writeJson({
          direcao: message.remetenteId === userId ? 'ENVIADA' : 'RECEBIDA',
          dataCriacao: message.dataCriacao.toISOString(),
          dataLeitura: message.dataLeitura?.toISOString() ?? null,
          lida: message.lida,
          apagadaParaTodos: message.apagadaParaTodos,
          dataExclusao: message.dataExclusao?.toISOString() ?? null,
        }),
    );
    await write('},"notificacoes":');
    await this.writePagedExportArray(
      file,
      signal,
      (cursor: ExportCreatedAtCursor | undefined) =>
        transaction.notificacao.findMany({
          where: {
            usuarioId: userId,
            limpa: false,
            ...(cursor
              ? {
                  OR: [
                    { dataCriacao: { lt: cursor.dataCriacao } },
                    {
                      dataCriacao: cursor.dataCriacao,
                      id: { lt: cursor.id },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ dataCriacao: 'desc' }, { id: 'desc' }],
          take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
          select: {
            id: true,
            tipo: true,
            lida: true,
            dataCriacao: true,
            dataLeitura: true,
            claim: { select: { status: true, expiraEm: true } },
          },
        }),
      (notification) => ({
        dataCriacao: notification.dataCriacao,
        id: notification.id,
      }),
      (notification) => {
        const serialized = JSON.stringify({
          tipo: notification.tipo,
          lida: notification.lida,
          dataCriacao: notification.dataCriacao.toISOString(),
          dataLeitura: notification.dataLeitura?.toISOString() ?? null,
          ...(notification.claim
            ? {
                claimStatus: notification.claim.status,
                claimExpiraEm: notification.claim.expiraEm.toISOString(),
              }
            : {}),
        });
        return write(serialized);
      },
    );
    await write(',"solicitacoes":');
    await this.writePagedExportArray(
      file,
      signal,
      (cursor: ExportCreatedAtCursor | undefined) =>
        transaction.solicitacaoTitular.findMany({
          where: {
            titularId: userId,
            ...(cursor
              ? {
                  OR: [
                    { dataCriacao: { gt: cursor.dataCriacao } },
                    {
                      dataCriacao: cursor.dataCriacao,
                      id: { gt: cursor.id },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
          take: PERSONAL_DATA_EXPORT_PAGE_SIZE,
          select: {
            id: true,
            categoria: true,
            status: true,
            dataCriacao: true,
          },
        }),
      (request) => ({ dataCriacao: request.dataCriacao, id: request.id }),
      (request) =>
        writeJson({
          categoria: request.categoria,
          status: request.status,
          dataCriacao: request.dataCriacao.toISOString(),
        }),
    );
    await write('}');
  }

  private async writePagedExportArray<T, TCursor>(
    file: TemporaryExportFile,
    signal: AbortSignal | undefined,
    fetchPage: (cursor: TCursor | undefined) => Promise<T[]>,
    getCursor: (last: T) => TCursor,
    writeRow: (row: T) => Promise<void>,
  ): Promise<void> {
    const write = async (value: string): Promise<void> => {
      this.throwIfExportCancelled(signal);
      await file.write(Buffer.from(value, 'utf8'));
      this.throwIfExportCancelled(signal);
    };
    await write('[');
    let cursor: TCursor | undefined;
    let first = true;

    while (true) {
      this.throwIfExportCancelled(signal);
      const page = await fetchPage(cursor);
      this.throwIfExportCancelled(signal);

      for (const row of page) {
        this.throwIfExportCancelled(signal);
        if (!first) {
          await write(',');
        }
        await writeRow(row);
        first = false;
      }

      if (page.length < PERSONAL_DATA_EXPORT_PAGE_SIZE) {
        break;
      }
      const last = page[page.length - 1];
      if (!last) {
        break;
      }
      cursor = getCursor(last);
    }

    await write(']');
  }

  private throwIfExportCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new PersonalDataExportCancelledError();
    }
  }

  async findAuthorizationStateById(userId: number): Promise<{
    id: number;
    ativo: boolean;
    authVersion: number;
    emailConfirmacaoObrigatoria: boolean;
    tipoUsuario: TipoUsuario;
    barbeiro: { ativo: boolean } | null;
  } | null> {
    return this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        ativo: true,
        authVersion: true,
        emailConfirmacaoObrigatoria: true,
        tipoUsuario: true,
        barbeiro: {
          select: {
            ativo: true,
          },
        },
      },
    });
  }

  async findAuthVersionById(userId: number): Promise<{
    id: number;
    authVersion: number;
    emailConfirmacaoObrigatoria: boolean;
  } | null> {
    return this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        authVersion: true,
        emailConfirmacaoObrigatoria: true,
      },
    });
  }

  async findByPhone(telefone: string): Promise<UserResponseDto | null> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { telefone },
      select: this.publicUserSelect,
    });

    if (!usuario) {
      throw new NotFoundException(
        `Usuário com telefone ${telefone} não encontrado.`,
      );
    }

    return this.sanitizeUser(usuario);
  }

  async findByEmail(email: string): Promise<{ id: number } | null> {
    return this.prisma.usuario.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
  }

  async findByVerifiedEmail(email: string): Promise<UserResponseDto | null> {
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        email,
        emailVerificadoEm: { not: null },
        ativo: true,
      },
      select: this.publicUserSelect,
    });

    return this.sanitizeUser(usuario);
  }

  async findForPasswordRecovery(email: string): Promise<{
    id: number;
    email: string;
    tipoUsuario: TipoUsuario;
  } | null> {
    const matches = await this.prisma.usuario.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
        emailVerificadoEm: { not: null },
        ativo: true,
      },
      select: { id: true, email: true, tipoUsuario: true },
      take: 2,
    });

    if (matches.length !== 1 || !matches[0].email) {
      return null;
    }
    return matches[0] as {
      id: number;
      email: string;
      tipoUsuario: TipoUsuario;
    };
  }

  async findAllInternal(): Promise<UserResponseDto[]> {
    const usuarios = await this.prisma.usuario.findMany({
      select: this.publicUserSelect,
    });

    return usuarios.map(
      (usuario) => this.sanitizeUser(usuario) as UserResponseDto,
    );
  }

  /**
   * Barbeiros ELEGÍVEIS para escolha (GET /barbers): perfil de barbeiro ATIVO
   * E usuário ATIVO. Retorna apenas o mínimo público (id do Barbeiro + nome),
   * sem telefone, e-mail, hash, status ou qualquer dado administrativo.
   * Não há filtro arbitrário: um barbeiro inativo (perfil ou usuário) nunca é
   * listado, e o cliente não pode escolher quem aparece.
   */
  async findActiveBarbers(): Promise<BarberResponseDto[]> {
    const barbeiros = await this.prisma.barbeiro.findMany({
      where: {
        ativo: true,
        usuario: { ativo: true },
      },
      select: {
        id: true,
        usuarioId: true,
        usuario: { select: { nome: true } },
      },
      orderBy: { id: 'asc' },
    });

    return barbeiros.map((barbeiro) => ({
      id: barbeiro.id,
      usuarioId: barbeiro.usuarioId,
      nome: barbeiro.usuario.nome,
    }));
  }

  /**
   * Extrai, de forma segura, o nome do campo em conflito a partir de um erro
   * P2002 do Prisma.
   *
   * O Prisma 7 (com @prisma/adapter-pg) NÃO popula `meta.target`: os dados
   * reais da violação ficam em `meta.driverAdapterError.cause`, com
   * `kind: "UniqueConstraintViolation"` e o índice em `originalMessage`
   * (ex.: `... "Usuario_email_key"`). O campo `constraint` existe no objeto,
   * mas pode vir `undefined` (o Postgres nem sempre expõe `detail`).
   *
   * Formatos legados (`meta.target` como array de strings) continuam
   * suportados, mas nunca são assumidos: qualquer valor que não seja um array
   * de strings é ignorado. Retorna `null` quando o campo não pode ser
   * determinado com segurança.
   */
  private extractUniqueConflictField(error: unknown): string | null {
    const meta = (error as { meta?: Record<string, unknown> })?.meta;
    if (!meta || typeof meta !== 'object') {
      return null;
    }

    // Formato legado: meta.target = ['email', 'telefone']
    const target = meta.target;
    if (Array.isArray(target)) {
      const names = target.filter(
        (item): item is string => typeof item === 'string',
      );
      if (names.includes('email')) return 'email';
      if (names.includes('telefone')) return 'telefone';
    }

    // Formato Prisma 7 + driver adapter: meta.driverAdapterError.cause
    const cause = (
      meta.driverAdapterError as { cause?: Record<string, unknown> } | undefined
    )?.cause;
    if (!cause || typeof cause !== 'object') {
      return null;
    }

    const constraint =
      typeof cause.constraint === 'string' ? cause.constraint : undefined;
    const originalMessage =
      typeof cause.originalMessage === 'string'
        ? cause.originalMessage
        : undefined;

    const evidence = `${constraint ?? ''} ${originalMessage ?? ''}`;
    if (evidence.includes('Usuario_email_key')) return 'email';
    if (evidence.includes('Usuario_telefone_key')) return 'telefone';

    // Fallback: nomes de coluna/índice genéricos (sem assumirem tabela).
    if (/\bemail\b/i.test(evidence)) return 'email';
    if (/\btelefone\b/i.test(evidence)) return 'telefone';

    return null;
  }

  /**
   * Converte um P2002 em 409 com mensagem acessível.
   * O campo só é nomeado quando comprovado; caso contrário usa-se uma
   * mensagem genérica (nunca assumir telefone).
   */
  private buildUniqueConflictException(error: unknown): ConflictException {
    const field = this.extractUniqueConflictField(error);
    if (field === 'email') {
      return new ConflictException(
        'Este e-mail já está em uso por outra conta.',
      );
    }
    if (field === 'telefone') {
      return new ConflictException(
        'Este telefone já está em uso por outra conta.',
      );
    }
    return new ConflictException(
      'Os dados informados já estão em uso por outra conta.',
    );
  }

  /**
   * Atualiza o próprio usuário autenticado.
   *
   * - Campos escritos são EXCLUSIVAMENTE os do UpdateUserDto (nome, telefone,
   *   e-mail). Qualquer outra chave (id, tipoUsuario, ativo, senhaHash...)
   *   é descartada na camada de serviço, como backup do
   *   forbidNonWhitelisted do ValidationPipe global.
   * - Atualização vazia (sem campos definidos) é rejeitada com 400.
   * - Telefone/email duplicados dos outros usuários são tratados como 409
   *   (P2002 do Prisma tratado de forma centralizada).
   */
  async updateUser(
    id: number,
    data: UpdateUserDto,
    expectedAuthVersion?: number,
  ): Promise<UserResponseDto> {
    const existingUser = await this.prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        telefone: true,
        email: true,
        authVersion: true,
      },
    });

    if (!existingUser) {
      throw new NotFoundException(`Usuário com ID ${id} não encontrado.`);
    }

    // 1) Mapa explícito dos campos permitidos e definidos — nada além de
    //    nome/telefone/email chega à consulta do Prisma.
    const updates: { nome?: string; telefone?: string; email?: string | null } =
      {};
    if (data.nome !== undefined) updates.nome = data.nome;
    if (data.telefone !== undefined) updates.telefone = data.telefone;
    if (data.email !== undefined) {
      updates.email = data.email === null ? null : normalizeEmail(data.email);
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException(
        'Nenhum campo válido informado para atualização.',
      );
    }

    const tokenAuthVersion =
      expectedAuthVersion ?? existingUser.authVersion ?? 0;

    try {
      const { usuarioAtualizado, emailChanged } =
        await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id" FROM "Usuario" WHERE "id" = ${id} FOR UPDATE
          `;

          const currentUser = await transaction.usuario.findUnique({
            where: { id },
            select: {
              id: true,
              nome: true,
              telefone: true,
              email: true,
              authVersion: true,
            },
          });

          if (!currentUser) {
            throw new NotFoundException(`Usuário com ID ${id} não encontrado.`);
          }

          const currentAuthVersion = currentUser.authVersion ?? 0;
          if (currentAuthVersion !== tokenAuthVersion) {
            throw new ConflictException(
              'O perfil foi alterado durante a atualização. Atualize os dados e tente novamente.',
            );
          }

          const requestedEmail =
            updates.email === undefined || updates.email === null
              ? updates.email
              : normalizeEmail(updates.email);
          const normalizeNullableEmail = (email: string | null) =>
            email === null ? null : normalizeEmail(email);

          const staleName =
            updates.nome !== undefined &&
            existingUser.nome !== currentUser.nome &&
            updates.nome !== currentUser.nome;
          const stalePhone =
            updates.telefone !== undefined &&
            existingUser.telefone !== currentUser.telefone &&
            updates.telefone !== currentUser.telefone;
          const staleEmail =
            requestedEmail !== undefined &&
            normalizeNullableEmail(existingUser.email) !==
              normalizeNullableEmail(currentUser.email) &&
            normalizeNullableEmail(requestedEmail) !==
              normalizeNullableEmail(currentUser.email);

          if (staleName || stalePhone || staleEmail) {
            throw new ConflictException(
              'O perfil foi alterado durante a atualização. Atualize os dados e tente novamente.',
            );
          }

          const currentEmail = normalizeNullableEmail(currentUser.email);
          const emailChanged =
            requestedEmail !== undefined && requestedEmail !== currentEmail;

          if (
            updates.telefone !== undefined &&
            updates.telefone !== currentUser.telefone
          ) {
            const existingPhone = await transaction.usuario.findUnique({
              where: { telefone: updates.telefone },
              select: { id: true },
            });
            if (existingPhone && existingPhone.id !== id) {
              throw new ConflictException('Telefone já cadastrado.');
            }
          }

          if (emailChanged && requestedEmail !== null) {
            const existingEmail = await transaction.usuario.findFirst({
              where: {
                email: { equals: requestedEmail, mode: 'insensitive' },
                id: { not: id },
              },
              select: { id: true },
            });
            if (existingEmail) {
              throw new ConflictException(
                'E-mail já cadastrado em outra conta.',
              );
            }
          }

          if (updates.email !== undefined && !emailChanged) {
            updates.email = currentUser.email;
          } else if (updates.email !== undefined) {
            updates.email = requestedEmail;
          }

          const updatedUser = await transaction.usuario.update({
            where: { id },
            data: emailChanged
              ? {
                  ...updates,
                  authVersion: { increment: 1 },
                  emailVerificadoEm: null,
                  emailConfirmacaoObrigatoria: updates.email !== null,
                }
              : updates,
            select: this.publicUserSelect,
          });

          if (emailChanged) {
            await transaction.emailVerificationToken.updateMany({
              where: { usuarioId: id, usadoEm: null },
              data: { usadoEm: new Date() },
            });
            await transaction.passwordResetToken.updateMany({
              where: { usuarioId: id, usadoEm: null },
              data: { usadoEm: new Date() },
            });
          }

          return { usuarioAtualizado: updatedUser, emailChanged };
        });

      if (emailChanged) {
        this.revokeWebSocketSessions(id);
      }

      return this.sanitizeUser(usuarioAtualizado) as UserResponseDto;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // DEF-2: `meta.target` não é populado no Prisma 7; o campo em
        // conflito é extraído de forma segura e a mensagem só nomeia o
        // campo quando comprovado (fallback genérico caso contrário).
        throw this.buildUniqueConflictException(error);
      }
      throw error;
    }
  }

  private revokeWebSocketSessions(usuarioId: number): void {
    if (!this.moduleRef) {
      throw new Error('ModuleRef indisponível para revogar sessões WebSocket.');
    }

    const gateway = this.moduleRef.get<{
      revokeUserSessions: (userId: number) => void;
    }>('MESSAGES_GATEWAY', { strict: false });

    if (!gateway || typeof gateway.revokeUserSessions !== 'function') {
      throw new Error(
        'Gateway de mensagens indisponível para revogar sessões.',
      );
    }

    gateway.revokeUserSessions(usuarioId);
  }

  /**
   * MÉTODO INTERNO - NÃO EXPOR EM CONTROLLER
   * Retorna usuário COM senhaHash para autenticação
   * Uso exclusivo: AuthService.login()
   */
  async findByPhoneWithPasswordHash(telefone: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { telefone },
    });

    return usuario;
  }

  /**
   * Cria um novo usuário no banco.
   * IMPORTANTE: Esta operação é atômica quando usada com nested create no Prisma.
   */
  async createUser(data: {
    nome: string;
    telefone: string;
    senhaHash: string;
    tipoUsuario: 'CLIENTE' | 'BARBEIRO';
    email?: string | null;
    requireEmailVerification?: boolean;
  }) {
    try {
      // Para clients, criar usuário + cliente atomicamente
      if (data.tipoUsuario === 'CLIENTE') {
        const usuario = await this.prisma.usuario.create({
          data: {
            nome: data.nome,
            telefone: data.telefone,
            senhaHash: data.senhaHash,
            tipoUsuario: data.tipoUsuario,
            email: data.email || null,
            emailConfirmacaoObrigatoria: data.requireEmailVerification ?? false,
            ativo: true,
            cliente: {
              create: {},
            },
          },
          select: this.publicUserSelect,
        });

        return this.sanitizeUser(usuario) as UserResponseDto;
      }

      // Para barbeiros ou outros tipos, criar apenas usuario
      const usuario = await this.prisma.usuario.create({
        data: {
          nome: data.nome,
          telefone: data.telefone,
          senhaHash: data.senhaHash,
          tipoUsuario: data.tipoUsuario,
          email: data.email || null,
          emailConfirmacaoObrigatoria: data.requireEmailVerification ?? false,
          ativo: true,
        },
        select: this.publicUserSelect,
      });

      return this.sanitizeUser(usuario) as UserResponseDto;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.buildUniqueConflictException(error);
      }
      throw error;
    }
  }
}
