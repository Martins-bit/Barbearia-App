import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import {
  OrigemWaitlistReoffer,
  ResultadoWaitlistReoffer,
  StatusWaitlistReoffer,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  ReleasedWindow,
  WaitlistOpportunityService,
} from './waitlist-opportunity.service';
import {
  MAX_WAITLIST_REOFFER_ATTEMPTS,
  WAITLIST_REOFFER_HEARTBEAT_MS,
  WAITLIST_REOFFER_LEASE_MS,
} from './waitlist-reoffer.constants';

const RETRY_BASE_DELAY_MS = 60 * 1000;
const RETRY_MAX_DELAY_MS = 15 * 60 * 1000;
export { MAX_WAITLIST_REOFFER_ATTEMPTS } from './waitlist-reoffer.constants';

export interface EnqueueWaitlistReoffer {
  idempotencyKey: string;
  origin: OrigemWaitlistReoffer;
  originId?: number;
  window: ReleasedWindow;
}

interface ClaimedReoffer extends ReleasedWindow {
  id: number;
  attempts: number;
}

type ReofferProcessingOutcome =
  'COMPLETED' | 'RETRY' | 'PERMANENT_FAILURE' | 'LEASE_LOST';

export interface ProcessWaitlistReoffersResult {
  claimedCount: number;
  completedCount: number;
  retryCount: number;
  permanentFailureCount: number;
}

@Injectable()
export class WaitlistReofferOutboxService {
  private readonly logger = new Logger(WaitlistReofferOutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunityService: WaitlistOpportunityService,
  ) {}

  async enqueue(
    tx: Prisma.TransactionClient | PrismaClient,
    event: EnqueueWaitlistReoffer,
  ): Promise<void> {
    await tx.waitlistReofferOutbox.upsert({
      where: { chaveIdempotencia: event.idempotencyKey },
      create: {
        chaveIdempotencia: event.idempotencyKey,
        origem: event.origin,
        origemId: event.originId,
        barbeiroId: event.window.barbeiroId,
        data: new Date(`${event.window.dateKey}T00:00:00.000Z`),
        horaInicio: event.window.horaInicio,
        horaFim: event.window.horaFim,
      },
      update: {},
    });
  }

  async processPendingReoffers(
    batchSize = 25,
  ): Promise<ProcessWaitlistReoffersResult> {
    const result: ProcessWaitlistReoffersResult = {
      claimedCount: 0,
      completedCount: 0,
      retryCount: 0,
      permanentFailureCount: 0,
    };

    try {
      const exhaustedCount = await this.finalizeExhaustedReoffers();
      result.permanentFailureCount += exhaustedCount;
      if (exhaustedCount > 0) {
        this.logger.error(
          `${exhaustedCount} pendência(s) da OUTBOX encerrada(s) após atingir ${MAX_WAITLIST_REOFFER_ATTEMPTS} tentativas.`,
        );
      }
    } catch {
      this.logger.error(
        'Falha ao encerrar pendências que esgotaram tentativas.',
      );
      return result;
    }

    for (let index = 0; index < batchSize; index++) {
      let job: ClaimedReoffer | undefined;
      try {
        job = await this.claimNextPendingReoffer();
      } catch {
        this.logger.error(
          'Falha ao adquirir pendência da lista de espera.',
        );
        break;
      }

      if (!job) {
        break;
      }

      result.claimedCount++;
      const outcome = await this.processClaimedReoffer(job);
      if (outcome === 'COMPLETED') {
        result.completedCount++;
      } else if (outcome === 'RETRY') {
        result.retryCount++;
      } else if (outcome === 'PERMANENT_FAILURE') {
        result.permanentFailureCount++;
      }
    }

    return result;
  }

