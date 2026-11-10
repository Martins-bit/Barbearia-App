-- AlterTable
ALTER TABLE "Mensagem" ADD COLUMN "apagadaParaTodos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "excluidaPeloRemetente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "excluidaPeloDestinatario" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dataExclusao" TIMESTAMP(3);
