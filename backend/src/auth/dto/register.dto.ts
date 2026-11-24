import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { normalizeEmail } from '../../common/utils/email.util';
import { normalizePhone } from '../../common/utils/phone.util';

export class RegisterDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Informe seu nome.' })
  @MinLength(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  nome: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePhone(value) : value,
  )
  @IsString()
  @Matches(/^\d{10,11}$/, {
    message: 'Telefone deve conter DDD e 10 ou 11 dígitos.',
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
