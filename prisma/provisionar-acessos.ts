import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient, Papel } from "@prisma/client";
import bcrypt from "bcryptjs";
import { isValidCpf } from "../src/utils/cpf";

/**
 * Cria (ou atualiza) o cadastro de Colaborador + o login (Usuario) de cada
 * pessoa listada em um CSV, todos com a MESMA senha temporária — decisão
 * consciente do Vini (2026-07-03): mais rápido de distribuir, com o risco
 * de personificação entre colegas mitigado por precisaTrocarSenha=true,
 * que trava qualquer rota da API além de /auth/me e /auth/senha até a
 * pessoa escolher uma senha só dela no primeiro login (ver src/plugins/auth.ts).
 *
 * Uso:
 *   1. Coloque o CSV em prisma/import/colaboradores-acesso.csv (pasta já no
 *      .gitignore — nunca é commitado). Colunas esperadas (cabeçalho):
 *        nomeCompleto, cpf, email, unidade, setor, cargo, papel, contaFuncao, observacoes
 *      - nomeCompleto, email: sempre obrigatórios (email é o login).
 *      - cpf: obrigatório e validado (isValidCpf) a não ser que
 *        contaFuncao="true" — nesse caso pode ficar em branco.
 *      - contaFuncao: opcional, "true"/"false". Marca contas de função (ex:
 *        recepção de uma unidade) que rodam entre pessoas diferentes e não
 *        têm CPF fixo — o nome (nomeCompleto) fica livre pra editar direto
 *        na tela Colaboradores sempre que a pessoa do posto mudar. Default: false.
 *      - observacoes: opcional, texto livre — usado aqui pra documentar
 *        pendências do registro (ex: "CPF placeholder, confirmar o real").
 *      - unidade / setor / cargo: opcionais, precisam bater com o nome
 *        exato já cadastrado no sistema (ver tela Configurações).
 *      - papel: opcional, um de ADMINISTRADOR | GESTOR_COORDENADOR |
 *        SUPORTE_TI | COLABORADOR. Default: COLABORADOR.
 *   2. Defina a senha temporária compartilhada:
 *        SENHA_TEMPORARIA_COMPARTILHADA="algo-forte-aqui" npm run provisionar
 *   3. Rode `npm run provisionar`. Idempotente — rodar de novo atualiza
 *      cadastro e re-emite a MESMA senha temporária apenas para quem ainda
 *      não trocou (precisaTrocarSenha=true); quem já trocou não é afetado.
 */

const prisma = new PrismaClient();
const IMPORT_DIR = path.join(__dirname, "import");
const ARQUIVO = "colaboradores-acesso.csv";

const PAPEIS_VALIDOS: Papel[] = ["ADMINISTRADOR", "GESTOR_COORDENADOR", "SUPORTE_TI", "COLABORADOR"];

function campo(row: Record<string, string>, chave: string): string {
  return (row[chave] ?? "").trim();
}

