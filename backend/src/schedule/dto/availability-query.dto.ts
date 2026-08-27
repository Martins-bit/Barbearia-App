import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export class AvailabilityQueryDto {
  @IsString()
  @Matches(DATE_PATTERN, { message: 'data deve estar no formato YYYY-MM-DD' })
  data: string;

  @IsInt()
  servicoId: number;

  /**
   * Obrigatório para CLIENTE. Para BARBEIRO pode ser omitido e é resolvido
   * pelo usuário autenticado (nunca escolhido arbitrariamente). Quando
   * informado por qualquer papel, é usado apenas para CONSULTA — operações
   * administrativas nunca confiam neste campo.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  barbeiroId?: number;
}
