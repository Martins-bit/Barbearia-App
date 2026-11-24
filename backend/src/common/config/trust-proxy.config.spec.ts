import express from 'express';
import { parseTrustProxySetting } from './trust-proxy.config';

describe('parseTrustProxySetting', () => {
  it('mantém a confiança em proxy desativada quando não configurada', () => {
    expect(parseTrustProxySetting(undefined)).toBeUndefined();
  });

  it('converte booleanos e quantidade de hops para os tipos do Express', () => {
    expect(parseTrustProxySetting('true')).toBe(true);
    expect(parseTrustProxySetting('FALSE')).toBe(false);
    expect(parseTrustProxySetting('1')).toBe(1);
    expect(parseTrustProxySetting('0')).toBe(0);
  });

  it('aceita aliases, endereços e sub-redes reconhecidos pelo Express', () => {
    const setting = parseTrustProxySetting(
      'loopback, 10.0.0.0/8, 192.168.0.0/255.255.255.0, ::1/128',
    );
    expect(setting).toEqual([
      'loopback',
      '10.0.0.0/8',
      '192.168.0.0/255.255.255.0',
      '::1/128',
    ]);

    const app = express();
    if (setting !== undefined) app.set('trust proxy', setting);
    expect(app.get('trust proxy')).toEqual(setting);
  });

  it('rejeita entrada vazia, formatos inválidos e valores fora do intervalo', () => {
    for (const value of [
      '',
      '  ',
      '-1',
      '1.5',
      '9007199254740992',
      'not-an-ip',
      '10.0.0.0/0',
      '10.0.0.0/33',
      '192.168.0.0/255.0.255.0',
      '::1/129',
      'loopback,',
    ]) {
      expect(() => parseTrustProxySetting(value)).toThrow('TRUST_PROXY');
    }
  });

  it('entrega a quantidade numérica ao Express, não a string original', () => {
    const app = express();
    const setting = parseTrustProxySetting('1');

    if (setting !== undefined) app.set('trust proxy', setting);

    expect(app.get('trust proxy')).toBe(1);
  });
});
