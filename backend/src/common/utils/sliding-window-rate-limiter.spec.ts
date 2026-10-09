import { SlidingWindowRateLimiter } from './sliding-window-rate-limiter';

/**
 * Testes do limitador de janela deslizante usado nos eventos WebSocket
 * (message:send). Determinístico: `now` é injetado, sem timers reais.
 */
describe('SlidingWindowRateLimiter', () => {
  const LIMIT = 3;
  const WINDOW_MS = 60_000;

  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    limiter = new SlidingWindowRateLimiter(LIMIT, WINDOW_MS);
  });

  afterEach(() => {
    limiter.reset();
  });

  it('permite até o limite dentro da janela', () => {
    const t0 = 1_000_000;
    expect(limiter.tryConsume('user:1', t0)).toBe(true);
    expect(limiter.tryConsume('user:1', t0 + 1)).toBe(true);
    expect(limiter.tryConsume('user:1', t0 + 2)).toBe(true);
  });

  it('bloqueia a tentativa seguinte ao estourar o limite', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMIT; i++) {
      expect(limiter.tryConsume('user:1', t0 + i)).toBe(true);
    }
    // (LIMIT + 1)-ésima dentro da mesma janela é recusada.
    expect(limiter.tryConsume('user:1', t0 + LIMIT)).toBe(false);
  });

  it('libera novo orçamento quando os hits saem da janela', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMIT; i++) {
      limiter.tryConsume('user:1', t0 + i);
    }
    // Ainda bloqueado pouco antes de a janela virar.
    expect(limiter.tryConsume('user:1', t0 + WINDOW_MS - 1)).toBe(false);
    // Após a janela completa, o hit mais antigo expirou e há orçamento.
    expect(limiter.tryConsume('user:1', t0 + WINDOW_MS)).toBe(true);
  });

  it('mantém contadores independentes por chave', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMIT; i++) {
      limiter.tryConsume('user:1', t0 + i);
    }
    expect(limiter.tryConsume('user:1', t0 + LIMIT)).toBe(false);
    // Outro usuário tem orçamento próprio.
    expect(limiter.tryConsume('user:2', t0)).toBe(true);
  });

  it('reset limpa todo o estado', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMIT; i++) {
      limiter.tryConsume('user:1', t0 + i);
    }
    expect(limiter.tryConsume('user:1', t0 + LIMIT)).toBe(false);
    limiter.reset();
    expect(limiter.tryConsume('user:1', t0 + LIMIT)).toBe(true);
  });
});
