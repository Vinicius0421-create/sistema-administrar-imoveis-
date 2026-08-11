import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Papel, Prisma, StatusColaborador, TipoTelefoneColaborador } from "@prisma/client";
import { maskCpf, isValidCpf } from "../utils/cpf";
import { normalizarTelefone } from "../utils/telefone";
import { somenteDigitos, normalizarEmail, capitalizarNome, isValidTelefone } from "../utils/validacao";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarAuditoria } from "../utils/audit";
import { gerarSenhaTemporaria } from "../utils/senha";
import {
  caminhoAbsolutoDoAnexo,
  caminhoParaNovoAnexo,
  MIME_TYPES_PERMITIDOS,
  removerArquivoAnexo,
  TAMANHO_MAXIMO_BYTES,
} from "../utils/anexos";
import { notificar, notificarPorPapeis } from "../utils/notificacoes.service";
import { avisarMudanca } from "../utils/realtime";
import { prepararRevogacaoAcessoDesligamento } from "../utils/usuarios";

// CPF só é obrigatório/validado para pessoas de verdade. Contas de função
// (contaFuncao: true — ex: "Recepção Itaúna", que roda entre pessoas
// diferentes) ficam sem CPF: não existe um titular fixo pra exigir o dado.
const colaboradorBaseSchema = z.object({
  // Padronização Global (Fase 3, 09/07/2026): capitaliza automaticamente —
  // "JOÃO DA SILVA" ou "joão da silva" viram "João da Silva" ao salvar, sem
  // exigir que quem digitou preste atenção em maiúsculas/minúsculas.
  nomeCompleto: z.string().min(3).transform(capitalizarNome),
  // Armazenado como dígitos puros (ver comentário em utils/validacao.ts) —
  // a validação de dígito verificador roda depois, no superRefine abaixo,
  // já sobre o valor normalizado.
  cpf: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : v)),
  contaFuncao: z.boolean().default(false),
  email: z.string().email().optional().nullable().transform((v) => (v ? normalizarEmail(v) : v)),
  // Múltiplos telefones (Fase 07/08/2026, pedido do Vini) — antes era um
  // único campo `telefone` de texto solto no colaborador; virou uma lista de
  // TelefoneColaborador (número + tipo + principal + observação opcional),
  // pra cobrir casos reais como "celular pessoal + WhatsApp de trabalho + fixo
  // residencial" sem forçar a pessoa a escolher só um. Continua distinto de
  // LinhaTelefonica (ver comentário grande logo abaixo) — isso aqui é contato
  // pessoal, aquilo é linha corporativa gerenciada pela empresa. Dígitos
  // puros por item, mesma normalização que o campo único usava.
  telefones: z
    .array(
      z.object({
        numero: z.string().min(1).transform((v) => normalizarTelefone(v)),
        tipo: z.nativeEnum(TipoTelefoneColaborador).default("CELULAR"),
        principal: z.boolean().default(false),
        observacao: z.string().optional().nullable(),
      })
    )
    .default([]),
  unidadeId: z.string().optional().nullable(),
  setorId: z.string().optional().nullable(),
  cargoId: z.string().optional().nullable(),
  status: z.nativeEnum(StatusColaborador).default("ATIVO"),
  dataAdmissao: z.coerce.date().optional().nullable(),
  // 07/07/2026, pedido do Vini. Mesma sensibilidade do CPF — ver
  // PAPEIS_COM_CPF_COMPLETO abaixo, reaproveitado pra decidir quem recebe
  // esse campo de volta em GET /colaboradores.
  dataNascimento: z.coerce.date().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

// Fase 3 (09/07/2026), adaptado em 07/08/2026 pra lista de telefones — mesma
// validação reaproveitada nos dois schemas abaixo (criação e edição
// parcial): cada item da lista (se houver) precisa ser um número brasileiro
// plausível (DDD + 8 ou 9 dígitos = 10 ou 11 dígitos). A lista em si continua
// opcional (pode ser vazia — nenhum telefone cadastrado).
function validarTelefonesOpcionais(data: { telefones?: Array<{ numero?: string | null }> }, ctx: z.RefinementCtx) {
  (data.telefones ?? []).forEach((t, index) => {
    // numero vazio/null aqui significa que sobrou 0 dígito após a
    // normalização (ex: usuário digitou só letras) — trata igual a inválido,
    // já que cada item da lista precisa ter um número de verdade (diferente
    // do campo único antigo, que podia ficar totalmente em branco).
    if (!t.numero || !isValidTelefone(t.numero)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["telefones", index, "numero"],
        message: "Telefone inválido — informe DDD + número (10 ou 11 dígitos).",
      });
    }
  });
}

const colaboradorInputSchema = colaboradorBaseSchema.superRefine((data, ctx) => {
  if (!data.contaFuncao) {
    if (!data.cpf || !isValidCpf(data.cpf)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cpf"], message: "CPF inválido." });
    }
  }
  validarTelefonesOpcionais(data, ctx);
});

// Edição parcial (PUT): só valida o CPF se ele veio no payload — não força
// reenvio de CPF em updates que não mexem nesse campo (ex: só trocar telefone).
const colaboradorUpdateSchema = colaboradorBaseSchema.partial().superRefine((data, ctx) => {
  if (data.cpf !== undefined && data.cpf !== null && !isValidCpf(data.cpf)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cpf"], message: "CPF inválido." });
  }
  validarTelefonesOpcionais(data, ctx);
});

