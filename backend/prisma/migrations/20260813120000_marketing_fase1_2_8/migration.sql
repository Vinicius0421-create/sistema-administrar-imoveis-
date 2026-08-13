-- CreateEnum
CREATE TYPE "StatusImovel" AS ENUM ('DISPONIVEL', 'RESERVADO', 'VENDIDO', 'INATIVO');

-- CreateEnum
CREATE TYPE "PrioridadeImovel" AS ENUM ('A_COMERCIAL', 'B_PORTFOLIO', 'C_ESTOQUE');

-- CreateEnum
CREATE TYPE "TipoImovel" AS ENUM ('CASA', 'APARTAMENTO', 'LOTE', 'CHACARA', 'OUTRO');

-- AlterEnum
ALTER TYPE "CategoriaNotificacao" ADD VALUE 'MARKETING';

-- AlterEnum
ALTER TYPE "Papel" ADD VALUE 'MARKETING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoNotificacao" ADD VALUE 'MARKETING_IMOVEL_STATUS_MUDOU';
ALTER TYPE "TipoNotificacao" ADD VALUE 'MARKETING_IMOVEL_VENDIDO';
ALTER TYPE "TipoNotificacao" ADD VALUE 'MARKETING_SINCRONIZACAO_ERRO';

-- CreateTable
CREATE TABLE "imoveis_marketing" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "tipo" "TipoImovel" NOT NULL,
    "bairroRegiao" TEXT,
    "descricaoCurta" TEXT,
    "valor" DECIMAL(12,2),
    "corretorId" TEXT,
    "corretorNome" TEXT,
    "temFotos" BOOLEAN NOT NULL DEFAULT false,
    "temVideo" BOOLEAN NOT NULL DEFAULT false,
    "linkPasta" TEXT,
    "prioridade" "PrioridadeImovel" NOT NULL DEFAULT 'B_PORTFOLIO',
    "status" "StatusImovel" NOT NULL DEFAULT 'DISPONIVEL',
    "observacoes" TEXT,
    "origemImoview" BOOLEAN NOT NULL DEFAULT false,
    "codigoImoview" INTEGER,
    "fotoPrincipalUrl" TEXT,
    "fotosUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoUrl" TEXT,
    "tituloSugerido" TEXT,
    "descricaoSugerida" TEXT,
    "ultimaSincronizacaoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imoveis_marketing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sincronizacoes_imoview_log" (
    "id" TEXT NOT NULL,
    "executadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sucesso" BOOLEAN NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,

    CONSTRAINT "sincronizacoes_imoview_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canais_marketing" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" "StatusAtivoInativo" NOT NULL DEFAULT 'ATIVO',

    CONSTRAINT "canais_marketing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objetivos_marketing" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" "StatusAtivoInativo" NOT NULL DEFAULT 'ATIVO',

    CONSTRAINT "objetivos_marketing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "origens_lead_marketing" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" "StatusAtivoInativo" NOT NULL DEFAULT 'ATIVO',

    CONSTRAINT "origens_lead_marketing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_criativo_marketing" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" "StatusAtivoInativo" NOT NULL DEFAULT 'ATIVO',

    CONSTRAINT "tipos_criativo_marketing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "imoveis_marketing_codigo_key" ON "imoveis_marketing"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "imoveis_marketing_codigoImoview_key" ON "imoveis_marketing"("codigoImoview");

-- CreateIndex
CREATE UNIQUE INDEX "canais_marketing_nome_key" ON "canais_marketing"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "objetivos_marketing_nome_key" ON "objetivos_marketing"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "origens_lead_marketing_nome_key" ON "origens_lead_marketing"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_criativo_marketing_nome_key" ON "tipos_criativo_marketing"("nome");

-- AddForeignKey
ALTER TABLE "imoveis_marketing" ADD CONSTRAINT "imoveis_marketing_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imoveis_marketing" ADD CONSTRAINT "imoveis_marketing_corretorId_fkey" FOREIGN KEY ("corretorId") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

