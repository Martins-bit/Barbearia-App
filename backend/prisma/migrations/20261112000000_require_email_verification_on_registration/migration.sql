ALTER TABLE "Usuario"
ADD COLUMN "emailConfirmacaoObrigatoria" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EmailVerificationRateLimit" (
    "emailHash" CHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL,
    "lastRequestedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailVerificationRateLimit_pkey" PRIMARY KEY ("emailHash")
);

CREATE INDEX "EmailVerificationRateLimit_windowStartedAt_idx"
ON "EmailVerificationRateLimit"("windowStartedAt");
