-- Múltiplos telefones por colaborador (07/08/2026, pedido do Vini) —
-- substitui o campo único "telefone" (texto solto, "telefone de contato",
-- distinto da linha corporativa em linhas_telefonicas) por uma tabela
-- própria, permitindo número + tipo + principal + observação por colaborador.
--
-- Escrita à mão (não gerada por `prisma migrate dev`) porque este schema foi
-- recuperado por mineração de transcrição (ver
-- Recuperacao_Codigo_Fonte_07-08-2026.md) e o histórico real de migrations
-- de produção não pôde ser recuperado por completo — só esta e uma migration
-- anterior estão neste diretório. A tabela "colaboradores" real em produção
-- deve ter a coluna "telefone" (confirmado pelo uso extensivo no código
-- recuperado), mas a migração abaixo é defensiva: só tenta migrar dados da
-- coluna antiga se ela realmente existir, para não falhar caso o schema real
-- já tenha divergido disso por algum motivo não capturado na recuperação.
--
-- ⚠️ ANTES DE RODAR EM PRODUÇÃO: `prisma migrate deploy` (nunca `db push`
-- direto), e de preferência com um backup/snapshot do banco tirado antes —
-- é uma migração que move dados entre uma coluna e uma tabela nova.

-- CreateEnum
CREATE TYPE "TipoTelefoneColaborador" AS ENUM ('CELULAR', 'RESIDENCIAL', 'COMERCIAL', 'WHATSAPP', 'OUTRO');

-- CreateTable
CREATE TABLE "telefones_colaborador" (
    "id" TEXT NOT NULL,
    "colaboradorId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo" "TipoTelefoneColaborador" NOT NULL DEFAULT 'CELULAR',
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telefones_colaborador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telefones_colaborador_colaboradorId_idx" ON "telefones_colaborador"("colaboradorId");

-- AddForeignKey
ALTER TABLE "telefones_colaborador" ADD CONSTRAINT "telefones_colaborador_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "colaboradores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: copia o telefone único de cada colaborador (quando
-- preenchido) para um primeiro registro principal na tabela nova — id
-- gerado com o mesmo esquema do Prisma (cuid não é gerável em SQL puro, por
-- isso usa-se gen_random_uuid() como id; funciona igual para o Prisma, que
-- só exige uma string única, não exige que seja um cuid de verdade).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'colaboradores' AND column_name = 'telefone'
  ) THEN
    INSERT INTO "telefones_colaborador" ("id", "colaboradorId", "numero", "tipo", "principal", "criadoEm", "atualizadoEm")
    SELECT gen_random_uuid()::text, "id", "telefone", 'CELULAR', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "colaboradores"
    WHERE "telefone" IS NOT NULL AND btrim("telefone") <> '';

    ALTER TABLE "colaboradores" DROP COLUMN "telefone";
  END IF;
END $$;
