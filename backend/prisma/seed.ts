import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import seedData from "./seed-data.json";

const prisma = new PrismaClient();

/**
 * Este seed popula só o que é seguro versionar: tabelas de domínio (listas
 * mestras, sem dado pessoal) e um usuário administrador inicial.
 *
 * Colaboradores, equipamentos, linhas telefônicas etc. contêm CPF, telefone
 * e e-mail de pessoas reais — propositalmente NÃO ficam hardcoded aqui.
 * Para importar a base real, use `npm run import:csv` apontando para os
 * CSVs exportados da planilha/Airtable (ver prisma/import-csv.ts e README).
 */
async function main() {
  console.log("Semeando tabelas de domínio...");

  for (const nome of seedData.unidades) {
    await prisma.unidade.upsert({ where: { nome }, update: {}, create: { nome } });
  }

  for (const nome of seedData.setores) {
    await prisma.setor.upsert({ where: { nome }, update: {}, create: { nome } });
  }

  for (const razaoSocial of seedData.empresas) {
    await prisma.empresa.upsert({ where: { razaoSocial }, update: {}, create: { razaoSocial } });
  }

  for (const nome of seedData.sistemas) {
    await prisma.sistemaAcesso.upsert({ where: { nome }, update: {}, create: { nome } });
  }

  // Dropdowns administráveis de Patrimônio (Evolução Completa, 07/2026).
  // Continuam editáveis depois pela página Configurações — isso aqui é só o
  // ponto de partida, pra não obrigar o admin a cadastrar tudo do zero.
  for (const nome of seedData.categoriasEquipamento ?? []) {
    await prisma.categoriaEquipamento.upsert({ where: { nome }, update: {}, create: { nome } });
  }

  for (const nome of seedData.marcasEquipamento ?? []) {
    await prisma.marcaEquipamento.upsert({ where: { nome }, update: {}, create: { nome } });
  }

  // Catálogo de Papelaria e Compras (09/07/2026, pedido do Vini: "coloca os
  // itens de papelaria... todos que você conseguir, todos mesmo") — mesmo
  // racional de "seguro versionar" do restante deste arquivo: é lista
  // mestra sem dado pessoal, então entra aqui como ponto de partida (~100
  // produtos cobrindo as 10 frentes de consumo mais comuns de um escritório:
  // papel/impressão, escrita, arquivo, equipamentos de mesa, cadernos,
  // limpeza, copa/higiene, informática, sinalização e correios/embalagem).
  // upsert por nome em ambos os níveis (categoria e produto) — reexecutar o
  // seed num ambiente que já tem parte disso não duplica nada, e também não
  // apaga categorias/produtos que alguém já tenha criado manualmente depois
  // pela tela de Configurações (esta rotina nunca faz delete).
  for (const grupo of seedData.catalogoPapelaria ?? []) {
    const categoria = await prisma.categoriaProdutoPapelaria.upsert({
      where: { nome: grupo.categoria },
      update: {},
      create: { nome: grupo.categoria },
    });
    for (const produto of grupo.produtos) {
      await prisma.produtoPapelaria.upsert({
        where: { nome: produto.nome },
        update: {},
        create: {
          nome: produto.nome,
          categoriaId: categoria.id,
          unidadeMedidaPadrao: produto.unidadeMedidaPadrao as any,
        },
      });
    }
  }
  console.log(`Catálogo de papelaria semeado: ${(seedData.catalogoPapelaria ?? []).length} categorias.`);

  // Acesso extra a canal de chat interno (08/07/2026, pedido do Vini: "o
  // locação juntamente ao sucesso do cliente") — regra pro setor inteiro
  // (setorOrigemId), não uma pessoa específica: todo mundo cujo setor é
  // Locação também acompanha o canal de Sucesso do Cliente. Ver
  // AcessoCanalExtra em schema.prisma. Idempotente via findFirst antes de
  // criar (não há unique constraint natural pra usar upsert aqui).
  const setorLocacao = await prisma.setor.findUnique({ where: { nome: "Locação" } });
  const setorSucessoCliente = await prisma.setor.findUnique({ where: { nome: "Sucesso do Cliente" } });
  if (setorLocacao && setorSucessoCliente) {
    const jaExiste = await prisma.acessoCanalExtra.findFirst({
      where: { setorOrigemId: setorLocacao.id, tipo: "CANAL_SETOR", setorDestinoId: setorSucessoCliente.id },
    });
    if (!jaExiste) {
      await prisma.acessoCanalExtra.create({
        data: {
          setorOrigemId: setorLocacao.id,
          tipo: "CANAL_SETOR",
          setorDestinoId: setorSucessoCliente.id,
          observacao: "Locação acompanha Sucesso do Cliente (pedido do Vini, 08/07/2026).",
        },
      });
      console.log("Acesso extra de canal criado: Locação -> Sucesso do Cliente.");
    }
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const senhaHash = await bcrypt.hash(adminPassword, 12);
    await prisma.usuario.upsert({
      where: { email: adminEmail },
      update: {},
      create: { email: adminEmail, senhaHash, papel: "ADMINISTRADOR" },
    });
    console.log(`Usuário administrador pronto: ${adminEmail} (troque a senha no primeiro login).`);
  } else {
    console.warn(
      "SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD não definidos no .env — nenhum usuário administrador foi criado."
    );
  }

  console.log("Seed de domínio concluído.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
