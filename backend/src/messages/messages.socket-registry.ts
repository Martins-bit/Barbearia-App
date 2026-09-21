import { Injectable } from '@nestjs/common';

/**
 * Registro EM MEMÓRIA das conexões WebSocket autenticadas do módulo de
 * mensagens (ETAPA 7C.1).
 *
 * - Conexões são voláteis por natureza: nada é persistido no PostgreSQL e
 *   nenhuma tabela/migration é criada para sockets.
 * - Permite localizar, posteriormente (envio em tempo real), os sockets de um
 *   determinado usuário — um usuário pode possuir múltiplas conexões
 *   simultâneas (ex.: vários dispositivos).
 * - A identidade sempre vem do JWT validado no handshake; o registro nunca
 *   confia em informação enviada pelo cliente.
 */
@Injectable()
export class MessagesSocketRegistry {
  private readonly socketsPorUsuario = new Map<number, Set<string>>();

  /** Registra um socket conectado para o usuário autenticado. */
  add(usuarioId: number, socketId: string): void {
    const sockets = this.socketsPorUsuario.get(usuarioId) ?? new Set<string>();
    sockets.add(socketId);
    this.socketsPorUsuario.set(usuarioId, sockets);
  }

  /**
   * Remove um socket do usuário (desconexão). Remove a entrada do usuário
   * quando o último socket dela é encerrado. Operação idempotente.
   */
  remove(usuarioId: number, socketId: string): void {
    const sockets = this.socketsPorUsuario.get(usuarioId);
    if (!sockets) {
      return;
    }
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.socketsPorUsuario.delete(usuarioId);
    }
  }

  /** Ids dos sockets conectados do usuário (snapshot; possivelmente vazio). */
  getSocketIds(usuarioId: number): string[] {
    return [...(this.socketsPorUsuario.get(usuarioId) ?? [])];
  }

  /** Quantidade de sockets conectados do usuário. */
  count(usuarioId: number): number {
    return this.socketsPorUsuario.get(usuarioId)?.size ?? 0;
  }

  /** Indica se o usuário possui pelo menos uma conexão ativa. */
  has(usuarioId: number): boolean {
    return this.count(usuarioId) > 0;
  }

  /** Total de sockets registrados (diagnóstico/testes). */
  size(): number {
    let total = 0;
    for (const sockets of this.socketsPorUsuario.values()) {
      total += sockets.size;
    }
    return total;
  }
}
