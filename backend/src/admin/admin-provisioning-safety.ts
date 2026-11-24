export interface SafeDatabaseDestination {
  host: '127.0.0.1' | '::1';
  port: number;
  database: string;
  summary: string;
  connectionString: string;
}

export interface DatabaseDestinationEnvironment {
  DATABASE_URL?: string;
  FIRST_ADMIN_DATABASE_NAME?: string;
  FIRST_ADMIN_PROVISIONING?: string;
}

export class FirstAdminSafetyError extends Error {
  constructor(
    public readonly code:
      | 'ADMIN_PROVISIONING_NOT_AUTHORIZED'
      | 'DATABASE_URL_MISSING'
      | 'DATABASE_URL_INVALID'
      | 'DATABASE_DESTINATION_NOT_LOCAL'
      | 'DATABASE_DESTINATION_UNEXPECTED'
      | 'ADMIN_PROVISIONING_CANCELLED',
    message: string,
  ) {
    super(message);
  }
}

export function assertOperationalAuthorization(
  environment: DatabaseDestinationEnvironment,
): void {
  if (environment.FIRST_ADMIN_PROVISIONING !== 'yes') {
    throw new FirstAdminSafetyError(
      'ADMIN_PROVISIONING_NOT_AUTHORIZED',
      'Provisionamento não autorizado neste ambiente.',
    );
  }
}

export function inspectSafeDatabaseDestination(
  environment: DatabaseDestinationEnvironment,
): SafeDatabaseDestination {
  assertOperationalAuthorization(environment);

  const raw = environment.DATABASE_URL?.trim();
  if (!raw) {
    throw new FirstAdminSafetyError(
      'DATABASE_URL_MISSING',
      'DATABASE_URL não está configurada.',
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FirstAdminSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL não é uma URL válida.',
    );
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new FirstAdminSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL deve usar PostgreSQL.',
    );
  }

  if (
    url.search !== '' ||
    url.hash !== '' ||
    raw.includes('?') ||
    raw.includes('#')
  ) {
    throw new FirstAdminSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL não pode conter parâmetros de conexão.',
    );
  }

  if (url.hostname.includes('%') || raw.includes(',')) {
    throw new FirstAdminSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL não pode usar destinos múltiplos ou codificados.',
    );
  }

  const rawHost = url.hostname.toLowerCase();
  const host =
    rawHost === '[::1]' ? '::1' : rawHost;
  if (
    host !== '127.0.0.1' &&
    host !== '::1'
  ) {
    throw new FirstAdminSafetyError(
      'DATABASE_DESTINATION_NOT_LOCAL',
      'O destino do banco não é local.',
    );
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).trim();
  if (!database || database.includes('/')) {
    throw new FirstAdminSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'O banco efetivo não pôde ser identificado com segurança.',
    );
  }

  const expectedDatabase = environment.FIRST_ADMIN_DATABASE_NAME?.trim();
  if (!expectedDatabase) {
    throw new FirstAdminSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'FIRST_ADMIN_DATABASE_NAME não está configurado.',
    );
  }
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(expectedDatabase)) {
    throw new FirstAdminSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'A configuração local do banco é inválida.',
    );
  }
  if (database !== expectedDatabase) {
    throw new FirstAdminSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'O banco efetivo não corresponde à configuração local aprovada.',
    );
  }

  const port = url.port ? Number(url.port) : 5432;
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new FirstAdminSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'A porta do banco não pôde ser identificada com segurança.',
    );
  }

  return {
    host: host as SafeDatabaseDestination['host'],
    port,
    database,
    summary: `host=${host} porta=${port} banco=${database}`,
    connectionString: raw,
  };
}

export function isExplicitDestinationConfirmation(value: string): boolean {
  return value.trim() === 'PROVISIONAR';
}

export function getSafeProvisioningErrorCode(error: unknown): string {
  if (error instanceof FirstAdminSafetyError) {
    return error.code;
  }
  if (
    error instanceof Error &&
    error.name === 'BadRequestException'
  ) {
    return 'ADMIN_INPUT_INVALID';
  }
  if (
    error instanceof Error &&
    error.name === 'ConflictException'
  ) {
    return 'ADMIN_PROVISIONING_CONFLICT';
  }
  return 'ADMIN_PROVISIONING_INTERNAL';
}
