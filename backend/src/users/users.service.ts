import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
}
