-- CreateEnum
CREATE TYPE "TipoUsuario" AS ENUM ('CLIENTE', 'BARBEIRO');

-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('CONFIRMADO', 'CANCELADO', 'CONCLUIDO', 'NAO_COMPARECEU');

-- CreateEnum
CREATE TYPE "StatusListaEspera" AS ENUM ('ATIVA', 'NOTIFICADA', 'ATENDIDA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "TipoNotificacao" AS ENUM ('AGENDAMENTO', 'CANCELAMENTO', 'LEMBRETE', 'LISTA_ESPERA', 'EMERGENCIA', 'AVISO', 'ALTERACAO_HORARIO');

-- CreateEnum
CREATE TYPE "StatusEmergencia" AS ENUM ('ATIVA', 'ENCERRADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT,
    "senhaHash" TEXT NOT NULL,
    "tipoUsuario" "TipoUsuario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barbeiro" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Barbeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servico" (
    "id" SERIAL NOT NULL,
    "barbeiroId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "duracaoMinutos" INTEGER NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agendamento" (
    "id" SERIAL NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "barbeiroId" INTEGER NOT NULL,
    "servicoId" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "horaInicio" TIMESTAMP(3) NOT NULL,
    "horaFim" TIMESTAMP(3) NOT NULL,
    "status" "StatusAgendamento" NOT NULL DEFAULT 'CONFIRMADO',
    "observacoes" TEXT,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListaEspera" (
    "id" SERIAL NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "servicoId" INTEGER NOT NULL,
    "dataDesejada" DATE NOT NULL,
    "status" "StatusListaEspera" NOT NULL DEFAULT 'ATIVA',
    "dataEntrada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListaEspera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacao" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "tipo" "TipoNotificacao" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mensagem" (
    "id" SERIAL NOT NULL,
    "remetenteId" INTEGER NOT NULL,
    "destinatarioId" INTEGER NOT NULL,
    "conteudo" VARCHAR(50) NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorarioFuncionamento" (
    "id" SERIAL NOT NULL,
    "barbeiroId" INTEGER NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HorarioFuncionamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloqueioAgenda" (
    "id" SERIAL NOT NULL,
    "barbeiroId" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "horaInicio" TIMESTAMP(3) NOT NULL,
    "horaFim" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BloqueioAgenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Emergencia" (
    "id" SERIAL NOT NULL,
    "barbeiroId" INTEGER NOT NULL,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT NOT NULL,
    "status" "StatusEmergencia" NOT NULL DEFAULT 'ATIVA',
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Emergencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_telefone_key" ON "Usuario"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_usuarioId_key" ON "Cliente"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Barbeiro_usuarioId_key" ON "Barbeiro"("usuarioId");

-- CreateIndex
CREATE INDEX "Servico_barbeiroId_idx" ON "Servico"("barbeiroId");

-- CreateIndex
CREATE INDEX "Servico_ativo_idx" ON "Servico"("ativo");

-- CreateIndex
CREATE INDEX "Agendamento_clienteId_idx" ON "Agendamento"("clienteId");

-- CreateIndex
CREATE INDEX "Agendamento_barbeiroId_data_idx" ON "Agendamento"("barbeiroId", "data");

-- CreateIndex
CREATE INDEX "Agendamento_servicoId_idx" ON "Agendamento"("servicoId");

-- CreateIndex
CREATE INDEX "Agendamento_status_idx" ON "Agendamento"("status");

-- CreateIndex
CREATE INDEX "ListaEspera_clienteId_idx" ON "ListaEspera"("clienteId");

-- CreateIndex
CREATE INDEX "ListaEspera_servicoId_dataDesejada_status_idx" ON "ListaEspera"("servicoId", "dataDesejada", "status");

-- CreateIndex
CREATE INDEX "Notificacao_usuarioId_lida_idx" ON "Notificacao"("usuarioId", "lida");

-- CreateIndex
CREATE INDEX "Mensagem_remetenteId_idx" ON "Mensagem"("remetenteId");

-- CreateIndex
CREATE INDEX "Mensagem_destinatarioId_lida_idx" ON "Mensagem"("destinatarioId", "lida");

-- CreateIndex
CREATE INDEX "HorarioFuncionamento_barbeiroId_diaSemana_idx" ON "HorarioFuncionamento"("barbeiroId", "diaSemana");

-- CreateIndex
CREATE INDEX "BloqueioAgenda_barbeiroId_data_idx" ON "BloqueioAgenda"("barbeiroId", "data");

-- CreateIndex
CREATE INDEX "Emergencia_barbeiroId_dataInicio_dataFim_idx" ON "Emergencia"("barbeiroId", "dataInicio", "dataFim");

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barbeiro" ADD CONSTRAINT "Barbeiro_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "Servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListaEspera" ADD CONSTRAINT "ListaEspera_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListaEspera" ADD CONSTRAINT "ListaEspera_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "Servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notificacao" ADD CONSTRAINT "Notificacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_remetenteId_fkey" FOREIGN KEY ("remetenteId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensagem" ADD CONSTRAINT "Mensagem_destinatarioId_fkey" FOREIGN KEY ("destinatarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorarioFuncionamento" ADD CONSTRAINT "HorarioFuncionamento_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloqueioAgenda" ADD CONSTRAINT "BloqueioAgenda_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Emergencia" ADD CONSTRAINT "Emergencia_barbeiroId_fkey" FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
