export class ServiceResponseDto {
  id: number;
  nome: string;
  descricao: string | null;
  duracaoMinutos: number;
  preco: string;
  ativo: boolean;
}