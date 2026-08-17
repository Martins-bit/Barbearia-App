export class UserResponseDto {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  tipoUsuario: 'CLIENTE' | 'BARBEIRO';
  ativo: boolean;
  dataCriacao: Date;
  dataAtualizacao: Date;
}
