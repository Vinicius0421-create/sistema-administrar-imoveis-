import { FastifyInstance } from "fastify";
import { z } from "zod";
import { StatusAcesso } from "@prisma/client";
import { registrarAuditoria } from "../utils/audit";
import { PAPEIS_QUE_VEEM_TUDO } from "../utils/autorizacao";
import { avisarMudanca } from "../utils/realtime";

// Mesma trava de src/routes/equipamentos.routes.ts: quem não é
// ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI/RH só vê o próprio acesso a
// sistemas. Constante movida pra utils/autorizacao.ts na Etapa 3.
//
// Achado de auditoria C1 (22/07/2026) — investigado e NÃO restringido como
// a auditoria sugeriu (ver comentário completo em `PAPEIS_QUE_VEEM_TUDO`,
// utils/autorizacao.ts): GESTOR_COORDENADOR/RH ainda dependem deste dado
// sem filtro pra exibir "Acessos a Sistemas" na ficha de qualquer
// colaborador em Colaboradores.tsx (`useAppData.ts` busca tudo pra todo
// papel). Restringir aqui quebraria essa tela de verdade.

const acessoInputSchema = z.object({
  colaboradorId: z.string(),
  sistemaId: z.string(),
  status: z.nativeEnum(StatusAcesso).default("ATIVO"),
  observacoes: z.string().optional().nullable(),
});

export default async function acessosRoutes(app: FastifyInstance) {
  app.get("/acessos-sistema", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { colaboradorId } = request.query as { colaboradorId?: string };
    const vePermitidoRestringirPorConta = !PAPEIS_QUE_VEEM_TUDO.includes(request.user.papel);
    const colaboradorIdForcado = vePermitidoRestringirPorConta
      ? request.user.colaboradorId ?? "__sem_colaborador_vinculado__"
      : colaboradorId;
    const acessos = await app.prisma.acessoSistema.findMany({
      where: colaboradorIdForcado ? { colaboradorId: colaboradorIdForcado } : undefined,
      include: { colaborador: { select: { id: true, nomeCompleto: true } }, sistema: true },
      orderBy: { colaborador: { nomeCompleto: "asc" } },
    });
    return reply.send(acessos);
  });

  app.post(
    "/acessos-sistema",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const parsed = acessoInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      const acesso = await app.prisma.acessoSistema.create({
        data: { ...parsed.data, dataConcessao: new Date() },
      });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CONCEDER_ACESSO",
        entidade: "AcessoSistema",
        entidadeId: acesso.id,
        ip: request.ip,
      });
      avisarMudanca("acessos");
      return reply.code(201).send(acesso);
    }
  );

  // Alterna Ativo/Bloqueado — equivalente ao botão de toggle do protótipo,
  // mas agora só quem tem papel autorizado consegue chamar o endpoint.
  app.post(
    "/acessos-sistema/:id/alternar-status",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const acesso = await app.prisma.acessoSistema.findUnique({ where: { id } });
      if (!acesso) return reply.code(404).send({ error: "Acesso não encontrado." });

      const novoStatus: StatusAcesso = acesso.status === "ATIVO" ? "BLOQUEADO" : "ATIVO";
      const atualizado = await app.prisma.acessoSistema.update({
        where: { id },
        data: {
          status: novoStatus,
          dataRevogacao: novoStatus === "BLOQUEADO" ? new Date() : null,
        },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: novoStatus === "BLOQUEADO" ? "BLOQUEAR_ACESSO" : "REATIVAR_ACESSO",
        entidade: "AcessoSistema",
        entidadeId: id,
        ip: request.ip,
      });

      avisarMudanca("acessos");

      return reply.send(atualizado);
    }
  );

  // Achado de auditoria (06/07/2026): não havia nenhuma forma de corrigir um
  // acesso concedido com o sistema errado ou sem observação nenhuma sem
  // excluir e recriar (perdendo dataConcessao original). PATCH cobre exatamente
  // isso — trocar o sistema vinculado e/ou editar a observação. Alternar
  // Ativo/Bloqueado continua exclusivo da rota "alternar-status" acima.
  app.patch(
    "/acessos-sistema/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({ sistemaId: z.string().optional(), observacoes: z.string().optional().nullable() })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      const existente = await app.prisma.acessoSistema.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Acesso não encontrado." });
      if (parsed.data.sistemaId) {
        const sistemaExiste = await app.prisma.sistemaAcesso.findUnique({ where: { id: parsed.data.sistemaId } });
        if (!sistemaExiste) return reply.code(400).send({ error: "Sistema não encontrado." });
      }
      const atualizado = await app.prisma.acessoSistema.update({ where: { id }, data: parsed.data });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ATUALIZAR",
        entidade: "AcessoSistema",
        entidadeId: id,
        ip: request.ip,
      });
      avisarMudanca("acessos");
      return reply.send(atualizado);
    }
  );

  // Exclusão definitiva — pra corrigir uma concessão de acesso criada por
  // engano (sistema errado, colaborador errado). Não há nenhuma outra
  // tabela que referencie acesso_sistema, então a exclusão é direta. Para
  // revogar um acesso que realmente existiu, use "alternar-status" (marca
  // como BLOQUEADO e preserva o registro) — isto aqui apaga de vez.
  app.delete(
    "/acessos-sistema/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const acesso = await app.prisma.acessoSistema.findUnique({ where: { id } });
      if (!acesso) return reply.code(404).send({ error: "Acesso não encontrado." });

      await app.prisma.acessoSistema.delete({ where: { id } });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "AcessoSistema",
        entidadeId: id,
        ip: request.ip,
      });

      avisarMudanca("acessos");

      return reply.code(204).send();
    }
  );
}
