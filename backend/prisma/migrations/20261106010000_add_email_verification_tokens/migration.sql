ALTER TABLE "Usuario"
ADD COLUMN "emailVerificadoEm" TIMESTAMP(3);

CREATE TABLE "EmailVerificationToken" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key"
ON "EmailVerificationToken"("tokenHash");

CREATE INDEX "EmailVerificationToken_usuarioId_criadoEm_idx"
ON "EmailVerificationToken"("usuarioId", "criadoEm");

CREATE INDEX "EmailVerificationToken_expiraEm_idx"
ON "EmailVerificationToken"("expiraEm");

ALTER TABLE "EmailVerificationToken"
ADD CONSTRAINT "EmailVerificationToken_usuarioId_fkey"
FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id")
ON DELETE CASCADE ON UPDATE CASCADE;