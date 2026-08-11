import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { registrarAuditoria } from "../utils/audit";
import { PAPEIS_QUE_VEEM_TUDO } from "../utils/autorizacao";
import { avisarMudanca } from "../utils/realtime";

// Mesma trava usada em equipamentos.routes.ts — quem não está nessa lista
// (hoje só COLABORADOR) enxerga apenas o histórico de custódia em que ele
// mesmo aparece (origem ou destino), nunca o de outra pessoa. Achado em
// auditoria de 06/07/2026: a rota só exigia estar logado, então qualquer
// colaborador autenticado conseguia ver quem recebeu/devolveu qualquer
// equipamento da empresa inteira, de/para quem — o mesmo tipo de vazamento
// que a lista de equipamentos já corrige. Constante movida pra
// utils/autorizacao.ts na Etapa 3.

// Criação é só automática (rotas de Equipamentos geram cada registro) —
// não existe POST manual, é exatamente essa dependência de preenchimento
// manual que fazia o módulo equivalente na planilha original ficar sempre
// vazio. Exclusão manual existe (abaixo), mas só pra corrigir um registro
// gerado por engano (ex: teste, transferência revertida na hora) — não é
// operação do dia a dia, por isso só ADMINISTRADOR.
export default async function historicoRoutes(app: FastifyInstance) {
  app.get(
    "/historico-trocas",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { equipamentoId } = request.query as { equipamentoId?: string };

      const escopoColaborador: Prisma.HistoricoTrocaWhereInput =
        !PAPEIS_QUE_VEEM_TUDO.includes(request.user.papel) && request.user.colaboradorId
          ? {
              OR: [
                { colaboradorOrigemId: request.user.colaboradorId },
                { colaboradorDestinoId: request.user.colaboradorId },
              ],
            }
          : {};

      const historico = await app.prisma.historicoTroca.findMany({
        where: {
          ...(equipamentoId ? { equipamentoId } : {}),
          ...escopoColaborador,
        },
        orderBy: { data: "desc" },
        include: {
          equipamento: { select: { id: true, tipo: true, modelo: true } },
          colaboradorOrigem: { select: { id: true, nomeCompleto: true } },
          colaboradorDestino: { select: { id: true, nomeCompleto: true } },
        },
      });
      return reply.send(historico);
    }
  );

  // Entidade "folha": nenhuma outra tabela referencia historico_trocas.
  app.delete(
    "/historico-trocas/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const registro = await app.prisma.historicoTroca.findUnique({ where: { id } });
      if (!registro) return reply.code(404).send({ error: "Registro de histórico não encontrado." });
      await app.prisma.historicoTroca.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "HistoricoTroca", entidadeId: id, ip: request.ip });
      avisarMudanca("historico");
      return reply.code(204).send();
    }
  );
}
