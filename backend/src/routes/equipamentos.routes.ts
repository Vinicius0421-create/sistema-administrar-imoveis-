import { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { EstadoConservacao, Prisma, StatusEquipamento } from "@prisma/client";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarAuditoria } from "../utils/audit";
import { PAPEIS_QUE_VEEM_TUDO } from "../utils/autorizacao";
import { notificar, notificarPorPapeis } from "../utils/notificacoes.service";
import { avisarMudanca } from "../utils/realtime";
import {
  caminhoAbsolutoDoAnexo,
  caminhoParaNovoAnexo,
  MIME_TYPES_PERMITIDOS,
  removerArquivoAnexo,
  TAMANHO_MAXIMO_BYTES,
} from "../utils/anexos";
// NOTA (recuperação 07/08/2026): src/utils/termoResponsabilidade.ts não foi
// encontrado em nenhuma transcrição desta sessão (o único vestígio real é
// esta própria rota, que já reconstrói corretamente os dados de entrada —
// ver montarLinhaEquipamento abaixo). Em vez de fabricar a lógica de geração
// do PDF (que dependeria de conhecer o layout exato do modelo oficial da
// empresa), a função fica com um stub que devolve 501 até ser reconstruída.
// Ver Recuperacao_Codigo_Fonte_07-08-2026.md.
async function gerarTermoResponsabilidadePdf(_dados: unknown): Promise<Buffer> {
  throw Object.assign(
    new Error(
      "Geração de termo de responsabilidade temporariamente indisponível — utilitário perdido na recuperação de código de 07/08/2026, ainda não reconstruído."
    ),
    { statusCode: 501 }
  );
}

// Central de Notificações (Fase B, 09/07/2026) — quem gerencia Patrimônio
// (mesma dupla que já tem requireRole em toda rota de escrita deste
// arquivo). "Devolvido"/"Manutenção"/"Baixado" só interessam a quem
// administra o patrimônio; "Atribuído" avisa também o próprio colaborador
// que recebeu o equipamento (quando ele tem login).
const PAPEIS_GERENCIAM_PATRIMONIO = ["ADMINISTRADOR", "SUPORTE_TI"] as const;

async function notificarEquipamentoAtribuido(
  app: FastifyInstance,
  colaboradorId: string,
  equipamento: { id: string; tipo: string; patrimonio: string | null },
  origemUsuarioId: string
) {
  // Aproveita pra checar o termo de responsabilidade nesta mesma chamada:
  // equipamento entregue sem o termo assinado em mãos é exatamente o cenário
  // que TERMO_RESPONSABILIDADE_PENDENTE existe pra sinalizar (ver
  // enum TipoNotificacao em schema.prisma).
  const colaborador = await app.prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { nomeCompleto: true, termoResponsabilidadeUrl: true, usuario: { select: { id: true } } },
  });
  if (!colaborador) return;

  if (colaborador.usuario) {
    await notificar(app, {
      destinatarioIds: [colaborador.usuario.id],
      categoria: "PATRIMONIO",
      tipo: "PATRIMONIO_EQUIPAMENTO_ATRIBUIDO",
      titulo: "Equipamento atribuído a você",
      mensagem: `${equipamento.tipo}${equipamento.patrimonio ? ` (patrimônio ${equipamento.patrimonio})` : ""} foi vinculado ao seu cadastro.`,
      entidade: "Equipamento",
      entidadeId: equipamento.id,
      origemUsuarioId,
    });
  }

  if (!colaborador.termoResponsabilidadeUrl) {
    await notificarPorPapeis(app, ["ADMINISTRADOR", "GESTOR_COORDENADOR"], {
      categoria: "USUARIO",
      tipo: "TERMO_RESPONSABILIDADE_PENDENTE",
      titulo: "Termo de responsabilidade pendente",
      mensagem: `${colaborador.nomeCompleto} recebeu ${equipamento.tipo} mas ainda não tem termo de responsabilidade anexado.`,
      prioridade: "ALTA",
      entidade: "Colaborador",
      entidadeId: colaboradorId,
      origemUsuarioId,
    });
  }
}

// Quem não está nessa lista (hoje só COLABORADOR) enxerga apenas os próprios
// equipamentos — nunca os de outra pessoa, mesmo que peça outro colaboradorId
// na query. Sem essa trava, qualquer colaborador autenticado conseguia listar
// o patrimônio de todo mundo, já que a rota só exigia estar logado.
// RH incluído em 08/07/2026 (achado de bug pelo Vini): o papel RH existe
// justamente pra ver "todas as informações do colaborador", inclusive os
// equipamentos vinculados — sem entrar aqui, a tela de Colaboradores mostrava
// "Nenhum" pra praticamente todo mundo porque a lista de equipamentos vinha
// vazia/restrita ao próprio RH. Constante movida pra utils/autorizacao.ts na
// Etapa 3 (estava duplicada em 4 arquivos de rota — ver comentário lá).

