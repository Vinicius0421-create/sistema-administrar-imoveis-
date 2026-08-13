import { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Prisma, StatusPagamentoColaborador, TipoPagamentoColaborador } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { registrarAuditoria } from "../utils/audit";
import { avisarMudanca } from "../utils/realtime";
import {
  gerarCnab240,
  lerRetornoCnab240,
  onlyDigits,
  DESCRICAO_OCORRENCIA,
  EmpresaCnab,
  FavorecidoCnab,
} from "../utils/cnab240";
import {
  caminhoAbsolutoDoAnexo,
  caminhoParaNovoAnexo,
  MIME_TYPES_PERMITIDOS,
  removerArquivoAnexo,
  TAMANHO_MAXIMO_BYTES,
} from "../utils/anexos";
import { extrairTextoPorPagina, dividirPorPagina, identificarPagina, CandidatoRecibo } from "../utils/reciboSplit";

// Módulo de Pagamento de Colaboradores via CNAB 240 — Sicoob (20/07/2026,
// pedido do Vini; especificação completa dele no relatório do módulo).
// Fluxo: dados bancários no cadastro → folha por competência → lançamento
// dos pagamentos → geração da remessa (arquivo .rem, layout homologado —
// ver cnab240.ts) → download/envio ao banco → importação do retorno →
// baixa automática. Tudo restrito a ADMINISTRADOR/FINANCEIRO (dados
// bancários também RH, que cadastra gente), tudo auditado.

// RH incluído em 22/07/2026 (pedido do Vini: "os papéis RH e financeiro
// devem ter as mesmas abas... pagamentos... e etc") — RH passa a ter a
// mesma escrita que Financeiro em todo este módulo (já tinha em dados
// bancários, ver PAPEIS_DADOS_BANCARIOS abaixo).
const PAPEIS_PAGAMENTO = ["ADMINISTRADOR", "FINANCEIRO", "RH"] as const;
const PAPEIS_DADOS_BANCARIOS = ["ADMINISTRADOR", "FINANCEIRO", "RH"] as const;

const dadosBancariosSchema = z.object({
  bancoCodigo: z.string().regex(/^\d{3}$/, "Código do banco deve ter 3 dígitos."),
  bancoNome: z.string().min(2),
  agencia: z.string().min(1),
  agenciaDv: z.string().optional().nullable(),
  conta: z.string().min(1),
  contaDv: z.string().optional().nullable(),
  tipoConta: z.string().default("corrente"),
  favorecidoNome: z.string().optional().nullable(),
  favorecidoCpf: z.string().optional().nullable(),
  endereco: z.string().min(2),
  numero: z.string().min(1),
  complemento: z.string().optional().nullable(),
  bairro: z.string().min(1),
  cidade: z.string().min(1),
  cep: z.string().regex(/^\d{8}$/, "CEP deve ter 8 dígitos (só números)."),
  uf: z.string().length(2),
  // Dados financeiros padrão (21/07/2026, pedido do Vini) — só sugestão pro
  // lançamento em lote (ver rota .../pagamentos/lote); nunca obrigatório.
  // Mesmo gate de papel dos dados bancários (ADMINISTRADOR/FINANCEIRO/RH,
  // ver PAPEIS_DADOS_BANCARIOS) — Financeiro e RH têm exatamente o mesmo
  // acesso de escrita aqui, pedido explícito do Vini.
  salarioPadrao: z.coerce.number().min(0).optional().nullable(),
  valorAdiantamentoPadrao: z.coerce.number().min(0).optional().nullable(),
});

const configSchema = z.object({
  bancoCodigo: z.string().regex(/^\d{3}$/),
  bancoNome: z.string().min(2),
  razaoSocial: z.string().min(2),
  cnpj: z.string().min(14),
  convenio: z.string().min(1),
  agencia: z.string().min(1),
  agenciaDv: z.string(),
  conta: z.string().min(1),
  contaDv: z.string(),
  endereco: z.string().min(2),
  numero: z.string().min(1),
  complemento: z.string(),
  cidade: z.string().min(1),
  cep: z.string().regex(/^\d{8}$/),
  uf: z.string().length(2),
  proximoSequencialRemessa: z.coerce.number().int().min(1),
});

