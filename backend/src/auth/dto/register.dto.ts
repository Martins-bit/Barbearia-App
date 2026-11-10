import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { normalizeEmail } from '../../common/utils/email.util';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome: string;

  @IsString()
  @Matches(/^\d{10,11}$/, {
    message: 'Telefone deve conter 10 ou 11 dígitos',
  })
  telefone: string;

  @IsString()
  @MinLength(8, {
    message: 'Senha deve ter no mínimo 8 caracteres',
  })
  @MaxLength(72, {
    message: 'Senha deve possuir no máximo 72 caracteres e 72 bytes UTF-8.',
  })
  senha: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
}
