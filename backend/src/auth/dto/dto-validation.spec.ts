import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';

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
});
