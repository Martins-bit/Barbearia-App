import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateWaitlistDto {
  @IsInt()
  @Min(1)
  barbeiroId: number;

  @IsInt()
  @Min(1)
  servicoId: number;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'data deve estar no formato YYYY-MM-DD' })
  data: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN, { message: 'horaInicio deve estar no formato HH:mm' })
  horaInicio?: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN, { message: 'horaFim deve estar no formato HH:mm' })
  horaFim?: string;
}
