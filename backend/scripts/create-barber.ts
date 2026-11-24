import { config } from 'dotenv';
import readline from 'node:readline';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailVerificationService } from '../src/auth/email-verification.service';
import { createEmailVerificationMailer } from '../src/auth/brevo-email-verification-mailer';
import {
  BarberProvisioningService,
  validateBarberProvisioningInput,
} from '../src/admin/barber-provisioning';
import {
  assertSafeLocalBarberExecution,
  BarberProvisioningSafetyError,
  getSafeBarberProvisioningErrorCode,
  inspectSafeBarberDatabaseDestination,
  isExplicitBarberProvisioningConfirmation,
} from '../src/admin/barber-provisioning-safety';
import { resolveBackendEnvPath } from './admin-cli-safety';

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
    const stdin = process.stdin;
    if (!stdin.setRawMode) {
      reject(new Error('Não foi possível ocultar a senha neste terminal.'));
      return;
    }

    let value = '';
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
  assertSafeLocalBarberExecution({
    argv: process.argv,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    environment: process.env,
  });

  const backendEnvPath = resolveBackendEnvPath(__dirname);
  config({ path: backendEnvPath, override: false });

  const destination = inspectSafeBarberDatabaseDestination(process.env);
  process.stdout.write(`Destino local aprovado: ${destination.summary}\n`);

  const confirmation = await readLine(
    `Digite exatamente PROVISIONAR BARBEIRO ${destination.database} para continuar: `,
  );
  if (
    !isExplicitBarberProvisioningConfirmation(
      confirmation,
      destination.database,
    )
  ) {
    throw new BarberProvisioningSafetyError(
      'BARBER_PROVISIONING_CANCELLED',
      'Provisionamento cancelado.',
    );
  }

  const input = {
    nome: await readLine('Nome do barbeiro: '),
    telefone: await readLine('Telefone (10 ou 11 dígitos): '),
    email: await readLine('E-mail: '),
    senha: await readHidden('Senha inicial: '),
    confirmarSenha: await readHidden('Confirme a senha: '),
    confirmacaoOperacional: confirmation,
  };
  validateBarberProvisioningInput(input);

  const mailer = createEmailVerificationMailer(process.env);
  const prisma = new PrismaService(destination.connectionString);
  const provisioning = new BarberProvisioningService(prisma);
  const emailVerification = new EmailVerificationService(prisma, mailer);

  try {
    const barber = await provisioning.provision(input);
    const confirmationSent =
      await emailVerification.sendRegistrationConfirmation(barber.id);

    process.stdout.write(
      `Conta BARBEIRO ${barber.id} e perfil ${barber.barbeiroId} criados. ` +
        'O login permanece bloqueado até a confirmação do e-mail.\n',
    );
    if (!confirmationSent) {
      process.stderr.write(
        'A confirmação não foi enviada. Corrija a configuração de e-mail e solicite o reenvio pelo fluxo existente.\n',
      );
      process.exitCode = 1;
    } else {
      process.stdout.write('E-mail de confirmação enviado.\n');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const code = getSafeBarberProvisioningErrorCode(error);
  process.stderr.write(
    `Falha no provisionamento [${code}]. Nenhum detalhe interno foi exibido.\n`,
  );
  process.exitCode = 1;
});
