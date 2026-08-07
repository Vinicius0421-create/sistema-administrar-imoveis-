import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  Prioridade,
  StatusSolicitacaoPapelaria,
  TipoSolicitacaoPapelaria,
  UnidadeMedidaProduto,
} from "@prisma/client";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarAuditoria } from "../utils/audit";
import { nomeExibicaoUsuario } from "../utils/usuarios";
import { notificar, notificarPorPapeis } from "../utils/notificacoes.service";
import { avisarMudanca } from "../utils/realtime";

const STATUS_SOLIC_PAPELARIA_LABEL_PT: Record<StatusSolicitacaoPapelaria, string> = {
  RASCUNHO: "Rascunho",
  ENVIADA: "Enviada",
  EM_ANALISE: "Em análise",
  APROVADA: "Aprovada",
  EM_SEPARACAO: "Em separação",
  EM_TRANSPORTE: "Em transporte",
  ENTREGUE: "Entregue",
  CANCELADA: "Cancelada",
  REPROVADA: "Reprovada",
};

// Módulo "Remessa para Papelaria e Compras" (09/07/2026, pedido do Vini) —
// submódulo de Solicitações, ao lado de SolicitacaoEquipamento (ver
// solicitacoes.routes.ts). Mesmo racional de linha do tempo de eventos já
// usado em ChamadoManutencao/ChamadoEvento: toda mudança de status, edição e
// comentário vira um EventoSolicitacaoPapelaria, nunca uma alteração muda.
//
// Papéis e permissões (confirmado com o Vini — ajustado em 09/07/2026,
// depois do módulo já estar em produção: "o intuito seria os colaboradores
// solicitar e o RH autorizar ou não, definir se é urgente ou não"):
//   - Podem CRIAR solicitação: ADMINISTRADOR, GESTOR_COORDENADOR, RH — e
//     agora também COLABORADOR (Portal de autoatendimento), sempre em nome
//     próprio, e sempre com tipo/prioridade forçados pro servidor (ver POST
//     abaixo) — colaborador comum não escolhe Mensal/Avulsa, só descreve o
//     que precisa. Quem decide se é urgente e reclassifica é o RH (ou
//     Administrador/Gestor), via PATCH /:id (edição) antes de aprovar.
//   - Podem GERENCIAR (aprovar/recusar/mudar status/editar/excluir/
//     reclassificar tipo e prioridade) as solicitações de Papelaria e
//     Compras: ADMINISTRADOR, GESTOR_COORDENADOR e também RH — mas RH só tem
//     esse poder AQUI, dentro deste módulo. RH continua sem nenhum acesso a
//     SolicitacaoEquipamento (módulo de Equipamentos, arquivo
//     solicitacoes.routes.ts, que nem sequer entra nesta rota) nem a
//     qualquer outro módulo administrativo além de Colaboradores (somente
//     leitura, já existente).
//   - COLABORADOR só enxerga e comenta nas PRÓPRIAS solicitações (ver
//     escopoColaborador no GET de lista/detalhe, mesmo padrão já usado em
//     solicitacoes.routes.ts pro módulo de Equipamentos) — nunca aprova,
//     edita ou muda status.
//   - SUPORTE_TI não gerencia este módulo (sem tela de aprovação/gestão,
//     mesmo critério de sempre) — mas, a partir de 09/07/2026 ("Meu
//     Portal", pedido do Vini: todo papel não-ADMINISTRADOR também é um
//     colaborador e precisa conseguir solicitar coisas pra si mesmo), pode
//     abrir a própria solicitação em nome próprio, igual COLABORADOR já
//     podia. Continua fora de PAPEIS_GERENCIAM — não aprova, edita ou muda
//     status de solicitação de ninguém, só cria a própria.
// Reorganização de hierarquia (17/07/2026, pedido do Vini: "solicitações de
// papelaria e compras... é do RH e financeiro" + papel novo FINANCEIRO).
// GESTOR_COORDENADOR saiu de PAPEIS_GERENCIAM — a nova identidade dele é
// gestão de PESSOAS/equipe, não aprovação de custo (essa virou exclusiva de
// quem lida com dinheiro: RH continua porque já fazia a triagem/gestão do
// pedido, FINANCEIRO entra como segunda camada de aprovação — confirmado
// com o Vini via pergunta explícita: "RH e Financeiro aprovam juntos", não
// um no lugar do outro). GESTOR_COORDENADOR continua podendo CRIAR (pedir
// papelaria pro próprio time via Meu Portal, mesmo mecanismo de
// autoatendimento que COLABORADOR/SUPORTE_TI já tinham) — só não gerencia
// mais a fila alheia.
const PAPEIS_GERENCIAM: Array<"ADMINISTRADOR" | "RH" | "FINANCEIRO"> = ["ADMINISTRADOR", "RH", "FINANCEIRO"];
const PAPEIS_PODEM_CRIAR: Array<"ADMINISTRADOR" | "RH" | "FINANCEIRO" | "GESTOR_COORDENADOR" | "COLABORADOR" | "SUPORTE_TI"> = [
  ...PAPEIS_GERENCIAM,
  "GESTOR_COORDENADOR",
  "COLABORADOR",
  "SUPORTE_TI",
];

