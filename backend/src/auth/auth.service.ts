import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UsersService } from '../users/users.service';
import { hashPassword, comparePasswords } from '../common/utils/password.util';
import { normalizeEmail } from '../common/utils/email.util';
import { JWT_CONFIG } from '../common/config/jwt.config';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Registra um novo usuário (CLIENTE)
   */
  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    // Validações básicas
    if (
      !registerDto.nome ||
      !registerDto.telefone ||
      !registerDto.senha ||
      !registerDto.email
    ) {
      throw new BadRequestException(
        'Nome, telefone, e-mail e senha são obrigatórios',
      );
    }

    const email = normalizeEmail(registerDto.email);

    // Verifica se o telefone já existe
    const usuarioExistente =
      await this.usersService.findByPhoneWithPasswordHash(registerDto.telefone);

    if (usuarioExistente) {
      throw new ConflictException('Telefone já cadastrado');
    }

    const emailExistente = await this.usersService.findByEmail(email);
    if (emailExistente) {
      throw new ConflictException('Este e-mail já está em uso por outra conta.');
    }

    // Hash da senha
    const senhaHash = await hashPassword(registerDto.senha);

    // Cria o usuário (CLIENTE) de forma atômica com seu registro de Cliente
    const usuario = await this.usersService.createUser({
      nome: registerDto.nome,
      telefone: registerDto.telefone,
      email,
      senhaHash,
      tipoUsuario: 'CLIENTE',
    });

    return usuario;
  }

  /**
   * Autentica um usuário e retorna um token JWT
   */
  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    // Validações básicas
    if (!loginDto.telefone || !loginDto.senha) {
      throw new BadRequestException('Telefone e senha são obrigatórios');
    }

    // Busca o usuário COM senhaHash (interno)
    const usuario = await this.usersService.findByPhoneWithPasswordHash(
      loginDto.telefone,
    );

    // Usuário não existe
    if (!usuario) {
      throw new UnauthorizedException('Telefone ou senha incorretos');
    }

    // Verifica a senha normalmente para um usuário existente
    const senhaValida = await comparePasswords(
      loginDto.senha,
      usuario.senhaHash,
    );

    // A autenticação só é válida quando senha está correta e conta está ativa
    if (!senhaValida || !usuario.ativo) {
      throw new UnauthorizedException('Telefone ou senha incorretos');
    }

    // Gera o token JWT
    const token = this.generateToken(usuario);

    // Retorna usuário sem senhaHash + token
    const {
      senhaHash: _senhaHash,
      authVersion: _authVersion,
      ...usuarioSemHash
    } = usuario;

    return {
      user: usuarioSemHash,
      token,
      expiresIn: JWT_CONFIG.expiresIn,
    };
  }

  /**
   * Obtém o usuário autenticado pelo ID
   */
  async getCurrentUser(userId: number): Promise<AuthResponseDto> {
    const usuario = await this.usersService.findById(userId);

    if (!usuario) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    // Verifica se o usuário está ativo
    if (!usuario.ativo) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return usuario;
  }

  /**
   * Gera um token JWT para o usuário
   */
  private generateToken(usuario: any): string {
    const payload = {
      sub: usuario.id,
      telefone: usuario.telefone,
      tipoUsuario: usuario.tipoUsuario,
      authVersion: usuario.authVersion ?? 0,
    };

    return this.jwtService.sign(payload);
  }
}
