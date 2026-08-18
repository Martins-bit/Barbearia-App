import { AuthResponseDto } from './auth-response.dto';

export class LoginResponseDto {
  user: AuthResponseDto;
  token: string;
  expiresIn: string;
}
