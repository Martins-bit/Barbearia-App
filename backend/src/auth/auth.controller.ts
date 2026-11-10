import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { JwtGuard } from './guards/jwt.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';
import { TipoUsuario } from '../generated/prisma/enums';
import { ConfirmEmailDto } from './dto/confirm-email.dto';
import { EmailVerificationService } from './email-verification.service';
import { PasswordRecoveryService } from './password-recovery.service';
import { PasswordRecoveryDto } from './dto/password-recovery.dto';
import { PasswordResetDto } from './dto/password-reset.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordRecoveryService: PasswordRecoveryService,
  ) {}

  /**
   * POST /auth/register
   * Registra um novo usuário (CLIENTE)
   */
  @Post('register')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  /**
   * POST /auth/login
   * Autentica um usuário e retorna um token JWT
   */
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(loginDto);
  }

  @Post('email/verification/request')
  @HttpCode(202)
  @UseGuards(JwtGuard, RolesGuard, ThrottlerGuard)
  @Roles(TipoUsuario.CLIENTE, TipoUsuario.BARBEIRO)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async requestEmailVerification(
    @CurrentUser() userId: number,
  ): Promise<{ message: string }> {
    return this.emailVerificationService.requestConfirmation(userId);
  }

  @Post('email/verification/confirm')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async confirmEmail(
    @Body() dto: ConfirmEmailDto,
  ): Promise<{ message: string }> {
    return this.emailVerificationService.confirm(dto.token);
  }

  @Post('password-recovery')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestPasswordRecovery(
    @Body() dto: PasswordRecoveryDto,
  ): Promise<{ message: string }> {
    return this.passwordRecoveryService.requestRecovery(dto.email);
  }

  @Post('password-reset')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(
    @Body() dto: PasswordResetDto,
  ): Promise<{ message: string }> {
    return this.passwordRecoveryService.resetPassword(dto.token, dto.senha);
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
