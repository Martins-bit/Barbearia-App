CREATE TYPE "StatusWaitlistReoffer" AS ENUM (
    'PENDENTE',
    'PROCESSANDO',
    'CONCLUIDA',
    'FALHA_FINAL'
);

CREATE TYPE "OrigemWaitlistReoffer" AS ENUM (
    'CLAIM_RECUSADO',
    'ENTRADA_CANCELADA',
    'CLAIM_EXPIRADO',
    'AGENDAMENTO_CANCELADO',
    'BLOQUEIO_REMOVIDO'
);

CREATE TYPE "ResultadoWaitlistReoffer" AS ENUM (
    'CLAIM_CRIADO',
    'SEM_CANDIDATO',
    'FALHA_PERMANENTE'
);

CREATE TABLE "WaitlistReofferOutbox" (
    "id" SERIAL NOT NULL,
    "chaveIdempotencia" TEXT NOT NULL,
    "origem" "OrigemWaitlistReoffer" NOT NULL,
    "origemId" INTEGER,
    "barbeiroId" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,
    "status" "StatusWaitlistReoffer" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseAte" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "resultado" "ResultadoWaitlistReoffer",
    "concluidoEm" TIMESTAMP(3),
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistReofferOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaitlistReofferOutbox_chaveIdempotencia_key"
    ON "WaitlistReofferOutbox"("chaveIdempotencia");

CREATE INDEX "WaitlistReofferOutbox_status_proximaTentativaEm_id_idx"
    ON "WaitlistReofferOutbox"("status", "proximaTentativaEm", "id");

CREATE INDEX "WaitlistReofferOutbox_status_leaseAte_idx"
    ON "WaitlistReofferOutbox"("status", "leaseAte");

CREATE INDEX "WaitlistReofferOutbox_origem_origemId_idx"
    ON "WaitlistReofferOutbox"("origem", "origemId");

ALTER TABLE "WaitlistClaim"
    ADD COLUMN "reofertaOutboxId" INTEGER;

CREATE UNIQUE INDEX "WaitlistClaim_reofertaOutboxId_key"
    ON "WaitlistClaim"("reofertaOutboxId");

ALTER TABLE "WaitlistClaim"
    ADD CONSTRAINT "WaitlistClaim_reofertaOutboxId_fkey"
    FOREIGN KEY ("reofertaOutboxId")
    REFERENCES "WaitlistReofferOutbox"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
