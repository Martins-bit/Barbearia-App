-- AlterEnum
ALTER TYPE "TipoNotificacao" ADD VALUE 'WAITLIST_OPPORTUNITY';

-- AlterTable
ALTER TABLE "Notificacao"
ADD COLUMN "claimId" INTEGER,
ADD COLUMN "dataLeitura" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notificacao_usuarioId_dataCriacao_idx" ON "Notificacao"("usuarioId", "dataCriacao");
CREATE INDEX "Notificacao_claimId_idx" ON "Notificacao"("claimId");

-- AddForeignKey
ALTER TABLE "Notificacao" ADD CONSTRAINT "Notificacao_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "WaitlistClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;