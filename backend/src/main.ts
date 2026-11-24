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
import { parseTrustProxySetting } from './common/config/trust-proxy.config';

async function bootstrap() {
  const trustProxy = parseTrustProxySetting(process.env.TRUST_PROXY);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Headers de segurança (ETAPA 2). Helmet com os defaults seguros; a API é
  // JSON-only (não serve HTML nem define CSP própria), portanto os defaults
  // não quebram o consumo. Socket.IO e o JWT (header Authorization) não são
  // afetados.
  app.use(helmet());

  // Mantém a confiança em proxies desativada por padrão. O valor explícito é
  // convertido e validado antes de ser aplicado ao Express.
  if (trustProxy !== undefined) {
    try {
      app.set('trust proxy', trustProxy);
    } catch {
      throw new Error(
        'TRUST_PROXY contém um valor que o Express não aceita. Revise o formato sem compartilhar seu valor.',
      );
    }
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
