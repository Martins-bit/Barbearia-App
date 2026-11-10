import { IsString, Matches } from 'class-validator';

export class ConfirmEmailDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'Token de confirmação inválido.',
  })
  token: string;
}