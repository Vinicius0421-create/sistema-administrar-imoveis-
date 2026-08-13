-- RH — Documentos de colaborador (11/08/2026, Fase RH da Evolução Completa).
-- Puramente aditiva: 2 enums novos, 3 tabelas novas, 7 valores novos em
-- enums já existentes (CategoriaNotificacao/TipoNotificacao) — nenhuma
-- coluna/tabela existente é alterada ou removida.
--
-- ⚠️ Escrita à mão (sem Postgres local disponível neste ambiente para rodar
-- `prisma migrate dev` e gerar/validar automaticamente — ver nota no
-- CLAUDE.md do projeto sobre reconciliar migrations contra um banco de
-- teste). Sintaxe conferida contra o padrão das migrations já existentes
-- neste diretório (nomes de constraint/index, tipos de coluna, JSONB para
-- campos `Json?`). Antes de aplicar em produção: rodar `prisma migrate
-- deploy` (nunca `db push`) contra um banco de teste primeiro, com
-- `prisma migrate status` limpo antes e depois.

-- CreateEnum
CREATE TYPE "StatusDocumentoColaborador" AS ENUM ('SOLICITADO', 'ENVIADO', 'EM_ANALISE', 'APROVADO', 'REJEITADO', 'EXPIRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoEventoDocumentoColaborador" AS ENUM ('SOLICITACAO', 'ENVIO', 'REENVIO_SOLICITADO', 'ANALISE_APROVADA', 'ANALISE_REJEITADA', 'COMENTARIO', 'ALERTA_VENCIMENTO', 'EXPIRADO', 'CANCELADO');

-- AlterEnum (novos valores em enums já existentes — cada ADD VALUE precisa
-- de seu próprio statement; nenhum dos dois é usado nesta mesma migration,
-- então não há o problema de "unsafe use of new value before commit").
ALTER TYPE "CategoriaNotificacao" ADD VALUE 'DOCUMENTO';
ALTER TYPE "TipoNotificacao" ADD VALUE 'DOCUMENTO_SOLICITADO';
ALTER TYPE "TipoNotificacao" ADD VALUE 'DOCUMENTO_ENVIADO';
ALTER TYPE "TipoNotificacao" ADD VALUE 'DOCUMENTO_APROVADO';
ALTER TYPE "TipoNotificacao" ADD VALUE 'DOCUMENTO_REJEITADO';
ALTER TYPE "TipoNotificacao" ADD VALUE 'DOCUMENTO_VENCENDO';
ALTER TYPE "TipoNotificacao" ADD VALUE 'DOCUMENTO_COMENTARIO';

-- CreateTable
CREATE TABLE "tipos_documento" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "exigeValidade" BOOLEAN NOT NULL DEFAULT false,
    "diasAntecedenciaAlerta" INTEGER[] DEFAULT ARRAY[30, 15, 7, 1]::INTEGER[],
    "status" "StatusAtivoInativo" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipos_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_colaborador" (
    "id" TEXT NOT NULL,
    "colaboradorId" TEXT NOT NULL,
    "tipoDocumentoId" TEXT NOT NULL,
    "status" "StatusDocumentoColaborador" NOT NULL DEFAULT 'SOLICITADO',
    "solicitadoPorId" TEXT,
    "solicitadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacaoSolicitacao" TEXT,
    "arquivoUrl" TEXT,
    "arquivoNomeOriginal" TEXT,
    "arquivoTipo" TEXT,
    "arquivoTamanhoBytes" INTEGER,
    "enviadoEm" TIMESTAMP(3),
    "dataValidade" TIMESTAMP(3),
    "analisadoPorId" TEXT,
    "analisadoEm" TIMESTAMP(3),
    "motivoRejeicao" TEXT,
    "alertasVencimentoEnviados" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_colaborador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_colaborador_eventos" (
    "id" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "tipo" "TipoEventoDocumentoColaborador" NOT NULL,
    "autorId" TEXT,
    "mensagem" TEXT,
    "detalhe" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_colaborador_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tipos_documento_nome_key" ON "tipos_documento"("nome");

-- CreateIndex
CREATE INDEX "documentos_colaborador_colaboradorId_idx" ON "documentos_colaborador"("colaboradorId");

-- CreateIndex
CREATE INDEX "documentos_colaborador_tipoDocumentoId_idx" ON "documentos_colaborador"("tipoDocumentoId");

-- CreateIndex
CREATE INDEX "documentos_colaborador_status_idx" ON "documentos_colaborador"("status");

-- CreateIndex
CREATE INDEX "documentos_colaborador_status_dataValidade_idx" ON "documentos_colaborador"("status", "dataValidade");

-- CreateIndex
CREATE INDEX "documentos_colaborador_eventos_documentoId_idx" ON "documentos_colaborador_eventos"("documentoId");

-- AddForeignKey
ALTER TABLE "documentos_colaborador" ADD CONSTRAINT "documentos_colaborador_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "colaboradores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_colaborador" ADD CONSTRAINT "documentos_colaborador_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "tipos_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_colaborador" ADD CONSTRAINT "documentos_colaborador_solicitadoPorId_fkey" FOREIGN KEY ("solicitadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_colaborador" ADD CONSTRAINT "documentos_colaborador_analisadoPorId_fkey" FOREIGN KEY ("analisadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_colaborador_eventos" ADD CONSTRAINT "documentos_colaborador_eventos_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "documentos_colaborador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_colaborador_eventos" ADD CONSTRAINT "documentos_colaborador_eventos_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
