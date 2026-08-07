import { FastifyInstance } from "fastify";
import { z } from "zod";
import { StatusLinha, TipoPlano, SituacaoConferenciaLinha, Prisma } from "@prisma/client";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarAuditoria } from "../utils/audit";
import { normalizarTelefone } from "../utils/telefone";
import { isValidTelefone } from "../utils/validacao";
import { PAPEIS_QUE_VEEM_TUDO } from "../utils/autorizacao";
import { notificar, notificarPorPapeis } from "../utils/notificacoes.service";
import { avisarMudanca } from "../utils/realtime";

// Central de Notificações (Fase B, 09/07/2026) — dispara LINHA_VINCULADA pro
// próprio colaborador que acabou de ganhar/trocar de linha corporativa
// (quando ele tem login no sistema; se ainda não tem, não há pra quem
// notificar — a função é um no-op nesse caso, mesmo padrão defensivo já
// usado no resto do arquivo) e LINHA_NECESSITA_CONFERENCIA pra quem gerencia
// o módulo, quando uma linha cai nessa situação.
async function notificarLinhaVinculada(
  app: FastifyInstance,
  colaboradorId: string,
  linha: { id: string; numero: string },
  origemUsuarioId: string
) {
  const colaborador = await app.prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { nomeCompleto: true, usuario: { select: { id: true } } },
  });
  if (!colaborador?.usuario) return;
  await notificar(app, {
    destinatarioIds: [colaborador.usuario.id],
    categoria: "LINHA_TELEFONICA",
    tipo: "LINHA_VINCULADA",
    titulo: "Linha telefônica vinculada",
    mensagem: `A linha ${linha.numero} foi vinculada ao seu cadastro.`,
    entidade: "LinhaTelefonica",
    entidadeId: linha.id,
    origemUsuarioId,
  });
}

// Mesma trava de src/routes/equipamentos.routes.ts: quem não é
// ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI/RH só vê a própria linha.
// Constante movida pra utils/autorizacao.ts na Etapa 3.

const linhaInputSchema = z.object({
  // Padronização Global (Fase 3, 09/07/2026) — mesma convenção de
  // CPF/CNPJ/telefone (ver utils/validacao.ts): dígitos puros no banco,
  // máscara só na apresentação. Reaproveita normalizarTelefone (já usado
  // neste arquivo pra comparar linha↔colaborador desde a Etapa 1) também
  // pra normalizar o valor no momento de salvar, não só nas comparações.
  numero: z
    .string()
    .min(8)
    .transform((v) => normalizarTelefone(v) ?? v)
    .refine((v) => isValidTelefone(v), { message: "Número de telefone inválido — informe DDD + número (10 ou 11 dígitos)." }),
  operadora: z.string().optional().nullable(),
  plano: z.string().optional().nullable(),
  // Novo na Evolução Completa: Pós-pago/Pré-pago. Default POS_PAGO no schema
  // cobre a migração das linhas já existentes; aqui o default cobre o
  // formulário de criação (mesma decisão do usuário: linha nova sem escolha
  // explícita nasce Pós-paga, igual todo o resto da carteira atual).
  tipoPlano: z.nativeEnum(TipoPlano).default("POS_PAGO"),
  empresaId: z.string().optional().nullable(),
  colaboradorId: z.string().optional().nullable(),
  colaboradorInformado: z.string().optional().nullable(),
  // Etapa 1 (08/07/2026): qual linha é a "principal" de um colaborador —
  // fonte única do número corporativo exibido no cadastro dele. Default
  // true porque, hoje, ninguém tem mais de uma linha (a UI nem mostra essa
  // escolha ainda pra usuário comum; existe pra suportar o caso futuro de
  // duas linhas por pessoa sem quebrar nada).
  principal: z.boolean().default(true),
  situacaoConferencia: z.nativeEnum(SituacaoConferenciaLinha).optional(),
  unidadeId: z.string().optional().nullable(),
  status: z.nativeEnum(StatusLinha).default("ATIVA"),
  observacoes: z.string().optional().nullable(),
});

const listQuerySchema = paginationSchema.extend({
  // Espelha a view "Pendentes de reconciliação" do protótipo: linhas que
  // têm um nome digitado à mão (colaboradorInformado) mas nenhum vínculo
  // formal (colaboradorId) ainda.
  pendentesReconciliacao: z.coerce.boolean().optional(),
  status: z.nativeEnum(StatusLinha).optional(),
  tipoPlano: z.nativeEnum(TipoPlano).optional(),
  situacaoConferencia: z.nativeEnum(SituacaoConferenciaLinha).optional(),
});

/**
 * Se a linha está virando (ou nascendo) "principal" de um colaborador,
 * qualquer outra linha que hoje seja a principal desse mesmo colaborador
 * deixa de ser — dentro da mesma transação da escrita, pra nunca existir
 * uma janela em que duas linhas do mesmo colaborador estejam marcadas como
 * principal ao mesmo tempo (o índice único parcial no banco garante isso
 * como última linha de defesa, mas fazer aqui evita o próprio erro de
 * constraint na maioria dos casos).
 */
