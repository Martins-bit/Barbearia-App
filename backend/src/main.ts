// Carrega as variaveis de ambiente do arquivo .env antes de qualquer outro
// modulo. Necessario porque JWT_CONFIG (common/config/jwt.config) avalia o
// segredo de forma eager no import; sem este carregamento o boot real em
// desenvolvimento/producao falharia com "JWT_SECRET must be defined".
import 'dotenv/config';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { buildCorsOptions } from './common/config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Headers de segurança (ETAPA 2). Helmet com os defaults seguros; a API é
  // JSON-only (não serve HTML nem define CSP própria), portanto os defaults
  // não quebram o consumo. Socket.IO e o JWT (header Authorization) não são
  // afetados.
  app.use(helmet());

  // Confiança no proxy (ETAPA 2) — OPT-IN e conservadora: só passa a confiar
  // em X-Forwarded-For quando TRUST_PROXY estiver explicitamente definido
  // (ex.: "1" para um único hop do Cloudflare). Por padrão NÃO confia em
  // cabeçalho enviado pelo cliente. Necessário publicar atrás do Cloudflare
  // para que req.ip (e o rate limit por IP) reflitam o cliente real.
  // Ver docs/SEGURANCA-INFRAESTRUTURA.md.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY);
  }

  // CORS (ETAPA 2): origens autorizadas vêm de CORS_ALLOWED_ORIGINS
  // (obrigatório em produção; locais por padrão em desenvolvimento), com
  // credentials: true e sem "*". A MESMA lista é usada pelo handshake do
  // Socket.IO (messages.gateway).
  app.enableCors(buildCorsOptions());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
