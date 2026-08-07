import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prioridade, StatusSolicitacao } from "@prisma/client";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarAuditoria } from "../utils/audit";
import { nomeExibicaoUsuario } from "../utils/usuarios";
import { notificar, notificarPorPapeis } from "../utils/notificacoes.service";
import { avisarMudanca } from "../utils/realtime";

// Nomeação automática de lote (09/07/2026) — usado só pra dar um nome
// legível ("Julho/2026") ao lote criado sozinho quando nenhum ABERTO
// existe ainda, ver POST /solicitacoes-equipamento abaixo.
const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const STATUS_SOLICITACAO_LABEL_PT: Record<StatusSolicitacao, string> = {
  PENDENTE: "Pendente",
  EM_ANALISE: "Em análise",
  APROVADO: "Aprovado",
  EM_COMPRA: "Em compra",
  COMPRADO: "Comprado",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
  REPROVADO: "Reprovado",
};

// unidadeId (o "local") e tecnicoResponsavelId (o "técnico") obrigatórios
// desde 07/07/2026, a pedido do Vini — mesma mudança feita em
// chamados.routes.ts. Lista de técnicos vem de GET /tecnicos (registrada em
// chamados.routes.ts, reaproveitada aqui — não faz sentido duplicar rota).
// categoriaId/produtoId (09/07/2026, pedido do Vini — "Ajuste na Estrutura
// das Solicitações"): antes, `item` era só texto livre sem nenhum catálogo
// por trás. Agora existe um catálogo (CategoriaProdutoEquipamento/
// ProdutoEquipamento, ver dominios.routes.ts), mas continua opcional — item
// fora do catálogo ("outro") ainda é permitido, só digitando `item`
// diretamente sem informar produtoId. Quando produtoId é informado, o
// handler abaixo SOBRESCREVE `item` com o nome real do produto (snapshot no
// momento da solicitação, mesmo padrão de nomeProduto em
// ItemSolicitacaoPapelaria) — não confia no texto que o cliente mandou, pra
// não deixar o vínculo com o catálogo divergir do texto exibido.
const solicitacaoInputSchema = z.object({
  solicitanteId: z.string(),
  categoriaId: z.string().optional().nullable(),
  produtoId: z.string().optional().nullable(),
  item: z.string().min(2),
  justificativa: z.string().optional().nullable(),
  prioridade: z.nativeEnum(Prioridade).default("MEDIA"),
  loteId: z.string().optional().nullable(),
  quantidade: z.coerce.number().int().min(1).default(1),
  valorUnitario: z.coerce.number().min(0).default(0),
  fornecedor: z.string().max(200).optional().nullable(),
  unidadeId: z.string().min(1, "Selecione a unidade."),
  tecnicoResponsavelId: z.string().min(1, "Selecione o técnico responsável."),
});

// Valor e fornecedor da compra (17/07/2026, pedido do Vini: "o técnico ou
// quem for responsável pelas solicitações poder alterar o valor... o
// colaborador nem colocar valor, apenas o responsável"). Papéis que cuidam
// da compra: validação técnica (SUPORTE_TI) + decisão de custo (FINANCEIRO)
// + ADMINISTRADOR. Colaborador solicitante nunca define valor — nem na
// criação (forçado a 0 no POST) nem depois (esta rota exige papel).
const detalhesCompraSchema = z.object({
  valorUnitario: z.coerce.number().min(0).optional(),
  fornecedor: z.string().max(200).optional().nullable(),
});
// RH incluído em 22/07/2026 (pedido do Vini: "os papéis RH e financeiro
// devem ter as mesmas abas... e etc", confirmado que inclui Solicitações
// por completo) — RH ganha exatamente o mesmo poder de decisão de custo que
// FINANCEIRO já tinha aqui. SUPORTE_TI continua por motivo técnico à parte
// (valida o item antes da compra), não por causa dessa equiparação.
const PAPEIS_QUE_EDITAM_COMPRA = ["ADMINISTRADOR", "SUPORTE_TI", "FINANCEIRO", "RH"] as const;

