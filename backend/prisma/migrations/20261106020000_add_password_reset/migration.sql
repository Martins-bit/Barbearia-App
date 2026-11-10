ALTER TABLE "Usuario"
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PasswordResetToken" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key"
ON "PasswordResetToken"("tokenHash");

CREATE INDEX "PasswordResetToken_usuarioId_criadoEm_idx"
ON "PasswordResetToken"("usuarioId", "criadoEm");

CREATE INDEX "PasswordResetToken_expiraEm_idx"
ON "PasswordResetToken"("expiraEm");

ALTER TABLE "PasswordResetToken"
ADD CONSTRAINT "PasswordResetToken_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PasswordResetRateLimit" (
    "identifierHash" CHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordResetRateLimit_pkey" PRIMARY KEY ("identifierHash")
);

CREATE INDEX "PasswordResetRateLimit_windowStartedAt_idx"
ON "PasswordResetRateLimit"("windowStartedAt");