// Transições válidas a partir de cada status — evita, por exemplo, pular de
// RASCUNHO direto para ENTREGUE, ou reabrir uma solicitação já CANCELADA.
// CANCELADA é alcançável a partir de qualquer status não-terminal (desistência
// pode acontecer em qualquer ponto do fluxo); REPROVADA só a partir de
// ENVIADA/EM_ANALISE (é uma decisão de análise, não faz sentido depois de já
// aprovada). Status terminais (ENTREGUE, CANCELADA, REPROVADA) não têm saída.
const TRANSICOES_VALIDAS: Record<StatusSolicitacaoPapelaria, StatusSolicitacaoPapelaria[]> = {
  RASCUNHO: ["ENVIADA", "CANCELADA"],
  ENVIADA: ["EM_ANALISE", "APROVADA", "REPROVADA", "CANCELADA"],
  EM_ANALISE: ["APROVADA", "REPROVADA", "CANCELADA"],
  APROVADA: ["EM_SEPARACAO", "CANCELADA"],
  EM_SEPARACAO: ["EM_TRANSPORTE", "CANCELADA"],
  EM_TRANSPORTE: ["ENTREGUE", "CANCELADA"],
  ENTREGUE: [],
  CANCELADA: [],
  REPROVADA: [],
};

const STATUS_TERMINAIS: StatusSolicitacaoPapelaria[] = ["ENTREGUE", "CANCELADA", "REPROVADA"];
// Só estes dois status representam decisão de aprovação (preenchem/limpam
// aprovadorId) — os demais (separação, transporte, entrega, cancelamento)
// são passos operacionais depois que a decisão já foi tomada.
const STATUS_DECISAO: StatusSolicitacaoPapelaria[] = ["APROVADA", "REPROVADA"];

const itemInputSchema = z
  .object({
    produtoId: z.string().optional().nullable(),
    // Obrigatório só quando não vem de um produto do catálogo (produtoId
    // ausente) — item avulso ainda precisa de um nome pra aparecer na lista.
    nomeProduto: z.string().min(1).optional(),
    categoriaId: z.string().min(1, "Selecione a categoria."),
    quantidade: z.coerce.number().int().min(1, "Quantidade precisa ser pelo menos 1."),
    unidadeMedida: z.nativeEnum(UnidadeMedidaProduto).default("UNIDADE"),
    observacoes: z.string().optional().nullable(),
  })
  .refine((v) => v.produtoId || v.nomeProduto, {
    message: "Escolha um produto do catálogo ou informe o nome do item avulso.",
    path: ["nomeProduto"],
  });

const solicitacaoInputSchema = z
  .object({
    unidadeId: z.string().min(1, "Selecione a unidade."),
    // Ausente = usuário logado (ver rota POST abaixo); só ADMINISTRADOR/
    // GESTOR_COORDENADOR/RH gerentes podem escolher outra pessoa, e mesmo
    // assim só entre colegas com um desses três papéis (não faz sentido abrir
    // "em nome" de alguém sem acesso ao módulo).
    responsavelId: z.string().optional(),
    // Default MENSAL (09/07/2026): colaborador comum não escolhe isso — o
    // campo só é preenchido de verdade por quem gerencia (Administrador/
    // Gestor/RH), que continua escolhendo explicitamente no formulário
    // deles. Quando quem cria é COLABORADOR, o valor é sempre forçado pro
    // servidor de qualquer forma (ver POST abaixo), então este default só
    // cobre o caso de o campo nem ser enviado.
    tipo: z.nativeEnum(TipoSolicitacaoPapelaria).default("MENSAL"),
    prioridade: z.nativeEnum(Prioridade).default("MEDIA"),
    justificativa: z.string().optional().nullable(),
    observacoes: z.string().optional().nullable(),
    itens: z.array(itemInputSchema).min(1, "Inclua pelo menos um item."),
    // Se true, a solicitação já nasce ENVIADA (pula o estado RASCUNHO) — ver
    // POST abaixo.
    enviarAgora: z.boolean().default(false),
  })
  .refine((v) => v.tipo !== "AVULSA" || (v.justificativa && v.justificativa.trim().length > 0), {
    message: "Justificativa é obrigatória para remessa avulsa (urgente).",
    path: ["justificativa"],
  });

const updateSchema = z.object({
  unidadeId: z.string().min(1).optional(),
  tipo: z.nativeEnum(TipoSolicitacaoPapelaria).optional(),
  prioridade: z.nativeEnum(Prioridade).optional(),
  justificativa: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
  itens: z.array(itemInputSchema).min(1).optional(),
});

// motivo opcional aqui (mesmo racional de solicitacoes.routes.ts, achado de
// auditoria S2, 22/07/2026): esta rota cobre TODAS as transições de status,
// não só REPROVADA — o motivo só é exigido dentro do handler, quando o
// próximo status é REPROVADA. Mesma mensagem/limite mínimo já usado em
// Serviço (POST /solicitacoes-servico/:id/recusar).
const statusUpdateSchema = z.object({ status: z.nativeEnum(StatusSolicitacaoPapelaria), motivo: z.string().trim().optional() });
const comentarioSchema = z.object({ mensagem: z.string().min(1) });

function podeGerenciar(papel: string): boolean {
  return (PAPEIS_GERENCIAM as string[]).includes(papel);
}

