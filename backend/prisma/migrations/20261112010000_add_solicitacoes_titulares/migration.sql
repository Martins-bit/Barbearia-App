CREATE TYPE "CategoriaSolicitacaoTitular" AS ENUM (
    'ACESSO_EXPORTACAO',
    'CORRECAO',
    'EXCLUSAO_ANONIMIZACAO',
    'OUTRA'
);

CREATE TYPE "StatusSolicitacaoTitular" AS ENUM (
    'RECEBIDA'
);

CREATE TABLE "SolicitacaoTitular" (
    "id" SERIAL NOT NULL,
    "titularId" INTEGER NOT NULL,
    "chaveIdempotencia" UUID NOT NULL,
    "categoria" "CategoriaSolicitacaoTitular" NOT NULL,
    "status" "StatusSolicitacaoTitular" NOT NULL DEFAULT 'RECEBIDA',
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolicitacaoTitular_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SolicitacaoTitular_titularId_chaveIdempotencia_key"
    ON "SolicitacaoTitular"("titularId", "chaveIdempotencia");

CREATE INDEX "SolicitacaoTitular_titularId_dataCriacao_id_idx"
    ON "SolicitacaoTitular"("titularId", "dataCriacao", "id");

ALTER TABLE "SolicitacaoTitular"
    ADD CONSTRAINT "SolicitacaoTitular_titularId_fkey"
    FOREIGN KEY ("titularId")
    REFERENCES "Usuario"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
