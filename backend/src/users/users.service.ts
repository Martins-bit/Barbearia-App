import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { TipoUsuario } from '../generated/prisma/enums';
import { normalizeEmail } from '../common/utils/email.util';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { BarberResponseDto } from '../barbers/dto/barber-response.dto';
import {
  dateKeyFromUtcMidnight,
  formatLocalHHmm,
} from '../schedule/tz.util';

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
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async exportPersonalData(userId: number): Promise<PersonalDataExport> {
    const user = await this.prisma.usuario.findUnique({
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
            horarios: {
              select: {
                diaSemana: true,
                horaInicio: true,
                horaFim: true,
                ativo: true,
              },
              orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
            },
            bloqueios: {
              select: {
                data: true,
                horaInicio: true,
                horaFim: true,
                ativo: true,
                dataCriacao: true,
              },
              orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }],
            },
            emergencias: {
              select: {
                dataInicio: true,
                dataFim: true,
                status: true,
                dataCriacao: true,
              },
              orderBy: { dataInicio: 'asc' },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const appointmentOwnership = [
      ...(user.cliente ? [{ clienteId: user.cliente.id }] : []),
      ...(user.barbeiro ? [{ barbeiroId: user.barbeiro.id }] : []),
    ];
    const waitlistOwnership = [
      ...(user.cliente ? [{ clienteId: user.cliente.id }] : []),
      ...(user.barbeiro ? [{ barbeiroId: user.barbeiro.id }] : []),
    ];
    const counterpart =
      user.tipoUsuario === TipoUsuario.CLIENTE
        ? {
            ativo: true,
            tipoUsuario: TipoUsuario.BARBEIRO,
            barbeiro: { is: { ativo: true } },
          }
        : { ativo: true, tipoUsuario: TipoUsuario.CLIENTE };

    const [appointments, waitlist, messages, notifications] =
      await Promise.all([
        this.prisma.agendamento.findMany({
          where: { OR: appointmentOwnership },
          orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }, { id: 'asc' }],
          select: {
            data: true,
            horaInicio: true,
            horaFim: true,
            status: true,
            dataCriacao: true,
            dataAtualizacao: true,
            servico: {
              select: { nome: true, duracaoMinutos: true },
            },
          },
        }),
        this.prisma.listaEspera.findMany({
          where: { OR: waitlistOwnership },
          orderBy: [{ dataDesejada: 'asc' }, { dataEntrada: 'asc' }, { id: 'asc' }],
          select: {
            dataDesejada: true,
            horaInicio: true,
            horaFim: true,
            status: true,
            dataEntrada: true,
            dataAtualizacao: true,
            servico: { select: { nome: true } },
            claims: {
              select: {
                data: true,
                horaInicio: true,
                horaFim: true,
                status: true,
                expiraEm: true,
                dataCriacao: true,
              },
              orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
            },
          },
        }),
        this.prisma.mensagem.findMany({
          where: {
            apagadaParaTodos: false,
            OR: [
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
            ],
          },
          orderBy: [{ dataCriacao: 'asc' }, { id: 'asc' }],
          select: {
            remetenteId: true,
            lida: true,
            dataCriacao: true,
            dataLeitura: true,
            apagadaParaTodos: true,
            dataExclusao: true,
          },
        }),
        this.prisma.notificacao.findMany({
          where: { usuarioId: userId, limpa: false },
          orderBy: [{ dataCriacao: 'desc' }, { id: 'desc' }],
          select: {
            tipo: true,
            lida: true,
            dataCriacao: true,
            dataLeitura: true,
            claim: {
              select: { status: true, expiraEm: true },
            },
          },
        }),
      ]);

    const barberProfile = user.barbeiro
      ? {
          ativo: user.barbeiro.ativo,
          criadoEm: user.barbeiro.dataCriacao.toISOString(),
          atualizadoEm: user.barbeiro.dataAtualizacao.toISOString(),
          horarios: user.barbeiro.horarios,
          bloqueios: user.barbeiro.bloqueios.map((block) => ({
            data: dateKeyFromUtcMidnight(block.data),
            horaInicio: formatLocalHHmm(block.horaInicio),
            horaFim: formatLocalHHmm(block.horaFim),
            ativo: block.ativo,
            dataCriacao: block.dataCriacao.toISOString(),
          })),
          emergencias: user.barbeiro.emergencias.map((emergency) => ({
            dataInicio: emergency.dataInicio.toISOString(),
            dataFim: emergency.dataFim.toISOString(),
            status: emergency.status,
            dataCriacao: emergency.dataCriacao.toISOString(),
          })),
        }
      : user.cliente
        ? {
            criadoEm: user.cliente.dataCriacao.toISOString(),
            atualizadoEm: user.cliente.dataAtualizacao.toISOString(),
          }
        : {};

    return {
      formato: 'Barbearia-App personal data v1',
      geradoEm: new Date().toISOString(),
      limitacoes: [
        'O conteúdo das mensagens, observações de agendamentos, motivos de bloqueios/emergências e textos livres de notificações foram omitidos para reduzir a exposição de dados de terceiros; o escopo ainda depende de decisão do responsável pelo tratamento.',
        'Mensagens apagadas para todos ou ocultadas para este usuário não são incluídas.',
        'Tokens, hashes de senha, identificadores internos de autenticação, credenciais e segredos não são incluídos.',
        'Solicitações de titulares e preferências não persistidas não estão disponíveis para exportação.',
        'Notificações já limpas não são incluídas, pois não são exibidas pelo endpoint atual do usuário.',
      ],
      conta: {
        nome: user.nome,
        telefone: user.telefone,
        email: user.email,
        tipoUsuario: user.tipoUsuario,
        ativo: user.ativo,
        criadoEm: user.dataCriacao.toISOString(),
        atualizadoEm: user.dataAtualizacao.toISOString(),
        confirmacaoEmail: {
          confirmadoEm: user.emailVerificadoEm?.toISOString() ?? null,
          confirmacaoObrigatoria: user.emailConfirmacaoObrigatoria,
        },
        perfil: barberProfile,
      },
      agendamentos: appointments.map((appointment) => ({
        data: dateKeyFromUtcMidnight(appointment.data),
        horaInicio: formatLocalHHmm(appointment.horaInicio),
        horaFim: formatLocalHHmm(appointment.horaFim),
        status: appointment.status,
        criadoEm: appointment.dataCriacao.toISOString(),
        atualizadoEm: appointment.dataAtualizacao.toISOString(),
        servico: appointment.servico,
      })),
      listaEspera: waitlist.map((entry) => ({
        dataDesejada: dateKeyFromUtcMidnight(entry.dataDesejada),
        horaInicio: entry.horaInicio,
        horaFim: entry.horaFim,
        status: entry.status,
        dataEntrada: entry.dataEntrada.toISOString(),
        atualizadoEm: entry.dataAtualizacao.toISOString(),
        servico: entry.servico,
        claims: entry.claims.map((claim) => ({
          data: dateKeyFromUtcMidnight(claim.data),
          horaInicio: claim.horaInicio,
          horaFim: claim.horaFim,
          status: claim.status,
          expiraEm: claim.expiraEm.toISOString(),
          criadoEm: claim.dataCriacao.toISOString(),
        })),
      })),
      mensagens: {
        conteudoIncluido: false,
        registros: messages.map((message) => ({
          direcao: message.remetenteId === userId ? 'ENVIADA' : 'RECEBIDA',
          dataCriacao: message.dataCriacao.toISOString(),
          dataLeitura: message.dataLeitura?.toISOString() ?? null,
          lida: message.lida,
          apagadaParaTodos: message.apagadaParaTodos,
          dataExclusao: message.dataExclusao?.toISOString() ?? null,
        })),
      },
      notificacoes: notifications.map((notification) => ({
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
      })),
    };
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
  async updateUser(id: number, data: UpdateUserDto): Promise<UserResponseDto> {
    const existingUser = await this.prisma.usuario.findUnique({
      where: { id },
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
      updates.email =
        data.email === null ? null : normalizeEmail(data.email);
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException(
        'Nenhum campo válido informado para atualização.',
      );
    }

    // 2) Conflito de unicidade: verifica-se antes a escrita, mantendo a
    //    consistência same-pattern do cadastro (register).
    const telefoneAlvo =
      updates.telefone !== undefined ? updates.telefone : existingUser.telefone;
    if (telefoneAlvo !== existingUser.telefone) {
      const pegouTelefone = await this.prisma.usuario.findUnique({
        where: { telefone: telefoneAlvo },
      });
      if (pegouTelefone && pegouTelefone.id !== id) {
        throw new ConflictException('Telefone já cadastrado.');
      }
    }

    const currentEmail =
      existingUser.email === null ? null : normalizeEmail(existingUser.email);
    const emailAlvo = updates.email;
    const emailChanged =
      updates.email !== undefined && updates.email !== currentEmail;
    if (
      !emailChanged &&
      updates.email !== undefined &&
      existingUser.email !== null
    ) {
      updates.email = existingUser.email;
    }

    if (emailAlvo !== undefined && emailAlvo !== null) {
      const pegouEmail = await this.prisma.usuario.findFirst({
        where: {
          email: { equals: emailAlvo, mode: 'insensitive' },
          id: { not: id },
        },
        select: { id: true },
      });
      if (pegouEmail) {
        throw new ConflictException('E-mail já cadastrado em outra conta.');
      }
    }

    // 3) Leitura por observador de escrita: caso concorrência gere
    //    PrismaClientKnownRequestError P2002 (email/telefone único), converte
    //    em 409 com mensagem acessível.
    try {
      const usuarioAtualizado = emailChanged
        ? await this.prisma.$transaction(async (transaction) => {
            const updatedUser = await transaction.usuario.update({
              where: { id },
              data: {
                ...updates,
                emailVerificadoEm: null,
                emailConfirmacaoObrigatoria: updates.email !== null,
              },
              select: this.publicUserSelect,
            });
            await transaction.emailVerificationToken.updateMany({
              where: { usuarioId: id, usadoEm: null },
              data: { usadoEm: new Date() },
            });
            await transaction.passwordResetToken.updateMany({
              where: { usuarioId: id, usadoEm: null },
              data: { usadoEm: new Date() },
            });
            return updatedUser;
          })
        : await this.prisma.usuario.update({
            where: { id },
            data: updates,
            select: this.publicUserSelect,
          });

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
            emailConfirmacaoObrigatoria:
              data.requireEmailVerification ?? false,
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
          emailConfirmacaoObrigatoria:
            data.requireEmailVerification ?? false,
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
