import { FastifyInstance } from "fastify";
import { z } from "zod";
import { registrarAuditoria } from "../utils/audit";
import { avisarMudanca } from "../utils/realtime";
import { notificarPorPapeis, notificar } from "../utils/notificacoes.service";

// Solicitações de Serviço (20/07/2026, pedido do Vini): colaborador pede um
// SERVIÇO (ex: "marketing precisa de Dropbox"); o Suporte TI atende e
// resolve o acesso; se o serviço exigir plano/contratação PAGA, o TI
// encaminha ao Financeiro com fornecedor/valor estimado, e é o Financeiro
// quem conclui. "Hierarquia de processos que evolui a cada necessidade":
//
//   ABERTA ──(TI atende)──▶ EM_ATENDIMENTO ──┬──(sem custo)──▶ CONCLUIDA
//                                            └──(precisa pagar)──▶
//                       AGUARDANDO_CONTRATACAO ──(Financeiro)──▶ CONCLUIDA
//   (qualquer etapa) ──▶ RECUSADA
//
// Timeline de eventos no mesmo padrão de ChamadoEvento — cada transição
// vira uma linha visível, nunca uma edição silenciosa.

const PAPEIS_TI = ["ADMINISTRADOR", "SUPORTE_TI"] as const;
// RH incluído em 22/07/2026 (pedido do Vini, "igualar RH e Financeiro,
// inclusive Solicitações") — RH decide contratação paga de serviço
// exatamente como FINANCEIRO já decidia.
const PAPEIS_FINANCEIRO = ["ADMINISTRADOR", "FINANCEIRO", "RH"] as const;

const INCLUDE_SERVICO = {
  solicitante: { select: { id: true, nomeCompleto: true } },
  unidade: { select: { id: true, nome: true } },
  eventos: {
    orderBy: { criadoEm: "asc" as const },
    include: { autor: { select: { email: true, colaborador: { select: { nomeCompleto: true } } } } },
  },
};

async function adicionarEvento(app: FastifyInstance, solicitacaoId: string, autorId: string | null, mensagem: string) {
  await app.prisma.solicitacaoServicoEvento.create({ data: { solicitacaoId, autorId, mensagem } });
}

