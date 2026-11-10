-- AlterTable
ALTER TABLE "Notificacao" ADD COLUMN "limpa" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Notificacao_usuarioId_limpa_idx" ON "Notificacao"("usuarioId", "limpa");
