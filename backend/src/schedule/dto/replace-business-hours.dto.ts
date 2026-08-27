import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { BusinessHourInputDto } from './business-hour-input.dto';

export class ReplaceBusinessHoursDto {
  // Múltiplas janelas por dia são permitidas (ex.: pausa de almoço recorrente).
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(70)
  @ValidateNested({ each: true })
  @Type(() => BusinessHourInputDto)
  horarios: BusinessHourInputDto[];
}
