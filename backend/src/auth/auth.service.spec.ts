import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-purposes-min-32';

const { AuthService } = require('./auth.service');
const { UsersService } = require('../users/users.service');

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: any;
  let usersService: any;
  let jwtService: JwtService;
  let emailVerificationService: { sendRegistrationConfirmation: jest.Mock };

  beforeEach(async () => {
    // Ensure JWT_SECRET is set for tests
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET =
        'test-jwt-secret-key-for-testing-purposes-only-minimum-32-chars';
    }

    const mockUsersService = {
      findByPhoneWithPasswordHash: jest.fn(),
      findByEmail: jest.fn().mockResolvedValue(null),
      createUser: jest.fn(),
      findById: jest.fn(),
    };

    const mockJwtService = {
      sign: jest.fn(),
    };
    emailVerificationService = {
      sendRegistrationConfirmation: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: require('./email-verification.service')
            .EmailVerificationService,
          useValue: emailVerificationService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should create a new CLIENTE user successfully', async () => {
      const registerDto: RegisterDto = {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha12345',
        email: 'joao@example.com',
      };

      const usuarioRetornado = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: 'joao@example.com',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        null,
      );
      (usersService.createUser as jest.Mock).mockResolvedValue(
        usuarioRetornado,
      );

      const result = await service.register(registerDto);

      expect(result).toEqual({
        ...usuarioRetornado,
        emailConfirmationSent: true,
      });
      expect(usersService.findByPhoneWithPasswordHash).toHaveBeenCalledWith(
        registerDto.telefone,
      );
      expect(usersService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          nome: registerDto.nome,
          telefone: registerDto.telefone,
          email: registerDto.email,
          tipoUsuario: 'CLIENTE',
          requireEmailVerification: true,
        }),
      );
      expect(emailVerificationService.sendRegistrationConfirmation).toHaveBeenCalledTimes(1);
      expect(emailVerificationService.sendRegistrationConfirmation).toHaveBeenCalledWith(
        usuarioRetornado.id,
      );
    });

    it('should throw ConflictException when phone already exists', async () => {
      const registerDto: RegisterDto = {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha12345',
        email: 'joao@example.com',
      };

      const usuarioExistente = {
        id: 1,
        nome: 'Outro Usuário',
        telefone: '11999999999',
        email: null,
        senhaHash: 'hash123',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuarioExistente,
      );

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException when e-mail already exists', async () => {
      const registerDto: RegisterDto = {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha12345',
        email: 'JOAO@example.com',
      };

      usersService.findByPhoneWithPasswordHash.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue({ id: 2 });

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(usersService.findByEmail).toHaveBeenCalledWith(
        'joao@example.com',
      );
      expect(usersService.createUser).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when required fields are missing', async () => {
      const invalidDto = {
        nome: 'João',
        telefone: '',
        senha: 'senha12345',
        email: 'joao@example.com',
      };

      await expect(service.register(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should never expose senhaHash in response', async () => {
      const registerDto: RegisterDto = {
        nome: 'João Silva',
        telefone: '11999999999',
        senha: 'senha12345',
        email: 'joao@example.com',
      };

      const usuarioRetornado = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        null,
      );
      (usersService.createUser as jest.Mock).mockResolvedValue(
        usuarioRetornado,
      );

      const result = await service.register(registerDto);

      expect(result).not.toHaveProperty('senhaHash');
      expect(emailVerificationService.sendRegistrationConfirmation).toHaveBeenCalledTimes(1);
    });

    it('returns an explicit incomplete-delivery state after the account is created', async () => {
      emailVerificationService.sendRegistrationConfirmation.mockResolvedValue(
        false,
      );
      usersService.findByPhoneWithPasswordHash.mockResolvedValue(null);
      usersService.createUser.mockResolvedValue({
        id: 11,
        nome: 'Cliente',
        telefone: '11999999998',
        email: 'cliente@example.com',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      });

      const result = await service.register({
        nome: 'Cliente',
        telefone: '11999999998',
        senha: 'senha-segura',
        email: 'cliente@example.com',
      });

      expect(result.emailConfirmationSent).toBe(false);
      expect(usersService.createUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('login', () => {
    it('does not issue a JWT while a new account must confirm its e-mail', async () => {
      usersService.findByPhoneWithPasswordHash.mockResolvedValue({
        id: 7,
        telefone: '11999999999',
        senhaHash: 'hash',
        ativo: true,
        emailConfirmacaoObrigatoria: true,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({ telefone: '11999999999', senha: 'senha12345' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(jwtService.sign).not.toHaveBeenCalled();
      expect(emailVerificationService.sendRegistrationConfirmation).not.toHaveBeenCalled();
    });

    it('allows a previously registered account with the default marker to log in', async () => {
      usersService.findByPhoneWithPasswordHash.mockResolvedValue({
        id: 8,
        telefone: '11888888888',
        senhaHash: 'hash',
        ativo: true,
        emailConfirmacaoObrigatoria: false,
        tipoUsuario: 'CLIENTE',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue('legacy-token');

      await expect(
        service.login({ telefone: '11888888888', senha: 'senha12345' }),
      ).resolves.toMatchObject({ token: 'legacy-token' });
      expect(emailVerificationService.sendRegistrationConfirmation).not.toHaveBeenCalled();
    });

    it('should authenticate user and return token', async () => {
      const loginDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senha12345',
      };

      const usuario = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: 'joao@example.com',
        emailVerificadoEm: new Date(),
        emailConfirmacaoObrigatoria: false,
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuario,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue('token123');

      const result = await service.login(loginDto);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expiresIn');
      expect(result.user).not.toHaveProperty('senhaHash');
      expect(result.token).toBe('token123');
        expect(jwtService.sign).toHaveBeenCalledWith(
          expect.objectContaining({ authVersion: 0 }),
        );
        expect(result.user).not.toHaveProperty('authVersion');
    });

    it('should include user current authVersion in the JWT payload when non-zero', async () => {
      const loginDto: LoginDto = {
        telefone: '11888888888',
        senha: 'senha12345',
      };

      const usuario = {
        id: 2,
        nome: 'Carlos Barbeiro',
        telefone: '11888888888',
        email: 'barbeiro@example.com',
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'BARBEIRO',
        ativo: true,
        authVersion: 3,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuario,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue('tokenWithVersion3');

      const result = await service.login(loginDto);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 2,
          authVersion: 3,
          tipoUsuario: 'BARBEIRO',
        }),
      );
      expect(result.user).not.toHaveProperty('authVersion');
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      const loginDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senha12345',
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      const loginDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senhaerrada',
      };

      const usuario = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuario,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should use generic error message without revealing if phone or password was wrong', async () => {
      const loginDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senhaerrada',
      };

      const usuario = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuario,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      try {
        await service.login(loginDto);
      } catch (error: any) {
        expect(error.message).toBe('Telefone ou senha incorretos');
      }
    });

    it('should never expose senhaHash in login response', async () => {
      const loginDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senha12345',
      };

      const usuario = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuario,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue('token123');

      const result = await service.login(loginDto);

      expect(result.user).not.toHaveProperty('senhaHash');
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      const loginDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senha12345',
      };

      const usuarioInativo = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'CLIENTE',
        ativo: false,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuarioInativo,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login(loginDto)).rejects.toThrow(
        'Telefone ou senha incorretos',
      );
    });

    it('should use generic error message when user is inactive (does not reveal account status)', async () => {
      const loginDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senha12345',
      };

      const usuarioInativo = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'CLIENTE',
        ativo: false,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuarioInativo,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      try {
        await service.login(loginDto);
        fail('Should have thrown UnauthorizedException');
      } catch (error: any) {
        expect(error.message).toBe('Telefone ou senha incorretos');
      }
    });

    it('should return the same public response for wrong password and disabled account', async () => {
      const wrongPasswordDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senhaerrada',
      };

      const usuarioInativo = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'CLIENTE',
        ativo: false,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuarioInativo,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(wrongPasswordDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login(wrongPasswordDto)).rejects.toThrow(
        'Telefone ou senha incorretos',
      );
    });

    it('should not issue a token for a disabled user', async () => {
      const loginDto: LoginDto = {
        telefone: '11999999999',
        senha: 'senha12345',
      };

      const usuarioInativo = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        senhaHash: '$2b$10$hashedpassword',
        tipoUsuario: 'CLIENTE',
        ativo: false,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findByPhoneWithPasswordHash as jest.Mock).mockResolvedValue(
        usuarioInativo,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user by ID', async () => {
      const usuario = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findById as jest.Mock).mockResolvedValue(usuario);

      const result = await service.getCurrentUser(1);

      expect(result).toEqual(usuario);
      expect(usersService.findById).toHaveBeenCalledWith(1);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(null);

      await expect(service.getCurrentUser(999)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      const usuarioInativo = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        tipoUsuario: 'CLIENTE',
        ativo: false,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findById as jest.Mock).mockResolvedValue(usuarioInativo);

      await expect(service.getCurrentUser(1)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should never expose senhaHash in getCurrentUser response', async () => {
      const usuario = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        tipoUsuario: 'CLIENTE',
        ativo: true,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findById as jest.Mock).mockResolvedValue(usuario);

      const result = await service.getCurrentUser(1);

      expect(result).not.toHaveProperty('senhaHash');
    });

    it('should block access when account is deactivated after login', async () => {
      // Simulate a user who was active at login but later deactivated
      const usuarioInativo = {
        id: 1,
        nome: 'João Silva',
        telefone: '11999999999',
        email: null,
        tipoUsuario: 'CLIENTE',
        ativo: false,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };

      (usersService.findById as jest.Mock).mockResolvedValue(usuarioInativo);

      await expect(service.getCurrentUser(1)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
