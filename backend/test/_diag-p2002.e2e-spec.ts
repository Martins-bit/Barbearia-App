/**
 * SCRIPT TEMPORÁRIO (diagnóstico) — inspeciona o formato REAL do erro P2002
 * produzido pelo Prisma 7 + @prisma/adapter-pg.
 * NÃO faz parte da aplicação; será removido ao final do diagnóstico.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';

describe('diagnostico P2002', () => {
  it('dump do shape real do erro', async () => {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    const prisma = new PrismaClient({ adapter });

    const stamp = String(Date.now()).slice(-8);
    const senhaHash = 'hash-temp-diagnostico';

    const u1 = await prisma.usuario.create({
      data: {
        nome: 'Diag A',
        telefone: `${stamp}01`,
        email: `diag.${stamp}@email.com`,
        senhaHash,
        tipoUsuario: 'CLIENTE',
        cliente: { create: {} },
      },
    });
    const u2 = await prisma.usuario.create({
      data: {
        nome: 'Diag B',
        telefone: `${stamp}02`,
        email: null,
        senhaHash,
        tipoUsuario: 'CLIENTE',
        cliente: { create: {} },
      },
    });

    const ids = [u1.id, u2.id];

    try {
      console.log('\n##### CASO 1: violar UNIQUE de e-mail #####');
      await prisma.usuario.update({
        where: { id: u2.id },
        data: { email: u1.email },
      });
    } catch (error) {
      dump('email', error);
    }

    try {
      console.log('\n##### CASO 2: violar UNIQUE de telefone #####');
      await prisma.usuario.update({
        where: { id: u2.id },
        data: { telefone: u1.telefone },
      });
    } catch (error) {
      dump('telefone', error);
    }

    await prisma.cliente.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }, 60000);
});

function dump(caso: string, error: unknown) {
  console.log('--- caso:', caso, '---');
  console.log('constructor.name      =', (error as object)?.constructor?.name);
  console.log(
    'instanceof PrismaKnown=',
    error instanceof Prisma.PrismaClientKnownRequestError,
  );
  const e = error as { code?: string; message?: string; meta?: unknown };
  console.log('code                  =', e?.code);
  console.log('message               =', e?.message);
  console.log('meta                  =', JSON.stringify(e?.meta, null, 2));
  console.log(
    'meta.target           =',
    JSON.stringify((e?.meta as { target?: unknown })?.target),
  );
  console.log(
    'meta.driverAdapterError =',
    JSON.stringify(
      (e?.meta as { driverAdapterError?: unknown })?.driverAdapterError,
      null,
      2,
    ),
  );
  const dae = (e?.meta as { driverAdapterError?: { cause?: unknown } })
    ?.driverAdapterError;
  console.log('dae.cause             =', JSON.stringify(dae?.cause, null, 2));
}
