/**
 * Configuração do ambiente de testes E2E — carregada pelo `setupFiles` do
 * `test/jest-e2e.json`, ANTES de qualquer módulo da aplicação ser importado.
 *
 * Responsabilidades:
 * 1. Ler `DATABASE_URL` EXCLUSIVAMENTE de `DATABASE_URL_E2E`. O `.env` de
 *    desenvolvimento NÃO é carregado: se `DATABASE_URL_E2E` estiver ausente,
 *    a suíte falha aqui, antes de qualquer conexão.
 * 2. Validar explicitamente o destino: protocolo postgres, host local, e o
 *    banco PRECISA ser exatamente o banco de testes esperado. Qualquer outro
 *    banco (inclusive o de desenvolvimento) interrompe a execução.
 * 3. Definir um `JWT_SECRET` só de testes (quando ausente), para que os testes
 *    não dependam do segredo de desenvolvimento.
 *
 * Nenhum valor sensível é impresso: as mensagens de erro mostram apenas o nome
 * do banco/host, nunca usuário, senha ou a URL completa.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Banco DEDICADO aos testes E2E. Qualquer outro nome é recusado. */
export const TEST_DATABASE_NAME = 'barbearia_app_e2e';

/**
 * Hosts aceitos: apenas loopback. Os E2E apagam dados em massa e não devem
 * rodar contra um servidor remoto/compartilhado.
 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface E2eDatabaseInfo {
  host: string;
  port: string;
  database: string;
}

function fail(message: string): never {
  // Interrompe a suíte inteira no setup (nenhuma conexão é feita antes disso).
  throw new Error(`[e2e] ${message}`);
}

/**
 * Valida a URL do banco de testes e devolve apenas metadados não sensíveis.
 * Função pura exportada para poder ser testada de forma independente.
 */
export function parseTestDatabaseUrl(raw: string | undefined): E2eDatabaseInfo {
  if (!raw || raw.trim().length === 0) {
    fail(
      'DATABASE_URL_E2E não está definida. Os testes E2E exigem um banco ' +
      'dedicado e nunca usam o .env de desenvolvimento. Veja backend/.env.e2e.example.',
    );
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    fail('DATABASE_URL_E2E não é uma URL válida.');
  }

  const protocol = url.protocol.replace(':', '');
  if (protocol !== 'postgresql' && protocol !== 'postgres') {
    fail(`DATABASE_URL_E2E deve usar o protocolo postgresql:// (recebido "${protocol}").`);
  }

  const host = url.hostname;
  if (!ALLOWED_HOSTS.has(host)) {
    fail(
      `DATABASE_URL_E2E aponta para um host não permitido ("${host}"). ` +
      'Os testes E2E só podem usar um PostgreSQL local (localhost/127.0.0.1).',
    );
  }

  const database = url.pathname.replace(/^\//, '');
  if (database !== TEST_DATABASE_NAME) {
    fail(
      `DATABASE_URL_E2E aponta para o banco "${database || '(vazio)'}", mas o ` +
      `único banco permitido para E2E é "${TEST_DATABASE_NAME}". ` +
      'A execução foi interrompida antes de qualquer alteração.',
    );
  }

  return {
    host,
    port: url.port || '5432',
    database,
  };
}

/**
 * Compara o `current_database()` real da conexão com o banco declarado na URL.
 * Proteção contra redirecionamento de `search_path`/database no servidor e
 * contra strings de conexão com truques inesperados.
 */
export function assertConnectedDatabase(
  expected: E2eDatabaseInfo,
  currentDatabase: string,
): void {
  if (currentDatabase !== expected.database) {
    fail(
      `A conexão aberta aponta para o banco "${currentDatabase}", diferente de ` +
      `"${expected.database}" declarado em DATABASE_URL_E2E. Execução interrompida.`,
    );
  }
}

/**
 * Aplica a configuração no `process.env` do worker do Jest.
 * Idempotente: pode ser chamada novamente por uma suíte sem efeito colateral.
 */
export function configureE2eEnvironment(): E2eDatabaseInfo {
  const info = parseTestDatabaseUrl(process.env.DATABASE_URL_E2E);

  // A aplicação (PrismaService, prisma.config.ts, scripts) lê DATABASE_URL.
  // Aqui ela recebe SOMENTE a URL de testes validada acima.
  process.env.DATABASE_URL = process.env.DATABASE_URL_E2E;
  process.env.NODE_ENV = 'test';
  process.env.E2E_DATABASE_NAME = info.database;

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
    // Segredo SÓ de testes: 64 caracteres fixos, sem valor de produção.
    process.env.JWT_SECRET =
      'e2e-only-secret-key-not-for-production-0123456789abcdef0123456789abcdef';
  }

  // Sem porta fixa: cada suíte escuta em porta efêmera (app.listen(0)).
  delete process.env.PORT;

  return info;
}

/** Helper para suítes/scripts: monta a conexão a partir da URL já validada. */
export function getE2eConnectionString(): string {
  const raw = process.env.DATABASE_URL_E2E;
  parseTestDatabaseUrl(raw);
  return raw as string;
}

/** Aviso amigável (usado por scripts) quando o arquivo de exemplo não existir. */
export function e2eEnvExampleHint(): string {
  const example = resolve(process.cwd(), '.env.e2e.example');
  return existsSync(example)
    ? 'Consulte backend/.env.e2e.example para o formato esperado.'
    : 'Defina DATABASE_URL_E2E no ambiente antes de rodar os testes E2E.';
}