async function desmarcarOutrasPrincipais(
  tx: Prisma.TransactionClient,
  colaboradorId: string,
  idDaLinhaAtual: string | null
) {
  await tx.linhaTelefonica.updateMany({
    where: {
      colaboradorId,
      principal: true,
      ...(idDaLinhaAtual ? { id: { not: idDaLinhaAtual } } : {}),
    },
    data: { principal: false },
  });
}

export default async function linhasRoutes(app: FastifyInstance) {
  app.get("/linhas-telefonicas", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = toSkipTake(query);

    const vePermitidoRestringirPorConta = !PAPEIS_QUE_VEEM_TUDO.includes(request.user.papel);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.tipoPlano ? { tipoPlano: query.tipoPlano } : {}),
      ...(query.situacaoConferencia ? { situacaoConferencia: query.situacaoConferencia } : {}),
      ...(query.pendentesReconciliacao ? { colaboradorId: null } : {}),
      ...(vePermitidoRestringirPorConta
        ? { colaboradorId: request.user.colaboradorId ?? "__sem_colaborador_vinculado__" }
        : {}),
    };

    const [items, total] = await Promise.all([
      app.prisma.linhaTelefonica.findMany({
        where,
        skip,
        take,
        orderBy: { numero: "asc" },
        include: {
          colaborador: { select: { id: true, nomeCompleto: true } },
          // "De quem era" (17/07/2026) — exibido quando a linha está sem
          // dono atual (ex: devolvida ao estoque após desligamento).
          ultimoColaborador: { select: { id: true, nomeCompleto: true } },
          empresa: true,
          unidade: true,
        },
      }),
      app.prisma.linhaTelefonica.count({ where }),
    ]);

    // Etapa 1 (08/07/2026): sugestão automática de vínculo pra linha
    // pendente (sem colaboradorId) cujo número bate com o telefone de
    // contato de um colaborador já cadastrado — acha o caso, mas NUNCA
    // vincula sozinho (achado real na auditoria: a linha "Elisiane" batia
    // exatamente com o telefone de Elisiane Machado da Costa, e ainda
    // assim ficou pendente só porque ninguém clicou pra confirmar).
    const pendentesSemColaborador = items.filter((l) => !l.colaboradorId);
    let sugestaoPorLinhaId = new Map<string, { id: string; nomeCompleto: string }>();
    if (pendentesSemColaborador.length > 0) {
      // Múltiplos telefones (07/08/2026) — antes só existia UM telefone de
      // contato por colaborador; agora compara contra QUALQUER telefone
      // cadastrado dele (não só o principal), porque é comum a linha
      // corporativa estar salva como o número "COMERCIAL"/"WHATSAPP" de
      // outra pessoa, não necessariamente o principal.
      const candidatos = await app.prisma.colaborador.findMany({
        where: { telefones: { some: {} }, status: { not: "INATIVO" } },
        select: { id: true, nomeCompleto: true, telefones: { select: { numero: true } } },
      });
      const candidatoPorTelefone = new Map<string, { id: string; nomeCompleto: string }>();
      for (const c of candidatos) {
        for (const t of c.telefones) {
          const norm = normalizarTelefone(t.numero);
          if (norm) candidatoPorTelefone.set(norm, { id: c.id, nomeCompleto: c.nomeCompleto });
        }
      }
      for (const l of pendentesSemColaborador) {
        const norm = normalizarTelefone(l.numero);
        const achado = norm ? candidatoPorTelefone.get(norm) : undefined;
        if (achado) sugestaoPorLinhaId.set(l.id, achado);
      }
    }

    const itemsComSugestao = items.map((l) => ({
      ...l,
      sugestaoColaborador: sugestaoPorLinhaId.get(l.id) ?? null,
    }));

    return reply.send(paginatedResponse(itemsComSugestao, total, query));
  });

  app.post(
    "/linhas-telefonicas",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const parsed = linhaInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      const { colaboradorId, principal } = parsed.data;
      try {
        const linha = await app.prisma.$transaction(async (tx) => {
          if (colaboradorId && principal) {
            await desmarcarOutrasPrincipais(tx, colaboradorId, null);
          }
          return tx.linhaTelefonica.create({ data: parsed.data });
        });
        await registrarAuditoria(app, {
          usuarioId: request.user.sub,
          acao: "CRIAR",
          entidade: "LinhaTelefonica",
          entidadeId: linha.id,
          ip: request.ip,
        });

        // Central de Notificações (Fase B, 09/07/2026).
        if (linha.colaboradorId) {
          await notificarLinhaVinculada(app, linha.colaboradorId, linha, request.user.sub);
        }
        if (linha.situacaoConferencia === "NECESSITA_CONFERENCIA") {
          await notificarPorPapeis(app, ["ADMINISTRADOR", "SUPORTE_TI"], {
            categoria: "LINHA_TELEFONICA",
            tipo: "LINHA_NECESSITA_CONFERENCIA",
            titulo: "Linha precisa de conferência",
            mensagem: `A linha ${linha.numero} está marcada como "Necessita conferência".`,
            entidade: "LinhaTelefonica",
            entidadeId: linha.id,
            origemUsuarioId: request.user.sub,
          });
        }

        // "Tudo instantâneo" — vincular uma linha nova a um colaborador
        // também muda a aba "Pessoal"/"Corporativas" em Linhas E o campo
        // `linhaCorporativa` derivado em Colaboradores (ver realtime.ts).
        avisarMudanca("linhas", "colaboradores");

        return reply.code(201).send(linha);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return reply.code(409).send({ error: "Este número já está cadastrado." });
        }
        throw e;
      }
    }
  );

  // Ação principal do fluxo de reconciliação: vincular a linha a um
  // colaborador cadastrado, sem precisar recriar o registro.
  app.put(
    "/linhas-telefonicas/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = linhaInputSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      const existente = await app.prisma.linhaTelefonica.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Linha não encontrada." });

      // Se está (re)vinculando a um colaborador com principal=true (padrão
      // do PUT quando o campo não vem no corpo é NÃO mexer no que já estava
      // salvo, então só entra aqui quando de fato pedido ou implícito pela
      // troca de colaboradorId), garante a exclusividade antes de gravar.
      const colaboradorIdFinal = parsed.data.colaboradorId !== undefined ? parsed.data.colaboradorId : existente.colaboradorId;
      const principalFinal = parsed.data.principal !== undefined ? parsed.data.principal : existente.principal;

      try {
        // "De quem era" (17/07/2026) — se esta edição tira ou troca o dono da
        // linha (colaboradorId veio no corpo com valor diferente do atual, e
        // o atual não era vazio), o dono anterior fica registrado. É o que
        // acontece no desligamento: a linha volta pro estoque sem virar um
        // número anônimo.
        const removeuOuTrocouDono =
          parsed.data.colaboradorId !== undefined &&
          !!existente.colaboradorId &&
          parsed.data.colaboradorId !== existente.colaboradorId;

        const linha = await app.prisma.$transaction(async (tx) => {
          if (colaboradorIdFinal && principalFinal) {
            await desmarcarOutrasPrincipais(tx, colaboradorIdFinal, id);
          }
          return tx.linhaTelefonica.update({
            where: { id },
            data: {
              ...parsed.data,
              ...(removeuOuTrocouDono ? { ultimoColaboradorId: existente.colaboradorId } : {}),
            },
          });
        });
        await registrarAuditoria(app, {
          usuarioId: request.user.sub,
          acao: "ATUALIZAR",
          entidade: "LinhaTelefonica",
          entidadeId: id,
          ip: request.ip,
        });

        // Central de Notificações (Fase B, 09/07/2026) — só dispara quando o
        // vínculo/situação de fato MUDOU nesta edição (não a cada PUT que só
        // toca outro campo), pro colaborador/gestor não receber aviso
        // repetido de algo que já estava assim antes.
        if (linha.colaboradorId && linha.colaboradorId !== existente.colaboradorId) {
          await notificarLinhaVinculada(app, linha.colaboradorId, linha, request.user.sub);
        }
        if (linha.situacaoConferencia === "NECESSITA_CONFERENCIA" && existente.situacaoConferencia !== "NECESSITA_CONFERENCIA") {
          await notificarPorPapeis(app, ["ADMINISTRADOR", "SUPORTE_TI"], {
            categoria: "LINHA_TELEFONICA",
            tipo: "LINHA_NECESSITA_CONFERENCIA",
            titulo: "Linha precisa de conferência",
            mensagem: `A linha ${linha.numero} está marcada como "Necessita conferência".`,
            entidade: "LinhaTelefonica",
            entidadeId: linha.id,
            origemUsuarioId: request.user.sub,
          });
        }

        avisarMudanca("linhas", "colaboradores");

        return reply.send(linha);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return reply.code(409).send({ error: "Este número já está cadastrado." });
        }
        throw e;
      }
    }
  );

  // Exclusão definitiva — pra corrigir um cadastro errado (número duplicado,
  // linha que nunca existiu, digitação errada). Não há nenhuma outra tabela
  // que referencie linha_telefonica, então a exclusão é direta.
  app.delete(
    "/linhas-telefonicas/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const linha = await app.prisma.linhaTelefonica.findUnique({ where: { id } });
      if (!linha) return reply.code(404).send({ error: "Linha não encontrada." });

      await app.prisma.linhaTelefonica.delete({ where: { id } });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "LinhaTelefonica",
        entidadeId: id,
        detalhe: { numero: linha.numero },
        ip: request.ip,
      });

      avisarMudanca("linhas", "colaboradores");

      return reply.code(204).send();
    }
  );
}
