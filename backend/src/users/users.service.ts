import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoUsuario } from '../generated/prisma/enums';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

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

  private sanitizeUser<T extends Record<string, any>>(usuario: T | null): UserResponseDto | null {
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
      throw new NotFoundException(`Usuário com telefone ${telefone} não encontrado.`);
    }

    return this.sanitizeUser(usuario);
  }

  async findAllInternal(): Promise<UserResponseDto[]> {
    const usuarios = await this.prisma.usuario.findMany({
      select: this.publicUserSelect,
    });

    return usuarios.map((usuario) => this.sanitizeUser(usuario) as UserResponseDto);
  }

  async updateUser(id: number, data: UpdateUserDto): Promise<UserResponseDto> {
    const existingUser = await this.prisma.usuario.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundException(`Usuário com ID ${id} não encontrado.`);
    }

    const usuarioAtualizado = await this.prisma.usuario.update({
      where: { id },
      data,
      select: this.publicUserSelect,
    });

    return this.sanitizeUser(usuarioAtualizado) as UserResponseDto;
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
