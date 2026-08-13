import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, PrioridadeImovel, StatusAtivoInativo, StatusImovel, TipoImovel } from "@prisma/client";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarAuditoria } from "../utils/audit";
import { avisarMudanca } from "../utils/realtime";
import { env } from "../env";
import { executarSincronizacaoImoview, notificarMudancaStatusImovel } from "../utils/marketingImoviewSyncJob";

// Módulo de Marketing Imobiliário (13/08/2026, Fases 1+2+8) — arquivo único
// de propósito: por ora é só 1 entidade central (ImovelMarketing) + 4
// domínios simples + sincronização, o que não justifica uma subpasta
// routes/marketing/ (essa divisão só compensa quando existirem várias
// entidades relacionadas, ver roadmap de fases futuras do módulo). Um
// arquivo por módulo é o padrão do resto do projeto (equipamentos.routes.ts,
// dominios.routes.ts etc.).

const PAPEIS_GERENCIAM_MARKETING = ["ADMINISTRADOR", "MARKETING"] as const;

// ---------------------------------------------------------------------
// 4 domínios extensíveis (Canal/Objetivo/Origem de Lead/Tipo de Criativo)
// — deliberadamente FORA do helper genérico `registrarDominioSimples` de
// dominios.routes.ts: aquele helper só permite escrita por ADMINISTRADOR, e
// mudar isso ali arriscaria regressão nos 7 domínios já em produção que o
// usam. Aqui, um helper local pequeno e dedicado, com escrita liberada para
// ADMINISTRADOR E MARKETING (app.requireRole aceita múltiplos papéis, ver
// plugins/auth.ts). Sem DELETE por ora: nenhuma tela ainda referencia esses
// ids para checar "em uso" (ImovelMarketing não tem FK pra nenhum dos 4) —
// adicionar exclusão agora seria prematuro; ativar/inativar via PATCH já
// cobre "não quero mais usar este valor" sem risco de órfão.
interface DominioMarketingConfig {
  path: string;
  model: "canalMarketing" | "objetivoMarketing" | "origemLeadMarketing" | "tipoCriativoMarketing";
  entidade: string;
  artigo: string;
}

function registrarDominioMarketing(app: FastifyInstance, config: DominioMarketingConfig) {
  const prismaModel = (app.prisma as any)[config.model];

  app.get(`/${config.path}`, { preHandler: [app.authenticate] }, async (_request, reply) => {
    const itens = await prismaModel.findMany({ orderBy: { nome: "asc" } });
    return reply.send(itens);
  });

  app.post(
    `/${config.path}`,
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM_MARKETING)] },
    async (request, reply) => {
      const parsed = z.object({ nome: z.string().min(2) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const jaExiste = await prismaModel.findUnique({ where: { nome: parsed.data.nome } });
      if (jaExiste) return reply.code(409).send({ error: `Já existe ${config.artigo} com este nome.` });
      const item = await prismaModel.create({ data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: config.entidade, entidadeId: item.id, ip: request.ip });
      avisarMudanca("marketing");
      return reply.code(201).send(item);
    }
  );

  app.patch(
    `/${config.path}/:id`,
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM_MARKETING)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({ nome: z.string().min(2).optional(), status: z.nativeEnum(StatusAtivoInativo).optional() })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      if (parsed.data.nome) {
        const jaExiste = await prismaModel.findUnique({ where: { nome: parsed.data.nome } });
        if (jaExiste && jaExiste.id !== id) return reply.code(409).send({ error: `Já existe ${config.artigo} com este nome.` });
      }
      const item = await prismaModel.update({ where: { id }, data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: config.entidade, entidadeId: id, ip: request.ip });
      avisarMudanca("marketing");
      return reply.send(item);
    }
  );
}

// ---------------------------------------------------------------------
// ImovelMarketing — Banco de Imóveis (Fase 2)
// ---------------------------------------------------------------------

