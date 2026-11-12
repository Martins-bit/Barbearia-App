process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'unit-test-jwt-secret-with-at-least-32-characters';

const { UnauthorizedException } = require('@nestjs/common');
const { JwtStrategy } = require('./jwt.strategy');

describe('JwtStrategy authVersion validation', () => {
  let usersService: { findAuthVersionById: jest.Mock };
  let strategy: InstanceType<typeof JwtStrategy>;

  beforeEach(() => {
    usersService = { findAuthVersionById: jest.fn() };
    strategy = new JwtStrategy(usersService as any);
  });

  it('accepts legacy CLIENTE tokens without authVersion while the user is at version 0', async () => {
    usersService.findAuthVersionById.mockResolvedValue({
      id: 8,
      authVersion: 0,
    });

    await expect(
      strategy.validate({
        sub: 8,
        telefone: '11999999999',
        tipoUsuario: 'CLIENTE',
        iat: 1,
        exp: 9999999999,
      }),
    ).resolves.toMatchObject({ sub: 8, tipoUsuario: 'CLIENTE' });
  });

  it('accepts BARBEIRO tokens with the current authVersion', async () => {
    usersService.findAuthVersionById.mockResolvedValue({
      id: 9,
      authVersion: 3,
    });

    await expect(
      strategy.validate({
        sub: 9,
        telefone: '11888888888',
        tipoUsuario: 'BARBEIRO',
        authVersion: 3,
        iat: 1,
        exp: 9999999999,
      }),
    ).resolves.toMatchObject({ sub: 9, tipoUsuario: 'BARBEIRO' });
  });

  it('rejects a token issued before password reset increments authVersion', async () => {
    usersService.findAuthVersionById.mockResolvedValue({
      id: 8,
      authVersion: 1,
    });

    await expect(
      strategy.validate({
        sub: 8,
        telefone: '11999999999',
        tipoUsuario: 'CLIENTE',
        authVersion: 0,
        iat: 1,
        exp: 9999999999,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an otherwise-current token while email confirmation is mandatory', async () => {
    usersService.findAuthVersionById.mockResolvedValue({
      id: 8,
      authVersion: 0,
      emailConfirmacaoObrigatoria: true,
    });

    await expect(
      strategy.validate({
        sub: 8,
        telefone: '11999999999',
        tipoUsuario: 'CLIENTE',
        authVersion: 0,
        iat: 1,
        exp: 9999999999,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects malformed or negative authVersion values', async () => {
    await expect(
      strategy.validate({
        sub: 8,
        telefone: '11999999999',
        tipoUsuario: 'CLIENTE',
        authVersion: -1,
        iat: 1,
        exp: 9999999999,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.findAuthVersionById).not.toHaveBeenCalled();
  });
});