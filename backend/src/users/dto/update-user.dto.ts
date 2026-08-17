import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,11}$/)
  telefone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