const imovelInputSchema = z.object({
  codigo: z.string().min(1, "Informe o código."),
  unidadeId: z.string().min(1, "Selecione a unidade."),
  tipo: z.nativeEnum(TipoImovel),
  bairroRegiao: z.string().optional().nullable(),
  descricaoCurta: z.string().optional().nullable(),
  valor: z.union([z.string(), z.number()]).optional().nullable(),
  corretorId: z.string().optional().nullable(),
  corretorNome: z.string().optional().nullable(),
  temFotos: z.boolean().optional(),
  temVideo: z.boolean().optional(),
  linkPasta: z.string().optional().nullable(),
  prioridade: z.nativeEnum(PrioridadeImovel).optional(),
  status: z.nativeEnum(StatusImovel).optional(),
  observacoes: z.string().optional().nullable(),
});

const INCLUDE_IMOVEL = {
  unidade: true,
  corretor: { select: { id: true, nomeCompleto: true } },
} satisfies Prisma.ImovelMarketingInclude;

const imovelListQuerySchema = paginationSchema.extend({
  unidadeId: z.string().optional(),
  tipo: z.nativeEnum(TipoImovel).optional(),
  status: z.nativeEnum(StatusImovel).optional(),
  prioridade: z.nativeEnum(PrioridadeImovel).optional(),
  busca: z.string().optional(),
});

// Protege POST /marketing/sincronizacao/executar contra execução
// concorrente — flag simples em memória do módulo (mesmo racional já usado
// em outros pontos do projeto para evitar corrida em job manual x
// agendado): duas chamadas simultâneas (ex: alguém clica 2x no botão
// "Sincronizar agora" ou o job automático dispara no meio de uma execução
// manual) nunca rodam ao mesmo tempo.
let sincronizacaoEmAndamento = false;