const equipamentoInputSchema = z.object({
  tipo: z.string().min(2),
  marca: z.string().optional().nullable(),
  modelo: z.string().optional().nullable(),
  numeroSerie: z.string().optional().nullable(),
  patrimonio: z.string().optional().nullable(),
  estadoConservacao: z.nativeEnum(EstadoConservacao).optional().nullable(),
  status: z.nativeEnum(StatusEquipamento).default("DISPONIVEL"),
  colaboradorId: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
  // Novos na Evolução Completa: categoriaId/marcaId apontam pras tabelas
  // administráveis (Configurações); tipo/marca (texto livre, acima) seguem
  // aceitos por compatibilidade com o que já existia.
  categoriaId: z.string().optional().nullable(),
  marcaId: z.string().optional().nullable(),
  localizacao: z.string().optional().nullable(),
  dataAquisicao: z.coerce.date().optional().nullable(),
  // CMDB completo (Onda 3.1 do redesenho, 21/07/2026 — item 11 da
  // auditoria). `valorAquisicao` aceita number OU string (o formulário
  // manda como texto, mesmo padrão já usado em outros valores monetários
  // do sistema, ex: `valorEstimado` de Solicitação de Serviço) — o Prisma
  // aceita string pra campo Decimal diretamente, sem perda de precisão
  // (evita o erro de arredondamento de float que o comentário do model
  // `ItemSolicitacaoPapelaria.valorUnitario` já alertava).
  garantiaAte: z.coerce.date().optional().nullable(),
  fornecedor: z.string().optional().nullable(),
  notaFiscal: z.string().optional().nullable(),
  valorAquisicao: z.union([z.string(), z.number()]).optional().nullable(),
  vidaUtilMeses: z.coerce.number().int().positive().optional().nullable(),
  // Acessórios inclusos (17/07/2026, pedido do Vini: "colocar se vem com
  // acessório ou não") — ids do catálogo AcessorioEquipamento marcados como
  // presentes NESTE equipamento específico. `.optional()` é o que permite
  // diferenciar "não mexeu nos acessórios nesta edição" (chave ausente do
  // body) de "limpou todos os acessórios" (`[]` explícito) — ver o `"in"`
  // check no handler de PUT, mesmo idioma já usado para `colaboradorId`
  // nesta mesma rota.
  acessorioIds: z.array(z.string()).optional(),
});

// Reaproveitado tanto no POST quanto no include do GET/PUT — mantém a forma
// da resposta idêntica nos 3 casos, sem repetir o objeto `include` 3 vezes.
const INCLUDE_EQUIPAMENTO = {
  colaborador: { select: { id: true, nomeCompleto: true } },
  // "De quem era" (17/07/2026) — exibido pela UI quando o equipamento está
  // no estoque (sem dono atual), pra não virar um item anônimo depois do
  // desligamento de alguém.
  ultimoColaborador: { select: { id: true, nomeCompleto: true } },
  categoria: true,
  marcaEquipamento: true,
  acessorios: { include: { acessorio: true } },
  // Metadata dos anexos vai junto na listagem/detalhe (tipo/tamanho/data —
  // nunca o arquivo em si, que só é lido sob demanda pela rota de download
  // abaixo). Ordena pela posição escolhida via arrastar-e-soltar (campo
  // `ordem`); criadoEm desempata entre anexos que nunca foram reordenados
  // (todos ordem=0 de antes do campo existir, ou empate transitório).
  anexos: { orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] },
  // `satisfies` (não `as const`): o array de orderBy precisa ficar mutável
  // pro tipo do Prisma aceitar, e o satisfies mantém a checagem de forma.
} satisfies Prisma.EquipamentoInclude;

// Depreciação (Onda 3.1 do redesenho, 21/07/2026 — item 11 da auditoria):
// CALCULADA a cada leitura, nunca guardada em coluna própria (ver
// comentário no model Equipamento, schema.prisma) — método linear simples
// (o mais comum pra bens de TI/escritório, sem valor residual), a partir
// de valorAquisicao/dataAquisicao/vidaUtilMeses. Meses corridos usa 30.44
// dias/mês (média do ano civil, 365.25/12) em vez de contar mês
// calendário — evita around trip de fuso/dia-do-mês na borda (ex: comprado
// dia 31, "mês" seguinte só tem 28/30 dias). Sem qualquer um dos 3 campos,
// devolve null nos dois (não é "depreciação zero", é "não calculável" —
// distinção que a UI usa pra mostrar "—" em vez de "R$ 0,00").
function comDepreciacao<T extends { valorAquisicao: Prisma.Decimal | null; dataAquisicao: Date | null; vidaUtilMeses: number | null }>(
  eq: T
): T & { valorAtual: number | null; depreciacaoAcumulada: number | null } {
  if (!eq.valorAquisicao || !eq.dataAquisicao || !eq.vidaUtilMeses || eq.vidaUtilMeses <= 0) {
    return { ...eq, valorAtual: null, depreciacaoAcumulada: null };
  }
  const valor = Number(eq.valorAquisicao);
  const DIAS_POR_MES = 30.44;
  const mesesDecorridos = Math.max(
    0,
    (Date.now() - eq.dataAquisicao.getTime()) / (1000 * 60 * 60 * 24 * DIAS_POR_MES)
  );
  const fracaoDepreciada = Math.min(1, mesesDecorridos / eq.vidaUtilMeses);
  const depreciacaoAcumulada = Math.round(valor * fracaoDepreciada * 100) / 100;
  const valorAtual = Math.round((valor - depreciacaoAcumulada) * 100) / 100;
  return { ...eq, valorAtual, depreciacaoAcumulada };
}

