-- CreateEnum
CREATE TYPE "StatusWaitlistClaim" AS ENUM ('ATIVO', 'EXPIRADO', 'ACEITO', 'RECUSADO');

-- CreateTable
CREATE TABLE "WaitlistClaim" (
    "id" SERIAL NOT NULL,
    "listaEsperaId" INTEGER NOT NULL,
    "barbeiroId" INTEGER NOT NULL,
    "servicoId" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,
    "status" "StatusWaitlistClaim" NOT NULL DEFAULT 'ATIVO',
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaitlistClaim_barbeiroId_servicoId_data_horaInicio_horaFim_status_idx" ON "WaitlistClaim"("barbeiroId", "servicoId", "data", "horaInicio", "horaFim", "status");
CREATE INDEX "WaitlistClaim_listaEsperaId_status_idx" ON "WaitlistClaim"("listaEsperaId", "status");
CREATE INDEX "WaitlistClaim_expiraEm_idx" ON "WaitlistClaim"("expiraEm");

-- AddForeignKey
ALTER TABLE "WaitlistClaim" ADD CONSTRAINT "WaitlistClaim_listaEsperaId_fkey" FOREIGN KEY ("listaEsperaId") REFERENCES "ListaEspera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;