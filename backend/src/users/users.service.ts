import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { TipoUsuario } from '../generated/prisma/enums';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { BarberResponseDto } from '../barbers/dto/barber-response.dto';

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
      select: this.publicUserSelect,
    });

    if (!usuario) {
      throw new NotFoundException(`Usuário com ID ${id} não encontrado.`);
    }

    return this.sanitizeUser(usuario);
  }

  async findAuthorizationStateById(userId: number): Promise<{
    id: number;
    ativo: boolean;
    tipoUsuario: TipoUsuario;
    barbeiro: { ativo: boolean } | null;
  } | null> {
    return this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        ativo: true,
        tipoUsuario: true,
        barbeiro: {
          select: {
            ativo: true,
          },
        },
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
    if (data.email !== undefined) updates.email = data.email; // null limpa o e-mail

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

    const emailAlvo =
      updates.email !== undefined ? updates.email : existingUser.email;
    // O pre-check de e-mail só faz sentido para e-mail NÃO nulo:
    // `email` é anulável e vários usuários podem tê-lo `null`.
    // Buscar `null` com findFirst({ email: null }) encontraria QUALQUER
    // usuário sem e-mail e geraria falso 409 (DEF-1).
    if (emailAlvo !== null && emailAlvo !== existingUser.email) {
      // `email` é único: findUnique exige string não nula, então a busca
      // usa findFirst com filtro compatível.
      const pegouEmail = await this.prisma.usuario.findFirst({
        where: { email: emailAlvo },
      });
      if (pegouEmail && pegouEmail.id !== id) {
        // `emailAlvo !== null` garante que `updates.email` não é null aqui.
        throw new ConflictException('E-mail já cadastrado em outra conta.');
      }
    }

    // 3) Leitura por observador de escrita: caso concorrência gere
    //    PrismaClientKnownRequestError P2002 (email/telefone único), converte
    //    em 409 com mensagem acessível.
    try {
      const usuarioAtualizado = await this.prisma.usuario.update({
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
  }) {
    // Para clients, criar usuário + cliente atomicamente
    if (data.tipoUsuario === 'CLIENTE') {
      const usuario = await this.prisma.usuario.create({
        data: {
          nome: data.nome,
          telefone: data.telefone,
          senhaHash: data.senhaHash,
          tipoUsuario: data.tipoUsuario,
          email: data.email || null,
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
        ativo: true,
      },
      select: this.publicUserSelect,
    });

    return this.sanitizeUser(usuario) as UserResponseDto;
  }
}
