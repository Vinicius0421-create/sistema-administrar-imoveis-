import { FastifyInstance } from "fastify";
import { z } from "zod";
import { StatusLote } from "@prisma/client";
import { registrarAuditoria } from "../utils/audit";
import { avisarMudanca } from "../utils/realtime";

const loteInputSchema = z.object({
  nome: z.string().min(3),
  descricao: z.string().optional().nullable(),
  dataInicio: z.coerce.date().optional().nullable(),
  status: z.nativeEnum(StatusLote).default("ABERTO"),
});

export default async function lotesRoutes(app: FastifyInstance) {
  app.get("/lotes-rateio", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const lotes = await app.prisma.loteRateio.findMany({
      orderBy: { dataInicio: "desc" },
      include: {
        _count: { select: { solicitacoes: true } },
      },
    });
    return reply.send(lotes);
  });

  app.post(
    "/lotes-rateio",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const parsed = loteInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      const lote = await app.prisma.loteRateio.create({ data: parsed.data });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR",
        entidade: "LoteRateio",
        entidadeId: lote.id,
        ip: request.ip,
      });
      avisarMudanca("lotes");
      return reply.code(201).send(lote);
    }
  );

  app.post(
    "/lotes-rateio/:id/fechar",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      // Achado de auditoria (06/07/2026): faltava esta checagem — igual ao
      // DELETE mais abaixo já fazia. Sem ela, um id inexistente virava P2025
      // do Prisma → 500 genérico. Aproveitado pra também bloquear fechar um
      // lote que já está fechado (antes, reabria a data de fechamento
      // silenciosamente, distorcendo relatório que dependa da data original).
      const existente = await app.prisma.loteRateio.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Lote não encontrado." });
      if (existente.status === "FECHADO") {
        return reply.code(409).send({ error: "Este lote já está fechado." });
      }

      const lote = await app.prisma.loteRateio.update({
        where: { id },
        data: { status: "FECHADO", dataFechamento: new Date() },
      });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "FECHAR_LOTE",
        entidade: "LoteRateio",
        entidadeId: id,
        ip: request.ip,
      });
      avisarMudanca("lotes");
      return reply.send(lote);
    }
  );

  // Seguro: solicitacoes_equipamento.loteId é opcional com ON DELETE SET
  // NULL — solicitações já rateadas continuam existindo, só perdem o
  // vínculo com este lote específico.
  app.delete(
    "/lotes-rateio/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const lote = await app.prisma.loteRateio.findUnique({ where: { id } });
      if (!lote) return reply.code(404).send({ error: "Lote não encontrado." });
      await app.prisma.loteRateio.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "LoteRateio", entidadeId: id, detalhe: { nome: lote.nome }, ip: request.ip });
      avisarMudanca("lotes");
      return reply.code(204).send();
    }
  );
}