async function main() {
  const senhaTemporaria = process.env.SENHA_TEMPORARIA_COMPARTILHADA;
  if (!senhaTemporaria || senhaTemporaria.length < 8) {
    console.error(
      "Defina SENHA_TEMPORARIA_COMPARTILHADA (mínimo 8 caracteres) antes de rodar. Ex:\n" +
        '  SENHA_TEMPORARIA_COMPARTILHADA="Adm2026#Provisorio" npm run provisionar'
    );
    process.exit(1);
  }

  const filePath = path.join(IMPORT_DIR, ARQUIVO);
  if (!existsSync(filePath)) {
    console.error(`Arquivo não encontrado: prisma/import/${ARQUIVO}`);
    console.error("Colunas esperadas: nomeCompleto, cpf, email, unidade, setor, cargo, papel, contaFuncao, observacoes");
    process.exit(1);
  }

  const linhas = parse(readFileSync(filePath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const senhaHash = await bcrypt.hash(senhaTemporaria, 12);

  let criados = 0;
  let atualizados = 0;
  let pulados = 0;

  for (const [indice, row] of linhas.entries()) {
    const linhaNum = indice + 2; // +2: cabeçalho ocupa a linha 1
    const nomeCompleto = campo(row, "nomeCompleto");
    const cpfRaw = campo(row, "cpf");
    const cpfDigits = cpfRaw.replace(/\D/g, "");
    const email = campo(row, "email");
    const observacoes = campo(row, "observacoes") || null;
    const contaFuncao = campo(row, "contaFuncao").toLowerCase() === "true";
    const papelRaw = campo(row, "papel").toUpperCase() as Papel;
    const papel: Papel = PAPEIS_VALIDOS.includes(papelRaw) ? papelRaw : "COLABORADOR";

    if (!nomeCompleto || !email) {
      console.warn(`[linha ${linhaNum}] pulada — nomeCompleto e email são obrigatórios.`);
      pulados++;
      continue;
    }
    // Conta de função (ex: recepção rotativa): sem CPF fixo, não valida.
    // Pessoa de verdade: CPF obrigatório e validado, igual à tela Colaboradores.
    if (!contaFuncao && (!cpfDigits || !isValidCpf(cpfDigits))) {
      console.warn(`[linha ${linhaNum}] pulada — CPF ausente/inválido para "${nomeCompleto}" (e não é contaFuncao).`);
      pulados++;
      continue;
    }

    const [unidade, setor, cargo] = await Promise.all([
      campo(row, "unidade") ? prisma.unidade.findUnique({ where: { nome: campo(row, "unidade") } }) : null,
      campo(row, "setor") ? prisma.setor.findUnique({ where: { nome: campo(row, "setor") } }) : null,
      campo(row, "cargo")
        ? prisma.cargo.findFirst({ where: { nome: campo(row, "cargo") } })
        : null,
    ]);
    if (campo(row, "unidade") && !unidade) console.warn(`[linha ${linhaNum}] unidade "${campo(row, "unidade")}" não encontrada — deixado em branco.`);
    if (campo(row, "setor") && !setor) console.warn(`[linha ${linhaNum}] setor "${campo(row, "setor")}" não encontrado — deixado em branco.`);
    if (campo(row, "cargo") && !cargo) console.warn(`[linha ${linhaNum}] cargo "${campo(row, "cargo")}" não encontrado — deixado em branco.`);

    // upsert por CPF só funciona quando o CPF existe (contas de função não
    // têm CPF, e Postgres trata múltiplos NULL como valores distintos na
    // constraint @unique — não daria pra usar como chave mesmo se quisesse).
    // Nesses casos identifica o registro existente pelo e-mail, que é o
    // login e por isso já é único nessas linhas.
    const dadosColaborador = {
      nomeCompleto,
      email,
      contaFuncao,
      observacoes,
      unidadeId: unidade?.id,
      setorId: setor?.id,
      cargoId: cargo?.id,
    };
    let colaborador;
    if (cpfDigits) {
      colaborador = await prisma.colaborador.upsert({
        where: { cpf: cpfDigits },
        update: dadosColaborador,
        create: { ...dadosColaborador, cpf: cpfDigits },
      });
    } else {
      const existente = await prisma.colaborador.findUnique({ where: { email } });
      colaborador = existente
        ? await prisma.colaborador.update({ where: { id: existente.id }, data: dadosColaborador })
        : await prisma.colaborador.create({ data: dadosColaborador });
    }

    const usuarioExistente = await prisma.usuario.findUnique({ where: { email } });

    if (usuarioExistente && !usuarioExistente.precisaTrocarSenha) {
      // Pessoa já trocou a senha temporária pela própria — não sobrescreve.
      pulados++;
      console.log(`[linha ${linhaNum}] "${nomeCompleto}" já tem senha própria definida — login não alterado.`);
      continue;
    }

    await prisma.usuario.upsert({
      where: { email },
      update: { senhaHash, papel, colaboradorId: colaborador.id, precisaTrocarSenha: true, ativo: true },
      create: { email, senhaHash, papel, colaboradorId: colaborador.id, precisaTrocarSenha: true },
    });

    if (usuarioExistente) atualizados++;
    else criados++;
  }

  console.log("---");
  console.log(`Logins criados: ${criados}`);
  console.log(`Logins atualizados (senha temporária reemitida): ${atualizados}`);
  console.log(`Linhas puladas (dado inválido ou senha própria já definida): ${pulados}`);
  console.log(`Senha temporária desta rodada: ${senhaTemporaria}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
