import { config } from 'dotenv';
import readline from 'node:readline';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  FirstAdminProvisioningService,
  validateFirstAdminInput,
} from '../src/admin/first-admin-provisioning';
import {
  getSafeProvisioningErrorCode,
  inspectSafeDatabaseDestination,
  isExplicitDestinationConfirmation,
  type SafeDatabaseDestination,
  FirstAdminSafetyError,
} from '../src/admin/admin-provisioning-safety';
import { resolveBackendEnvPath } from './admin-cli-safety';

const backendEnvPath = resolveBackendEnvPath(__dirname);
config({ path: backendEnvPath, override: false });

function assertSafeLocalExecution(): void {
  if (process.argv.length > 2) {
    throw new Error(
      'Este comando não aceita argumentos; informe os dados pelo terminal.',
    );
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Este comando exige um terminal interativo local.',
    );
  }
}

function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function readHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;

    if (!stdin.setRawMode) {
      reject(new Error('Não foi possível ocultar a senha neste terminal.'));
      return;
    }

    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };

    const onData = (chunk: string) => {
      if (chunk === '\r' || chunk === '\n') {
        cleanup();
        resolve(value);
        return;
      }
      if (chunk === '\u0003') {
        cleanup();
        reject(new Error('Operação cancelada.'));
        return;
      }
      if (chunk === '\u007f' || chunk === '\b') {
        if (value.length > 0) value = value.slice(0, -1);
        return;
      }
      if (chunk.charCodeAt(0) >= 32) {
        value += chunk;
      }
    };

    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  assertSafeLocalExecution();

  let destination: SafeDatabaseDestination;
  try {
    destination = inspectSafeDatabaseDestination(process.env);
  } catch (error) {
    if (error instanceof FirstAdminSafetyError) {
      throw error;
    }
    throw new FirstAdminSafetyError(
      'DATABASE_DESTINATION_UNEXPECTED',
      'Não foi possível identificar o destino com segurança.',
    );
  }

  process.stdout.write(
    `Destino aprovado: ${destination.summary}\n`,
  );
  process.stdout.write(
    'Esta operação cria o primeiro administrador. ' +
      'Digite exatamente PROVISIONAR para continuar.\n',
  );
  const confirmation = await readLine('Confirmação: ');
  if (!isExplicitDestinationConfirmation(confirmation)) {
    throw new FirstAdminSafetyError(
      'ADMIN_PROVISIONING_CANCELLED',
      'Provisionamento cancelado pelo operador.',
    );
  }

  const nome = await readLine('Nome do administrador: ');
  const telefone = await readLine('Telefone (10 ou 11 dígitos): ');
  const email = await readLine('E-mail: ');
  const senha = await readHidden('Senha: ');
  const confirmarSenha = await readHidden('Confirme a senha: ');

  validateFirstAdminInput({
    nome,
    telefone,
    email,
    senha,
    confirmarSenha,
    confirmacaoOperacional: 'PROVISIONAR',
  });

  const prisma = new PrismaService(destination.connectionString);
  const provisioning = new FirstAdminProvisioningService(prisma);

  try {
    await provisioning.provision({
      nome,
      telefone,
      email,
      senha,
      confirmarSenha,
      confirmacaoOperacional: 'PROVISIONAR',
    });
    process.stdout.write(
      'Primeiro administrador provisionado com sucesso.\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const code = getSafeProvisioningErrorCode(error);
  process.stderr.write(
    `Falha no provisionamento [${code}]. Nenhum detalhe interno foi exibido.\n`,
  );
  process.exitCode = 1;
});