// Garante no máximo 1 principal e, se a lista não tem nenhum marcado como
// principal (comum: usuário só preenche o número e nem mexe no flag),
// assume o primeiro da lista como principal — evita forçar essa decisão na
// tela pra quem só tem um telefone mesmo. Usado tanto no create quanto no
// update, sempre imediatamente antes de gravar.
function normalizarTelefonesParaGravacao(
  telefones: Array<{ numero: string | null; tipo: TipoTelefoneColaborador; principal: boolean; observacao?: string | null }>
) {
  // O `numero: string | null` aqui é só o tipo que o zod infere por causa do
  // transform de normalizarTelefone (pode devolver null se sobrar 0 dígito)
  // — na prática nunca chega null até aqui porque validarTelefonesOpcionais
  // já barrou isso no parse. O filter é só a garantia de tipo pro Prisma.
  const validos = telefones.filter((t): t is typeof t & { numero: string } => !!t.numero);
  if (validos.length === 0) return [];
  const indicePrincipal = validos.findIndex((t) => t.principal);
  const indiceEfetivo = indicePrincipal === -1 ? 0 : indicePrincipal;
  return validos.map((t, index) => ({ ...t, principal: index === indiceEfetivo }));
}

const listQuerySchema = paginationSchema.extend({
  busca: z.string().optional(),
  setorId: z.string().optional(),
  unidadeId: z.string().optional(),
  status: z.nativeEnum(StatusColaborador).optional(),
});

// Só quem tem esses papéis vê o CPF completo; os demais recebem mascarado.
// A visualização do CPF completo sempre gera um registro em AuditLog.
// Reaproveitado a partir de 07/07/2026 para dataNascimento e para o anexo do
// termo de responsabilidade (mesmo nível de sensibilidade — dado pessoal que
// não precisa circular pra além de quem já mexe com CPF).
// RH incluído em 08/07/2026 (pedido do Vini) — papel novo, só-leitura, mas
// com visão completa do cadastro do colaborador (é o próprio propósito do
// papel: ver todo mundo sem poder editar nada).
const PAPEIS_COM_CPF_COMPLETO: Papel[] = ["ADMINISTRADOR", "GESTOR_COORDENADOR", "RH"];

// Observações incluído no mesmo filtro em 10/07/2026 (Ciclo de Evolução
// Contínua Nº 3 — achado 🔴, implementado só depois de sinal verde explícito
// do Vini). Antes, qualquer usuário autenticado via o conteúdo desse campo
// em QUALQUER colega — inclusive anotações potencialmente sensíveis feitas
// por RH/Gestão sobre a pessoa (ex: motivo de advertência, situação de
// saúde, processo em andamento). Mesmo grupo de papéis que já vê CPF
// completo/data de nascimento: quem já lida com esse nível de dado pessoal
// continua vendo; os demais (colaborador comum olhando o cadastro de um
// colega) deixam de ver.
function ocultarDadosSensiveis<
  T extends { cpf: string | null; dataNascimento?: Date | null; termoResponsabilidadeUrl?: string | null; observacoes?: string | null }
>(colaborador: T, podeVer: boolean): T {
  if (podeVer) return colaborador;
  return { ...colaborador, cpf: maskCpf(colaborador.cpf), dataNascimento: null, termoResponsabilidadeUrl: null, observacoes: null };
}

// Etapa 1 (08/07/2026, pedido do Vini — Reestruturação e Sincronização das
// Linhas Telefônicas). `linhaCorporativa` é a ÚNICA fonte do número
// corporativo de um colaborador: nunca mais um campo de texto solto no
// cadastro dele, sempre a linha marcada como `principal` (ver
// LinhaTelefonica no schema). `telefone` continua existindo no colaborador,
// mas passou a significar exclusivamente "telefone de contato" — os dois
// podem legitimamente ser diferentes (achado real na auditoria: pelo menos
// 2 colaboradores têm contato pessoal e linha corporativa diferentes, ambos
// corretos). Uma linha CANCELADA não conta como corporativa "ativa" — fica
// de fora daqui mesmo que ainda esteja marcada como principal (histórico).
const SELECT_LINHA_CORPORATIVA = {
  where: { principal: true, status: { not: "CANCELADA" as const } },
  take: 1,
  select: {
    id: true,
    numero: true,
    operadora: true,
    tipoPlano: true,
    status: true,
    situacaoConferencia: true,
  },
};

// Usado na listagem: só busca a linha principal (payload leve), então
// `linhas` sempre tem no máximo 1 item — vira só `linhaCorporativa`, sem
// expor o array (evitaria dar a entender que é a lista completa de linhas
// do colaborador, quando na verdade é só a principal).
function comLinhaCorporativaLista<T extends { linhas: Array<Record<string, unknown>> }>(colaborador: T) {
  const { linhas, ...resto } = colaborador;
  return { ...resto, linhaCorporativa: linhas[0] ?? null };
}

// Usado no detalhe: `linhas` já vem completo (todas as linhas do
// colaborador, pro card "Linhas Telefônicas (N)") — aqui só adiciona
// `linhaCorporativa` derivada do mesmo array, sem descartar o resto.
function comLinhaCorporativaDetalhe<T extends { linhas: Array<{ principal: boolean; status: string }> }>(colaborador: T) {
  const principal = colaborador.linhas.find((l) => l.principal && l.status !== "CANCELADA") ?? null;
  return { ...colaborador, linhaCorporativa: principal };
}

