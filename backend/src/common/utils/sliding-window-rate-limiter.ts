/**
 * Limitador de taxa simples, em memória, de janela deslizante.
 *
 * Cobre eventos WebSocket (ex.: `message:send`), que NÃO passam pelo
 * `ThrottlerGuard` do NestJS (que só protege rotas HTTP). A chave deve ser o
 * identificador mais apropriado disponível (usuário autenticado no socket).
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Tenta consumir uma unidade para `key`.
   * @returns `true` se ainda há orçamento na janela; `false` se excedeu.
   */
  tryConsume(key: string, now: number = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Limpa todo o estado (útil em testes). */
  reset(): void {
    this.hits.clear();
  }
}
