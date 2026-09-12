-- CreateIndex
CREATE INDEX "Mensagem_remetenteId_destinatarioId_dataCriacao_idx" ON "Mensagem"("remetenteId", "destinatarioId", "dataCriacao");

-- CreateIndex
CREATE INDEX "Mensagem_destinatarioId_remetenteId_dataCriacao_idx" ON "Mensagem"("destinatarioId", "remetenteId", "dataCriacao");