const pagamentoSchema = z.object({
  colaboradorId: z.string().min(1),
  tipo: z.nativeEnum(TipoPagamentoColaborador),
  valor: z.coerce.number().positive("Valor deve ser maior que zero."),
  dataPrevista: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

const INCLUDE_PAGAMENTO = {
  colaborador: { select: { id: true, nomeCompleto: true, cpf: true } },
  remessa: { select: { id: true, numero: true, status: true, dataGeracao: true } },
} satisfies Prisma.PagamentoColaboradorInclude;

async function obterConfig(app: FastifyInstance) {
  // upsert com data vazia: cria com os defaults do schema na 1ª vez, nunca
  // sobrescreve o que já existe.
  return app.prisma.configuracaoPagamento.upsert({
    where: { id: "unica" },
    create: { id: "unica" },
    update: {},
  });
}

export default async function pagamentosRoutes(app: FastifyInstance) {
  // ---------- Configuração da empresa pagadora ----------
  app.get(
    "/pagamentos/configuracao",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (_request, reply) => reply.send(await obterConfig(app))
  );

  app.put(
    "/pagamentos/configuracao",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const parsed = configSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      await obterConfig(app);
      const atualizada = await app.prisma.configuracaoPagamento.update({ where: { id: "unica" }, data: parsed.data });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "ConfiguracaoPagamento", entidadeId: "unica", ip: request.ip,
      });
      return reply.send(atualizada);
    }
  );

  // ---------- Dados bancários do colaborador ----------
  app.get(
    "/colaboradores/:id/dados-bancarios",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_DADOS_BANCARIOS)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dados = await app.prisma.dadosBancariosColaborador.findUnique({ where: { colaboradorId: id } });
      return reply.send(dados);
    }
  );

  app.put(
    "/colaboradores/:id/dados-bancarios",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_DADOS_BANCARIOS)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const colaborador = await app.prisma.colaborador.findUnique({ where: { id } });
      if (!colaborador) return reply.code(404).send({ error: "Colaborador não encontrado." });

      const parsed = dadosBancariosSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const dados = await app.prisma.dadosBancariosColaborador.upsert({
        where: { colaboradorId: id },
        create: { colaboradorId: id, ...parsed.data },
        update: parsed.data,
      });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub, acao: "SALVAR_DADOS_BANCARIOS", entidade: "Colaborador", entidadeId: id, ip: request.ip,
      });
      return reply.send(dados);
    }
  );

  // ---------- Folhas de pagamento ----------
  app.get(
    "/folhas-pagamento",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (_request, reply) => {
      const folhas = await app.prisma.folhaPagamento.findMany({
        orderBy: { numero: "desc" },
        include: {
          pagamentos: { include: INCLUDE_PAGAMENTO, orderBy: { criadoEm: "asc" } },
          remessas: { select: { id: true, numero: true, status: true, dataGeracao: true, valorTotal: true, quantidadePagamentos: true }, orderBy: { numero: "desc" } },
          criadoPor: { select: { email: true, colaborador: { select: { nomeCompleto: true } } } },
        },
      });
      return reply.send(
        folhas.map((f) => ({
          ...f,
          valorTotal: f.pagamentos
            .filter((p) => p.status !== "CANCELADO")
            .reduce((soma, p) => soma.add(p.valor), new Decimal(0)),
        }))
      );
    }
  );

  app.post(
    "/folhas-pagamento",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const parsed = z
        .object({
          competencia: z.string().min(4),
          descricao: z.string().optional().nullable(),
          tipo: z.nativeEnum(TipoPagamentoColaborador).default("SALARIO"),
          dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const folha = await app.prisma.folhaPagamento.create({
        data: {
          competencia: parsed.data.competencia,
          descricao: parsed.data.descricao,
          tipo: parsed.data.tipo,
          dataPagamento: parsed.data.dataPagamento ? new Date(parsed.data.dataPagamento + "T00:00:00") : null,
          criadoPorId: request.user.sub,
        },
      });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "FolhaPagamento", entidadeId: folha.id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(201).send(folha);
    }
  );

  // PUT separado do POST porque, diferente de competência/tipo (fixados na
  // criação — trocar o tipo depois de já ter pagamentos lançados criaria
  // inconsistência com o que já foi lançado), descrição e data de pagamento
  // fazem sentido ajustar depois: a data em particular é normal só ficar
  // definida perto da geração da remessa (Vini pediu que a definição da data
  // única aconteça só depois dos valores ajustados no fluxo).
  app.put(
    "/folhas-pagamento/:id",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const folha = await app.prisma.folhaPagamento.findUnique({ where: { id } });
      if (!folha) return reply.code(404).send({ error: "Folha não encontrada." });
      if (folha.status === "FECHADA") return reply.code(409).send({ error: "Folha fechada — não pode mais ser editada." });
      const parsed = z
        .object({
          descricao: z.string().optional().nullable(),
          dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const atualizada = await app.prisma.folhaPagamento.update({
        where: { id },
        data: {
          ...("descricao" in parsed.data ? { descricao: parsed.data.descricao } : {}),
          ...("dataPagamento" in parsed.data
            ? { dataPagamento: parsed.data.dataPagamento ? new Date(parsed.data.dataPagamento + "T00:00:00") : null }
            : {}),
        },
      });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "FolhaPagamento", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.send(atualizada);
    }
  );

  app.delete(
    "/folhas-pagamento/:id",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const folha = await app.prisma.folhaPagamento.findUnique({ where: { id }, include: { remessas: { select: { id: true } } } });
      if (!folha) return reply.code(404).send({ error: "Folha não encontrada." });
      if (folha.remessas.length > 0) {
        return reply.code(409).send({ error: "Esta folha já tem remessa gerada — não pode ser excluída (cancele a remessa primeiro, se fizer sentido)." });
      }
      // Exclusão de folhas (21/07/2026, pedido do Vini) — só permitida antes
      // de qualquer remessa enviada/processada (checado acima) OU antes da
      // folha já ter sido processada (fechada pelo retorno automático, ver
      // fechamento automático em /remessas-cnab/importar-retorno). Depois de
      // FECHADA o histórico precisa ficar preservado, mesmo que por algum
      // caminho ainda não tivesse remessa vinculada (ex: baixa manual).
      if (folha.status === "FECHADA") {
        return reply.code(409).send({ error: "Esta folha já foi processada (fechada) — não pode ser excluída, para preservar o histórico." });
      }
      await app.prisma.folhaPagamento.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "FolhaPagamento", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(204).send();
    }
  );

  // ---------- Pagamentos dentro da folha ----------
  app.post(
    "/folhas-pagamento/:id/pagamentos",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const folha = await app.prisma.folhaPagamento.findUnique({ where: { id } });
      if (!folha) return reply.code(404).send({ error: "Folha não encontrada." });
      if (folha.status === "FECHADA") return reply.code(409).send({ error: "Folha fechada — reabra ou crie outra folha." });

      const parsed = pagamentoSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const pagamento = await app.prisma.pagamentoColaborador.create({
        data: {
          folhaId: id,
          colaboradorId: parsed.data.colaboradorId,
          tipo: parsed.data.tipo,
          valor: parsed.data.valor,
          dataPrevista: parsed.data.dataPrevista ? new Date(parsed.data.dataPrevista + "T00:00:00") : null,
          observacoes: parsed.data.observacoes ?? null,
        },
        include: INCLUDE_PAGAMENTO,
      });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "PagamentoColaborador", entidadeId: pagamento.id, detalhe: { valor: parsed.data.valor, tipo: parsed.data.tipo }, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(201).send(pagamento);
    }
  );

  // Lançamento em lote (21/07/2026, pedido do Vini: "selecionar os
  // colaboradores que receberão... trazer automaticamente o salário ou
  // adiantamento cadastrado... permitir alteração manual do valor"). O
  // valor sugerido (salarioPadrao/valorAdiantamentoPadrao, conforme o tipo
  // da folha) é resolvido e ajustável no FRONTEND antes de chamar esta rota
  // — aqui a rota só recebe o valor final já decidido por item, exatamente
  // como o lançamento individual acima; nunca é obrigatório o valor bater
  // com o cadastro (pode haver bônus, desconto, reajuste). Ignora
  // colaboradores que já têm um pagamento não-cancelado nesta mesma folha
  // (evita duplicar por engano se o lote for reenviado) — devolve quem foi
  // ignorado, sem falhar a operação inteira por causa disso.
  app.post(
    "/folhas-pagamento/:id/pagamentos/lote",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const folha = await app.prisma.folhaPagamento.findUnique({ where: { id } });
      if (!folha) return reply.code(404).send({ error: "Folha não encontrada." });
      if (folha.status === "FECHADA") return reply.code(409).send({ error: "Folha fechada — reabra ou crie outra folha." });

      const parsed = z
        .object({
          itens: z
            .array(
              z.object({
                colaboradorId: z.string().min(1),
                valor: z.coerce.number().positive("Valor deve ser maior que zero."),
                observacoes: z.string().optional().nullable(),
              })
            )
            .min(1, "Selecione ao menos um colaborador."),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const jaLancados = await app.prisma.pagamentoColaborador.findMany({
        where: { folhaId: id, status: { not: "CANCELADO" }, colaboradorId: { in: parsed.data.itens.map((i) => i.colaboradorId) } },
        select: { colaboradorId: true },
      });
      const idsJaLancados = new Set(jaLancados.map((p) => p.colaboradorId));
      const aCriar = parsed.data.itens.filter((i) => !idsJaLancados.has(i.colaboradorId));

      const colaboradores = await app.prisma.colaborador.findMany({
        where: { id: { in: aCriar.map((i) => i.colaboradorId) } },
        select: { id: true, nomeCompleto: true },
      });
      const nomesPorId = new Map(colaboradores.map((c) => [c.id, c.nomeCompleto]));

      const criados = await app.prisma.$transaction(
        aCriar
          .filter((item) => nomesPorId.has(item.colaboradorId))
          .map((item) =>
            app.prisma.pagamentoColaborador.create({
              data: {
                folhaId: id,
                colaboradorId: item.colaboradorId,
                tipo: folha.tipo,
                valor: item.valor,
                dataPrevista: folha.dataPagamento,
                observacoes: item.observacoes ?? null,
              },
              include: INCLUDE_PAGAMENTO,
            })
          )
      );

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR_LOTE",
        entidade: "PagamentoColaborador",
        entidadeId: id,
        detalhe: { quantidade: criados.length, ignorados: idsJaLancados.size },
        ip: request.ip,
      });
      avisarMudanca("pagamentos");
      return reply.code(201).send({
        criados,
        ignoradosPorJaExistir: [...idsJaLancados],
      });
    }
  );

  app.put(
    "/pagamentos-colaborador/:id",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existente = await app.prisma.pagamentoColaborador.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Pagamento não encontrado." });
      if (existente.status !== "PENDENTE" && existente.status !== "REJEITADO") {
        return reply.code(409).send({ error: "Só pagamentos pendentes ou rejeitados podem ser editados." });
      }
      const parsed = pagamentoSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const atualizado = await app.prisma.pagamentoColaborador.update({
        where: { id },
        data: {
          ...(parsed.data.colaboradorId ? { colaboradorId: parsed.data.colaboradorId } : {}),
          ...(parsed.data.tipo ? { tipo: parsed.data.tipo } : {}),
          ...(parsed.data.valor !== undefined ? { valor: parsed.data.valor } : {}),
          ...("dataPrevista" in parsed.data ? { dataPrevista: parsed.data.dataPrevista ? new Date(parsed.data.dataPrevista + "T00:00:00") : null } : {}),
          ...("observacoes" in parsed.data ? { observacoes: parsed.data.observacoes ?? null } : {}),
          // Reeditar um rejeitado o devolve pra PENDENTE (pronto pra entrar
          // numa remessa nova depois da correção).
          ...(existente.status === "REJEITADO" ? { status: "PENDENTE" as StatusPagamentoColaborador, ocorrencias: null, remessaId: null } : {}),
        },
        include: INCLUDE_PAGAMENTO,
      });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "PagamentoColaborador", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.send(atualizado);
    }
  );

  app.delete(
    "/pagamentos-colaborador/:id",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existente = await app.prisma.pagamentoColaborador.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Pagamento não encontrado." });
      if (existente.status !== "PENDENTE") {
        return reply.code(409).send({ error: "Só pagamentos pendentes podem ser excluídos." });
      }
      await app.prisma.pagamentoColaborador.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "PagamentoColaborador", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(204).send();
    }
  );

  // ---------- Pagamentos avulsos (22/07/2026, pedido do Vini) ----------
  // "Incluir pagamentos avulsos em geral, apenas para ter registro, sem
  // precisar de arquivo de remessa nem nada" — um avulso é exatamente um
  // PagamentoColaborador com folhaId nulo (ver comentário no schema.prisma).
  // Reaproveita toda a infra já existente por trás (PUT/DELETE genéricos
  // acima, recibo, histórico) — só precisou de rota de criação/listagem
  // própria e de uma forma de marcar como pago manualmente, já que não passa
  // pelo fluxo de retorno CNAB (só quem tem remessa recebe baixa automática).
  app.get(
    "/pagamentos-avulsos",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (_request, reply) => {
      const avulsos = await app.prisma.pagamentoColaborador.findMany({
        where: { folhaId: null },
        orderBy: { criadoEm: "desc" },
        include: INCLUDE_PAGAMENTO,
      });
      return reply.send(avulsos);
    }
  );

  app.post(
    "/pagamentos-avulsos",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const parsed = pagamentoSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const pagamento = await app.prisma.pagamentoColaborador.create({
        data: {
          folhaId: null,
          colaboradorId: parsed.data.colaboradorId,
          tipo: parsed.data.tipo,
          valor: parsed.data.valor,
          dataPrevista: parsed.data.dataPrevista ? new Date(parsed.data.dataPrevista + "T00:00:00") : null,
          observacoes: parsed.data.observacoes ?? null,
        },
        include: INCLUDE_PAGAMENTO,
      });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR_AVULSO", entidade: "PagamentoColaborador", entidadeId: pagamento.id, detalhe: { valor: parsed.data.valor, tipo: parsed.data.tipo }, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(201).send(pagamento);
    }
  );

  // Marcar como pago manualmente — só faz sentido para avulsos (quem tem
  // folha/remessa recebe baixa automática pelo retorno CNAB, ver
  // POST /remessas-cnab/importar-retorno; misturar os dois fluxos no mesmo
  // pagamento criaria inconsistência entre "pago pelo banco" x "pago à
  // mão"). Por isso o gate exige folhaId nulo, não só status PENDENTE.
  app.patch(
    "/pagamentos-colaborador/:id/marcar-pago",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existente = await app.prisma.pagamentoColaborador.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Pagamento não encontrado." });
      if (existente.folhaId !== null) {
        return reply.code(409).send({ error: "Este pagamento pertence a uma folha — a baixa é automática pelo retorno do banco." });
      }
      if (existente.status !== "PENDENTE") {
        return reply.code(409).send({ error: "Só pagamentos pendentes podem ser marcados como pagos." });
      }
      const atualizado = await app.prisma.pagamentoColaborador.update({
        where: { id },
        data: { status: "PAGO", dataConfirmacao: new Date() },
        include: INCLUDE_PAGAMENTO,
      });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "MARCAR_PAGO", entidade: "PagamentoColaborador", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.send(atualizado);
    }
  );

  // ---------- Histórico por colaborador ----------
  app.get(
    "/colaboradores/:id/pagamentos",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_DADOS_BANCARIOS)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const pagamentos = await app.prisma.pagamentoColaborador.findMany({
        where: { colaboradorId: id },
        orderBy: { criadoEm: "desc" },
        include: {
          folha: { select: { numero: true, competencia: true } },
          remessa: { select: { numero: true, dataGeracao: true, status: true } },
        },
      });
      return reply.send(pagamentos);
    }
  );

  // ---------- Recibos (PDF bruto da folha, split automático) ----------
  // Upload de UM ÚNICO PDF com todos os recibos da folha (21/07/2026,
  // pedido do Vini) — separa página por página, tenta identificar o dono de
  // cada uma por CPF (prioridade) ou nome (ver utils/reciboSplit.ts) e
  // anexa como recibo individual de cada PagamentoColaborador já lançado
  // nesta folha. Página que não bate com ninguém (ou bate com alguém que
  // não tem pagamento lançado aqui) NUNCA é atribuída por adivinhação — só
  // aparece na lista de "não identificadas" da resposta, pra anexação
  // manual avulso (rota abaixo). O PDF bruto inteiro não é guardado — só as
  // páginas que foram de fato vinculadas a um pagamento.
  app.post(
    "/folhas-pagamento/:id/upload-recibos",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const folha = await app.prisma.folhaPagamento.findUnique({ where: { id } });
      if (!folha) return reply.code(404).send({ error: "Folha não encontrada." });

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "Envie o PDF bruto com os recibos da folha." });
      if (file.mimetype !== "application/pdf") {
        await file.file.resume();
        return reply.code(400).send({ error: "Envie um arquivo PDF." });
      }
      const bytes = await file.toBuffer();
      if (file.file.truncated || bytes.byteLength > TAMANHO_MAXIMO_BYTES * 5) {
        return reply.code(413).send({ error: "Arquivo excede o tamanho máximo permitido para o lote de recibos (50MB)." });
      }

      const pagamentos = await app.prisma.pagamentoColaborador.findMany({
        where: { folhaId: id, status: { not: "CANCELADO" } },
        include: { colaborador: { include: { dadosBancarios: true } } },
      });
      if (pagamentos.length === 0) {
        return reply.code(409).send({ error: "Lance os pagamentos dos colaboradores nesta folha antes de anexar os recibos." });
      }
      const candidatos: CandidatoRecibo[] = pagamentos.map((p) => ({
        colaboradorId: p.colaboradorId,
        nomeCompleto: p.colaborador.nomeCompleto,
        cpfs: [p.colaborador.cpf, p.colaborador.dadosBancarios?.favorecidoCpf]
          .filter((v): v is string => !!v)
          .map(onlyDigits),
      }));
      const pagamentoPorColaborador = new Map(pagamentos.map((p) => [p.colaboradorId, p]));

      let textos: string[];
      let paginasPdf: Uint8Array[];
      try {
        [textos, paginasPdf] = await Promise.all([extrairTextoPorPagina(bytes), dividirPorPagina(bytes)]);
      } catch {
        return reply.code(422).send({ error: "Não foi possível ler este PDF — confere se o arquivo não está corrompido ou protegido por senha." });
      }

      const vinculados: { pagina: number; colaborador: string; motivoIdentificacao: "cpf" | "nome" }[] = [];
      const naoIdentificados: { pagina: number; motivo: string; amostraTexto: string }[] = [];

      for (let i = 0; i < textos.length; i++) {
        const pagina = i + 1;
        const texto = textos[i] ?? "";
        const paginaBytes = paginasPdf[i];
        const identificado = identificarPagina(texto, candidatos);
        const pagamento = identificado ? pagamentoPorColaborador.get(identificado.colaboradorId) : undefined;
        if (!identificado) {
          naoIdentificados.push({ pagina, motivo: "Nenhum CPF ou nome de colaborador desta folha encontrado no texto da página.", amostraTexto: texto.slice(0, 180) });
          continue;
        }
        if (!pagamento || !paginaBytes) {
          naoIdentificados.push({
            pagina,
            motivo: "Colaborador identificado, mas sem pagamento lançado nesta folha.",
            amostraTexto: texto.slice(0, 180),
          });
          continue;
        }

        const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(`recibo-pagamento-${pagamento.id}`, `recibo-pagina-${pagina}.pdf`);
        await fs.promises.mkdir(caminhoAbsoluto.slice(0, caminhoAbsoluto.lastIndexOf("/")), { recursive: true });
        await fs.promises.writeFile(caminhoAbsoluto, paginaBytes);

        const anexoAntigo = pagamento.reciboUrl;
        await app.prisma.pagamentoColaborador.update({
          where: { id: pagamento.id },
          data: {
            reciboUrl: caminhoRelativo,
            reciboNomeOriginal: `recibo-${(pagamento.colaborador.nomeCompleto.split(" ")[0] || "colaborador").toLowerCase()}-pagina${pagina}.pdf`,
            reciboTipo: "application/pdf",
            reciboEnviadoEm: new Date(),
          },
        });
        if (anexoAntigo) removerArquivoAnexo(anexoAntigo);

        vinculados.push({ pagina, colaborador: pagamento.colaborador.nomeCompleto, motivoIdentificacao: identificado.motivo });
      }

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "UPLOAD_RECIBOS_FOLHA",
        entidade: "FolhaPagamento",
        entidadeId: id,
        detalhe: { totalPaginas: textos.length, vinculados: vinculados.length, naoIdentificados: naoIdentificados.length },
        ip: request.ip,
      });
      avisarMudanca("pagamentos");
      return reply.send({ totalPaginas: textos.length, vinculados, naoIdentificados });
    }
  );

  // Anexo manual avulso (fallback do split automático acima, ou pra quem
  // prefere anexar recibo por recibo diretamente) — mesmo padrão de slot
  // único e substituível do termo de responsabilidade de Colaborador.
  app.post(
    "/pagamentos-colaborador/:id/recibo",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const pagamento = await app.prisma.pagamentoColaborador.findUnique({ where: { id } });
      if (!pagamento) return reply.code(404).send({ error: "Pagamento não encontrado." });

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "Nenhum arquivo enviado." });
      if (!MIME_TYPES_PERMITIDOS.has(file.mimetype)) {
        await file.file.resume();
        return reply.code(400).send({ error: "Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou PDF." });
      }

      const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(`recibo-pagamento-${id}`, file.filename);
      await fs.promises.mkdir(caminhoAbsoluto.slice(0, caminhoAbsoluto.lastIndexOf("/")), { recursive: true });
      try {
        await pipeline(file.file, fs.createWriteStream(caminhoAbsoluto));
      } catch (err) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        throw err;
      }
      const { size } = await fs.promises.stat(caminhoAbsoluto);
      if (file.file.truncated || size > TAMANHO_MAXIMO_BYTES) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        return reply.code(413).send({ error: `Arquivo excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)}MB).` });
      }

      const anexoAntigo = pagamento.reciboUrl;
      const atualizado = await app.prisma.pagamentoColaborador.update({
        where: { id },
        data: {
          reciboUrl: caminhoRelativo,
          reciboNomeOriginal: file.filename,
          reciboTipo: file.mimetype,
          reciboEnviadoEm: new Date(),
        },
      });
      if (anexoAntigo) removerArquivoAnexo(anexoAntigo);

      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ANEXAR_RECIBO_MANUAL", entidade: "PagamentoColaborador", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(201).send({ reciboNomeOriginal: atualizado.reciboNomeOriginal, reciboEnviadoEm: atualizado.reciboEnviadoEm });
    }
  );

  app.get(
    "/pagamentos-colaborador/:id/recibo",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_DADOS_BANCARIOS)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const pagamento = await app.prisma.pagamentoColaborador.findUnique({ where: { id } });
      if (!pagamento || !pagamento.reciboUrl) return reply.code(404).send({ error: "Este pagamento não tem recibo anexado." });
      const caminhoAbsoluto = caminhoAbsolutoDoAnexo(pagamento.reciboUrl);
      if (!caminhoAbsoluto || !fs.existsSync(caminhoAbsoluto)) return reply.code(404).send({ error: "Arquivo não encontrado no armazenamento." });
      const nomeOriginal = (pagamento.reciboNomeOriginal || "recibo").replace(/"/g, "");
      reply.header("Content-Disposition", `inline; filename="${nomeOriginal}"`);
      if (pagamento.reciboTipo) reply.header("Content-Type", pagamento.reciboTipo);
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "BAIXAR_RECIBO", entidade: "PagamentoColaborador", entidadeId: id, ip: request.ip });
      return reply.send(fs.createReadStream(caminhoAbsoluto));
    }
  );

  app.delete(
    "/pagamentos-colaborador/:id/recibo",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const pagamento = await app.prisma.pagamentoColaborador.findUnique({ where: { id } });
      if (!pagamento) return reply.code(404).send({ error: "Pagamento não encontrado." });
      if (!pagamento.reciboUrl) return reply.code(204).send();
      removerArquivoAnexo(pagamento.reciboUrl);
      await app.prisma.pagamentoColaborador.update({
        where: { id },
        data: { reciboUrl: null, reciboNomeOriginal: null, reciboTipo: null, reciboEnviadoEm: null },
      });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "REMOVER_RECIBO", entidade: "PagamentoColaborador", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(204).send();
    }
  );

  // ---------- Geração da remessa ----------
  app.post(
    "/folhas-pagamento/:id/gerar-remessa",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({
          // Opcional (21/07/2026) — quando omitida, cai na data única já
          // definida na folha (FolhaPagamento.dataPagamento). Continua
          // aceitando uma data explícita aqui pra ajustar/confirmar na hora,
          // sem precisar voltar e editar a folha antes.
          dataPagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de pagamento inválida.").optional(),
          pagamentoIds: z.array(z.string()).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const folha = await app.prisma.folhaPagamento.findUnique({
        where: { id },
        include: {
          pagamentos: {
            where: {
              // Reenvio parcial de rejeitados (21/07/2026, pedido do Vini:
              // "permitir nova geração da remessa apenas para os pagamentos
              // rejeitados") — REJEITADO só entra quando explicitamente
              // selecionado via pagamentoIds (nunca junto com o "gerar tudo
              // que está pendente" default, pra não reenviar um rejeitado
              // sem ninguém ter decidido reenviar aquele especificamente).
              status: parsed.data.pagamentoIds ? { in: ["PENDENTE", "REJEITADO"] } : "PENDENTE",
              ...(parsed.data.pagamentoIds ? { id: { in: parsed.data.pagamentoIds } } : {}),
            },
            include: { colaborador: { include: { dadosBancarios: true } } },
          },
        },
      });
      if (!folha) return reply.code(404).send({ error: "Folha não encontrada." });
      if (folha.pagamentos.length === 0) {
        return reply.code(409).send({ error: "Nenhum pagamento pendente (ou rejeitado selecionado) nesta folha." });
      }
      if (!parsed.data.dataPagamento && !folha.dataPagamento) {
        return reply.code(422).send({ error: "Defina a data de pagamento da folha antes de gerar a remessa." });
      }

      // Validação ANTES de qualquer escrita: todo mundo precisa ter dados
      // bancários completos e CPF — a lista de quem falta volta inteira, não
      // só o primeiro erro.
      const problemas: string[] = [];
      for (const p of folha.pagamentos) {
        const db = p.colaborador.dadosBancarios;
        if (!db) {
          problemas.push(`${p.colaborador.nomeCompleto}: sem dados bancários cadastrados.`);
          continue;
        }
        const cpf = onlyDigits(db.favorecidoCpf || p.colaborador.cpf || "");
        if (cpf.length !== 11) problemas.push(`${p.colaborador.nomeCompleto}: CPF do favorecido inválido.`);
        if (onlyDigits(db.bancoCodigo).length !== 3) problemas.push(`${p.colaborador.nomeCompleto}: código do banco inválido.`);
        if (!db.endereco || !db.numero || !db.bairro || !db.cidade || onlyDigits(db.cep).length !== 8 || db.uf.length !== 2) {
          problemas.push(`${p.colaborador.nomeCompleto}: endereço incompleto nos dados bancários.`);
        }
      }
      if (problemas.length > 0) {
        return reply.code(422).send({ error: "Corrija os cadastros antes de gerar a remessa:", detalhes: problemas });
      }

      const config = await obterConfig(app);
      const dataPagamento = parsed.data.dataPagamento
        ? new Date(parsed.data.dataPagamento + "T00:00:00")
        : folha.dataPagamento!;
      const dataGeracao = new Date();

      const empresa: EmpresaCnab = {
        bancoCodigo: config.bancoCodigo,
        bancoNome: config.bancoNome,
        razaoSocial: config.razaoSocial,
        cnpj: config.cnpj,
        convenio: config.convenio,
        agencia: config.agencia,
        agenciaDv: config.agenciaDv,
        conta: config.conta,
        contaDv: config.contaDv,
        endereco: config.endereco,
        numero: config.numero,
        complemento: config.complemento,
        cidade: config.cidade,
        cep: config.cep,
        uf: config.uf,
        sequencialRemessa: config.proximoSequencialRemessa,
      };

      const favorecidos: FavorecidoCnab[] = folha.pagamentos.map((p) => {
        const db = p.colaborador.dadosBancarios!;
        return {
          nome: db.favorecidoNome || p.colaborador.nomeCompleto,
          cpf: onlyDigits(db.favorecidoCpf || p.colaborador.cpf || ""),
          bancoCodigo: db.bancoCodigo,
          agencia: db.agencia,
          agenciaDv: db.agenciaDv ?? "",
          conta: db.conta,
          contaDv: db.contaDv ?? "",
          valor: p.valor,
          // Número do pagamento no sistema — volta no retorno do banco e é a
          // chave da baixa automática.
          codigoIdentificacao: String(p.numero),
          endereco: db.endereco,
          numero: db.numero,
          complemento: db.complemento ?? "",
          bairro: db.bairro,
          cidade: db.cidade,
          cep: db.cep,
          uf: db.uf,
        };
      });

      const { conteudo, totalValor } = gerarCnab240(empresa, favorecidos, dataPagamento, dataGeracao);
      const arquivoNome = `remessa_${String(config.proximoSequencialRemessa).padStart(3, "0")}.rem`;

      const remessa = await app.prisma.$transaction(async (tx) => {
        const criada = await tx.remessaCnab.create({
          data: {
            numero: config.proximoSequencialRemessa,
            folhaId: id,
            dataPagamento,
            dataGeracao,
            geradoPorId: request.user.sub,
            quantidadePagamentos: folha.pagamentos.length,
            valorTotal: totalValor,
            arquivoNome,
            conteudo,
          },
        });
        await tx.pagamentoColaborador.updateMany({
          where: { id: { in: folha.pagamentos.map((p) => p.id) } },
          data: { status: "EM_REMESSA", remessaId: criada.id },
        });
        // Sequencial consumido — incrementa dentro da MESMA transação, com
        // checagem de corrida: se outra geração consumiu o mesmo número no
        // meio do caminho, updateMany não acha a linha e a transação inteira
        // desfaz (unique em RemessaCnab.numero é a segunda trava).
        const atualizadas = await tx.configuracaoPagamento.updateMany({
          where: { id: "unica", proximoSequencialRemessa: config.proximoSequencialRemessa },
          data: { proximoSequencialRemessa: config.proximoSequencialRemessa + 1 },
        });
        if (atualizadas.count !== 1) throw new Error("Concorrência na geração da remessa — tente de novo.");
        return criada;
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "GERAR_REMESSA_CNAB",
        entidade: "RemessaCnab",
        entidadeId: remessa.id,
        detalhe: { numero: remessa.numero, quantidade: folha.pagamentos.length, valorTotal: totalValor.toString() },
        ip: request.ip,
      });
      avisarMudanca("pagamentos");
      return reply.code(201).send(remessa);
    }
  );

  // ---------- Remessas ----------
  app.get(
    "/remessas-cnab",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (_request, reply) => {
      const remessas = await app.prisma.remessaCnab.findMany({
        orderBy: { numero: "desc" },
        include: {
          folha: { select: { numero: true, competencia: true } },
          geradoPor: { select: { email: true, colaborador: { select: { nomeCompleto: true } } } },
          pagamentos: { include: INCLUDE_PAGAMENTO, orderBy: { criadoEm: "asc" } },
        },
      });
      return reply.send(remessas);
    }
  );

  app.get(
    "/remessas-cnab/:id/arquivo",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const remessa = await app.prisma.remessaCnab.findUnique({ where: { id } });
      if (!remessa) return reply.code(404).send({ error: "Remessa não encontrada." });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "BAIXAR_REMESSA_CNAB", entidade: "RemessaCnab", entidadeId: id, ip: request.ip });
      reply.header("Content-Disposition", `attachment; filename="${remessa.arquivoNome}"`);
      reply.header("Content-Type", "text/plain; charset=ascii");
      return reply.send(remessa.conteudo);
    }
  );

  app.patch(
    "/remessas-cnab/:id/status",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ status: z.enum(["ENVIADA", "CANCELADA"]) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Status inválido — daqui só se marca ENVIADA ou CANCELADA (PROCESSADA/REJEITADA vêm do arquivo de retorno)." });

      const remessa = await app.prisma.remessaCnab.findUnique({ where: { id } });
      if (!remessa) return reply.code(404).send({ error: "Remessa não encontrada." });
      if (remessa.status === "PROCESSADA") return reply.code(409).send({ error: "Remessa já processada pelo banco — não pode mais mudar." });

      if (parsed.data.status === "CANCELADA") {
        // Cancelar devolve os pagamentos pra PENDENTE (o arquivo não foi ou
        // não será processado pelo banco) — eles podem entrar numa remessa
        // nova depois.
        await app.prisma.$transaction([
          app.prisma.remessaCnab.update({ where: { id }, data: { status: "CANCELADA" } }),
          app.prisma.pagamentoColaborador.updateMany({
            where: { remessaId: id, status: "EM_REMESSA" },
            data: { status: "PENDENTE", remessaId: null },
          }),
        ]);
      } else {
        await app.prisma.remessaCnab.update({ where: { id }, data: { status: "ENVIADA" } });
      }

      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: `REMESSA_${parsed.data.status}`, entidade: "RemessaCnab", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(204).send();
    }
  );

  // Exclusão definitiva de remessa (22/07/2026, pedido do Vini: "poder
  // excluir... remessas que não forem lançadas"). Confirmado com o Vini via
  // pergunta explícita: só enquanto GERADA — assim que vira ENVIADA, o
  // arquivo já pode ter sido entregue ao banco fisicamente, então daí em
  // diante só CANCELAR (que mantém o registro histórico) faz sentido, nunca
  // apagar. Reverte os pagamentos ligados pra PENDENTE antes de excluir, na
  // mesma transação (mesmo efeito da CANCELADA acima, só que some com a
  // remessa em vez de manter o registro). Decisão deliberada: NÃO decrementa
  // `ConfiguracaoPagamento.proximoSequencialRemessa` — evita qualquer risco
  // de dois arquivos saírem com o mesmo número sequencial; o "buraco" na
  // numeração é um efeito colateral aceitável e mais seguro.
  app.delete(
    "/remessas-cnab/:id",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const remessa = await app.prisma.remessaCnab.findUnique({ where: { id } });
      if (!remessa) return reply.code(404).send({ error: "Remessa não encontrada." });
      if (remessa.status !== "GERADA") {
        return reply.code(409).send({ error: "Só remessas ainda não enviadas (status Gerada) podem ser excluídas — cancele em vez de excluir se já foi enviada." });
      }

      await app.prisma.$transaction([
        app.prisma.pagamentoColaborador.updateMany({
          where: { remessaId: id, status: "EM_REMESSA" },
          data: { status: "PENDENTE", remessaId: null },
        }),
        app.prisma.remessaCnab.delete({ where: { id } }),
      ]);

      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "RemessaCnab", entidadeId: id, ip: request.ip });
      avisarMudanca("pagamentos");
      return reply.code(204).send();
    }
  );

  // ---------- Importação do retorno ----------
  app.post(
    "/remessas-cnab/importar-retorno",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PAGAMENTO)] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "Envie o arquivo de retorno do banco." });
      const conteudo = (await file.toBuffer()).toString("latin1");

      const { itens } = lerRetornoCnab240(conteudo);
      if (itens.length === 0) {
        return reply.code(422).send({ error: "Nenhum Segmento A encontrado no arquivo — confere se é o retorno CNAB 240 do Sicoob?" });
      }

      const resultado = {
        pagos: 0,
        rejeitados: 0,
        naoEncontrados: [] as string[],
        // Detalhe dos rejeitados (21/07/2026, pedido do Vini: "informar
        // quais pagamentos apresentaram erro") — a UI usa isso pra listar o
        // problema e oferecer "gerar nova remessa" só com esses IDs (o
        // gerador de remessa passou a aceitar pagamento REJEITADO quando
        // selecionado explicitamente, ver .../gerar-remessa).
        rejeitadosDetalhe: [] as { pagamentoId: string; colaborador: string; motivo: string }[],
        // Folhas fechadas automaticamente porque todo mundo foi pago (ver
        // abaixo) — a UI usa isso só pra feedback ("Folha X fechada
        // automaticamente"), o fechamento em si já aconteceu no banco.
        folhasFechadasAutomaticamente: [] as number[],
      };
      const remessasAfetadas = new Set<string>();

      for (const item of itens) {
        const numero = Number(item.codigoIdentificacao);
        const pagamento = Number.isInteger(numero) && numero > 0
          ? await app.prisma.pagamentoColaborador.findUnique({
              where: { numero },
              include: { colaborador: { select: { nomeCompleto: true } } },
            })
          : null;
        if (!pagamento) {
          resultado.naoEncontrados.push(item.codigoIdentificacao);
          continue;
        }
        const descricao = item.ocorrencias
          .map((o) => `${o} — ${DESCRICAO_OCORRENCIA[o] ?? `código ${o}`}`)
          .join("; ");
        await app.prisma.pagamentoColaborador.update({
          where: { id: pagamento.id },
          data: {
            status: item.pago ? "PAGO" : "REJEITADO",
            ocorrencias: descricao || (item.pago ? "00 — Crédito ou débito efetivado" : null),
            dataConfirmacao: item.pago ? new Date() : null,
          },
        });
        if (item.pago) {
          resultado.pagos += 1;
        } else {
          resultado.rejeitados += 1;
          resultado.rejeitadosDetalhe.push({
            pagamentoId: pagamento.id,
            colaborador: pagamento.colaborador.nomeCompleto,
            motivo: descricao || "Rejeitado pelo banco (sem descrição de ocorrência).",
          });
        }
        if (pagamento.remessaId) remessasAfetadas.add(pagamento.remessaId);
      }

      // Situação da remessa reflete o desfecho: tudo rejeitado = REJEITADA;
      // qualquer coisa paga = PROCESSADA.
      const foldersAfetadas = new Set<string>();
      for (const remessaId of remessasAfetadas) {
        const pagamentos = await app.prisma.pagamentoColaborador.findMany({ where: { remessaId }, select: { status: true } });
        const algumPago = pagamentos.some((p) => p.status === "PAGO");
        const remessaAtualizada = await app.prisma.remessaCnab.update({
          where: { id: remessaId },
          data: { status: algumPago ? "PROCESSADA" : "REJEITADA", retornoImportadoEm: new Date() },
        });
        if (remessaAtualizada.folhaId) foldersAfetadas.add(remessaAtualizada.folhaId);
      }

      // Fechamento automático da folha (21/07/2026, pedido do Vini): "se
      // todos os pagamentos forem processados com sucesso, alterar
      // automaticamente o status da folha de Aberta para Fechada". Considera
      // só pagamentos não-CANCELADO (um cancelamento não é uma pendência —
      // já foi decidido que não ia acontecer). Se sobrar QUALQUER pagamento
      // que não seja PAGO (PENDENTE, EM_REMESSA ou REJEITADO), a folha
      // continua ABERTA — sem sobrescrever se já não estiver ABERTA, pra não
      // reabrir por engano uma folha fechada manualmente por outro caminho.
      for (const folhaId of foldersAfetadas) {
        const folha = await app.prisma.folhaPagamento.findUnique({ where: { id: folhaId }, select: { status: true, numero: true } });
        if (!folha || folha.status !== "ABERTA") continue;
        const pagamentosDaFolha = await app.prisma.pagamentoColaborador.findMany({
          where: { folhaId, status: { not: "CANCELADO" } },
          select: { status: true },
        });
        const todosPagos = pagamentosDaFolha.length > 0 && pagamentosDaFolha.every((p) => p.status === "PAGO");
        if (todosPagos) {
          await app.prisma.folhaPagamento.update({ where: { id: folhaId }, data: { status: "FECHADA" } });
          resultado.folhasFechadasAutomaticamente.push(folha.numero);
        }
      }

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "IMPORTAR_RETORNO_CNAB",
        entidade: "RemessaCnab",
        detalhe: resultado,
        ip: request.ip,
      });
      avisarMudanca("pagamentos");
      return reply.send(resultado);
    }
  );
}