export default async function marketingRoutes(app: FastifyInstance) {
  registrarDominioMarketing(app, { path: "canais-marketing", model: "canalMarketing", entidade: "CanalMarketing", artigo: "um canal" });
  registrarDominioMarketing(app, { path: "objetivos-marketing", model: "objetivoMarketing", entidade: "ObjetivoMarketing", artigo: "um objetivo" });
  registrarDominioMarketing(app, {
    path: "origens-lead-marketing",
    model: "origemLeadMarketing",
    entidade: "OrigemLeadMarketing",
    artigo: "uma origem de lead",
  });
  registrarDominioMarketing(app, {
    path: "tipos-criativo-marketing",
    model: "tipoCriativoMarketing",
    entidade: "TipoCriativoMarketing",
    artigo: "um tipo de criativo",
  });

  // Leitura liberada pra qualquer autenticado (inclui GESTOR_COORDENADOR:
  // "gestor vê resumo, não edita" — design do módulo).
  app.get("/marketing/imoveis", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = imovelListQuerySchema.parse(request.query);
    const { skip, take } = toSkipTake(query);

    const where: Prisma.ImovelMarketingWhereInput = {
      ...(query.unidadeId ? { unidadeId: query.unidadeId } : {}),
      ...(query.tipo ? { tipo: query.tipo } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.prioridade ? { prioridade: query.prioridade } : {}),
      ...(query.busca
        ? {
            OR: [
              { codigo: { contains: query.busca, mode: "insensitive" as const } },
              { bairroRegiao: { contains: query.busca, mode: "insensitive" as const } },
              { corretorNome: { contains: query.busca, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      app.prisma.imovelMarketing.findMany({ where, skip, take, orderBy: { criadoEm: "desc" }, include: INCLUDE_IMOVEL }),
      app.prisma.imovelMarketing.count({ where }),
    ]);

    return reply.send(paginatedResponse(items, total, query));
  });

  app.get("/marketing/imoveis/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const imovel = await app.prisma.imovelMarketing.findUnique({ where: { id }, include: INCLUDE_IMOVEL });
    if (!imovel) return reply.code(404).send({ error: "Imóvel não encontrado." });
    return reply.send(imovel);
  });

  app.post(
    "/marketing/imoveis",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM_MARKETING)] },
    async (request, reply) => {
      const parsed = imovelInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const codigoJaExiste = await app.prisma.imovelMarketing.findUnique({ where: { codigo: parsed.data.codigo } });
      if (codigoJaExiste) return reply.code(409).send({ error: "Já existe um imóvel com este código." });

      const unidadeExiste = await app.prisma.unidade.findUnique({ where: { id: parsed.data.unidadeId } });
      if (!unidadeExiste) return reply.code(400).send({ error: "Unidade não encontrada." });

      if (parsed.data.corretorId) {
        const corretorExiste = await app.prisma.colaborador.findUnique({ where: { id: parsed.data.corretorId } });
        if (!corretorExiste) return reply.code(400).send({ error: "Corretor não encontrado." });
      }

      const imovel = await app.prisma.imovelMarketing.create({ data: parsed.data, include: INCLUDE_IMOVEL });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "ImovelMarketing", entidadeId: imovel.id, ip: request.ip });
      avisarMudanca("marketing");
      return reply.code(201).send(imovel);
    }
  );

  app.patch(
    "/marketing/imoveis/:id",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM_MARKETING)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = imovelInputSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const atual = await app.prisma.imovelMarketing.findUnique({ where: { id } });
      if (!atual) return reply.code(404).send({ error: "Imóvel não encontrado." });

      if (parsed.data.codigo) {
        const codigoJaExiste = await app.prisma.imovelMarketing.findUnique({ where: { codigo: parsed.data.codigo } });
        if (codigoJaExiste && codigoJaExiste.id !== id) return reply.code(409).send({ error: "Já existe um imóvel com este código." });
      }
      if (parsed.data.unidadeId) {
        const unidadeExiste = await app.prisma.unidade.findUnique({ where: { id: parsed.data.unidadeId } });
        if (!unidadeExiste) return reply.code(400).send({ error: "Unidade não encontrada." });
      }
      if (parsed.data.corretorId) {
        const corretorExiste = await app.prisma.colaborador.findUnique({ where: { id: parsed.data.corretorId } });
        if (!corretorExiste) return reply.code(400).send({ error: "Corretor não encontrado." });
      }

      const imovel = await app.prisma.imovelMarketing.update({ where: { id }, data: parsed.data, include: INCLUDE_IMOVEL });

      // Regra: só notifica quando o status é de fato alterado nesta chamada
      // (não em toda edição — editar só a descrição, por exemplo, não gera
      // aviso nenhum). `excluirOrigem` (padrão true em notificar()) já
      // exclui quem fez a própria mudança do recebimento.
      if (parsed.data.status && parsed.data.status !== atual.status) {
        await notificarMudancaStatusImovel(app, { id: imovel.id, codigo: imovel.codigo, status: imovel.status }, request.user.sub);
      }

      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "ImovelMarketing", entidadeId: id, ip: request.ip });
      avisarMudanca("marketing");
      return reply.send(imovel);
    }
  );

  // ---------------------------------------------------------------------
  // Sincronização com o Imoview (Fase 8)
  // ---------------------------------------------------------------------

  app.get("/marketing/sincronizacao/status", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const registros = await app.prisma.sincronizacaoImoviewLog.findMany({
      orderBy: { executadoEm: "desc" },
      take: 20,
    });
    return reply.send({ ativa: !!env.IMOVIEW_API_KEY, registros });
  });

  app.post(
    "/marketing/sincronizacao/executar",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM_MARKETING)] },
    async (request, reply) => {
      if (!env.IMOVIEW_API_KEY) {
        return reply.code(400).send({ error: "Integração com Imoview não configurada — defina IMOVIEW_API_KEY." });
      }
      if (sincronizacaoEmAndamento) {
        return reply.code(409).send({ error: "Já existe uma sincronização em andamento. Aguarde ela terminar." });
      }

      sincronizacaoEmAndamento = true;
      try {
        const resultado = await executarSincronizacaoImoview(app, request.user.sub);
        return reply.send(resultado);
      } finally {
        sincronizacaoEmAndamento = false;
      }
    }
  );
}
