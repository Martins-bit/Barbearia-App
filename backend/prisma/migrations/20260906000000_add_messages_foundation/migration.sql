-- AlterTable
ALTER TABLE "Mensagem" ALTER COLUMN "conteudo" TYPE TEXT;
ALTER TABLE "Mensagem" ADD COLUMN "dataLeitura" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Mensagem_destinatarioId_dataCriacao_idx" ON "Mensagem"("destinatarioId", "dataCriacao");