export default async function solicitacoesServicoRoutes(app: FastifyInstance) {
  app.get("/solicitacoes-servico", { preHandler: [app.authenticate] }, async (request, reply) => {
    // Colaborador comum só vê as próprias; papéis de gestão veem tudo.
    const escopo =
      request.user.papel === "COLABORADOR" && request.user.colaboradorId
        ? { solicitanteId: request.user.colaboradorId }
        : {};
    const solicitacoes = await app.prisma.solicitacaoServico.findMany({
      where: escopo,
      orderBy: { criadoEm: "desc" },
      include: INCLUDE_SERVICO,
    });
    return reply.send(solicitacoes);
  });

  app.post("/solicitacoes-servico", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = z
      .object({
        solicitanteId: z.string().min(1),
        servico: z.string().min(2, "Diga qual serviço você precisa."),
        descricao: z.string().optional().nullable(),
        unidadeId: z.string().optional().nullable(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

    if (request.user.papel === "COLABORADOR" && parsed.data.solicitanteId !== request.user.colaboradorId) {
      return reply.code(403).send({ error: "Você só pode abrir solicitações em seu próprio nome." });
    }

    const solicitacao = await app.prisma.solicitacaoServico.create({
      data: {
        solicitanteId: parsed.data.solicitanteId,
        servico: parsed.data.servico,
        descricao: parsed.data.descricao ?? null,
        unidadeId: parsed.data.unidadeId ?? null,
      },
      include: INCLUDE_SERVICO,
    });
    await adicionarEvento(app, solicitacao.id, request.user.sub, `Solicitação aberta: ${parsed.data.servico}`);
    await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "SolicitacaoServico", entidadeId: solicitacao.id, ip: request.ip });
    await notificarPorPapeis(app, [...PAPEIS_TI], {
      categoria: "SOLICITACAO_EQUIPAMENTO",
      tipo: "SOLICITACAO_EQUIPAMENTO_NOVA",
      titulo: "Nova solicitação de serviço",
      mensagem: `${solicitacao.solicitante.nomeCompleto} pediu: ${parsed.data.servico}`,
      entidade: "SolicitacaoServico",
      entidadeId: solicitacao.id,
      origemUsuarioId: request.user.sub,
    });
    avisarMudanca("solicitacoes");
    return reply.code(201).send(solicitacao);
  });

  // TI assume o atendimento.
  app.patch(
    "/solicitacoes-servico/:id/atender",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_TI)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const s = await app.prisma.solicitacaoServico.findUnique({ where: { id } });
      if (!s) return reply.code(404).send({ error: "Solicitação não encontrada." });
      if (s.status !== "ABERTA") return reply.code(409).send({ error: "Esta solicitação não está mais aberta." });
      const atualizada = await app.prisma.solicitacaoServico.update({ where: { id }, data: { status: "EM_ATENDIMENTO" }, include: INCLUDE_SERVICO });
      await adicionarEvento(app, id, request.user.sub, "Suporte TI assumiu o atendimento.");
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATENDER", entidade: "SolicitacaoServico", entidadeId: id, ip: request.ip });
      avisarMudanca("solicitacoes");
      return reply.send(atualizada);
    }
  );

  // TI encaminha pra contratação paga (Financeiro).
  app.patch(
    "/solicitacoes-servico/:id/encaminhar-financeiro",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_TI)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({
          fornecedor: z.string().optional().nullable(),
          valorEstimado: z.coerce.number().min(0).optional().nullable(),
          observacao: z.string().optional().nullable(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const s = await app.prisma.solicitacaoServico.findUnique({ where: { id }, include: { solicitante: true } });
      if (!s) return reply.code(404).send({ error: "Solicitação não encontrada." });
      if (s.status !== "ABERTA" && s.status !== "EM_ATENDIMENTO") {
        return reply.code(409).send({ error: "Esta solicitação não está numa etapa que permita encaminhar." });
      }

      const atualizada = await app.prisma.solicitacaoServico.update({
        where: { id },
        data: {
          status: "AGUARDANDO_CONTRATACAO",
          precisaContratacao: true,
          fornecedor: parsed.data.fornecedor ?? null,
          valorEstimado: parsed.data.valorEstimado ?? null,
        },
        include: INCLUDE_SERVICO,
      });
      const detalhes = [
        parsed.data.fornecedor ? `fornecedor: ${parsed.data.fornecedor}` : null,
        parsed.data.valorEstimado ? `valor estimado: R$ ${parsed.data.valorEstimado.toFixed(2)}` : null,
        parsed.data.observacao || null,
      ].filter(Boolean).join(" · ");
      await adicionarEvento(app, id, request.user.sub, `Encaminhado ao Financeiro — precisa de contratação paga${detalhes ? ` (${detalhes})` : ""}.`);
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ENCAMINHAR_FINANCEIRO", entidade: "SolicitacaoServico", entidadeId: id, ip: request.ip });
      await notificarPorPapeis(app, [...PAPEIS_FINANCEIRO], {
        categoria: "SOLICITACAO_EQUIPAMENTO",
        tipo: "SOLICITACAO_EQUIPAMENTO_NOVA",
        titulo: "Serviço aguardando contratação",
        mensagem: `${s.servico} (${s.solicitante.nomeCompleto}) precisa de contratação paga.`,
        entidade: "SolicitacaoServico",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });
      avisarMudanca("solicitacoes");
      return reply.send(atualizada);
    }
  );

  // Conclusão: TI conclui direto quando não há custo; quando está
  // AGUARDANDO_CONTRATACAO, só Financeiro/Admin concluem.
  app.patch(
    "/solicitacoes-servico/:id/concluir",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ observacao: z.string().optional().nullable() }).safeParse(request.body ?? {});
      const observacao = parsed.success ? parsed.data.observacao : null;

      const s = await app.prisma.solicitacaoServico.findUnique({ where: { id }, include: { solicitante: { include: { usuario: { select: { id: true } } } } } });
      if (!s) return reply.code(404).send({ error: "Solicitação não encontrada." });
      if (s.status === "CONCLUIDA" || s.status === "RECUSADA") {
        return reply.code(409).send({ error: "Esta solicitação já foi finalizada." });
      }

      const papel = request.user.papel;
      const podeConcluir =
        s.status === "AGUARDANDO_CONTRATACAO"
          ? (PAPEIS_FINANCEIRO as readonly string[]).includes(papel)
          : (PAPEIS_TI as readonly string[]).includes(papel);
      if (!podeConcluir) {
        return reply.code(403).send({
          error:
            s.status === "AGUARDANDO_CONTRATACAO"
              ? "Nesta etapa, só o Financeiro (ou Administrador) pode concluir — a contratação é decisão dele."
              : "Só o Suporte TI (ou Administrador) pode concluir o atendimento.",
        });
      }

      const atualizada = await app.prisma.solicitacaoServico.update({ where: { id }, data: { status: "CONCLUIDA" }, include: INCLUDE_SERVICO });
      await adicionarEvento(
        app,
        id,
        request.user.sub,
        s.status === "AGUARDANDO_CONTRATACAO"
          ? `Contratação resolvida pelo Financeiro — serviço disponível.${observacao ? ` ${observacao}` : ""}`
          : `Atendimento concluído pelo Suporte TI.${observacao ? ` ${observacao}` : ""}`
      );
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CONCLUIR", entidade: "SolicitacaoServico", entidadeId: id, ip: request.ip });
      if (s.solicitante.usuario) {
        await notificar(app, {
          destinatarioIds: [s.solicitante.usuario.id],
          categoria: "SOLICITACAO_EQUIPAMENTO",
          tipo: "SOLICITACAO_EQUIPAMENTO_STATUS_MUDOU",
          titulo: "Serviço disponível",
          mensagem: `Sua solicitação de serviço "${s.servico}" foi concluída.`,
          entidade: "SolicitacaoServico",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      }
      avisarMudanca("solicitacoes");
      return reply.send(atualizada);
    }
  );

  app.patch(
    "/solicitacoes-servico/:id/recusar",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ motivo: z.string().min(3, "Explique o motivo da recusa.") }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const s = await app.prisma.solicitacaoServico.findUnique({ where: { id }, include: { solicitante: { include: { usuario: { select: { id: true } } } } } });
      if (!s) return reply.code(404).send({ error: "Solicitação não encontrada." });
      if (s.status === "CONCLUIDA" || s.status === "RECUSADA") {
        return reply.code(409).send({ error: "Esta solicitação já foi finalizada." });
      }
      const papel = request.user.papel;
      const podeRecusar =
        s.status === "AGUARDANDO_CONTRATACAO"
          ? (PAPEIS_FINANCEIRO as readonly string[]).includes(papel)
          : (PAPEIS_TI as readonly string[]).includes(papel);
      if (!podeRecusar) return reply.code(403).send({ error: "Sem permissão para recusar nesta etapa." });

      const atualizada = await app.prisma.solicitacaoServico.update({ where: { id }, data: { status: "RECUSADA" }, include: INCLUDE_SERVICO });
      await adicionarEvento(app, id, request.user.sub, `Recusada: ${parsed.data.motivo}`);
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "RECUSAR", entidade: "SolicitacaoServico", entidadeId: id, detalhe: { motivo: parsed.data.motivo }, ip: request.ip });
      if (s.solicitante.usuario) {
        await notificar(app, {
          destinatarioIds: [s.solicitante.usuario.id],
          categoria: "SOLICITACAO_EQUIPAMENTO",
          tipo: "SOLICITACAO_EQUIPAMENTO_STATUS_MUDOU",
          titulo: "Solicitação de serviço recusada",
          mensagem: `"${s.servico}": ${parsed.data.motivo}`,
          entidade: "SolicitacaoServico",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      }
      avisarMudanca("solicitacoes");
      return reply.send(atualizada);
    }
  );
}
