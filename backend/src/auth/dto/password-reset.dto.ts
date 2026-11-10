import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class PasswordResetDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'Token de redefinição inválido.',
  })
  token: string;

  @IsString()
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres.' })
  @MaxLength(72, { message: 'Senha excede o limite aceito.' })
  senha: string;
}