import { BadRequestException, ConflictException } from '@nestjs/common';
import { userInfo } from 'node:os';

export interface BarberProvisioningEnvironment {
  BARBER_DATABASE_NAME?: string;
  BARBER_PROVISIONING?: string;
  BARBER_PROVISIONING_OPERATOR?: string;
  DATABASE_URL?: string;
  NODE_ENV?: string;
}

export interface SafeBarberDatabaseDestination {
  host: '127.0.0.1' | '::1';
  port: number;
  database: string;
  summary: string;
  connectionString: string;
}

export class BarberProvisioningSafetyError extends Error {
  constructor(
    public readonly code:
      | 'BARBER_PROVISIONING_NOT_AUTHORIZED'
      | 'BARBER_OPERATOR_NOT_AUTHORIZED'
      | 'BARBER_ENVIRONMENT_NOT_DEVELOPMENT'
      | 'DATABASE_URL_MISSING'
      | 'DATABASE_URL_INVALID'
      | 'DATABASE_DESTINATION_NOT_LOCAL'
      | 'DATABASE_DESTINATION_UNEXPECTED'
      | 'BARBER_PROVISIONING_CANCELLED'
      | 'BARBER_EXECUTION_NOT_LOCAL_INTERACTIVE'
      | 'BARBER_EXECUTION_ARGUMENTS_NOT_ALLOWED',
    message: string,
  ) {
    super(message);
  }
}

export function assertBarberProvisioningAuthorization(
  environment: BarberProvisioningEnvironment,
  currentOperator = userInfo().username,
): void {
  if (environment.NODE_ENV !== 'development') {
    throw new BarberProvisioningSafetyError(
      'BARBER_ENVIRONMENT_NOT_DEVELOPMENT',
      'O provisionamento de barbeiro só é permitido em development.',
    );
  }

  if (environment.BARBER_PROVISIONING !== 'yes') {
    throw new BarberProvisioningSafetyError(
      'BARBER_PROVISIONING_NOT_AUTHORIZED',
      'Provisionamento de barbeiro não autorizado neste ambiente.',
    );
  }

  const approvedOperator = environment.BARBER_PROVISIONING_OPERATOR?.trim();
  if (
    !approvedOperator ||
    approvedOperator.toLocaleLowerCase('en-US') !==
      currentOperator.trim().toLocaleLowerCase('en-US')
  ) {
    throw new BarberProvisioningSafetyError(
      'BARBER_OPERATOR_NOT_AUTHORIZED',
      'A conta do sistema operacional não está autorizada.',
    );
  }
}

export function inspectSafeBarberDatabaseDestination(
  environment: BarberProvisioningEnvironment,
  currentOperator = userInfo().username,
): SafeBarberDatabaseDestination {
  assertBarberProvisioningAuthorization(environment, currentOperator);

  const raw = environment.DATABASE_URL?.trim();
  if (!raw) {
    throw new BarberProvisioningSafetyError(
      'DATABASE_URL_MISSING',
      'DATABASE_URL não está configurada.',
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BarberProvisioningSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL não é uma URL válida.',
    );
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new BarberProvisioningSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL deve usar PostgreSQL.',
    );
  }

  if (
    url.search !== '' ||
    url.hash !== '' ||
    raw.includes('?') ||
    raw.includes('#') ||
    url.hostname.includes('%') ||
    raw.includes(',')
  ) {
    throw new BarberProvisioningSafetyError(
      'DATABASE_URL_INVALID',
      'DATABASE_URL contém opções de destino não permitidas.',
    );
  }

  const rawHost = url.hostname.toLowerCase();
  const host = rawHost === '[::1]' ? '::1' : rawHost;
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new BarberProvisioningSafetyError(
      'DATABASE_DESTINATION_NOT_LOCAL',
      'O destino do banco não é local.',
    );
  }

  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, '')).trim();
  } catch {
    throw new BarberProvisioningSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'O banco efetivo não pôde ser identificado com segurança.',
    );
  }
  if (!database || database.includes('/')) {
    throw new BarberProvisioningSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'O banco efetivo não pôde ser identificado com segurança.',
    );
  }

  const expectedDatabase = environment.BARBER_DATABASE_NAME?.trim();
  if (
    !expectedDatabase ||
    !/^[A-Za-z0-9_-]{1,63}$/.test(expectedDatabase) ||
    database !== expectedDatabase
  ) {
    throw new BarberProvisioningSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'O banco efetivo não corresponde ao destino local aprovado.',
    );
  }

  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BarberProvisioningSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'A porta do banco não pôde ser identificada com segurança.',
    );
  }

  return {
    host,
    port,
    database,
    summary: `host=${host} porta=${port} banco=${database}`,
    connectionString: raw,
  };
}

export function isExplicitBarberProvisioningConfirmation(
  value: string,
  database: string,
): boolean {
  return value.trim() === `PROVISIONAR BARBEIRO ${database}`;
}

export function assertSafeLocalBarberExecution(input: {
  argv: readonly string[];
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  environment: NodeJS.ProcessEnv;
}): void {
  if (input.argv.length !== 2) {
    throw new BarberProvisioningSafetyError(
      'BARBER_EXECUTION_ARGUMENTS_NOT_ALLOWED',
      'Este comando não aceita argumentos.',
    );
  }

  if (
    !input.stdinIsTTY ||
    !input.stdoutIsTTY ||
    ['CI', 'SSH_CLIENT', 'SSH_CONNECTION', 'SSH_TTY', 'REMOTEHOST'].some(
      (key) => Boolean(input.environment[key]?.trim()),
    )
  ) {
    throw new BarberProvisioningSafetyError(
      'BARBER_EXECUTION_NOT_LOCAL_INTERACTIVE',
      'Este comando exige um terminal local interativo.',
    );
  }
}

export function getSafeBarberProvisioningErrorCode(error: unknown): string {
  if (error instanceof BarberProvisioningSafetyError) {
    return error.code;
  }
  if (error instanceof BadRequestException) {
    return 'BARBER_INPUT_INVALID';
  }
  if (error instanceof ConflictException) {
    return 'BARBER_PROVISIONING_CONFLICT';
  }
  return 'BARBER_PROVISIONING_INTERNAL';
}
