export class UserResponseDto {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  emailVerificadoEm?: Date | null;
  tipoUsuario: 'CLIENTE' | 'BARBEIRO';
  ativo: boolean;
  dataCriacao: Date;
  dataAtualizacao: Date;
}
