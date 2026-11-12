process.env.JWT_SECRET ??= 'unit-test-jwt-secret-with-at-least-32-characters';

import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordRecoveryService } from './password-recovery.service';
import { RolesGuard } from './guards/roles.guard';
import { JwtGuard } from './guards/jwt.guard';
import { PasswordRecoveryDto } from './dto/password-recovery.dto';
import { PasswordResetDto } from './dto/password-reset.dto';

describe('AuthController — password recovery & reset endpoints', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let emailVerificationService: Record<string, jest.Mock>;
  let passwordRecoveryService: Record<string, jest.Mock>;

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      register: jest.fn(),
      getCurrentUser: jest.fn(),
    };
    emailVerificationService = {
      requestConfirmation: jest.fn(),
      requestConfirmationByEmail: jest.fn(),
      confirm: jest.fn(),
    };
    passwordRecoveryService = {
      requestRecovery: jest.fn(),
      resetPassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: EmailVerificationService, useValue: emailVerificationService },
        { provide: PasswordRecoveryService, useValue: passwordRecoveryService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /auth/email/verification/resend', () => {
    it('delegates public resend using the normalized DTO email', async () => {
      const email = 'cliente@example.com';
      emailVerificationService.requestConfirmationByEmail.mockResolvedValue({
        message:
          'Solicitação recebida. Se o endereço pertencer a uma conta pendente e o envio estiver disponível, você receberá as instruções.',
      });

      const result = await controller.resendEmailVerification({ email });

      expect(
        emailVerificationService.requestConfirmationByEmail,
      ).toHaveBeenCalledWith(email);
      expect(result.message).toContain('Solicitação recebida');
    });
  });

  describe('POST /auth/password-recovery', () => {
    it('delegates to PasswordRecoveryService.requestRecovery with the dto email', async () => {
      const dto: PasswordRecoveryDto = { email: 'cliente@example.com' };
      passwordRecoveryService.requestRecovery.mockResolvedValue({
        message: 'Se houver uma conta elegível, as instruções serão enviadas.',
      });

      const result = await controller.requestPasswordRecovery(dto);

      expect(passwordRecoveryService.requestRecovery).toHaveBeenCalledWith(
        'cliente@example.com',
      );
      expect(result).toEqual({
        message: 'Se houver uma conta elegível, as instruções serão enviadas.',
      });
    });
  });

  describe('POST /auth/password-reset', () => {
    it('delegates to PasswordRecoveryService.resetPassword with token and senha', async () => {
      const dto: PasswordResetDto = {
        token: 'A'.repeat(43),
        senha: 'novaSenhaForte123',
      };
      passwordRecoveryService.resetPassword.mockResolvedValue({
        message: 'Senha redefinida. Entre novamente com a nova senha.',
      });

      const result = await controller.resetPassword(dto);

      expect(passwordRecoveryService.resetPassword).toHaveBeenCalledWith(
        dto.token,
        dto.senha,
      );
      expect(result).toEqual({
        message: 'Senha redefinida. Entre novamente com a nova senha.',
      });
    });
  });
});