export default async function colaboradoresRoutes(app: FastifyInstance) {
  app.get("/colaboradores", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = toSkipTake(query);

    const where = {
      ...(query.setorId ? { setorId: query.setorId } : {}),
      ...(query.unidadeId ? { unidadeId: query.unidadeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.busca
        ? { nomeCompleto: { contains: query.busca, mode: "insensitive" as const } }
        : {}),
    };

    const [items, total] = await Promise.all([
      app.prisma.colaborador.findMany({
        where,
        skip,
        take,
        orderBy: { nomeCompleto: "asc" },
        // `usuario` só com campos seguros (nunca senhaHash) — é o que permite
        // a tela de Colaboradores decidir entre "Conceder acesso" (sem
        // usuario ainda) e "Alterar papel do acesso" (já tem login).
        include: {
          unidade: true,
          setor: true,
          cargo: true,
          usuario: { select: { id: true, email: true, papel: true, ativo: true } },
          linhas: SELECT_LINHA_CORPORATIVA,
          telefones: { orderBy: [{ principal: "desc" }, { criadoEm: "asc" }] },
        },
      }),
      app.prisma.colaborador.count({ where }),
    ]);

    const podeVerCpfCompleto = PAPEIS_COM_CPF_COMPLETO.includes(request.user.papel);

    // Achado de auditoria (10/07/2026, Ciclo de Evolução Contínua): o
    // detalhe (GET /colaboradores/:id, logo abaixo) sempre registrou
    // VISUALIZAR_CPF, mas esta listagem — que também devolve CPF completo
    // pra quem tem o papel liberado — nunca registrava nada. Alguém com
    // acesso a CPF podia folhear o cadastro inteiro (várias páginas) sem
    // deixar nenhum rastro, quebrando a garantia documentada acima ("a
    // visualização do CPF completo sempre gera um registro em AuditLog").
    // Um único registro por requisição (não um por colaborador da página)
    // — mesmo raciocínio de log em lote sugerido na auditoria: uma tela
    // cheia de 20 CPFs é um único evento de "alguém viu N CPFs agora",
    // não 20 eventos idênticos.
    if (podeVerCpfCompleto && items.length > 0) {
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "VISUALIZAR_CPF_LISTA",
        entidade: "Colaborador",
        detalhe: { colaboradorIds: items.map((c) => c.id), quantidade: items.length },
        ip: request.ip,
      });
    }

    const itemsSeguro = items.map((c) => comLinhaCorporativaLista(ocultarDadosSensiveis(c, podeVerCpfCompleto)));

    return reply.send(paginatedResponse(itemsSeguro, total, query));
  });

  app.get("/colaboradores/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const colaborador = await app.prisma.colaborador.findUnique({
      where: { id },
      include: {
        unidade: true,
        setor: true,
        cargo: true,
        equipamentos: true,
        linhas: true,
        acessos: { include: { sistema: true } },
        usuario: { select: { id: true, email: true, papel: true, ativo: true } },
        telefones: { orderBy: [{ principal: "desc" }, { criadoEm: "asc" }] },
      },
    });
    if (!colaborador) return reply.code(404).send({ error: "Colaborador não encontrado." });

    const podeVerCpfCompleto = PAPEIS_COM_CPF_COMPLETO.includes(request.user.papel);
    if (podeVerCpfCompleto) {
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "VISUALIZAR_CPF",
        entidade: "Colaborador",
        entidadeId: colaborador.id,
        ip: request.ip,
      });
    }

    return reply.send(comLinhaCorporativaDetalhe(ocultarDadosSensiveis(colaborador, podeVerCpfCompleto)));
  });

  // Importação do Imoview (08/07/2026, pedido do Vini) — o Imoview não tem
  // API de nível empresa pra listar usuários/corretores (investigado a
  // fundo: só existe "Usuario/App_RetornarUsuarios", escopado a login
  // individual de app, não serve pra isso). Alternativa: o admin exporta a
  // tela "Usuários" do Imoview em Excel e sobe aqui. Esta rota só faz o
  // PARSE do arquivo e casa por e-mail com quem já existe — não cria nada
  // sozinha. Sugestão de cargo/setor/unidade fica por conta do frontend
  // (já tem as listas de domínio carregadas) — o admin sempre revisa e
  // confirma linha por linha antes de qualquer criação real, reaproveitando
  // o POST /colaboradores normal (CPF nunca vem do Imoview, então sempre
  // precisa ser preenchido à mão aqui, igual ao caso da
  // Viviane/Elisiane/Letícia).
  const COLUNAS_ESPERADAS = ["Nome", "Situacao", "Cargo", "Perfil", "Setor", "Email", "Telefone", "Creci"] as const;

  // O export real da tela "Usuários" do Imoview (confirmado com o arquivo que
  // o Vini subiu em 07/07/2026) é um .xlsx válido, mas gerado por uma
  // biblioteca que prefixa TODAS as tags com o namespace do spreadsheetml
  // (ex: <x:worksheet>, <x:sheetData>, <x:row>) em vez do padrão sem prefixo
  // que o Excel/LibreOffice usam. O parser XML do ExcelJS não resolve esse
  // prefixo e quebra com "Cannot read properties of undefined (reading
  // 'sheets')". Como fallback, reabre o .zip do .xlsx e remove qualquer
  // prefixo de namespace do OOXML (xmlns:x="...openxmlformats...") das tags
  // de cada XML interno antes de tentar de novo — a declaração xmlns: em si
  // fica no arquivo (inofensiva, só um namespace não usado), só as tags é
  // que deixam de ter o prefixo.
  async function normalizarNamespacesOoxml(buffer: Buffer): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer);
    const nomesXml = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith(".xml"));
    for (const nome of nomesXml) {
      const entrada = zip.files[nome];
      if (!entrada || entrada.dir) continue;
      const conteudo = await entrada.async("string");
      const prefixos = new Set<string>();
      const re = /xmlns:([a-zA-Z0-9_]+)="http:\/\/schemas\.openxmlformats\.org\/[^"]*"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(conteudo))) {
        if (m[1]) prefixos.add(m[1]);
      }
      if (prefixos.size === 0) continue;
      let novo = conteudo;
      for (const p of prefixos) {
        novo = novo.split(`<${p}:`).join("<").split(`</${p}:`).join("</");
      }
      if (novo !== conteudo) zip.file(nome, novo);
    }
    return zip.generateAsync({ type: "nodebuffer" });
  }

  app.post(
    "/colaboradores/importar-imoview/preview",
    // FINANCEIRO ganhou permissão de cadastrar colaborador (pedido do Vini,
    // 07/08/2026) — inclui o preview de importação porque ele é só o passo
    // anterior à mesma ação (cada linha confirmada vira um POST /colaboradores
    // normal, ver ImportarImoview.tsx no frontend).
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR", "FINANCEIRO")] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "Nenhum arquivo enviado." });

      const nomeArquivo = (file.filename || "").toLowerCase();
      if (!nomeArquivo.endsWith(".xlsx")) {
        await file.file.resume();
        return reply.code(400).send({ error: "Envie o arquivo .xlsx exportado da tela de Usuários do Imoview." });
      }

      const buffer = await file.toBuffer();
      const workbook = new ExcelJS.Workbook();
      try {
        // Cast necessário: @types/exceljs espera o Buffer "clássico" do Node,
        // e o Buffer devolvido por toBuffer() tipa como Buffer<ArrayBufferLike>
        // (mudança de tipagem do @types/node) — mesmo objeto em runtime, só
        // choque de tipos entre pacotes.
        await workbook.xlsx.load(buffer as any);
      } catch {
        // Fallback pro formato com namespace prefixado que o export real do
        // Imoview usa (ver normalizarNamespacesOoxml acima) — só tenta de
        // novo se a leitura direta falhar, pra não pagar esse custo extra em
        // arquivos já no formato padrão.
        try {
          const bufferCorrigido = await normalizarNamespacesOoxml(buffer);
          await workbook.xlsx.load(bufferCorrigido as any);
        } catch {
          return reply.code(400).send({ error: "Não consegui ler este arquivo — confirme que é o .xlsx exportado do Imoview sem edições." });
        }
      }

      const planilha = workbook.worksheets[0];
      if (!planilha) return reply.code(400).send({ error: "A planilha está vazia." });

      // Mapeia nome-da-coluna -> índice, pela primeira linha (cabeçalho) —
      // não assume ordem fixa, só que os nomes batem com o export do Imoview.
      const cabecalho: Record<string, number> = {};
      planilha.getRow(1).eachCell((cell, colNumber) => {
        const nome = String(cell.value ?? "").trim();
        if (nome) cabecalho[nome] = colNumber;
      });
      const colunasFaltando = COLUNAS_ESPERADAS.filter((c) => !(c in cabecalho));
      if (colunasFaltando.length > 0) {
        return reply.code(400).send({
          error: `Este arquivo não parece ser o export de Usuários do Imoview — faltam as colunas: ${colunasFaltando.join(", ")}.`,
        });
      }

      const valorCelula = (row: ExcelJS.Row, coluna: string): string => {
        const indiceColuna = cabecalho[coluna];
        if (indiceColuna === undefined) return "";
        const v = row.getCell(indiceColuna).value;
        if (v === null || v === undefined) return "";
        if (typeof v === "object" && "text" in (v as any)) return String((v as any).text).trim();
        return String(v).trim();
      };

      const emails = new Set<string>();
      const linhasImoview: Array<{
        linha: number;
        nome: string;
        situacaoImoview: string;
        statusSugerido: StatusColaborador;
        cargoImoview: string;
        perfilImoview: string;
        setorImoview: string;
        email: string;
        telefone: string;
        creci: string | null;
      }> = [];

      planilha.eachRow((row, numeroLinha) => {
        if (numeroLinha === 1) return; // cabeçalho
        const nome = valorCelula(row, "Nome");
        const email = valorCelula(row, "Email").toLowerCase();
        if (!nome && !email) return; // linha em branco no fim da planilha
        const situacaoImoview = valorCelula(row, "Situacao");
        const creci = valorCelula(row, "Creci");
        linhasImoview.push({
          linha: numeroLinha,
          nome,
          situacaoImoview,
          statusSugerido: situacaoImoview.toLowerCase().startsWith("ativ") ? "ATIVO" : "INATIVO",
          cargoImoview: valorCelula(row, "Cargo"),
          perfilImoview: valorCelula(row, "Perfil"),
          setorImoview: valorCelula(row, "Setor"),
          email,
          telefone: valorCelula(row, "Telefone"),
          creci: creci || null,
        });
        if (email) emails.add(email);
      });

      const existentes = await app.prisma.colaborador.findMany({
        where: { email: { in: Array.from(emails) } },
        select: { id: true, email: true, nomeCompleto: true },
      });
      const existentePorEmail = new Map(existentes.map((c) => [c.email?.toLowerCase(), c]));

      const resultado = linhasImoview.map((l) => {
        const existente = l.email ? existentePorEmail.get(l.email) : undefined;
        return {
          ...l,
          existente: !!existente,
          colaboradorExistenteId: existente?.id ?? null,
          colaboradorExistenteNome: existente?.nomeCompleto ?? null,
        };
      });

      return reply.send({
        linhas: resultado,
        resumo: {
          total: resultado.length,
          novos: resultado.filter((l) => !l.existente).length,
          existentes: resultado.filter((l) => l.existente).length,
        },
      });
    }
  );

  app.post(
    "/colaboradores",
    // FINANCEIRO ganhou permissão de cadastrar colaborador novo (pedido do
    // Vini, 07/08/2026) — RH já tinha esse acesso de fato via
    // GESTOR_COORDENADOR-equivalente em outras rotas; aqui é a única rota
    // que faltava abrir. Escopo deliberadamente restrito a CRIAR: editar,
    // desligar e excluir continuam só ADMINISTRADOR/GESTOR_COORDENADOR —
    // não foi isso que foi pedido.
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR", "FINANCEIRO")] },
    async (request, reply) => {
      const parsed = colaboradorInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }

      if (parsed.data.cpf) {
        const cpfExistente = await app.prisma.colaborador.findUnique({ where: { cpf: parsed.data.cpf } });
        if (cpfExistente) {
          return reply.code(409).send({ error: "Já existe um colaborador cadastrado com este CPF." });
        }
      }
      // Achado de auditoria (Etapa 3 — Backend, 08/07/2026): email também é
      // @unique no schema (assim como cpf, checado acima), mas não tinha a
      // mesma pré-checagem — um e-mail duplicado gerava 500 genérico em vez
      // de um erro 409 amigável. O try/catch abaixo no create é rede de
      // segurança extra contra corrida entre a checagem e a gravação (mesmo
      // padrão de linhas.routes.ts para P2002).
      if (parsed.data.email) {
        const emailExistente = await app.prisma.colaborador.findUnique({ where: { email: parsed.data.email } });
        if (emailExistente) {
          return reply.code(409).send({ error: "Já existe um colaborador cadastrado com este e-mail." });
        }
      }

      const { telefones, ...dadosColaborador } = parsed.data;

      let colaborador;
      try {
        colaborador = await app.prisma.colaborador.create({
          data: {
            ...dadosColaborador,
            telefones: { create: normalizarTelefonesParaGravacao(telefones) },
          },
          include: { telefones: { orderBy: [{ principal: "desc" }, { criadoEm: "asc" }] } },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return reply.code(409).send({ error: "Já existe um colaborador cadastrado com este CPF ou e-mail." });
        }
        throw e;
      }

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR",
        entidade: "Colaborador",
        entidadeId: colaborador.id,
        ip: request.ip,
      });

      avisarMudanca("colaboradores");

      return reply.code(201).send(colaborador);
    }
  );

  app.put(
    "/colaboradores/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = colaboradorUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }

      const existente = await app.prisma.colaborador.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Colaborador não encontrado." });

      if (parsed.data.cpf && parsed.data.cpf !== existente.cpf) {
        const cpfExistente = await app.prisma.colaborador.findUnique({ where: { cpf: parsed.data.cpf } });
        if (cpfExistente && cpfExistente.id !== id) {
          return reply.code(409).send({ error: "Já existe um colaborador cadastrado com este CPF." });
        }
      }
      // Mesmo achado do POST acima: email também precisa dessa checagem.
      if (parsed.data.email && parsed.data.email !== existente.email) {
        const emailExistente = await app.prisma.colaborador.findUnique({ where: { email: parsed.data.email } });
        if (emailExistente && emailExistente.id !== id) {
          return reply.code(409).send({ error: "Já existe um colaborador cadastrado com este e-mail." });
        }
      }

      // Desligamento revoga acesso (10/07/2026, sinal verde do Vini após o
      // Ciclo 3): além do botão dedicado "Desligar" (POST /desligar, logo
      // abaixo), o Status de um colaborador também pode virar INATIVO por
      // aqui, editando o formulário direto — os dois caminhos precisam do
      // mesmo efeito. Só dispara na TRANSIÇÃO (status antigo diferente de
      // INATIVO virando INATIVO agora) — salvar de novo um colaborador que
      // já está inativo não deve ficar reprocessando revogação a cada edição.
      const desligandoAgora = existente.status !== "INATIVO" && parsed.data.status === "INATIVO";
      const operacoesRevogacao = desligandoAgora ? await prepararRevogacaoAcessoDesligamento(app, id) : [];

      // `telefones` some do parsed.data quando não veio no payload (schema
      // parcial) — nesse caso não mexe na lista existente. Quando vem
      // (mesmo lista vazia — "removi todos os telefones"), substitui a lista
      // inteira: mais simples e previsível do que tentar diff item a item, e
      // o formulário do frontend sempre manda a lista completa (não edição
      // incremental por telefone individual).
      const { telefones, ...dadosAtualizacao } = parsed.data;
      const dadosParaGravar: Prisma.ColaboradorUpdateInput = { ...dadosAtualizacao };
      if (telefones !== undefined) {
        dadosParaGravar.telefones = { deleteMany: {}, create: normalizarTelefonesParaGravacao(telefones) };
      }

      let colaborador;
      try {
        if (operacoesRevogacao.length > 0) {
          const [atualizado] = await app.prisma.$transaction([
            app.prisma.colaborador.update({ where: { id }, data: dadosParaGravar }),
            ...operacoesRevogacao,
          ]);
          colaborador = atualizado;
        } else {
          colaborador = await app.prisma.colaborador.update({ where: { id }, data: dadosParaGravar });
        }
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return reply.code(409).send({ error: "Já existe um colaborador cadastrado com este CPF ou e-mail." });
        }
        throw e;
      }

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ATUALIZAR",
        entidade: "Colaborador",
        entidadeId: colaborador.id,
        detalhe: { ...parsed.data, acessoRevogado: desligandoAgora && operacoesRevogacao.length > 0 },
        ip: request.ip,
      });

      avisarMudanca("colaboradores");

      return reply.send(colaborador);
    }
  );

  // Desligar não é DELETE — é uma mudança de status. Excluir o registro
  // apagaria o histórico de equipamentos/linhas/acessos que precisa
  // continuar rastreável mesmo depois que a pessoa sai da empresa.
  app.post(
    "/colaboradores/:id/desligar",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const colaborador = await app.prisma.colaborador.findUnique({ where: { id } });
      if (!colaborador) return reply.code(404).send({ error: "Colaborador não encontrado." });

      // Achado de auditoria (Ciclo de Evolução Contínua Nº 3, 10/07/2026): as
      // duas escritas abaixo (marcar o colaborador como desligado + criar o
      // registro de movimentação correspondente) eram dois `await`
      // separados, fora de `$transaction` — diferente do padrão já usado em
      // outros fluxos multi-escrita do sistema (ver `equipamentos.routes.ts`,
      // devolução/exclusão de equipamento). Se a segunda escrita falhasse
      // (ex: queda de conexão entre as duas chamadas), o colaborador ficava
      // marcado como desligado SEM o registro de movimentação — perdendo o
      // rastro de quem revisou os impactos de acessos/linhas/equipamentos.
      // Desligamento revoga acesso (10/07/2026, sinal verde do Vini após o
      // Ciclo 3 apontar o risco 🔴: colaborador desligado continuava
      // conseguindo logar até alguém desativar manualmente). Mesma lógica
      // usada em PUT /colaboradores/:id quando o Status vira INATIVO por
      // ali — aqui a transição já é garantida (é literalmente o propósito
      // deste endpoint), só falta checar se existe um Usuario vinculado.
      const operacoesRevogacao = await prepararRevogacaoAcessoDesligamento(app, id);

      const [atualizado, movimentacao] = await app.prisma.$transaction([
        app.prisma.colaborador.update({
          where: { id },
          data: { status: "INATIVO", dataDesligamento: new Date() },
        }),
        app.prisma.movimentacaoColaborador.create({
          data: {
            colaboradorId: id,
            tipo: "DESLIGAMENTO",
            responsavelId: request.user.sub,
            status: "PENDENTE",
            impactoAcessos: "PENDENTE_REVISAO",
            impactoLinhas: "PENDENTE_REVISAO",
            impactoEquipamentos: "PENDENTE_REVISAO",
          },
        }),
        ...operacoesRevogacao,
      ]);

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "DESLIGAR",
        entidade: "Colaborador",
        entidadeId: id,
        detalhe: { acessoRevogado: operacoesRevogacao.length > 0 },
        ip: request.ip,
      });

      // Desligamento também cria uma movimentação (ver acima) — avisa os
      // dois recursos.
      avisarMudanca("colaboradores", "movimentacoes");

      return reply.send({ colaborador: atualizado, movimentacao });
    }
  );

  // Exclusão definitiva — diferente de "desligar" (que é uma mudança de
  // status e preserva todo o histórico de quem passou pela empresa). Isto
  // aqui apaga o registro de verdade, então só faz sentido para corrigir um
  // cadastro criado por engano (duplicado, teste, digitação errada) — nunca
  // para desligamento de alguém que realmente trabalhou aqui.
  // Por isso: só ADMINISTRADOR, e só se o colaborador não tiver NENHUM
  // rastro de uso real (equipamento, linha, acesso, login, solicitação,
  // chamado ou movimentação) — nesses casos a rota recusa e orienta a usar
  // "desligar", que é o fluxo correto e não perde histórico.
  app.delete(
    "/colaboradores/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const colaborador = await app.prisma.colaborador.findUnique({
        where: { id },
        include: {
          usuario: true,
          _count: {
            select: {
              equipamentos: true,
              linhas: true,
              acessos: true,
              solicitacoes: true,
              chamados: true,
              movimentacoes: true,
              historicoComoOrigem: true,
              historicoComoDestino: true,
            },
          },
        },
      });
      if (!colaborador) return reply.code(404).send({ error: "Colaborador não encontrado." });

      const vinculos = colaborador._count;
      const temVinculo =
        vinculos.equipamentos > 0 ||
        vinculos.linhas > 0 ||
        vinculos.acessos > 0 ||
        vinculos.solicitacoes > 0 ||
        vinculos.chamados > 0 ||
        vinculos.movimentacoes > 0 ||
        vinculos.historicoComoOrigem > 0 ||
        vinculos.historicoComoDestino > 0 ||
        !!colaborador.usuario;

      if (temVinculo) {
        return reply.code(409).send({
          error:
            "Este colaborador já tem histórico real no sistema (equipamento, linha, acesso, login, solicitação, chamado ou movimentação) — excluir apagaria esse rastro. Use \"Desligar\" para registrar a saída sem perder o histórico.",
          codigo: "COLABORADOR_COM_VINCULOS",
          vinculos,
        });
      }

      await app.prisma.colaborador.delete({ where: { id } });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "Colaborador",
        entidadeId: id,
        detalhe: { nomeCompleto: colaborador.nomeCompleto },
        ip: request.ip,
      });

      avisarMudanca("colaboradores");

      return reply.code(204).send();
    }
  );

  // Reset de senha autoatendido pelo gestor/admin — sem depender de e-mail
  // nem de acesso técnico ao banco. Gera senha temporária + força troca no
  // próximo login (mesmo mecanismo do provisionamento em lote), revoga
  // sessões abertas em outros dispositivos e deixa rastro em auditoria.
  app.post(
    "/colaboradores/:id/resetar-senha",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const usuario = await app.prisma.usuario.findUnique({ where: { colaboradorId: id } });
      if (!usuario) {
        return reply.code(404).send({ error: "Este colaborador não tem login no sistema." });
      }

      const senhaTemporaria = gerarSenhaTemporaria();
      const senhaHash = await bcrypt.hash(senhaTemporaria, 12);

      await app.prisma.usuario.update({
        where: { id: usuario.id },
        data: { senhaHash, precisaTrocarSenha: true, ativo: true },
      });

      // Derruba sessões já abertas em outros dispositivos — quem reseta a
      // senha espera que o acesso anterior pare de valer.
      await app.prisma.refreshToken.updateMany({
        where: { usuarioId: usuario.id, revogadoEm: null },
        data: { revogadoEm: new Date() },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "RESETAR_SENHA",
        entidade: "Usuario",
        entidadeId: usuario.id,
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — aviso de auditoria
      // pros demais Administradores (não pro próprio usuário afetado: ele
      // recebe a senha nova diretamente de quem executou a ação, por
      // WhatsApp/presencial — mandar notificação pra dentro do sistema não
      // ajudaria, já que a senha antiga dele parou de funcionar).
      await notificarPorPapeis(app, ["ADMINISTRADOR"], {
        categoria: "USUARIO",
        tipo: "USUARIO_SENHA_REDEFINIDA_ADMIN",
        titulo: "Senha redefinida por um administrador",
        mensagem: `A senha de ${usuario.email} foi redefinida.`,
        entidade: "Usuario",
        entidadeId: usuario.id,
        origemUsuarioId: request.user.sub,
      });

      // A senha em texto puro só existe nesta resposta, uma única vez — não
      // fica gravada em lugar nenhum além daqui. Quem chamou a rota precisa
      // repassá-la ao colaborador imediatamente (WhatsApp/presencial).
      return reply.send({ senhaTemporaria, usuario: { id: usuario.id, email: usuario.email } });
    }
  );

  // Concede login a um colaborador que já existe no cadastro mas ainda não
  // tem acesso ao sistema (ex: técnico de suporte novo, gestor promovido).
  // Faltava desde sempre — o único Usuario que existia até a Fase 3 da
  // Evolução Completa (07/2026) tinha sido criado manualmente via seed;
  // não havia nenhuma rota pra fazer isso de novo sem acesso direto ao
  // banco. Mesmo padrão de senha temporária + troca obrigatória usado no
  // reset de senha acima.
  app.post(
    "/colaboradores/:id/criar-acesso",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ papel: z.nativeEnum(Papel), email: z.string().email().optional().nullable() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const colaborador = await app.prisma.colaborador.findUnique({ where: { id }, include: { usuario: true } });
      if (!colaborador) return reply.code(404).send({ error: "Colaborador não encontrado." });
      if (colaborador.usuario) {
        return reply.code(409).send({ error: "Este colaborador já tem login no sistema. Use \"Resetar senha\" ou altere o papel do acesso existente." });
      }

      const email = normalizarEmail(parsed.data.email || colaborador.email || "") || null;
      if (!email) {
        return reply.code(400).send({ error: "Este colaborador não tem e-mail cadastrado — informe um e-mail para criar o acesso." });
      }

      const emailEmUso = await app.prisma.usuario.findUnique({ where: { email } });
      if (emailEmUso) {
        return reply.code(409).send({ error: `Já existe um login usando o e-mail ${email}.` });
      }

      const senhaTemporaria = gerarSenhaTemporaria();
      const senhaHash = await bcrypt.hash(senhaTemporaria, 12);

      const usuario = await app.prisma.usuario.create({
        data: { email, senhaHash, papel: parsed.data.papel, colaboradorId: id, precisaTrocarSenha: true, ativo: true },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR_ACESSO",
        entidade: "Usuario",
        entidadeId: usuario.id,
        detalhe: { colaboradorId: id, papel: parsed.data.papel },
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — mesmo racional do
      // reset de senha acima: aviso de auditoria pros demais Administradores,
      // não pro usuário recém-criado (ele ainda nem logou pela primeira vez).
      await notificarPorPapeis(app, ["ADMINISTRADOR"], {
        categoria: "USUARIO",
        tipo: "USUARIO_CONTA_CRIADA",
        titulo: "Novo acesso concedido",
        mensagem: `${email} agora tem login no sistema como ${parsed.data.papel}.`,
        entidade: "Usuario",
        entidadeId: usuario.id,
        origemUsuarioId: request.user.sub,
      });

      avisarMudanca("colaboradores");

      // Mesma regra do reset de senha: a senha em texto puro só existe
      // nesta resposta, uma única vez.
      return reply.code(201).send({ senhaTemporaria, usuario: { id: usuario.id, email: usuario.email, papel: usuario.papel } });
    }
  );

  // Promove/rebaixa um acesso já existente (ex: colaborador que passou a
  // atuar como suporte, ou saiu da função). Não altera senha nem exige
  // troca — é só o papel que muda.
  app.patch(
    "/colaboradores/:id/usuario",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ papel: z.nativeEnum(Papel) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const usuario = await app.prisma.usuario.findUnique({ where: { colaboradorId: id } });
      if (!usuario) return reply.code(404).send({ error: "Este colaborador não tem login no sistema." });

      const atualizado = await app.prisma.usuario.update({ where: { id: usuario.id }, data: { papel: parsed.data.papel } });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ALTERAR_PAPEL",
        entidade: "Usuario",
        entidadeId: usuario.id,
        detalhe: { papelAnterior: usuario.papel, papelNovo: parsed.data.papel },
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — este, diferente dos
      // dois de cima, é sobre o próprio usuário afetado (o papel dele mudou,
      // então o que ele pode/não pode fazer no sistema mudou junto — vale a
      // pena ele saber), além do aviso de auditoria de sempre pros
      // Administradores.
      await notificar(app, {
        destinatarioIds: [atualizado.id],
        categoria: "USUARIO",
        tipo: "USUARIO_PAPEL_ALTERADO",
        titulo: "Seu papel de acesso mudou",
        mensagem: `Seu acesso no sistema agora é: ${parsed.data.papel}.`,
        prioridade: "ALTA",
        entidade: "Usuario",
        entidadeId: usuario.id,
        origemUsuarioId: request.user.sub,
        // Exceção deliberada: mesmo que o próprio Administrador mude o
        // papel de si mesmo (caso raro, mas possível), ele deve ser avisado
        // — é uma mudança de acesso real, não uma notificação de rotina
        // sobre a própria ação.
        excluirOrigem: false,
      });
      await notificarPorPapeis(app, ["ADMINISTRADOR"], {
        categoria: "USUARIO",
        tipo: "USUARIO_PAPEL_ALTERADO",
        titulo: "Papel de acesso alterado",
        mensagem: `${atualizado.email}: ${usuario.papel} → ${parsed.data.papel}.`,
        entidade: "Usuario",
        entidadeId: usuario.id,
        origemUsuarioId: request.user.sub,
      });

      avisarMudanca("colaboradores");

      return reply.send({ id: atualizado.id, email: atualizado.email, papel: atualizado.papel });
    }
  );

  // Termo de responsabilidade de equipamento — anexo único por colaborador
  // (07/07/2026, pedido do Vini, ver decisão registrada no roadmap: anexo
  // fixo no cadastro, não por entrega individual). Mesma infra de arquivo
  // dos anexos de chamado (ANEXOS_DIR/Railway Volume), só com uma pasta por
  // colaborador em vez de por chamado — ver caminhoParaNovoAnexo em
  // utils/anexos.ts. Upload de um novo termo substitui o anterior (remove o
  // arquivo físico antigo do volume, senão o espaço nunca é liberado).
  app.post(
    "/colaboradores/:id/termo-responsabilidade",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const colaborador = await app.prisma.colaborador.findUnique({ where: { id } });
      if (!colaborador) return reply.code(404).send({ error: "Colaborador não encontrado." });

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "Nenhum arquivo enviado." });

      if (!MIME_TYPES_PERMITIDOS.has(file.mimetype)) {
        await file.file.resume();
        return reply.code(400).send({
          error: "Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou PDF.",
        });
      }

      const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(`colaborador-${id}`, file.filename);
      await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });

      try {
        await pipeline(file.file, fs.createWriteStream(caminhoAbsoluto));
      } catch (err) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        throw err;
      }

      // Checagem explícita pós-gravação, não só o `truncated` do busboy: desde
      // 08/07/2026 o teto do parser multipart (server.ts) é compartilhado com
      // o anexo de mensagem (20MB), maior que o limite próprio de termo
      // (10MB) — sem isso, um arquivo entre 10MB e 20MB passaria batido aqui.
      const { size: tamanhoBytesTermo } = await fs.promises.stat(caminhoAbsoluto);
      if (file.file.truncated || tamanhoBytesTermo > TAMANHO_MAXIMO_BYTES) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        return reply.code(413).send({
          error: `Arquivo excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)}MB).`,
        });
      }

      // Substitui o anterior — remove o arquivo físico antigo só depois que
      // o novo já foi gravado com sucesso, pra nunca ficar sem nenhum dos
      // dois em caso de erro no meio do caminho.
      const anexoAntigo = colaborador.termoResponsabilidadeUrl;

      const atualizado = await app.prisma.colaborador.update({
        where: { id },
        data: {
          termoResponsabilidadeUrl: caminhoRelativo,
          termoResponsabilidadeNomeOriginal: file.filename,
          // Etapa 3 (auditoria de backend, 08/07/2026): faltava salvar o
          // mimetype (ver comentário do campo no schema.prisma) — sem isso o
          // download nunca conseguia mandar Content-Type certo.
          termoResponsabilidadeTipo: file.mimetype,
          termoResponsabilidadeEnviadoEm: new Date(),
        },
      });

      if (anexoAntigo) removerArquivoAnexo(anexoAntigo);

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ANEXAR_TERMO_RESPONSABILIDADE",
        entidade: "Colaborador",
        entidadeId: id,
        detalhe: { nomeArquivoOriginal: file.filename },
        ip: request.ip,
      });

      return reply.code(201).send({
        termoResponsabilidadeNomeOriginal: atualizado.termoResponsabilidadeNomeOriginal,
        termoResponsabilidadeEnviadoEm: atualizado.termoResponsabilidadeEnviadoEm,
      });
    }
  );

  // Download — mesma regra de visibilidade do próprio dado sensível
  // (ADMINISTRADOR/GESTOR_COORDENADOR), nunca servido como arquivo estático
  // público.
  app.get(
    "/colaboradores/:id/termo-responsabilidade",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const colaborador = await app.prisma.colaborador.findUnique({ where: { id } });
      if (!colaborador || !colaborador.termoResponsabilidadeUrl) {
        return reply.code(404).send({ error: "Este colaborador não tem termo de responsabilidade anexado." });
      }

      const caminhoAbsoluto = caminhoAbsolutoDoAnexo(colaborador.termoResponsabilidadeUrl);
      if (!caminhoAbsoluto || !fs.existsSync(caminhoAbsoluto)) {
        return reply.code(404).send({ error: "Arquivo não encontrado no armazenamento." });
      }

      const nomeOriginal = (colaborador.termoResponsabilidadeNomeOriginal || "termo-responsabilidade").replace(/"/g, "");
      reply.header("Content-Disposition", `inline; filename="${nomeOriginal}"`);
      // Etapa 3 (auditoria de backend, 08/07/2026): sem Content-Type, o
      // Content-Disposition: inline acima não tinha efeito real — o
      // navegador não sabe como pré-visualizar o arquivo, então baixa em vez
      // de abrir. Mesmo padrão de chamados.routes.ts/mensagens.routes.ts.
      // Termos enviados antes desta correção não têm o tipo salvo
      // (termoResponsabilidadeTipo null) — nesse caso só degrada de volta
      // pro comportamento antigo, sem erro.
      if (colaborador.termoResponsabilidadeTipo) {
        reply.header("Content-Type", colaborador.termoResponsabilidadeTipo);
      }
      return reply.send(fs.createReadStream(caminhoAbsoluto));
    }
  );

  app.delete(
    "/colaboradores/:id/termo-responsabilidade",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const colaborador = await app.prisma.colaborador.findUnique({ where: { id } });
      if (!colaborador) return reply.code(404).send({ error: "Colaborador não encontrado." });
      if (!colaborador.termoResponsabilidadeUrl) return reply.code(204).send();

      removerArquivoAnexo(colaborador.termoResponsabilidadeUrl);
      await app.prisma.colaborador.update({
        where: { id },
        data: {
          termoResponsabilidadeUrl: null,
          termoResponsabilidadeNomeOriginal: null,
          termoResponsabilidadeTipo: null,
          termoResponsabilidadeEnviadoEm: null,
        },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "REMOVER_TERMO_RESPONSABILIDADE",
        entidade: "Colaborador",
        entidadeId: id,
        ip: request.ip,
      });

      return reply.code(204).send();
    }
  );
}