const statusUpdateSchema = z.object({
  status: z.nativeEnum(StatusSolicitacao),
});

// Aprovação em DUAS ETAPAS (17/07/2026, pedido do Vini — reorganização de
// hierarquia + papel novo FINANCEIRO: "falta um financeiro para aprovar as
// solicitações de equipamentos"). Em 14/07/2026 SUPORTE_TI tinha virado o
// único aprovador (ver histórico da migration anterior). Hoje isso mudou de
// novo — mas em vez de simplesmente trocar um aprovador único pelo outro
// (o que reverteria a regra de 14/07 sem necessidade), confirmado com o
// Vini via pergunta explícita: fluxo de DUAS ETAPAS OBRIGATÓRIAS, cada uma
// com seu próprio aprovador, reaproveitando o status EM_ANALISE que já
// existia no enum (não foi preciso criar nenhum status novo):
//
//   PENDENTE ──[validação técnica, só SUPORTE_TI/ADMIN]──▶ EM_ANALISE
//   EM_ANALISE ──[decisão de custo, só FINANCEIRO/ADMIN]──▶ APROVADO/REPROVADO
//
// Ou seja: SUPORTE_TI continua com poder de veto técnico (se ele nunca move
// pra EM_ANALISE, a solicitação nunca chega no Financeiro) — só que a
// palavra final sobre GASTAR o dinheiro passou a ser do Financeiro, não
// mais do técnico. `PAPEIS_QUE_VALIDAM_TECNICAMENTE` guarda a 1ª etapa,
// `PAPEIS_QUE_APROVAM` a 2ª. Isto NÃO afeta Solicitação de Papelaria e
// Compras, que tem seu próprio fluxo em `solicitacoesPapelaria.routes.ts`
// (RH + Financeiro + Administrador, sem etapa técnica — não faz sentido
// pedir "validação técnica" pra material de escritório).
const PAPEIS_QUE_VALIDAM_TECNICAMENTE = ["ADMINISTRADOR", "SUPORTE_TI"] as const;
// RH incluído em 22/07/2026 (pedido do Vini, "igualar tudo, inclusive
// Solicitações" — resposta explícita à pergunta de escopo) — RH aprova/
// reprova a 2ª etapa (decisão de custo) exatamente como FINANCEIRO.
const PAPEIS_QUE_APROVAM = ["ADMINISTRADOR", "FINANCEIRO", "RH"] as const;

