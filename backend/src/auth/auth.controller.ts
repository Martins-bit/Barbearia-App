import { Body, Controller, Get, Post, UseGuards, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { JwtGuard } from './guards/jwt.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/register
   * Registra um novo usuário (CLIENTE)
   */
  @Post('register')
  @HttpCode(201)
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  /**
   * POST /auth/login
   * Autentica um usuário e retorna um token JWT
   */
  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(loginDto);
  }

  /**
   * GET /auth/me
   * Retorna informações do usuário autenticado
   * Requer: JWT válido via Authorization header
   */
  @Get('me')
  @UseGuards(JwtGuard)
  async getCurrentUser(
    @CurrentUser() userId: number,
  ): Promise<AuthResponseDto> {
    return this.authService.getCurrentUser(userId);
  }
}
