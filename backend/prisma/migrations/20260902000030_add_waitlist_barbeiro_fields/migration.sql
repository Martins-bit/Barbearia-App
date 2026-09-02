/*
  Warnings:

  - Added the required column `barbeiroId` to the `ListaEspera` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ListaEspera" ADD COLUMN     "barbeiroId" INTEGER NOT NULL,
ADD COLUMN     "horaFim" TEXT,
ADD COLUMN     "horaInicio" TEXT;

-- CreateIndex
CREATE INDEX "ListaEspera_barbeiroId_idx" ON "ListaEspera"("barbeiroId");

-- CreateIndex
CREATE INDEX "ListaEspera_clienteId_barbeiroId_servicoId_dataDesejada_sta_idx" ON "ListaEspera"("clienteId", "barbeiroId", "servicoId", "dataDesejada", "status");

-- AddForeignKey
ALTER TABLE "ListaEspera" ADD CONSTRAINT "ListaEspera_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
