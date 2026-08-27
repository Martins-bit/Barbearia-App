import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleBlockDto {
  @IsString()
  @Matches(DATE_PATTERN, { message: 'data deve estar no formato YYYY-MM-DD' })
  data: string;

  @IsString()
  @Matches(HHMM_PATTERN, { message: 'horaInicio deve estar no formato HH:mm' })
  horaInicio: string;

  @IsString()
  @Matches(HHMM_PATTERN, { message: 'horaFim deve estar no formato HH:mm' })
  horaFim: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
