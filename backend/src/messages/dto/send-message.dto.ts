import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export const MAX_MESSAGE_LENGTH = 500;

export class SendMessageDto {
  @IsInt()
  @Min(1)
  destinatarioId!: number;

  // Trim garante mínimo de 1 caractere útil após espaços (validação de
  // comprimento mínimo aplicada no service, coerente com padrão do projeto).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(MAX_MESSAGE_LENGTH)
  conteudo!: string;
}