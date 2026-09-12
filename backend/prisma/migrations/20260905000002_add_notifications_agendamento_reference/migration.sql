-- AlterTable
ALTER TABLE "Notificacao" ADD COLUMN "agendamentoId" INTEGER;

-- CreateIndex
CREATE INDEX "Notificacao_agendamentoId_idx" ON "Notificacao"("agendamentoId");

-- AddForeignKey
ALTER TABLE "Notificacao" ADD CONSTRAINT "Notificacao_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "Agendamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;