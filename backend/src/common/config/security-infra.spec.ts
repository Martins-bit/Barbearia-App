import {
  Controller,
  Get,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import helmet from 'helmet';
import request from 'supertest';
import { buildCorsOptions } from './cors.config';

/**
 * Teste de INTEGRAÇÃO dos controles de infraestrutura (Etapa 2), montando uma
 * aplicação Nest mínima — SEM AppModule e SEM banco — para validar:
 *   - cabeçalhos de segurança (Helmet);
 *   - CORS REST (origem autorizada, origem rejeitada, preflight OPTIONS);
 *   - rate limiting (429) em uma rota sensível.
 *
 * Usa as MESMAS funções de produção (`buildCorsOptions`) e o ThrottlerGuard.
 */
@Controller()
class ProbeController {
  @Get('probe')
  probe(): { ok: true } {
    return { ok: true };
  }

  @Post('limited')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  limited(): { ok: true } {
    return { ok: true };
  }
}

describe('Segurança de infraestrutura (Etapa 2)', () => {
  const AUTHORIZED = 'http://localhost:5173';
  const UNAUTHORIZED = 'https://malicioso.exemplo';
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mesmos middlewares do main.ts, sem depender de banco/JWT.
    app.use(helmet());
    app.enableCors(buildCorsOptions());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Helmet', () => {
    it('retorna cabeçalhos de segurança nas respostas HTTP', async () => {
      const res = await request(app.getHttpServer()).get('/probe').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      // Helmet adiciona CSP por padrão.
      expect(res.headers['content-security-policy']).toBeDefined();
    });
  });

  describe('CORS REST', () => {
    it('origem autorizada recebe o cabeçalho Access-Control-Allow-Origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('Origin', AUTHORIZED)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(AUTHORIZED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('origem NÃO autorizada não recebe o cabeçalho de autorização CORS', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('Origin', UNAUTHORIZED)
        .expect(200);
      // Sem allow-origin para origem não listada → o navegador bloquearia.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('preflight OPTIONS funciona para origem autorizada', async () => {
      const res = await request(app.getHttpServer())
        .options('/probe')
        .set('Origin', AUTHORIZED)
        .set('Access-Control-Request-Method', 'POST');
      expect([200, 204]).toContain(res.status);
      expect(res.headers['access-control-allow-origin']).toBe(AUTHORIZED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('Rate limiting (429)', () => {
    it('respeita o limite configurado e retorna 429 ao exceder', async () => {
      const server = app.getHttpServer();
      // Limite = 3 por minuto nesta rota de teste.
      for (let i = 0; i < 3; i++) {
        await request(server).post('/limited').expect(201);
      }
      // A 4ª requisição excede o limite → 429.
      await request(server).post('/limited').expect(429);
    });
  });
});
