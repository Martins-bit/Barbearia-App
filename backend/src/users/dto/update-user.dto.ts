import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { normalizeEmail } from '../../common/utils/email.util';

export class UpdateUserDto {
  /**
   * `nome` e `telefone` são NOT NULL no banco. `@IsOptional()` ignoraria
   * também o valor `null` (o class-validator só pula a validação quando o
   * valor é `null` OU `undefined`), deixando o `null` chegar ao Prisma e
   * estourar em P2011 (500). `@ValidateIf` só ignora `undefined`, então
   * `null` é efetivamente validado por `@IsString()` e vira 400.
   */
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^\d{10,11}$/)
  telefone?: string;

  /**
   * `email` é anulável no banco: `null` significa "limpar o e-mail" e por
   * isso é aceito. `@IsOptional()` (que pula `null` e `undefined`) + `@IsEmail()`
   * dá exatamente esse contrato: `undefined` = não alterar, `null` = limpar,
   * string = precisa ser e-mail válido.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsOptional()
  @IsEmail()
  email?: string | null;
}