// Snapshot de cada item — resolve nomeProduto/categoriaId a partir do
// catálogo quando produtoId é informado (garante consistência: não dá pra
// mandar um nomeProduto qualquer junto de um produtoId real e os dois
// divergirem). Lança erro se produtoId/categoriaId não existir — quem chama
// captura e devolve 400.
async function resolverItens(
  app: FastifyInstance,
  itens: z.infer<typeof itemInputSchema>[]
): Promise<{ erro: string | null; dados: any[] }> {
  const dados: any[] = [];
  for (const item of itens) {
    let nomeProduto = item.nomeProduto || "";
    let categoriaId = item.categoriaId;
    let unidadeMedida = item.unidadeMedida;
    if (item.produtoId) {
      const produto = await app.prisma.produtoPapelaria.findUnique({ where: { id: item.produtoId } });
      if (!produto) return { erro: `Produto não encontrado (id ${item.produtoId}).`, dados: [] };
      nomeProduto = produto.nome;
      categoriaId = produto.categoriaId;
      // Unidade de medida do catálogo prevalece por padrão, mas quem monta a
      // solicitação pode ter escolhido outra explicitamente (ex: comprar em
      // caixa fechada em vez da unidade avulsa cadastrada) — só usa o padrão
      // do produto quando o campo não foi enviado.
      if (!item.unidadeMedida) unidadeMedida = produto.unidadeMedidaPadrao;
    }
    const categoriaExiste = await app.prisma.categoriaProdutoPapelaria.findUnique({ where: { id: categoriaId } });
    if (!categoriaExiste) return { erro: `Categoria não encontrada (id ${categoriaId}).`, dados: [] };
    dados.push({
      produtoId: item.produtoId || null,
      nomeProduto,
      categoriaId,
      quantidade: item.quantidade,
      unidadeMedida,
      observacoes: item.observacoes || null,
    });
  }
  return { erro: null, dados };
}

function comNomes<
  T extends {
    responsavel?: { id: string; email: string; colaborador?: { nomeCompleto: string } | null } | null;
    aprovador?: { id: string; email: string; colaborador?: { nomeCompleto: string } | null } | null;
    criadoPor?: { id: string; email: string; colaborador?: { nomeCompleto: string } | null } | null;
  }
>(solicitacao: T) {
  const { colaborador: _c1, ...responsavel } = solicitacao.responsavel || ({} as any);
  const resultado: any = { ...solicitacao };
  if (solicitacao.responsavel) resultado.responsavel = { ...responsavel, nome: nomeExibicaoUsuario(solicitacao.responsavel) };
  if (solicitacao.aprovador) {
    const { colaborador: _c2, ...aprovador } = solicitacao.aprovador;
    resultado.aprovador = { ...aprovador, nome: nomeExibicaoUsuario(solicitacao.aprovador) };
  }
  if (solicitacao.criadoPor) {
    const { colaborador: _c3, ...criadoPor } = solicitacao.criadoPor;
    resultado.criadoPor = { ...criadoPor, nome: nomeExibicaoUsuario(solicitacao.criadoPor) };
  }
  return resultado;
}

function tempoAtendimentoMs(s: { dataSolicitacao: Date; dataConclusao: Date | null }): number | null {
  if (!s.dataConclusao) return null;
  return s.dataConclusao.getTime() - s.dataSolicitacao.getTime();
}

const INCLUDE_LISTA = {
  unidade: { select: { id: true, nome: true } },
  responsavel: { select: { id: true, email: true, colaborador: { select: { nomeCompleto: true } } } },
  aprovador: { select: { id: true, email: true, colaborador: { select: { nomeCompleto: true } } } },
  // Achado de investigação (22/07/2026) — ver comentário completo em
  // schema.prisma (SolicitacaoPapelaria.criadoPorId): "quem de fato enviou
  // o pedido", distinto de responsavel quando a solicitação foi criada "em
  // nome de" outra pessoa.
  criadoPor: { select: { id: true, email: true, colaborador: { select: { nomeCompleto: true } } } },
  _count: { select: { itens: true } },
} as const;

