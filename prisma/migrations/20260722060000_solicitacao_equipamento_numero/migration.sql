-- Achado de auditoria S12 (22/07/2026, "nivelar os 4 fluxos de
-- Solicitação"): SolicitacaoEquipamento era o único dos 4 fluxos sem número
-- sequencial visível (Chamado, SolicitacaoPapelaria e SolicitacaoServico já
-- tinham). Mesmo padrão já usado em 20260705160000_chamados_fase2_reescrita
-- para adicionar "numero" a uma tabela que já tinha dados em produção: SERIAL
-- via ALTER TABLE preenche as linhas existentes automaticamente, em ordem,
-- sem precisar de um backfill manual separado.
-- AlterTable
ALTER TABLE "solicitacoes_equipamento" ADD COLUMN     "numero" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "solicitacoes_equipamento_numero_key" ON "solicitacoes_equipamento"("numero");
