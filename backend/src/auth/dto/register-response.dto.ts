import { AuthResponseDto } from './auth-response.dto';

export class RegisterResponseDto extends AuthResponseDto {
  emailConfirmationSent: boolean;
}