export default async function solicitacoesPapelariaRoutes(app: FastifyInstance) {
  // Lista de quem pode ser escolhido como "responsável" ao abrir uma
  // solicitação em nome de outra pessoa (ver POST abaixo — só
  // ADMINISTRADOR/GESTOR_COORDENADOR podem fazer essa escolha, e só entre
  // colegas que também têm acesso de gestão a este módulo). Mesmo racional
  // de nome de exibição e filtro por conta vinculada a colaborador real já
  // usado em GET /tecnicos (chamados.routes.ts).
  app.get("/solicitacoes-papelaria/gestores", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const brutos = await app.prisma.usuario.findMany({
      where: { papel: { in: PAPEIS_GERENCIAM }, ativo: true },
      select: { id: true, email: true, papel: true, colaborador: { select: { nomeCompleto: true } } },
    });
    const gestores = brutos
      .map((u) => ({ id: u.id, email: u.email, papel: u.papel, nome: nomeExibicaoUsuario(u) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return reply.send(gestores);
  });

  app.get("/solicitacoes-papelaria", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = paginationSchema
      .extend({
        status: z.nativeEnum(StatusSolicitacaoPapelaria).optional(),
        tipo: z.nativeEnum(TipoSolicitacaoPapelaria).optional(),
        prioridade: z.nativeEnum(Prioridade).optional(),
        unidadeId: z.string().optional(),
        responsavelId: z.string().optional(),
        criadoPorId: z.string().optional(),
        numero: z.coerce.number().int().optional(),
        dataInicio: z.coerce.date().optional(),
        dataFim: z.coerce.date().optional(),
      })
      .parse(request.query);
    const { skip, take } = toSkipTake(query);

    // Colaborador comum só enxerga as próprias solicitações (mesmo padrão
    // de escopoColaborador em solicitacoes.routes.ts, módulo de
    // Equipamentos) — aqui o "dono" é responsavelId (Usuario), não
    // solicitanteId (Colaborador), porque Papelaria sempre se relacionou a
    // Usuario, nunca a Colaborador diretamente. SUPORTE_TI entrou no mesmo
    // escopo em 09/07/2026 ("Meu Portal") — pode criar a própria
    // solicitação (ver PAPEIS_PODEM_CRIAR acima), mas não gerencia o
    // módulo, então só pode listar as que ele mesmo abriu, nunca a fila
    // inteira (que hoje gerenciam ADMINISTRADOR/RH/FINANCEIRO — ver
    // PAPEIS_GERENCIAM).
    //
    // GESTOR_COORDENADOR (17/07/2026, reorganização de hierarquia) saiu de
    // PAPEIS_GERENCIAM — não aprova mais Papelaria — mas foi DELIBERADAMENTE
    // deixado de fora deste `ehAutoatendimentoSemGestao` também: ele
    // continua vendo a fila inteira (visão do que a equipe dele está
    // pedindo), só perdeu o poder de editar/aprovar (isso é checado nas
    // rotas PATCH via PAPEIS_GERENCIAM, não aqui). Combina com a nova
    // identidade dele — acompanha a operação da equipe sem decidir gasto.
    const ehAutoatendimentoSemGestao = request.user.papel === "COLABORADOR" || request.user.papel === "SUPORTE_TI";
    const escopoColaborador = ehAutoatendimentoSemGestao ? { responsavelId: request.user.sub } : {};

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.tipo ? { tipo: query.tipo } : {}),
      ...(query.prioridade ? { prioridade: query.prioridade } : {}),
      ...(query.unidadeId ? { unidadeId: query.unidadeId } : {}),
      ...(query.responsavelId ? { responsavelId: query.responsavelId } : {}),
      ...(query.criadoPorId ? { criadoPorId: query.criadoPorId } : {}),
      ...(query.numero ? { numero: query.numero } : {}),
      ...(query.dataInicio || query.dataFim
        ? {
            dataSolicitacao: {
              ...(query.dataInicio ? { gte: query.dataInicio } : {}),
              ...(query.dataFim ? { lte: query.dataFim } : {}),
            },
          }
        : {}),
      ...escopoColaborador,
    };

    const [items, total] = await Promise.all([
      app.prisma.solicitacaoPapelaria.findMany({
        where,
        skip,
        take,
        orderBy: { dataSolicitacao: "desc" },
        include: INCLUDE_LISTA,
      }),
      app.prisma.solicitacaoPapelaria.count({ where }),
    ]);

    const comTempo = items.map((s) => ({ ...comNomes(s), tempoAtendimentoMs: tempoAtendimentoMs(s) }));
    return reply.send(paginatedResponse(comTempo, total, query));
  });

  app.get("/solicitacoes-papelaria/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const solicitacao = await app.prisma.solicitacaoPapelaria.findUnique({
      where: { id },
      include: {
        ...INCLUDE_LISTA,
        itens: { include: { produto: true, categoria: true }, orderBy: { criadoEm: "asc" } },
        eventos: {
          orderBy: { criadoEm: "asc" },
          include: { autor: { select: { id: true, email: true, papel: true, colaborador: { select: { nomeCompleto: true } } } } },
        },
      },
    });
    if (!solicitacao) return reply.code(404).send({ error: "Solicitação não encontrada." });
    // Colaborador comum (e, desde 09/07/2026, SUPORTE_TI em autoatendimento
    // — ver comentário em GET /solicitacoes-papelaria acima) só vê a
    // própria — 404 (não 403) pra não revelar nem a existência do registro
    // alheio, mesmo padrão de outras rotas "escopadas ao dono" no sistema.
    if (
      (request.user.papel === "COLABORADOR" || request.user.papel === "SUPORTE_TI") &&
      solicitacao.responsavelId !== request.user.sub
    ) {
      return reply.code(404).send({ error: "Solicitação não encontrada." });
    }
    return reply.send({ ...comNomes(solicitacao), tempoAtendimentoMs: tempoAtendimentoMs(solicitacao) });
  });

  app.post(
    "/solicitacoes-papelaria",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_PODEM_CRIAR)] },
    async (request, reply) => {
      const parsed = solicitacaoInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      // Inclui SUPORTE_TI desde 09/07/2026 ("Meu Portal") — mesmo
      // comportamento de autoatendimento do Colaborador comum: sem poder de
      // classificar (Mensal/Avulsa/prioridade), sempre em nome próprio, vai
      // direto pra fila do RH.
      const ehColaboradorComum = request.user.papel === "COLABORADOR" || request.user.papel === "SUPORTE_TI";

      let responsavelId = request.user.sub;
      if (parsed.data.responsavelId && parsed.data.responsavelId !== request.user.sub) {
        // Só ADMINISTRADOR/GESTOR_COORDENADOR podem abrir "em nome de" outra
        // pessoa — RH e Colaborador sempre abrem em nome próprio (RH mesmo
        // tendo o poder de gerenciar/aprovar depois; Colaborador porque é
        // sempre o próprio interessado no material).
        if (request.user.papel !== "ADMINISTRADOR" && request.user.papel !== "GESTOR_COORDENADOR") {
          return reply.code(403).send({ error: "Você não pode abrir esta solicitação em nome de outra pessoa." });
        }
        const outroUsuario = await app.prisma.usuario.findUnique({ where: { id: parsed.data.responsavelId } });
        if (!outroUsuario || !podeGerenciar(outroUsuario.papel)) {
          return reply.code(400).send({ error: "O responsável escolhido não tem acesso a este módulo." });
        }
        responsavelId = parsed.data.responsavelId;
      }

      const { erro, dados: itensResolvidos } = await resolverItens(app, parsed.data.itens);
      if (erro) return reply.code(400).send({ error: erro });

      // Colaborador comum não classifica a solicitação — nunca escolhe
      // Mensal/Avulsa nem prioridade (mesmo que tente mandar algo diferente
      // no corpo da requisição, o servidor ignora e força o default aqui).
      // Quem decide se é urgente é o RH/Administrador/Gestor, reclassificando
      // via PATCH /:id antes de aprovar — ver comentário no topo do arquivo.
      const tipo: TipoSolicitacaoPapelaria = ehColaboradorComum ? "MENSAL" : parsed.data.tipo;
      const prioridade: Prioridade = ehColaboradorComum ? "MEDIA" : parsed.data.prioridade;
      const justificativa = ehColaboradorComum ? null : parsed.data.justificativa || null;
      // Colaborador vai direto pra fila de análise do RH — não existe
      // "rascunho" que faça sentido pra quem só está pedindo material uma
      // vez, ao contrário de quem gerencia o módulo e pode preparar uma
      // remessa mensal com calma antes de enviar.
      const statusInicial: StatusSolicitacaoPapelaria = ehColaboradorComum || parsed.data.enviarAgora ? "ENVIADA" : "RASCUNHO";

      const solicitacao = await app.prisma.$transaction(async (tx) => {
        const criada = await tx.solicitacaoPapelaria.create({
          data: {
            tipo,
            unidadeId: parsed.data.unidadeId,
            responsavelId,
            // Achado de investigação (22/07/2026) — sempre o usuário logado
            // agora criando a solicitação, mesmo quando responsavelId é
            // delegado a outra pessoa ("em nome de"). Ver comentário
            // completo em schema.prisma.
            criadoPorId: request.user.sub,
            prioridade,
            justificativa,
            observacoes: parsed.data.observacoes || null,
            status: statusInicial,
            itens: { create: itensResolvidos },
          },
        });
        await tx.eventoSolicitacaoPapelaria.create({
          data: {
            solicitacaoId: criada.id,
            tipo: "CRIACAO",
            autorId: request.user.sub,
            detalhe: { status: statusInicial, quantidadeItens: itensResolvidos.length },
          },
        });
        return criada;
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR",
        entidade: "SolicitacaoPapelaria",
        entidadeId: solicitacao.id,
        detalhe: { numero: solicitacao.numero, tipo: solicitacao.tipo },
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — quem gerencia o
      // módulo (ADMINISTRADOR/GESTOR_COORDENADOR/RH) precisa saber que uma
      // solicitação entrou na fila. PAPELARIA_NOVA cobre o caso mais comum
      // agora (colaborador pedindo material); PAPELARIA_ENVIADA cobre o
      // caso de quem gerencia preparar uma remessa e já mandar pra fila
      // (enviarAgora=true) — são eventos distintos pedidos no desenho
      // original da Fase B, mesmo levando ao mesmo status ENVIADA.
      if (ehColaboradorComum) {
        const quemPediu = await app.prisma.usuario.findUnique({
          where: { id: request.user.sub },
          select: { email: true, colaborador: { select: { nomeCompleto: true } } },
        });
        await notificarPorPapeis(app, [...PAPEIS_GERENCIAM], {
          categoria: "SOLICITACAO_PAPELARIA",
          tipo: "PAPELARIA_NOVA",
          titulo: `Nova solicitação de papelaria #${solicitacao.numero}`,
          mensagem: `${quemPediu ? nomeExibicaoUsuario(quemPediu) : "Um colaborador"} pediu material — aguardando classificação e análise.`,
          entidade: "SolicitacaoPapelaria",
          entidadeId: solicitacao.id,
          origemUsuarioId: request.user.sub,
        });
      } else if (statusInicial === "ENVIADA") {
        await notificarPorPapeis(app, [...PAPEIS_GERENCIAM], {
          categoria: "SOLICITACAO_PAPELARIA",
          tipo: "PAPELARIA_ENVIADA",
          titulo: `Remessa de papelaria #${solicitacao.numero} enviada`,
          mensagem: `Remessa ${tipo === "AVULSA" ? "avulsa/urgente" : "mensal"} pronta pra análise.`,
          entidade: "SolicitacaoPapelaria",
          entidadeId: solicitacao.id,
          origemUsuarioId: request.user.sub,
        });
      }
      if (tipo === "AVULSA") {
        await notificarPorPapeis(app, [...PAPEIS_GERENCIAM], {
          categoria: "SOLICITACAO_PAPELARIA",
          tipo: "PAPELARIA_URGENTE_ABERTA",
          titulo: `Remessa urgente #${solicitacao.numero}`,
          mensagem: justificativa || "Remessa avulsa/urgente aberta.",
          prioridade: "ALTA",
          entidade: "SolicitacaoPapelaria",
          entidadeId: solicitacao.id,
          origemUsuarioId: request.user.sub,
        });
      }

      avisarMudanca("solicitacoesPapelaria");

      return reply.code(201).send(solicitacao);
    }
  );

  // Edição de conteúdo (itens, unidade, tipo, prioridade, textos) — só faz
  // sentido enquanto a solicitação ainda não avançou no fluxo de aprovação
  // (RASCUNHO ou ENVIADA); depois disso, mudar itens por baixo do pano
  // enquanto alguém já está analisando/aprovando seria confuso e arriscado.
  // Mudança de status tem rota própria (PATCH /:id/status) — mantidas
  // separadas pelo mesmo motivo já documentado em chamados.routes.ts.
  app.patch(
    "/solicitacoes-papelaria/:id",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const atual = await app.prisma.solicitacaoPapelaria.findUnique({ where: { id } });
      if (!atual) return reply.code(404).send({ error: "Solicitação não encontrada." });
      if (atual.status !== "RASCUNHO" && atual.status !== "ENVIADA") {
        return reply.code(409).send({ error: "Só é possível editar solicitações em Rascunho ou recém-Enviadas (ainda não analisadas)." });
      }

      // Mesma regra de "justificativa obrigatória pra Avulsa" do POST
      // (solicitacaoInputSchema), só que aplicada aqui contra o ESTADO FINAL
      // (o que já existia + o que está sendo alterado agora), não só o
      // corpo do PATCH — como updateSchema é parcial, olhar só o payload
      // deixaria passar, por exemplo, {tipo: "AVULSA"} sozinho, sem
      // justificativa, quando é exatamente esse o caso de uso mais comum
      // agora (09/07/2026): RH reclassificando uma solicitação que o
      // colaborador abriu como MENSAL sem justificativa nenhuma.
      const tipoFinal = parsed.data.tipo ?? atual.tipo;
      const justificativaFinal = parsed.data.justificativa !== undefined ? parsed.data.justificativa : atual.justificativa;
      if (tipoFinal === "AVULSA" && (!justificativaFinal || justificativaFinal.trim().length === 0)) {
        return reply.code(400).send({
          error: "Dados inválidos.",
          detalhes: { fieldErrors: { justificativa: ["Justificativa é obrigatória para remessa avulsa (urgente)."] } },
        });
      }

      const { itens, ...camposSimples } = parsed.data;
      let itensResolvidos: any[] | null = null;
      if (itens) {
        const resultado = await resolverItens(app, itens);
        if (resultado.erro) return reply.code(400).send({ error: resultado.erro });
        itensResolvidos = resultado.dados;
      }

      const solicitacao = await app.prisma.$transaction(async (tx) => {
        if (itensResolvidos) {
          await tx.itemSolicitacaoPapelaria.deleteMany({ where: { solicitacaoId: id } });
        }
        const atualizada = await tx.solicitacaoPapelaria.update({
          where: { id },
          data: {
            ...camposSimples,
            ...(itensResolvidos ? { itens: { create: itensResolvidos } } : {}),
          },
        });
        await tx.eventoSolicitacaoPapelaria.create({
          data: {
            solicitacaoId: id,
            tipo: "EDICAO",
            autorId: request.user.sub,
            detalhe: { camposAlterados: Object.keys(parsed.data) },
          },
        });
        return atualizada;
      });

      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "SolicitacaoPapelaria", entidadeId: id, ip: request.ip });

      // Central de Notificações (Fase B, 09/07/2026) — o caso de uso mais
      // comum deste PATCH agora é justamente a reclassificação do RH (ver
      // comentário no topo do arquivo): avisa o resto de quem gerencia que
      // uma solicitação virou urgente, só quando ela NÃO era AVULSA antes.
      if (tipoFinal === "AVULSA" && atual.tipo !== "AVULSA") {
        await notificarPorPapeis(app, [...PAPEIS_GERENCIAM], {
          categoria: "SOLICITACAO_PAPELARIA",
          tipo: "PAPELARIA_URGENTE_ABERTA",
          titulo: `Solicitação #${atual.numero} reclassificada como urgente`,
          mensagem: justificativaFinal || "Reclassificada para avulsa/urgente.",
          prioridade: "ALTA",
          entidade: "SolicitacaoPapelaria",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      }

      avisarMudanca("solicitacoesPapelaria");

      return reply.send(solicitacao);
    }
  );

  app.patch(
    "/solicitacoes-papelaria/:id/status",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = statusUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const atual = await app.prisma.solicitacaoPapelaria.findUnique({ where: { id } });
      if (!atual) return reply.code(404).send({ error: "Solicitação não encontrada." });

      const proximo = parsed.data.status;
      if (!TRANSICOES_VALIDAS[atual.status].includes(proximo)) {
        return reply.code(409).send({
          error: `Não é possível mudar de "${atual.status}" para "${proximo}" diretamente.`,
        });
      }

      // Achado de auditoria S2 (22/07/2026, "nivelar os 4 fluxos de
      // Solicitação"): reprovar exigia motivo em Serviço, mas não aqui —
      // dava pra reprovar com 1 clique, sem o solicitante saber por quê.
      // Mesma mensagem/limite mínimo de solicitacoesServico.routes.ts.
      if (proximo === "REPROVADA" && (!parsed.data.motivo || parsed.data.motivo.length < 3)) {
        return reply.code(400).send({ error: "Explique o motivo da reprovação." });
      }

      const concluindo = STATUS_TERMINAIS.includes(proximo);
      const ehDecisao = STATUS_DECISAO.includes(proximo);

      const solicitacao = await app.prisma.$transaction(async (tx) => {
        const atualizada = await tx.solicitacaoPapelaria.update({
          where: { id },
          data: {
            status: proximo,
            dataConclusao: concluindo ? new Date() : null,
            ...(ehDecisao ? { aprovadorId: request.user.sub } : {}),
          },
        });
        await tx.eventoSolicitacaoPapelaria.create({
          data: {
            solicitacaoId: id,
            tipo: "MUDANCA_STATUS",
            autorId: request.user.sub,
            detalhe: { de: atual.status, para: proximo, ...(parsed.data.motivo ? { motivo: parsed.data.motivo } : {}) },
          },
        });
        return atualizada;
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: `STATUS_${proximo}`,
        entidade: "SolicitacaoPapelaria",
        entidadeId: id,
        ...(parsed.data.motivo ? { detalhe: { motivo: parsed.data.motivo } } : {}),
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — avisa quem pediu.
      // Diferente de Chamado/Solicitação de Equipamento, aqui `responsavelId`
      // JÁ é um id de Usuario (não de Colaborador) — ver comentário no topo
      // do arquivo — então não precisa resolver colaborador→usuario, só
      // notificar direto.
      await notificar(app, {
        destinatarioIds: [atual.responsavelId],
        categoria: "SOLICITACAO_PAPELARIA",
        tipo: proximo === "APROVADA" ? "PAPELARIA_APROVADA" : proximo === "REPROVADA" ? "PAPELARIA_REPROVADA" : "PAPELARIA_STATUS_MUDOU",
        titulo: `Solicitação de papelaria #${atual.numero} — ${STATUS_SOLIC_PAPELARIA_LABEL_PT[proximo]}`,
        mensagem:
          proximo === "REPROVADA" && parsed.data.motivo
            ? `Sua solicitação #${atual.numero} foi reprovada: ${parsed.data.motivo}`
            : `Sua solicitação #${atual.numero} agora está: ${STATUS_SOLIC_PAPELARIA_LABEL_PT[proximo]}.`,
        prioridade: ehDecisao ? "ALTA" : "MEDIA",
        entidade: "SolicitacaoPapelaria",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });

      avisarMudanca("solicitacoesPapelaria");

      return reply.send(solicitacao);
    }
  );

  app.post(
    // Colaborador comum pode comentar (ex: responder uma dúvida do RH sobre
    // o próprio pedido) — só quem gerencia (ADMINISTRADOR/GESTOR_COORDENADOR/
    // RH) ou o dono da solicitação (Colaborador) participa da conversa;
    // qualquer outro papel autenticado é barrado dentro do handler abaixo,
    // já que "dono" só dá pra checar depois de buscar o registro.
    "/solicitacoes-papelaria/:id/comentarios",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = comentarioSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const existe = await app.prisma.solicitacaoPapelaria.findUnique({ where: { id } });
      if (!existe) return reply.code(404).send({ error: "Solicitação não encontrada." });

      const ehDono = existe.responsavelId === request.user.sub;
      if (!podeGerenciar(request.user.papel) && !ehDono) {
        return reply.code(403).send({ error: "Você não tem permissão para comentar nesta solicitação." });
      }

      const evento = await app.prisma.eventoSolicitacaoPapelaria.create({
        data: { solicitacaoId: id, tipo: "COMENTARIO", autorId: request.user.sub, mensagem: parsed.data.mensagem },
        include: { autor: { select: { id: true, email: true, papel: true, colaborador: { select: { nomeCompleto: true } } } } },
      });

      // Central de Notificações (Fase B, 09/07/2026) — avisa "o outro lado"
      // da conversa: se quem comentou foi o dono (colaborador), avisa quem
      // gerencia; se foi quem gerencia, avisa o dono direto (responsavelId
      // já é Usuario, ver nota acima).
      const preview = parsed.data.mensagem.length > 140 ? `${parsed.data.mensagem.slice(0, 140)}…` : parsed.data.mensagem;
      if (ehDono) {
        await notificarPorPapeis(app, [...PAPEIS_GERENCIAM], {
          categoria: "SOLICITACAO_PAPELARIA",
          tipo: "PAPELARIA_COMENTARIO",
          titulo: `Nova mensagem na solicitação #${existe.numero}`,
          mensagem: preview,
          entidade: "SolicitacaoPapelaria",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      } else {
        await notificar(app, {
          destinatarioIds: [existe.responsavelId],
          categoria: "SOLICITACAO_PAPELARIA",
          tipo: "PAPELARIA_COMENTARIO",
          titulo: `Nova mensagem na sua solicitação #${existe.numero}`,
          mensagem: preview,
          entidade: "SolicitacaoPapelaria",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      }

      return reply.code(201).send(evento);
    }
  );

  // Correção de evento lançado por engano — mesmo padrão/justificativa de
  // DELETE /chamados-manutencao/:id/eventos/:eventoId, restrito a ADMINISTRADOR.
  app.delete(
    "/solicitacoes-papelaria/:id/eventos/:eventoId",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id, eventoId } = request.params as { id: string; eventoId: string };
      const evento = await app.prisma.eventoSolicitacaoPapelaria.findUnique({ where: { id: eventoId } });
      if (!evento || evento.solicitacaoId !== id) return reply.code(404).send({ error: "Evento não encontrado." });
      await app.prisma.eventoSolicitacaoPapelaria.delete({ where: { id: eventoId } });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "EventoSolicitacaoPapelaria",
        entidadeId: eventoId,
        detalhe: { solicitacaoId: id, tipo: evento.tipo },
        ip: request.ip,
      });
      return reply.code(204).send();
    }
  );

  // Exclusão definitiva da solicitação inteira — corrige cadastro criado por
  // engano (duplicado, teste). Restrito a ADMINISTRADOR, mesma sensibilidade
  // de DELETE /chamados-manutencao/:id.
  app.delete(
    "/solicitacoes-papelaria/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const solicitacao = await app.prisma.solicitacaoPapelaria.findUnique({ where: { id } });
      if (!solicitacao) return reply.code(404).send({ error: "Solicitação não encontrada." });
      await app.prisma.solicitacaoPapelaria.delete({ where: { id } });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "SolicitacaoPapelaria",
        entidadeId: id,
        detalhe: { numero: solicitacao.numero },
        ip: request.ip,
      });
      avisarMudanca("solicitacoesPapelaria");
      return reply.code(204).send();
    }
  );

  // ---------------------------------------------------------------------
  // Dashboard — indicadores pedidos explicitamente: abertas, concluídas,
  // urgentes, remessas mensais realizadas, tempo médio de atendimento, por
  // unidade, por período. Uma única rota (em vez de recalcular no frontend a
  // partir da lista paginada) porque os indicadores precisam do conjunto
  // completo, não só da página atual — mesmo racional das rotas de KPI já
  // usadas em Home.tsx/useAppData para os outros módulos.
  // ---------------------------------------------------------------------
  app.get("/solicitacoes-papelaria/dashboard", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const [todas, unidades] = await Promise.all([
      app.prisma.solicitacaoPapelaria.findMany({
        select: {
          status: true,
          tipo: true,
          prioridade: true,
          unidadeId: true,
          dataSolicitacao: true,
          dataConclusao: true,
          unidade: { select: { nome: true } },
        },
      }),
      app.prisma.unidade.findMany({ where: { status: "ATIVO" }, select: { id: true, nome: true } }),
    ]);

    const abertas = todas.filter((s) => !STATUS_TERMINAIS.includes(s.status)).length;
    const concluidas = todas.filter((s) => s.status === "ENTREGUE").length;
    const urgentes = todas.filter((s) => s.tipo === "AVULSA" && !STATUS_TERMINAIS.includes(s.status)).length;

    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const remessasMensaisRealizadas = todas.filter(
      (s) => s.tipo === "MENSAL" && s.status === "ENTREGUE" && s.dataConclusao && s.dataConclusao >= trintaDiasAtras
    ).length;

    const concluidasComTempo = todas.filter((s) => s.status === "ENTREGUE" && s.dataConclusao);
    const tempoMedioAtendimentoMs =
      concluidasComTempo.length === 0
        ? null
        : concluidasComTempo.reduce((soma, s) => soma + (s.dataConclusao!.getTime() - s.dataSolicitacao.getTime()), 0) /
          concluidasComTempo.length;

    const porUnidadeMap = new Map<string, { unidadeId: string; nome: string; total: number }>();
    for (const u of unidades) porUnidadeMap.set(u.id, { unidadeId: u.id, nome: u.nome, total: 0 });
    for (const s of todas) {
      const entrada = porUnidadeMap.get(s.unidadeId) || { unidadeId: s.unidadeId, nome: s.unidade?.nome || "—", total: 0 };
      entrada.total += 1;
      porUnidadeMap.set(s.unidadeId, entrada);
    }
    const porUnidade = Array.from(porUnidadeMap.values()).sort((a, b) => b.total - a.total);

    // Últimos 6 meses (incluindo o atual) — suficiente para o gráfico "por
    // período" sem devolver um histórico ilimitado a cada carregamento.
    const porPeriodoMap = new Map<string, number>();
    const agora = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      porPeriodoMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
    }
    for (const s of todas) {
      const chave = `${s.dataSolicitacao.getFullYear()}-${String(s.dataSolicitacao.getMonth() + 1).padStart(2, "0")}`;
      if (porPeriodoMap.has(chave)) porPeriodoMap.set(chave, (porPeriodoMap.get(chave) || 0) + 1);
    }
    const porPeriodo = Array.from(porPeriodoMap.entries()).map(([mes, total]) => ({ mes, total }));

    return reply.send({
      abertas,
      concluidas,
      urgentes,
      remessasMensaisRealizadas,
      tempoMedioAtendimentoMs,
      porUnidade,
      porPeriodo,
    });
  });
}
