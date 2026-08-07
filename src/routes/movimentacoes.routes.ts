import { FastifyInstance } from "fastify";
import { z } from "zod";
import { StatusImpacto, StatusMovimentacao, TipoMovimentacao } from "@prisma/client";
import { registrarAuditoria } from "../utils/audit";
import { notificarPorPapeis } from "../utils/notificacoes.service";
import { avisarMudanca } from "../utils/realtime";

const movimentacaoInputSchema = z.object({
  colaboradorId: z.string(),
  tipo: z.nativeEnum(TipoMovimentacao),
  unidadeAnteriorId: z.string().optional().nullable(),
  setorAnteriorId: z.string().optional().nullable(),
  novaUnidadeId: z.string().optional().nullable(),
  novoSetorId: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

// Achado de auditoria (06/07/2026): a query era lida com um cast direto
// (`as { ... }`), sem validação de runtime — inconsistente com o padrão zod
// usado em equipamentos/linhas/solicitacoes, e um `status` fora do enum
// (digitado errado numa chamada manual, por exemplo) ia direto pro Prisma
// sem mensagem clara.
const listQuerySchema = z.object({
  colaboradorId: z.string().optional(),
  status: z.nativeEnum(StatusMovimentacao).optional(),
});

// Central de Notificações (Fase B, 09/07/2026) — só pra compor o texto da
// notificação abaixo; a label "de verdade" pro resto da UI já existe em
// types.ts no frontend (TIPO_MOVIMENTACAO_LABEL), não duplicada aqui em
// nenhuma resposta de API, só usada internamente neste arquivo.
const TIPO_MOVIMENTACAO_LABEL_PT: Record<TipoMovimentacao, string> = {
  ADMISSAO: "Admissão",
  DESLIGAMENTO: "Desligamento",
  TRANSFERENCIA_UNIDADE: "Transferência de unidade",
  TRANSFERENCIA_SETOR: "Transferência de setor",
  PROMOCAO: "Promoção",
};

export default async function movimentacoesRoutes(app: FastifyInstance) {
  app.get(
    "/movimentacoes-colaboradores",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const parsedQuery = listQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({ error: "Parâmetros de busca inválidos.", detalhes: parsedQuery.error.flatten() });
      }
      const { colaboradorId, status } = parsedQuery.data;
      // Etapa 3 (auditoria de backend, 08/07/2026): buscava o array completo
      // de ids de equipamentos/linhas/acessos só pra exibir a contagem no
      // aviso de "revisar antes de concluir" — trocado por `_count`
      // (agregado no banco), igual já era feito em GET /colaboradores/:id
      // pra necessidade equivalente. Resposta muda de `.length` do array pra
      // `_count.<relacao>` (ajustado também no frontend).
      const movimentacoes = await app.prisma.movimentacaoColaborador.findMany({
        where: { ...(colaboradorId ? { colaboradorId } : {}), ...(status ? { status } : {}) },
        orderBy: { data: "desc" },
        include: {
          colaborador: {
            select: {
              id: true,
              nomeCompleto: true,
              _count: { select: { equipamentos: true, linhas: true, acessos: true } },
            },
          },
        },
      });
      return reply.send(movimentacoes);
    }
  );

  app.post(
    "/movimentacoes-colaboradores",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const parsed = movimentacaoInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }

      // Achado de auditoria (06/07/2026): um colaboradorId inválido/excluído
      // ia direto pro Prisma e virava violação de FK (500 genérico) em vez
      // de uma mensagem clara.
      const colaboradorExiste = await app.prisma.colaborador.findUnique({ where: { id: parsed.data.colaboradorId } });
      if (!colaboradorExiste) {
        return reply.code(400).send({ error: "Colaborador não encontrado." });
      }

      const impactoInicial: StatusImpacto =
        parsed.data.tipo === "DESLIGAMENTO" ? "PENDENTE_REVISAO" : "NAO_SE_APLICA";

      const movimentacao = await app.prisma.movimentacaoColaborador.create({
        data: {
          ...parsed.data,
          responsavelId: request.user.sub,
          status: "PENDENTE",
          impactoAcessos: impactoInicial,
          impactoLinhas: impactoInicial,
          impactoEquipamentos: impactoInicial,
        },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR",
        entidade: "MovimentacaoColaborador",
        entidadeId: movimentacao.id,
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — avisa o resto de
      // quem gerencia movimentações (Administrador/Gestor) que uma acabou de
      // ser registrada e está PENDENTE de revisão de impactos (acessos/
      // linhas/equipamentos) — mesmo público que já vê esta tela, excluindo
      // quem acabou de registrar (não precisa de aviso da própria ação).
      await notificarPorPapeis(app, ["ADMINISTRADOR", "GESTOR_COORDENADOR"], {
        categoria: "USUARIO",
        tipo: "MOVIMENTACAO_REGISTRADA",
        titulo: `Nova movimentação: ${TIPO_MOVIMENTACAO_LABEL_PT[movimentacao.tipo]}`,
        mensagem: `${colaboradorExiste.nomeCompleto} — ${TIPO_MOVIMENTACAO_LABEL_PT[movimentacao.tipo]}. Revise os impactos em acessos, linhas e equipamentos.`,
        prioridade: movimentacao.tipo === "DESLIGAMENTO" ? "ALTA" : "MEDIA",
        entidade: "MovimentacaoColaborador",
        entidadeId: movimentacao.id,
        origemUsuarioId: request.user.sub,
      });

      avisarMudanca("movimentacoes", "colaboradores");

      return reply.code(201).send(movimentacao);
    }
  );

  app.post(
    "/movimentacoes-colaboradores/:id/concluir",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      // Achado de auditoria (06/07/2026): faltava esta checagem — igual ao
      // DELETE logo abaixo já fazia. Sem ela, um id inexistente (duplo
      // clique, ou a movimentação foi excluída por outra pessoa entre a
      // listagem e o clique) virava P2025 do Prisma → 500 genérico.
      const existente = await app.prisma.movimentacaoColaborador.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Movimentação não encontrada." });

      const movimentacao = await app.prisma.movimentacaoColaborador.update({
        where: { id },
        data: {
          status: "CONCLUIDA",
          impactoAcessos: "REVISADO",
          impactoLinhas: "REVISADO",
          impactoEquipamentos: "REVISADO",
        },
      });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CONCLUIR",
        entidade: "MovimentacaoColaborador",
        entidadeId: id,
        ip: request.ip,
      });
      avisarMudanca("movimentacoes", "colaboradores");
      return reply.send(movimentacao);
    }
  );

  // Exclusão definitiva — pra corrigir um registro de movimentação criado
  // por engano (duplicado, teste, unidade/setor errado). Entidade "folha":
  // nenhuma outra tabela referencia movimentacoes_colaboradores.
  app.delete(
    "/movimentacoes-colaboradores/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const movimentacao = await app.prisma.movimentacaoColaborador.findUnique({ where: { id } });
      if (!movimentacao) return reply.code(404).send({ error: "Movimentação não encontrada." });
      await app.prisma.movimentacaoColaborador.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "MovimentacaoColaborador", entidadeId: id, ip: request.ip });
      avisarMudanca("movimentacoes", "colaboradores");
      return reply.code(204).send();
    }
  );
}
