import { IsDecimal, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;

export class CreateServiceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;

  @IsInt()
  @Min(5)
  @Max(480)
  duracaoMinutos: number;

  @IsString()
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  @Matches(DECIMAL_PATTERN, {
    message: 'preco deve ser um decimal não negativo com até 8 dígitos inteiros e 2 casas decimais',
  })
  preco: string;
}