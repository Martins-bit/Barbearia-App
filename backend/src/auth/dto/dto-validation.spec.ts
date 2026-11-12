import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';
import { ConfirmEmailDto } from './confirm-email.dto';
import { PasswordRecoveryDto } from './password-recovery.dto';
import { PasswordResetDto } from './password-reset.dto';
import { RequestEmailVerificationDto } from './request-email-verification.dto';

describe('Auth DTOs Validation', () => {
  describe('RegisterDto', () => {
    it('should reject DTO with extra field tipoUsuario', async () => {
      const invalidData = {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha12345',
        tipoUsuario: 'BARBEIRO', // Extra field - should be rejected
      };

      const dto = plainToClass(RegisterDto, invalidData);
      const errors = await validate(dto, { forbidUnknownValues: true });

      // The ValidationPipe will reject this with forbidNonWhitelisted: true
      expect(dto).toHaveProperty('nome');
      expect(dto).toHaveProperty('telefone');
      expect(dto).toHaveProperty('senha');
      // Extra property should be ignored/stripped by class-transformer
    });

    it('should accept valid RegisterDto', async () => {
      const validData = {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha12345',
        email: 'joao@example.com',
      };

      const dto = plainToClass(RegisterDto, validData);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });

    it('should reject password shorter than 8 characters', async () => {
      const invalidData = {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha1', // Too short
      };

      const dto = plainToClass(RegisterDto, invalidData);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('senha');
    });

    it('should reject invalid phone number', async () => {
      const invalidData = {
        nome: 'João Silva',
        telefone: '123', // Invalid
        senha: 'senha12345',
      };

      const dto = plainToClass(RegisterDto, invalidData);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('telefone');
    });

    it('should normalize and validate e-mail', async () => {
      const dto = plainToClass(RegisterDto, {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha12345',
        email: '  JOAO@EXAMPLE.COM  ',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.email).toBe('joao@example.com');
    });

    it('should reject invalid e-mail', async () => {
      const dto = plainToClass(RegisterDto, {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha12345',
        email: 'invalid-email',
      });

      expect(await validate(dto)).toEqual(
        expect.arrayContaining([expect.objectContaining({ property: 'email' })]),
      );
    });
  });

  describe('LoginDto', () => {
    it('should accept valid LoginDto', async () => {
      const validData = {
        telefone: '11999999999',
        senha: 'senha12345',
      };

      const dto = plainToClass(LoginDto, validData);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });

    it('should reject invalid phone number', async () => {
      const invalidData = {
        telefone: 'abc', // Invalid
        senha: 'senha12345',
      };

      const dto = plainToClass(LoginDto, invalidData);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('telefone');
    });
  });

  describe('ConfirmEmailDto', () => {
    it('should accept a 32-byte base64url token', async () => {
      const dto = plainToClass(ConfirmEmailDto, { token: 'A'.repeat(43) });

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    describe('RequestEmailVerificationDto', () => {
      it('normalizes and validates public resend addresses', async () => {
        const dto = plainToClass(RequestEmailVerificationDto, {
          email: '  CLIENTE@EXAMPLE.COM ',
        });

        await expect(validate(dto)).resolves.toHaveLength(0);
        expect(dto.email).toBe('cliente@example.com');
      });

      it('rejects invalid public resend addresses', async () => {
        const dto = plainToClass(RequestEmailVerificationDto, {
          email: 'not-an-email',
        });

        expect(await validate(dto)).toEqual(
          expect.arrayContaining([expect.objectContaining({ property: 'email' })]),
        );
      });
    });

    it('should reject malformed confirmation tokens', async () => {
      const dto = plainToClass(ConfirmEmailDto, { token: 'not-a-token' });

      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('token');
    });
  });

  describe('PasswordRecoveryDto', () => {
    it('validates e-mail and normalizes surrounding whitespace', async () => {
      const dto = plainToClass(PasswordRecoveryDto, {
        email: '  person@example.com  ',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.email).toBe('person@example.com');
    });

    it('rejects invalid e-mail input', async () => {
      const dto = plainToClass(PasswordRecoveryDto, { email: 'not-an-email' });

      expect(await validate(dto)).toHaveLength(1);
    });
  });

  describe('PasswordResetDto', () => {
    it('accepts a valid token and password', async () => {
      const dto = plainToClass(PasswordResetDto, {
        token: 'A'.repeat(43),
        senha: 'senha-segura-123',
      });

      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejects short passwords and malformed tokens', async () => {
      const dto = plainToClass(PasswordResetDto, {
        token: 'invalid',
        senha: 'curta',
      });

      expect((await validate(dto)).map((error) => error.property)).toEqual(
        expect.arrayContaining(['token', 'senha']),
      );
    });
  });
});
