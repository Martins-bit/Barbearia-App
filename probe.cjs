require('./backend/node_modules/dotenv').config({ path: 'C:/Users/SEEMG/Barbearia-App/backend/.env' });
const { PrismaService } = require('./backend/dist/prisma/prisma.service.js');

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const values = [];
  const client = prisma.$client;
  if (client) {
    client.$use(async (params, next) => {
      if (params.model === 'Mensagem' && params.action === 'create') {
        values.push(['CREATE', params.args]);
      }
      return next(params);
    });
  }

  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nome: true, tipoUsuario: true, ativo: true },
    orderBy: { id: 'asc' },
  });
  console.log('USUARIOS=' + JSON.stringify(usuarios));

  const barbeiros = await prisma.barbeiro.findMany({
    select: { id: true, usuarioId: true, ativo: true },
    orderBy: { id: 'asc' },
  });
  console.log('BARBEIROS=' + JSON.stringify(barbeiros));

  const clientes = await prisma.cliente.findMany({
    select: { id: true, usuarioId: true },
    orderBy: { id: 'asc' },
  });
  console.log('CLIENTES=' + JSON.stringify(clientes));

  const mensagens = await prisma.mensagem.findMany({
    select: { id: true, remetenteId: true, destinatarioId: true, conteudo: true, lida: true },
    orderBy: { id: 'asc' },
  });
  console.log('MENSAGENS=' + JSON.stringify(mensagens));

  console.log('QUEUES=' + JSON.stringify(values));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERR', e && e.message ? e.message : e);
  process.exit(1);
});
