import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class PasswordRecoveryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email: string;
}