import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class BusinessHourInputDto {
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana: number;

  @IsString()
  @Matches(HHMM_PATTERN, { message: 'horaInicio deve estar no formato HH:mm' })
  horaInicio: string;

  @IsString()
  @Matches(HHMM_PATTERN, { message: 'horaFim deve estar no formato HH:mm' })
  horaFim: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