const listQuerySchema = paginationSchema.extend({
  busca: z.string().optional(),
  status: z.nativeEnum(StatusEquipamento).optional(),
  colaboradorId: z.string().optional(),
  categoriaId: z.string().optional(),
  marcaId: z.string().optional(),
});

export default async function equipamentosRoutes(app: FastifyInstance) {
  app.get("/equipamentos", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { skip, take } = toSkipTake(query);

    const vePermitidoRestringirPorConta = !PAPEIS_QUE_VEEM_TUDO.includes(request.user.papel);
    const colaboradorIdForcado = vePermitidoRestringirPorConta
      ? request.user.colaboradorId ?? "__sem_colaborador_vinculado__"
      : query.colaboradorId;

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(colaboradorIdForcado ? { colaboradorId: colaboradorIdForcado } : {}),
      ...(query.categoriaId ? { categoriaId: query.categoriaId } : {}),
      ...(query.marcaId ? { marcaId: query.marcaId } : {}),
      ...(query.busca
        ? {
            OR: [
              { tipo: { contains: query.busca, mode: "insensitive" as const } },
              { modelo: { contains: query.busca, mode: "insensitive" as const } },
              { numeroSerie: { contains: query.busca, mode: "insensitive" as const } },
              { patrimonio: { contains: query.busca, mode: "insensitive" as const } },
              { localizacao: { contains: query.busca, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      app.prisma.equipamento.findMany({
        where,
        skip,
        take,
        orderBy: { criadoEm: "desc" },
        include: INCLUDE_EQUIPAMENTO,
      }),
      app.prisma.equipamento.count({ where }),
    ]);

    return reply.send(paginatedResponse(items.map(comDepreciacao), total, query));
  });

  app.post(
    "/equipamentos",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const parsed = equipamentoInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }

      const { acessorioIds, ...dadosEquipamento } = parsed.data;

      const equipamento = await app.prisma.equipamento.create({
        data: {
          ...dadosEquipamento,
          dataEntrega: parsed.data.colaboradorId ? new Date() : null,
          // `createMany` aninhado do próprio Prisma (em vez de uma 2ª
          // chamada separada) — cria o equipamento e já vincula os
          // acessórios marcados na mesma operação atômica.
          ...(acessorioIds && acessorioIds.length > 0
            ? { acessorios: { createMany: { data: acessorioIds.map((acessorioId) => ({ acessorioId })) } } }
            : {}),
        },
        include: INCLUDE_EQUIPAMENTO,
      });

      if (equipamento.colaboradorId) {
        await app.prisma.historicoTroca.create({
          data: {
            equipamentoId: equipamento.id,
            tipoEvento: "ENTREGA",
            colaboradorDestinoId: equipamento.colaboradorId,
            responsavelRegistroId: request.user.sub,
            status: "CONCLUIDO",
          },
        });
      }

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR",
        entidade: "Equipamento",
        entidadeId: equipamento.id,
        ip: request.ip,
      });

      if (equipamento.colaboradorId) {
        await notificarEquipamentoAtribuido(app, equipamento.colaboradorId, equipamento, request.user.sub);
      }

      // Entrega imediata (colaboradorId no cadastro) também gera histórico.
      avisarMudanca("equipamentos", "historico");

      return reply.code(201).send(comDepreciacao(equipamento));
    }
  );

  // PUT reatribui o equipamento a outro colaborador (ou tira o vínculo) e,
  // se o colaboradorId mudou, gera o histórico automaticamente — esse é o
  // comportamento que no protótipo dependia de lógica espalhada em cada
  // handler `salvar()`; aqui fica centralizado num único lugar.
  app.put(
    "/equipamentos/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = equipamentoInputSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }

      const anterior = await app.prisma.equipamento.findUnique({ where: { id } });
      if (!anterior) return reply.code(404).send({ error: "Equipamento não encontrado." });

      // Correção do incidente de produção (13/08/2026, confirmado via stack
      // trace real): Colaborador tem DUAS relações com Equipamento
      // (colaborador/equipamentos e ultimoColaborador/equipamentosAnteriores
      // via @relation nomeada) — o Prisma Client 6.19.3 não expõe
      // `colaboradorId`/`ultimoColaboradorId` como escalar direto no
      // Unchecked update deste model por causa disso ("Unknown argument
      // `colaboradorId`. Did you mean `colaborador`?"), embora `categoriaId`/
      // `marcaId` (relação única, sem ambiguidade) continuem aceitos como
      // escalar normalmente. `colaboradorId` sai do spread; escrito pela
      // relação (`connect`/`disconnect`) em vez de escalar.
      const { acessorioIds, colaboradorId, ...dadosEquipamento } = parsed.data;

      const equipamento = await app.prisma.$transaction(async (tx) => {
        const colaboradorMudou =
          "colaboradorId" in parsed.data && parsed.data.colaboradorId !== anterior.colaboradorId;

        await tx.equipamento.update({
          where: { id },
          data: {
            ...dadosEquipamento,
            ...("colaboradorId" in parsed.data
              ? { colaborador: colaboradorId ? { connect: { id: colaboradorId } } : { disconnect: true } }
              : {}),
            // "De quem era" (17/07/2026) — qualquer edição que tire ou troque
            // o dono registra o dono ANTERIOR; a UI só mostra quando o
            // equipamento está sem dono atual (estoque). Mesma correção:
            // relação em vez de escalar direto.
            ...(colaboradorMudou && anterior.colaboradorId
              ? { ultimoColaborador: { connect: { id: anterior.colaboradorId } } }
              : {}),
          } as Prisma.EquipamentoUpdateInput,
        });

        if (colaboradorMudou) {
          await tx.historicoTroca.create({
            data: {
              equipamentoId: id,
              tipoEvento: anterior.colaboradorId && colaboradorId ? "TROCA" : "ENTREGA",
              colaboradorOrigemId: anterior.colaboradorId,
              colaboradorDestinoId: colaboradorId,
              responsavelRegistroId: request.user.sub,
              status: "CONCLUIDO",
            },
          });
        }

        // Sincroniza a lista de acessórios só quando a chave veio no body —
        // "substituição completa" (apaga tudo e recria com o que foi
        // enviado) é mais simples e segura que calcular diff, e o volume por
        // equipamento é sempre pequeno (poucos acessórios por catálogo de
        // categoria, nunca uma lista grande). `"acessorioIds" in parsed.data`
        // (não `acessorioIds &&`) é o que distingue "não mexeu nos
        // acessórios" de "limpou todos" — ver comentário no schema acima.
        if ("acessorioIds" in parsed.data) {
          await tx.equipamentoAcessorio.deleteMany({ where: { equipamentoId: id } });
          if (acessorioIds && acessorioIds.length > 0) {
            await tx.equipamentoAcessorio.createMany({
              data: acessorioIds.map((acessorioId) => ({ equipamentoId: id, acessorioId })),
              skipDuplicates: true,
            });
          }
        }

        return tx.equipamento.findUniqueOrThrow({ where: { id }, include: INCLUDE_EQUIPAMENTO });
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ATUALIZAR",
        entidade: "Equipamento",
        entidadeId: id,
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — só dispara quando o
      // que de fato mudou nesta edição é relevante (novo dono, ou status
      // entrou em manutenção/baixado agora), nunca em toda edição de campo
      // secundário (ex: só a marca ou a localização). `colaboradorMudou`
      // recalculado aqui (não reaproveitado do dentro da transação acima,
      // que é um escopo à parte) com a mesma expressão.
      const colaboradorMudou = "colaboradorId" in parsed.data && parsed.data.colaboradorId !== anterior.colaboradorId;
      const colaboradorMudouParaAlguem = colaboradorMudou && !!equipamento.colaboradorId;
      if (colaboradorMudouParaAlguem) {
        await notificarEquipamentoAtribuido(app, equipamento.colaboradorId!, equipamento, request.user.sub);
      }
      if (equipamento.status !== anterior.status) {
        if (equipamento.status === "EM_MANUTENCAO") {
          await notificarPorPapeis(app, [...PAPEIS_GERENCIAM_PATRIMONIO], {
            categoria: "PATRIMONIO",
            tipo: "PATRIMONIO_EQUIPAMENTO_MANUTENCAO",
            titulo: "Equipamento em manutenção",
            mensagem: `${equipamento.tipo}${equipamento.patrimonio ? ` (patrimônio ${equipamento.patrimonio})` : ""} foi marcado como em manutenção.`,
            entidade: "Equipamento",
            entidadeId: id,
            origemUsuarioId: request.user.sub,
          });
        }
        if (equipamento.status === "BAIXADO") {
          await notificarPorPapeis(app, [...PAPEIS_GERENCIAM_PATRIMONIO, "GESTOR_COORDENADOR"], {
            categoria: "PATRIMONIO",
            tipo: "PATRIMONIO_EQUIPAMENTO_BAIXADO",
            titulo: "Equipamento baixado",
            mensagem: `${equipamento.tipo}${equipamento.patrimonio ? ` (patrimônio ${equipamento.patrimonio})` : ""} foi dado como baixado (fora de uso definitivamente).`,
            prioridade: "ALTA",
            entidade: "Equipamento",
            entidadeId: id,
            origemUsuarioId: request.user.sub,
          });
        }
      }

      avisarMudanca("equipamentos", "historico");

      return reply.send(comDepreciacao(equipamento));
    }
  );

  app.post(
    "/equipamentos/:id/devolver",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const equipamento = await app.prisma.equipamento.findUnique({ where: { id } });
      if (!equipamento) return reply.code(404).send({ error: "Equipamento não encontrado." });
      if (!equipamento.colaboradorId) {
        return reply.code(409).send({ error: "Este equipamento já está no estoque." });
      }
      // Captura o valor já validado como não-nulo — o TS não propaga o
      // narrowing acima para dentro do closure da transação abaixo.
      const colaboradorAnteriorId = equipamento.colaboradorId;

      const resultado = await app.prisma.$transaction(async (tx) => {
        const atualizado = await tx.equipamento.update({
          where: { id },
          data: {
            // Correção do incidente de produção (13/08/2026) — mesma causa
            // do handler PUT acima: relação em vez de escalar direto.
            colaborador: { disconnect: true },
            status: "DISPONIVEL",
            dataDevolucao: new Date(),
            // "De quem era" (17/07/2026) — o dono que está devolvendo fica
            // registrado no próprio equipamento, visível no estoque.
            ultimoColaborador: { connect: { id: colaboradorAnteriorId } },
          },
        });

        await tx.historicoTroca.create({
          data: {
            equipamentoId: id,
            tipoEvento: "DEVOLUCAO",
            colaboradorOrigemId: equipamento.colaboradorId,
            responsavelRegistroId: request.user.sub,
            status: "CONCLUIDO",
          },
        });

        return atualizado;
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "DEVOLVER_ESTOQUE",
        entidade: "Equipamento",
        entidadeId: id,
        ip: request.ip,
      });

      await notificarPorPapeis(app, [...PAPEIS_GERENCIAM_PATRIMONIO], {
        categoria: "PATRIMONIO",
        tipo: "PATRIMONIO_EQUIPAMENTO_DEVOLVIDO",
        titulo: "Equipamento devolvido ao estoque",
        mensagem: `${equipamento.tipo}${equipamento.patrimonio ? ` (patrimônio ${equipamento.patrimonio})` : ""} voltou pro estoque.`,
        entidade: "Equipamento",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });

      avisarMudanca("equipamentos", "historico");

      return reply.send(resultado);
    }
  );

  // Exclusão definitiva — pra corrigir um cadastro criado errado (duplicado,
  // teste, item que nunca existiu de verdade). O histórico de custódia
  // (historico_trocas) só faz sentido em relação a este equipamento
  // específico, então é apagado junto. Chamados de manutenção já abertos
  // para este equipamento são preservados (têm custo/fornecedor/decisão
  // registrados) — só perdem o vínculo com o equipamento, não são apagados.
  app.delete(
    "/equipamentos/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const equipamento = await app.prisma.equipamento.findUnique({ where: { id } });
      if (!equipamento) return reply.code(404).send({ error: "Equipamento não encontrado." });

      await app.prisma.$transaction([
        app.prisma.chamadoManutencao.updateMany({ where: { equipamentoId: id }, data: { equipamentoId: null } }),
        app.prisma.historicoTroca.deleteMany({ where: { equipamentoId: id } }),
        // EquipamentoAcessorio tem onDelete: Cascade (ver schema) — não
        // precisa de deleteMany explícito aqui, o Postgres já limpa sozinho.
        app.prisma.equipamento.delete({ where: { id } }),
      ]);

      // Foto fica em disco (Railway Volume), fora do Postgres — precisa de
      // limpeza manual, senão o arquivo vira lixo órfão que nunca é
      // liberado (mesmo cuidado do termo de responsabilidade em
      // colaboradores.routes.ts).
      if (equipamento.fotoUrl) removerArquivoAnexo(equipamento.fotoUrl);

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "Equipamento",
        entidadeId: id,
        detalhe: { tipo: equipamento.tipo, numeroSerie: equipamento.numeroSerie },
        ip: request.ip,
      });

      // A exclusão também desvincula chamados de manutenção e apaga o
      // histórico de custódia deste equipamento (ver transação acima).
      avisarMudanca("equipamentos", "historico", "chamados");

      return reply.code(204).send();
    }
  );

  // Foto do equipamento (17/07/2026, pedido do Vini: "permitir colocar foto
  // do equipamento também, para saber o estado em que se encontra") — cópia
  // quase byte-a-byte do termo de responsabilidade de Colaborador (mesmo
  // ANEXOS_DIR/Railway Volume, mesmo slot único substituível, mesmo tipo
  // MIME permitido — só imagem faz sentido aqui, mas reaproveita o conjunto
  // que já inclui PDF por simplicidade, sem exigir mais um enum de
  // MIME_TYPES só pra este caso). Liberado pra quem já gerencia patrimônio
  // (ADMINISTRADOR/SUPORTE_TI, mesma dupla do resto deste arquivo) — não
  // tem regra de sigilo como o termo de Colaborador, então sem trava extra
  // de leitura.
  app.post(
    "/equipamentos/:id/foto",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const equipamento = await app.prisma.equipamento.findUnique({ where: { id } });
      if (!equipamento) return reply.code(404).send({ error: "Equipamento não encontrado." });

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "Nenhum arquivo enviado." });

      if (!MIME_TYPES_PERMITIDOS.has(file.mimetype)) {
        await file.file.resume();
        return reply.code(400).send({ error: "Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF)." });
      }

      const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(`equipamento-${id}`, file.filename);
      await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });

      try {
        await pipeline(file.file, fs.createWriteStream(caminhoAbsoluto));
      } catch (err) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        throw err;
      }

      const { size: tamanhoBytes } = await fs.promises.stat(caminhoAbsoluto);
      if (file.file.truncated || tamanhoBytes > TAMANHO_MAXIMO_BYTES) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        return reply.code(413).send({
          error: `Arquivo excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)}MB).`,
        });
      }

      const fotoAntiga = equipamento.fotoUrl;

      const atualizado = await app.prisma.equipamento.update({
        where: { id },
        data: {
          fotoUrl: caminhoRelativo,
          fotoNomeOriginal: file.filename,
          fotoTipo: file.mimetype,
          fotoEnviadaEm: new Date(),
        },
      });

      if (fotoAntiga) removerArquivoAnexo(fotoAntiga);

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ANEXAR_FOTO",
        entidade: "Equipamento",
        entidadeId: id,
        detalhe: { nomeArquivoOriginal: file.filename },
        ip: request.ip,
      });

      avisarMudanca("equipamentos");

      return reply.code(201).send({
        fotoNomeOriginal: atualizado.fotoNomeOriginal,
        fotoEnviadaEm: atualizado.fotoEnviadaEm,
      });
    }
  );

  app.get(
    "/equipamentos/:id/foto",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const equipamento = await app.prisma.equipamento.findUnique({ where: { id } });
      if (!equipamento || !equipamento.fotoUrl) {
        return reply.code(404).send({ error: "Este equipamento não tem foto anexada." });
      }

      const caminhoAbsoluto = caminhoAbsolutoDoAnexo(equipamento.fotoUrl);
      if (!caminhoAbsoluto || !fs.existsSync(caminhoAbsoluto)) {
        return reply.code(404).send({ error: "Arquivo não encontrado no armazenamento." });
      }

      const nomeOriginal = (equipamento.fotoNomeOriginal || "foto-equipamento").replace(/"/g, "");
      reply.header("Content-Disposition", `inline; filename="${nomeOriginal}"`);
      if (equipamento.fotoTipo) reply.header("Content-Type", equipamento.fotoTipo);
      return reply.send(fs.createReadStream(caminhoAbsoluto));
    }
  );

  app.delete(
    "/equipamentos/:id/foto",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const equipamento = await app.prisma.equipamento.findUnique({ where: { id } });
      if (!equipamento) return reply.code(404).send({ error: "Equipamento não encontrado." });
      if (!equipamento.fotoUrl) return reply.code(204).send();

      removerArquivoAnexo(equipamento.fotoUrl);
      await app.prisma.equipamento.update({
        where: { id },
        data: { fotoUrl: null, fotoNomeOriginal: null, fotoTipo: null, fotoEnviadaEm: null },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "REMOVER_FOTO",
        entidade: "Equipamento",
        entidadeId: id,
        ip: request.ip,
      });

      avisarMudanca("equipamentos");

      return reply.code(204).send();
    }
  );

  // Anexos múltiplos (17/07/2026, pedido do Vini: "preciso que dê para
  // colocar várias fotos e anexos nos equipamentos") — cada POST adiciona um
  // anexo novo à lista, sem apagar os anteriores (diferente do slot único de
  // foto acima, que substituía). O front chama esta rota uma vez por arquivo
  // selecionado (ver AnexosEquipamento.tsx) — upload multi-arquivo de
  // verdade (um `request` com N arquivos) exigiria trocar `multipart` de
  // single-file pra `request.parts()`, sem ganho real aqui já que o volume
  // por vez é sempre pequeno (poucas fotos/documentos por equipamento).
  // Mesmo MIME/tamanho permitido de sempre (imagem ou PDF, até 10MB) e mesma
  // dupla de papel liberada pra escrever (ADMINISTRADOR/SUPORTE_TI).
  const LIMITE_ANEXOS_POR_EQUIPAMENTO = 30;

  // Nome de download GENÉRICO por tipo — pedido do Vini (17/07/2026): "não
  // pegue o nome original do arquivo". O nome que o navegador do usuário
  // mandou no upload é descartado de propósito (não vai pro banco, nem pro
  // log de auditoria, nem pro nome físico em disco) — nome de arquivo de
  // celular carrega data/hora/app de origem e o pedido foi explicitamente
  // guardar só tamanho e data.
  const EXTENSAO_POR_MIME: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  function nomeGenericoAnexo(mimetype: string): string {
    const extensao = EXTENSAO_POR_MIME[mimetype] ?? "bin";
    return mimetype === "application/pdf" ? `documento-equipamento.${extensao}` : `foto-equipamento.${extensao}`;
  }

  app.post(
    "/equipamentos/:id/anexos",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const equipamento = await app.prisma.equipamento.findUnique({ where: { id } });
      if (!equipamento) return reply.code(404).send({ error: "Equipamento não encontrado." });

      const totalAtual = await app.prisma.anexoEquipamento.count({ where: { equipamentoId: id } });
      if (totalAtual >= LIMITE_ANEXOS_POR_EQUIPAMENTO) {
        return reply.code(400).send({ error: `Limite de ${LIMITE_ANEXOS_POR_EQUIPAMENTO} anexos por equipamento atingido.` });
      }

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "Nenhum arquivo enviado." });

      if (!MIME_TYPES_PERMITIDOS.has(file.mimetype)) {
        await file.file.resume();
        return reply.code(400).send({ error: "Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou PDF." });
      }

      const nomeGenerico = nomeGenericoAnexo(file.mimetype);
      const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(`equipamento-${id}`, nomeGenerico);
      await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });

      try {
        await pipeline(file.file, fs.createWriteStream(caminhoAbsoluto));
      } catch (err) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        throw err;
      }

      const { size: tamanhoBytes } = await fs.promises.stat(caminhoAbsoluto);
      if (file.file.truncated || tamanhoBytes > TAMANHO_MAXIMO_BYTES) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        return reply.code(413).send({
          error: `Arquivo excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)}MB).`,
        });
      }

      const anexo = await app.prisma.anexoEquipamento.create({
        data: {
          equipamentoId: id,
          url: caminhoRelativo,
          nomeOriginal: nomeGenerico,
          tipo: file.mimetype,
          tamanhoBytes,
          // Novo anexo sempre entra no FIM da lista visível. max(ordem)+1 em
          // vez de count(): depois de remoções, count pode repetir uma ordem
          // já usada e o novo item "furaria a fila" no meio.
          ordem:
            ((await app.prisma.anexoEquipamento.aggregate({
              where: { equipamentoId: id },
              _max: { ordem: true },
            }))._max.ordem ?? -1) + 1,
          enviadoPorId: request.user.sub,
        },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ANEXAR_ARQUIVO",
        entidade: "Equipamento",
        entidadeId: id,
        // Sem o nome original do upload aqui de propósito (pedido do Vini,
        // 17/07/2026) — o nome que veio do dispositivo do usuário não é
        // gravado em lugar nenhum, nem no log.
        detalhe: { tipo: file.mimetype, tamanhoBytes },
        ip: request.ip,
      });

      avisarMudanca("equipamentos");

      return reply.code(201).send(anexo);
    }
  );

  app.get(
    "/equipamentos/:id/anexos/:anexoId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, anexoId } = request.params as { id: string; anexoId: string };
      const anexo = await app.prisma.anexoEquipamento.findFirst({ where: { id: anexoId, equipamentoId: id } });
      if (!anexo) return reply.code(404).send({ error: "Anexo não encontrado." });

      const caminhoAbsoluto = caminhoAbsolutoDoAnexo(anexo.url);
      if (!caminhoAbsoluto || !fs.existsSync(caminhoAbsoluto)) {
        return reply.code(404).send({ error: "Arquivo não encontrado no armazenamento." });
      }

      const nomeOriginal = anexo.nomeOriginal.replace(/"/g, "");
      reply.header("Content-Disposition", `inline; filename="${nomeOriginal}"`);
      reply.header("Content-Type", anexo.tipo);
      return reply.send(fs.createReadStream(caminhoAbsoluto));
    }
  );

  app.delete(
    "/equipamentos/:id/anexos/:anexoId",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id, anexoId } = request.params as { id: string; anexoId: string };
      const anexo = await app.prisma.anexoEquipamento.findFirst({ where: { id: anexoId, equipamentoId: id } });
      if (!anexo) return reply.code(404).send({ error: "Anexo não encontrado." });

      removerArquivoAnexo(anexo.url);
      await app.prisma.anexoEquipamento.delete({ where: { id: anexoId } });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "REMOVER_ARQUIVO",
        entidade: "Equipamento",
        entidadeId: id,
        detalhe: { anexoId, tipo: anexo.tipo },
        ip: request.ip,
      });

      avisarMudanca("equipamentos");

      return reply.code(204).send();
    }
  );

  // Reordenação por arrastar-e-soltar (17/07/2026, pedido do Vini: "que eu
  // consiga arrastar e reorganizar") — o front manda a lista COMPLETA de ids
  // na nova ordem, e a posição no array vira o campo `ordem` (0-based).
  // Substituição completa em vez de "mover item X pra posição Y" pelo mesmo
  // racional da sincronização de acessórios no PUT acima: mais simples,
  // impossível de divergir, e a lista é sempre pequena (máx. 30).
  app.patch(
    "/equipamentos/:id/anexos/ordem",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ anexoIds: z.array(z.string()).min(1) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }

      const equipamento = await app.prisma.equipamento.findUnique({ where: { id } });
      if (!equipamento) return reply.code(404).send({ error: "Equipamento não encontrado." });

      // A lista enviada precisa ser exatamente o conjunto de anexos deste
      // equipamento — nem a mais (id de outro equipamento reordenaria coisa
      // alheia), nem a menos (item esquecido ficaria com ordem obsoleta e a
      // exibição divergiria do que o usuário acabou de arrastar).
      const atuais = await app.prisma.anexoEquipamento.findMany({
        where: { equipamentoId: id },
        select: { id: true },
      });
      const idsAtuais = new Set(atuais.map((a) => a.id));
      const idsEnviados = new Set(parsed.data.anexoIds);
      const mesmoConjunto =
        idsAtuais.size === idsEnviados.size &&
        parsed.data.anexoIds.length === idsEnviados.size &&
        [...idsAtuais].every((i) => idsEnviados.has(i));
      if (!mesmoConjunto) {
        return reply.code(409).send({
          error: "A lista de anexos mudou desde que a tela foi carregada. Recarregue e tente de novo.",
        });
      }

      await app.prisma.$transaction(
        parsed.data.anexoIds.map((anexoId, indice) =>
          app.prisma.anexoEquipamento.update({ where: { id: anexoId }, data: { ordem: indice } })
        )
      );

      avisarMudanca("equipamentos");

      return reply.code(204).send();
    }
  );

  // Termo de responsabilidade PREENCHIDO (17/07/2026, pedido do Vini: "toda
  // vez que eu passar o equipamento para outro colaborador, gere um termo
  // para ele assinar — já preenchido, completo, apenas para assinar").
  // Gera na hora um PDF fiel ao modelo oficial da empresa, com os dados do
  // colaborador atual (nome, CPF, número corporativo/contato, e-mail) e do
  // equipamento (categoria/tipo, marca/modelo, nº de série ou patrimônio,
  // acessórios inclusos). Por padrão sai o termo DESTE equipamento;
  // ?todos=1 inclui TODOS os equipamentos em uso do mesmo colaborador num
  // termo só (a tabela do modelo já é uma lista de equipamentos — cobre a
  // entrega de kit completo com uma assinatura só). Nada é salvo em disco:
  // documento novo a cada clique, sempre refletindo o cadastro atual. O
  // upload do termo ASSINADO continua sendo o fluxo que já existe no
  // cadastro do colaborador.
  app.get(
    "/equipamentos/:id/termo-preenchido",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { todos } = request.query as { todos?: string };

      const equipamento = await app.prisma.equipamento.findUnique({
        where: { id },
        include: {
          categoria: true,
          marcaEquipamento: true,
          acessorios: { include: { acessorio: true } },
          colaborador: {
            include: {
              linhas: { where: { principal: true }, select: { numero: true }, take: 1 },
              // Múltiplos telefones (07/08/2026) — o termo mostra só o
              // principal (mesma ideia de "um número de contato" que o
              // campo único antigo já representava).
              telefones: { where: { principal: true }, take: 1 },
            },
          },
        },
      });
      if (!equipamento) return reply.code(404).send({ error: "Equipamento não encontrado." });
      if (!equipamento.colaborador) {
        return reply.code(409).send({
          error: "Este equipamento está no estoque (sem colaborador) — entregue a alguém antes de gerar o termo.",
        });
      }

      const montarLinhaEquipamento = (e: typeof equipamento) => ({
        descricao: e.categoria?.nome || e.tipo,
        marcaModelo:
          [e.marcaEquipamento?.nome || e.marca, e.modelo].filter(Boolean).join(" — ") || "—",
        numeroSerie: e.numeroSerie || (e.patrimonio ? `Patrimônio ${e.patrimonio}` : "—"),
        acessorios: e.acessorios.map((a) => a.acessorio.nome),
      });

      let equipamentosDoTermo = [montarLinhaEquipamento(equipamento)];
      if (todos === "1") {
        const todosDoColaborador = await app.prisma.equipamento.findMany({
          where: { colaboradorId: equipamento.colaboradorId },
          orderBy: { criadoEm: "asc" },
          include: {
            categoria: true,
            marcaEquipamento: true,
            acessorios: { include: { acessorio: true } },
            colaborador: {
              include: {
                linhas: { where: { principal: true }, select: { numero: true }, take: 1 },
                // Mesmo include da consulta acima — não é usado nesta lista
                // (só reaproveita montarLinhaEquipamento, que não olha pra
                // telefone), mas precisa bater com o tipo de `equipamento`
                // pra montarLinhaEquipamento aceitar os dois.
                telefones: { where: { principal: true }, take: 1 },
              },
            },
          },
        });
        equipamentosDoTermo = todosDoColaborador.map(montarLinhaEquipamento);
      }

      const pdf = await gerarTermoResponsabilidadePdf({
        colaborador: {
          nomeCompleto: equipamento.colaborador.nomeCompleto,
          cpf: equipamento.colaborador.cpf,
          telefone: equipamento.colaborador.telefones[0]?.numero ?? null,
          email: equipamento.colaborador.email,
          linhaCorporativa: equipamento.colaborador.linhas[0]?.numero ?? null,
        },
        equipamentos: equipamentosDoTermo,
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "GERAR_TERMO_RESPONSABILIDADE",
        entidade: "Equipamento",
        entidadeId: id,
        detalhe: { colaboradorId: equipamento.colaboradorId, todosEquipamentos: todos === "1" },
        ip: request.ip,
      });

      const nomeArquivo = `termo-responsabilidade-${equipamento.colaborador.nomeCompleto
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .toLowerCase()}.pdf`;
      reply.header("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
      reply.header("Content-Type", "application/pdf");
      return reply.send(pdf);
    }
  );
}