  private async processClaimedReoffer(
    job: ClaimedReoffer,
  ): Promise<ReofferProcessingOutcome> {
    let leaseLost = false;
    let renewalInProgress = false;
    const heartbeat = setInterval(() => {
      if (renewalInProgress || leaseLost) {
        return;
      }

      renewalInProgress = true;
      void this.renewLease(job)
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
            this.logger.warn(
              `Lease da reoferta ${job.id}, tentativa ${job.attempts}, não pertence mais a este worker.`,
            );
          }
        })
        .catch(() => {
          this.logger.error(
            `Falha ao renovar lease da reoferta ${job.id}.`,
          );
        })
        .finally(() => {
          renewalInProgress = false;
        });
    }, WAITLIST_REOFFER_HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      if (leaseLost) {
        return 'LEASE_LOST';
      }

      const existingClaim = await this.findClaimForReoffer(job.id);
      if (existingClaim) {
        return (await this.complete(job, ResultadoWaitlistReoffer.CLAIM_CRIADO))
          ? 'COMPLETED'
          : 'LEASE_LOST';
      }

      const claim = await this.opportunityService.tryCreateForReleasedWindow(
        job,
        job.id,
        job.attempts,
      );
      const linkedClaim = claim ?? (await this.findClaimForReoffer(job.id));
      const completed = await this.complete(
        job,
        linkedClaim
          ? ResultadoWaitlistReoffer.CLAIM_CRIADO
          : ResultadoWaitlistReoffer.SEM_CANDIDATO,
      );
      return completed ? 'COMPLETED' : 'LEASE_LOST';
    } catch (error) {
      try {
        const existingClaim = await this.findClaimForReoffer(job.id);
        if (existingClaim) {
          return (await this.complete(
            job,
            ResultadoWaitlistReoffer.CLAIM_CRIADO,
          ))
            ? 'COMPLETED'
            : 'LEASE_LOST';
        }

        const isPermanent =
          (error instanceof HttpException && error.getStatus() < 500) ||
          job.attempts >= MAX_WAITLIST_REOFFER_ATTEMPTS;
        const updated = isPermanent
          ? await this.failPermanently(job, error)
          : await this.scheduleRetry(job, error);

        if (!updated) {
          this.logger.warn(
            `Tentativa ${job.attempts} da reoferta ${job.id} perdeu o lease; estado não foi atualizado.`,
          );
          return 'LEASE_LOST';
        }

        if (isPermanent) {
          this.logger.error(
            `Reoferta ${job.id} encerrada na tentativa ${job.attempts}.`,
          );
          return 'PERMANENT_FAILURE';
        }

        this.logger.error(
          `Falha ao processar reoferta ${job.id}; nova tentativa será feita após backoff.`,
        );
        return 'RETRY';
      } catch {
        this.logger.error(
          `Falha ao registrar recuperação da reoferta ${job.id}.`,
        );
        return 'LEASE_LOST';
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async claimNextPendingReoffer(): Promise<ClaimedReoffer | undefined> {
    const rows = await this.prisma.$transaction(
      (tx) => tx.$queryRaw<ClaimedReoffer[]>`
        WITH candidate AS (
          SELECT "id"
          FROM "WaitlistReofferOutbox"
          WHERE (
            "status" = ${StatusWaitlistReoffer.PENDENTE}::"StatusWaitlistReoffer"
            AND "proximaTentativaEm" <= (clock_timestamp() AT TIME ZONE 'UTC')
            AND "tentativas" < ${MAX_WAITLIST_REOFFER_ATTEMPTS}
          ) OR (
            "status" = ${StatusWaitlistReoffer.PROCESSANDO}::"StatusWaitlistReoffer"
            AND "leaseAte" <= (clock_timestamp() AT TIME ZONE 'UTC')
            AND "tentativas" < ${MAX_WAITLIST_REOFFER_ATTEMPTS}
          )
          ORDER BY "proximaTentativaEm", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "WaitlistReofferOutbox" AS outbox
        SET
          "status" = ${StatusWaitlistReoffer.PROCESSANDO}::"StatusWaitlistReoffer",
          "tentativas" = outbox."tentativas" + 1,
          "leaseAte" = (clock_timestamp() AT TIME ZONE 'UTC')
            + (${WAITLIST_REOFFER_LEASE_MS} * INTERVAL '1 millisecond'),
          "dataAtualizacao" = (clock_timestamp() AT TIME ZONE 'UTC')
        FROM candidate
        WHERE outbox."id" = candidate."id"
        RETURNING
          outbox."id",
          outbox."barbeiroId",
          to_char(outbox."data", 'YYYY-MM-DD') AS "dateKey",
          outbox."horaInicio",
          outbox."horaFim",
          outbox."tentativas" AS "attempts"
      `,
    );
    return rows[0];
  }

  private finalizeExhaustedReoffers(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "WaitlistReofferOutbox"
      SET
        "status" = ${StatusWaitlistReoffer.FALHA_FINAL}::"StatusWaitlistReoffer",
        "leaseAte" = NULL,
        "ultimoErro" = COALESCE(
          "ultimoErro",
          'Lease abandonado na tentativa máxima; encerrado para diagnóstico.'
        ),
        "resultado" = ${ResultadoWaitlistReoffer.FALHA_PERMANENTE}::"ResultadoWaitlistReoffer",
        "concluidoEm" = (clock_timestamp() AT TIME ZONE 'UTC'),
        "dataAtualizacao" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "tentativas" >= ${MAX_WAITLIST_REOFFER_ATTEMPTS}
        AND (
          "status" = ${StatusWaitlistReoffer.PENDENTE}::"StatusWaitlistReoffer"
          OR (
            "status" = ${StatusWaitlistReoffer.PROCESSANDO}::"StatusWaitlistReoffer"
            AND "leaseAte" <= (clock_timestamp() AT TIME ZONE 'UTC')
          )
        )
    `;
  }

  private async renewLease(job: ClaimedReoffer): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "WaitlistReofferOutbox"
      SET
        "leaseAte" = (clock_timestamp() AT TIME ZONE 'UTC')
          + (${WAITLIST_REOFFER_LEASE_MS} * INTERVAL '1 millisecond'),
        "dataAtualizacao" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${job.id}
        AND "status" = ${StatusWaitlistReoffer.PROCESSANDO}::"StatusWaitlistReoffer"
        AND "tentativas" = ${job.attempts}
        AND "leaseAte" > (clock_timestamp() AT TIME ZONE 'UTC')
    `;
    return updated === 1;
  }

  private findClaimForReoffer(outboxId: number) {
    return this.prisma.waitlistClaim.findUnique({
      where: { reofertaOutboxId: outboxId },
      select: { id: true },
    });
  }

  private async complete(
    job: ClaimedReoffer,
    result: ResultadoWaitlistReoffer,
  ): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "WaitlistReofferOutbox"
      SET
        "status" = ${StatusWaitlistReoffer.CONCLUIDA}::"StatusWaitlistReoffer",
        "leaseAte" = NULL,
        "ultimoErro" = NULL,
        "resultado" = ${result}::"ResultadoWaitlistReoffer",
        "concluidoEm" = (clock_timestamp() AT TIME ZONE 'UTC'),
        "dataAtualizacao" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${job.id}
        AND "status" = ${StatusWaitlistReoffer.PROCESSANDO}::"StatusWaitlistReoffer"
        AND "tentativas" = ${job.attempts}
        AND "leaseAte" > (clock_timestamp() AT TIME ZONE 'UTC')
    `;
    if (updated !== 1) {
      this.logger.warn(
        `Reoferta ${job.id}, tentativa ${job.attempts}, perdeu autorização antes da conclusão.`,
      );
      return false;
    }
    return true;
  }

  private async scheduleRetry(
    job: ClaimedReoffer,
    error: unknown,
  ): Promise<boolean> {
    const exponent = Math.min(Math.max(job.attempts - 1, 0), 20);
    const delay = Math.min(
      RETRY_BASE_DELAY_MS * 2 ** exponent,
      RETRY_MAX_DELAY_MS,
    );

    const updated = await this.prisma.$executeRaw`
      UPDATE "WaitlistReofferOutbox"
      SET
        "status" = ${StatusWaitlistReoffer.PENDENTE}::"StatusWaitlistReoffer",
        "proximaTentativaEm" = (clock_timestamp() AT TIME ZONE 'UTC')
          + (${delay} * INTERVAL '1 millisecond'),
        "leaseAte" = NULL,
        "ultimoErro" = ${this.errorCategory(error)},
        "dataAtualizacao" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${job.id}
        AND "status" = ${StatusWaitlistReoffer.PROCESSANDO}::"StatusWaitlistReoffer"
        AND "tentativas" = ${job.attempts}
        AND "leaseAte" > (clock_timestamp() AT TIME ZONE 'UTC')
    `;
    return updated === 1;
  }

  private async failPermanently(
    job: ClaimedReoffer,
    error: unknown,
  ): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "WaitlistReofferOutbox"
      SET
        "status" = ${StatusWaitlistReoffer.FALHA_FINAL}::"StatusWaitlistReoffer",
        "leaseAte" = NULL,
        "ultimoErro" = ${this.errorCategory(error)},
        "resultado" = ${ResultadoWaitlistReoffer.FALHA_PERMANENTE}::"ResultadoWaitlistReoffer",
        "concluidoEm" = (clock_timestamp() AT TIME ZONE 'UTC'),
        "dataAtualizacao" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${job.id}
        AND "status" = ${StatusWaitlistReoffer.PROCESSANDO}::"StatusWaitlistReoffer"
        AND "tentativas" = ${job.attempts}
        AND "leaseAte" > (clock_timestamp() AT TIME ZONE 'UTC')
    `;
    return updated === 1;
  }

  private errorCategory(error: unknown): string {
    if (error instanceof HttpException) {
      return `Falha de regra HTTP ${error.getStatus()}.`;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return `Falha de persistência Prisma ${error.code}.`;
    }
    return 'Falha inesperada de processamento.';
  }
}