export default async function solicitacoesRoutes(app: FastifyInstance) {
  app.get("/solicitacoes-equipamento", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = paginationSchema
      .extend({
        loteId: z.string().optional(),
        status: z.nativeEnum(StatusSolicitacao).optional(),
        solicitanteId: z.string().optional(),
        unidadeId: z.string().optional(),
      })
      .parse(request.query);
    const { skip, take } = toSkipTake(query);

    // Colaborador comum só enxerga as próprias solicitações — o resto dos
    // papéis vê tudo. Isso é o que faltava no protótipo, onde qualquer
    // pessoa logada no "Portal" só não via a lista alheia porque a tela
    // nunca listava — nada impedia via API, porque não havia API.
    const escopoColaborador =
      request.user.papel === "COLABORADOR" && request.user.colaboradorId
        ? { solicitanteId: request.user.colaboradorId }
        : {};

    const where = {
      ...(query.loteId ? { loteId: query.loteId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.solicitanteId ? { solicitanteId: query.solicitanteId } : {}),
      ...(query.unidadeId ? { unidadeId: query.unidadeId } : {}),
      ...escopoColaborador,
    };

    const [items, total] = await Promise.all([
      app.prisma.solicitacaoEquipamento.findMany({
        where,
        skip,
        take,
        orderBy: { dataSolicitacao: "desc" },
        include: {
          solicitante: { select: { id: true, nomeCompleto: true } },
          lote: true,
          unidade: { select: { id: true, nome: true } },
          // Achado do Vini (07/07/2026): mesma mudança de chamados.routes.ts
          // — o seletor mostrava e-mail, agora expõe o nome de exibição
          // (nome do colaborador vinculado, com fallback pro e-mail).
          tecnicoResponsavel: { select: { id: true, email: true, colaborador: { select: { nomeCompleto: true } } } },
          categoria: true,
          produto: true,
        },
      }),
      app.prisma.solicitacaoEquipamento.count({ where }),
    ]);

    const itemsComTotal = items.map((s) => {
      const { colaborador, ...tecnicoResponsavel } = s.tecnicoResponsavel;
      return {
        ...s,
        tecnicoResponsavel: { ...tecnicoResponsavel, nome: nomeExibicaoUsuario(s.tecnicoResponsavel) },
        valorTotal: Number(s.valorUnitario) * s.quantidade,
      };
    });

    return reply.send(paginatedResponse(itemsComTotal, total, query));
  });

  app.post("/solicitacoes-equipamento", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = solicitacaoInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
    }

    // Um colaborador comum (Portal de autoatendimento) só pode abrir
    // solicitação em nome dele mesmo.
    if (request.user.papel === "COLABORADOR" && parsed.data.solicitanteId !== request.user.colaboradorId) {
      return reply.code(403).send({ error: "Você só pode abrir solicitações em seu próprio nome." });
    }

    // Valor e fornecedor não são do colaborador (17/07/2026, pedido do
    // Vini) — quem define é o responsável pela compra, depois. Forçado no
    // SERVIDOR (não só escondido na tela do Portal): sem isto, qualquer
    // requisição direta à API com papel COLABORADOR ainda conseguiria
    // gravar um valor inventado.
    if (request.user.papel === "COLABORADOR") {
      parsed.data.valorUnitario = 0;
      parsed.data.fornecedor = null;
    }

    // Quando o item vem do catálogo, valida o produto e usa o nome dele
    // como texto exibido — não confia no `item` que o cliente mandou junto
    // (ver comentário no schema acima). Item "fora do catálogo" (outro)
    // continua funcionando normalmente: produtoId ausente, `item` é o texto
    // livre digitado, categoriaId (se enviado) só serve pra manter os
    // indicadores "por categoria" consistentes mesmo pra item avulso —
    // mesmo padrão já usado em ItemSolicitacaoPapelaria.
    let itemFinal = parsed.data.item;
    let categoriaIdFinal = parsed.data.categoriaId ?? null;
    if (parsed.data.produtoId) {
      const produto = await app.prisma.produtoEquipamento.findUnique({ where: { id: parsed.data.produtoId } });
      if (!produto || produto.status !== "ATIVO") {
        return reply.code(400).send({ error: "Produto do catálogo não encontrado ou inativo." });
      }
      itemFinal = produto.nome;
      categoriaIdFinal = produto.categoriaId;
    } else if (categoriaIdFinal) {
      const categoriaExiste = await app.prisma.categoriaProdutoEquipamento.findUnique({ where: { id: categoriaIdFinal } });
      if (!categoriaExiste) return reply.code(400).send({ error: "Categoria não encontrada." });
    }

    // Lote 100% automático (09/07/2026, pedido do Vini: "sempre gerar
    // automaticamente, sem eu precisar escolher ou o colaborador não
    // precisa escolher lote") — antes disto, sem lote ABERTO nenhum a
    // solicitação simplesmente ficava com loteId null e caía fora do
    // rateio, porque criar um lote novo dependia de alguém chamar a rota
    // POST /lotes-rateio manualmente (não existia — e continua não
    // existindo — nenhuma tela pra isso; só dava pra criar via chamada
    // direta à API). Agora, se não vier loteId explícito (a tela de "Nova
    // Solicitação" também parou de perguntar isso, ver Solicitacoes.tsx) e
    // não houver nenhum lote ABERTO, o próprio lote do mês corrente é
    // criado na hora, sem exigir nenhuma ação de ninguém antes. Fechar um
    // lote (corte mensal pra rateio/orçamento) continua uma ação manual,
    // de propósito — é o único passo que ainda importa alguém decidir
    // (quando fechar o mês); tudo antes disso agora é automático.
    let loteId = parsed.data.loteId ?? null;
    if (!loteId) {
      const loteAberto = await app.prisma.loteRateio.findFirst({ where: { status: "ABERTO" }, orderBy: { dataInicio: "desc" } });
      if (loteAberto) {
        loteId = loteAberto.id;
      } else {
        const agora = new Date();
        const novoLote = await app.prisma.loteRateio.create({
          data: { nome: `${MESES_PT[agora.getMonth()]}/${agora.getFullYear()}`, dataInicio: agora, status: "ABERTO" },
        });
        loteId = novoLote.id;
      }
    }

    const solicitacao = await app.prisma.solicitacaoEquipamento.create({
      data: { ...parsed.data, item: itemFinal, categoriaId: categoriaIdFinal, loteId, status: "PENDENTE" },
    });

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "CRIAR",
      entidade: "SolicitacaoEquipamento",
      entidadeId: solicitacao.id,
      ip: request.ip,
    });

    // Central de Notificações (Fase B, 09/07/2026) — avisa quem faz a
    // primeira etapa do fluxo (validação técnica, ver
    // PAPEIS_QUE_VALIDAM_TECNICAMENTE abaixo) que uma nova solicitação
    // entrou na fila. Reorganização de hierarquia (17/07/2026): GESTOR_
    // COORDENADOR saiu desta lista — não tem mais nenhuma ação a fazer com
    // uma solicitação de equipamento (só acompanha, via GET). FINANCEIRO
    // também não entra aqui de propósito — só é avisado quando a
    // solicitação chega em EM_ANALISE (ver rota de status abaixo), que é
    // quando de fato existe algo pra ele decidir; notificar Financeiro já
    // na criação seria ruído (a maioria das solicitações ainda vai ser
    // barrada ou ajustada na validação técnica antes de chegar nele).
    await notificarPorPapeis(app, ["ADMINISTRADOR", "SUPORTE_TI"], {
      categoria: "SOLICITACAO_EQUIPAMENTO",
      tipo: "SOLICITACAO_EQUIPAMENTO_NOVA",
      titulo: "Nova solicitação de equipamento",
      mensagem: `${itemFinal} (qtd. ${parsed.data.quantidade}) — aguardando validação técnica.`,
      entidade: "SolicitacaoEquipamento",
      entidadeId: solicitacao.id,
      origemUsuarioId: request.user.sub,
    });

    // "lotes" também, já que esta rota pode ter acabado de criar um lote
    // novo sozinha (ver bloco acima) — sem isso, quem estivesse com a tela
    // de solicitações aberta só veria o lote novo depois de um F5.
    avisarMudanca("solicitacoes", "lotes");

    return reply.code(201).send(solicitacao);
  });

  // Move o cartão entre colunas do Kanban. Qualquer papel de staff pode
  // mudar status puramente operacional/logístico (ex: Em compra → Comprado,
  // Aprovado → Entregue); as duas transições que são DECISÃO (não
  // logística) têm gate próprio, checado depois do requireRole genérico:
  //   → EM_ANALISE (a partir de PENDENTE): só quem valida tecnicamente
  //   → APROVADO/REPROVADO: só quem aprova o custo, e só se já passou pela
  //     validação técnica (ver PAPEIS_QUE_VALIDAM_TECNICAMENTE/
  //     PAPEIS_QUE_APROVAM acima, fluxo de duas etapas confirmado com o
  //     Vini em 17/07/2026).
  //
  // Achado de auditoria (Etapa 3 — Backend, 08/07/2026): esta rota bloqueava
  // só COLABORADOR manualmente, sem usar `requireRole` — RH (papel que
  // então era só-leitura por design) conseguia mover o Kanban de
  // solicitações mesmo assim, quebrando esse invariante. Trocado pelo
  // padrão explícito já usado no restante do sistema (ex: chamados.routes.ts,
  // rota equivalente de status).
  //
  // ATUALIZAÇÃO (22/07/2026, pedido do Vini — "igualar RH e Financeiro,
  // inclusive Solicitações"): RH deixou de ser só-leitura neste módulo e
  // passou a fazer parte do `requireRole` de propósito — ganhou o mesmo
  // poder de aprovação de custo que FINANCEIRO (ver PAPEIS_QUE_APROVAM
  // acima). RH continua sem poder validar tecnicamente (não faz parte de
  // PAPEIS_QUE_VALIDAM_TECNICAMENTE) — isso é escopo do Suporte/TI, não
  // muda com esta equiparação.
  app.patch(
    "/solicitacoes-equipamento/:id/status",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR", "SUPORTE_TI", "FINANCEIRO", "RH")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = statusUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Status inválido." });
      }

      // Achado de auditoria (06/07/2026): faltava esta checagem — igual ao
      // DELETE mais abaixo já fazia. Sem ela, um id inexistente (solicitação
      // excluída entre a listagem do Kanban e o clique) virava P2025 do
      // Prisma → 500 genérico em vez de 404. Movida pra ANTES dos gates de
      // aprovação (17/07/2026) porque o gate de "precisa já estar em
      // EM_ANALISE" abaixo precisa ler `existente.status`.
      const existente = await app.prisma.solicitacaoEquipamento.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Solicitação não encontrada." });

      const vaiParaAnalise = parsed.data.status === "EM_ANALISE" && existente.status === "PENDENTE";
      if (vaiParaAnalise && !PAPEIS_QUE_VALIDAM_TECNICAMENTE.includes(request.user.papel as (typeof PAPEIS_QUE_VALIDAM_TECNICAMENTE)[number])) {
        return reply.code(403).send({ error: "Só Administrador ou Suporte/TI podem validar tecnicamente uma solicitação antes de seguir para aprovação." });
      }

      const exigeAprovador = ["APROVADO", "REPROVADO"].includes(parsed.data.status);
      if (exigeAprovador && !PAPEIS_QUE_APROVAM.includes(request.user.papel as (typeof PAPEIS_QUE_APROVAM)[number])) {
        return reply.code(403).send({ error: "Só Administrador ou Financeiro podem aprovar ou reprovar." });
      }
      // Trava a ordem das duas etapas: não deixa aprovar/reprovar direto de
      // PENDENTE (ou de qualquer outro status) sem antes ter passado por
      // EM_ANALISE — garante que o técnico já validou antes do Financeiro
      // decidir o custo. ADMINISTRADOR, como override de topo em todo o
      // sistema, pode pular a etapa em caso excepcional.
      if (exigeAprovador && existente.status !== "EM_ANALISE" && request.user.papel !== "ADMINISTRADOR") {
        return reply.code(409).send({ error: "Esta solicitação ainda não passou pela validação técnica (Em análise) — peça para Suporte/TI validar antes de aprovar ou reprovar." });
      }

      const dataExtra: { aprovadorId?: string } = exigeAprovador ? { aprovadorId: request.user.sub } : {};

      const solicitacao = await app.prisma.solicitacaoEquipamento.update({
        where: { id },
        data: { status: parsed.data.status, ...dataExtra },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: `STATUS_${parsed.data.status}`,
        entidade: "SolicitacaoEquipamento",
        entidadeId: id,
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — avisa quem pediu (se
      // tiver login no sistema; colaborador sem conta própria não recebe
      // nada, mesmo padrão defensivo do resto do arquivo). APROVADO/
      // REPROVADO usam o tipo específico (decisão); as demais mudanças de
      // status do Kanban usam o tipo genérico.
      const solicitante = await app.prisma.colaborador.findUnique({
        where: { id: existente.solicitanteId },
        select: { usuario: { select: { id: true } } },
      });
      if (solicitante?.usuario) {
        const tipoNotificacao =
          parsed.data.status === "APROVADO"
            ? "SOLICITACAO_EQUIPAMENTO_APROVADA"
            : parsed.data.status === "REPROVADO"
              ? "SOLICITACAO_EQUIPAMENTO_REPROVADA"
              : "SOLICITACAO_EQUIPAMENTO_STATUS_MUDOU";
        await notificar(app, {
          destinatarioIds: [solicitante.usuario.id],
          categoria: "SOLICITACAO_EQUIPAMENTO",
          tipo: tipoNotificacao,
          titulo: `Solicitação de "${existente.item}" — ${STATUS_SOLICITACAO_LABEL_PT[parsed.data.status]}`,
          mensagem: `Sua solicitação de "${existente.item}" agora está: ${STATUS_SOLICITACAO_LABEL_PT[parsed.data.status]}.`,
          prioridade: exigeAprovador ? "ALTA" : "MEDIA",
          entidade: "SolicitacaoEquipamento",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      }

      avisarMudanca("solicitacoes");

      return reply.send(solicitacao);
    }
  );

  // Exclusão definitiva — pra corrigir uma solicitação criada por engano
  // (duplicada, item errado, teste). Entidade "folha": nenhuma outra tabela
  // referencia solicitacoes_equipamento, então a exclusão é direta, sem
  // efeito colateral em outros registros.
  app.delete(
    "/solicitacoes-equipamento/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const solicitacao = await app.prisma.solicitacaoEquipamento.findUnique({ where: { id } });
      if (!solicitacao) return reply.code(404).send({ error: "Solicitação não encontrada." });
      await app.prisma.solicitacaoEquipamento.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "SolicitacaoEquipamento", entidadeId: id, detalhe: { item: solicitacao.item }, ip: request.ip });
      avisarMudanca("solicitacoes");
      return reply.code(204).send();
    }
  );

  // Valor e fornecedor da compra (17/07/2026, pedido do Vini) — só quem
  // cuida da compra edita (ADMINISTRADOR/SUPORTE_TI/FINANCEIRO, ver
  // PAPEIS_QUE_EDITAM_COMPRA no topo). Auditoria grava o antes/depois: se
  // o solicitante reclamar que "o valor mudou", dá pra saber quem mudou,
  // de quanto pra quanto, e quando.
  app.patch(
    "/solicitacoes-equipamento/:id/detalhes-compra",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_QUE_EDITAM_COMPRA)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = detalhesCompraSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      if (parsed.data.valorUnitario === undefined && parsed.data.fornecedor === undefined) {
        return reply.code(400).send({ error: "Informe valor unitário e/ou fornecedor." });
      }

      const solicitacao = await app.prisma.solicitacaoEquipamento.findUnique({ where: { id } });
      if (!solicitacao) return reply.code(404).send({ error: "Solicitação não encontrada." });

      const atualizada = await app.prisma.solicitacaoEquipamento.update({
        where: { id },
        data: {
          ...(parsed.data.valorUnitario !== undefined ? { valorUnitario: parsed.data.valorUnitario } : {}),
          ...(parsed.data.fornecedor !== undefined ? { fornecedor: parsed.data.fornecedor?.trim() || null } : {}),
        },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EDITAR_DETALHES_COMPRA",
        entidade: "SolicitacaoEquipamento",
        entidadeId: id,
        detalhe: {
          valorUnitarioAntes: Number(solicitacao.valorUnitario),
          valorUnitarioDepois: Number(atualizada.valorUnitario),
          fornecedorAntes: solicitacao.fornecedor,
          fornecedorDepois: atualizada.fornecedor,
        },
        ip: request.ip,
      });

      avisarMudanca("solicitacoes");

      return reply.send({ ...atualizada, valorTotal: Number(atualizada.valorUnitario) * atualizada.quantidade });
    }
  );

  // Sugestões de fornecedor (17/07/2026) — todo fornecedor já usado em
  // qualquer solicitação vira sugestão pras próximas. É o que faz a lista
  // de "lojas da região" se construir sozinha com o uso real, em vez de
  // depender de um cadastro impossível de manter completo (a UI soma estas
  // sugestões a uma lista fixa de lojas conhecidas da web).
  app.get(
    "/solicitacoes-equipamento/fornecedores",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_QUE_EDITAM_COMPRA)] },
    async (_request, reply) => {
      const usados = await app.prisma.solicitacaoEquipamento.findMany({
        where: { fornecedor: { not: null } },
        select: { fornecedor: true },
        distinct: ["fornecedor"],
        orderBy: { fornecedor: "asc" },
      });
      return reply.send({ fornecedores: usados.map((u) => u.fornecedor).filter(Boolean) });
    }
  );
}
