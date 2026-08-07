import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { CategoriaChamado, ChamadoManutencao, Prioridade, StatusChamado, TipoSolicitacaoImoview } from "@prisma/client";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarAuditoria } from "../utils/audit";
import { nomeExibicaoUsuario } from "../utils/usuarios";
import {
  caminhoAbsolutoDoAnexo,
  caminhoParaNovoAnexo,
  MIME_TYPES_PERMITIDOS,
  removerArquivoAnexo,
  TAMANHO_MAXIMO_BYTES,
} from "../utils/anexos";
import { notificar, notificarPorPapeis } from "../utils/notificacoes.service";
import { avisarMudanca } from "../utils/realtime";

// Central de Notificações (Fase B, 09/07/2026) — quem gerencia Chamados é
// sempre ADMINISTRADOR + SUPORTE_TI (mesma dupla de requireRole em toda rota
// de escrita deste arquivo, exceto abertura/mensagem/anexo que qualquer
// autenticado com acesso ao chamado pode usar).
const PAPEIS_GERENCIAM_CHAMADO = ["ADMINISTRADOR", "SUPORTE_TI"] as const;

const STATUS_CHAMADO_LABEL_PT: Record<StatusChamado, string> = {
  ABERTO: "Aberto",
  EM_ANALISE: "Em análise",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_COLABORADOR: "Aguardando colaborador",
  AGUARDANDO_PECA: "Aguardando peça",
  RESOLVIDO: "Resolvido",
  ENCERRADO: "Encerrado",
};

const CATEGORIA_CHAMADO_LABEL_PT: Record<CategoriaChamado, string> = {
  MANUTENCAO: "Manutenção",
  SOLICITACAO_EQUIPAMENTO: "Solicitação de equipamento",
  SOFTWARE: "Software",
  HARDWARE: "Hardware",
  REDE: "Rede",
  TELEFONIA: "Telefonia",
  IMPRESSORA: "Impressora",
  ACESSOS: "Acessos",
  IMOVIEW_CRM: "Imoview CRM",
  OUTROS: "Outros",
};

const TIPO_SOLICITACAO_IMOVIEW_LABEL_PT: Record<TipoSolicitacaoImoview, string> = {
  ERRO_BUG: "Erro/Bug",
  DUVIDA: "Dúvida",
  LENTIDAO: "Lentidão",
  SOLICITACAO_ACESSO: "Solicitação de acesso",
  SOLICITACAO_MELHORIA: "Solicitação de melhoria",
  PROBLEMA_IMOVEL: "Problema relacionado a imóvel",
  OUTRO: "Outro",
};

// Resolve o Usuario do colaborador que abriu o chamado (solicitanteId é um
// id de Colaborador, não de Usuario — precisa desta ponte, mesmo padrão já
// usado em solicitacoes.routes.ts/equipamentos.routes.ts) e dispara a
// notificação pra ele. No-op silencioso se o colaborador não tem login
// (não há pra quem notificar).
async function notificarSolicitanteChamado(
  app: FastifyInstance,
  solicitanteId: string,
  input: Omit<Parameters<typeof notificar>[1], "destinatarioIds">
) {
  const solicitante = await app.prisma.colaborador.findUnique({
    where: { id: solicitanteId },
    select: { usuario: { select: { id: true } } },
  });
  if (!solicitante?.usuario) return;
  await notificar(app, { ...input, destinatarioIds: [solicitante.usuario.id] });
}

// Status "terminais" — chegar neles marca dataConclusao automaticamente,
// igual o antigo CONCLUIDO fazia. RESOLVIDO e ENCERRADO são os dois finais
// do novo conjunto (ver schema.prisma para o mapeamento completo dos status
// antigos pros novos, feito na migração da Fase 2).
const STATUS_TERMINAIS: StatusChamado[] = ["RESOLVIDO", "ENCERRADO"];

// Fase 2 — Melhorias Estruturais (09/07/2026): SLA por categoria. Baseline
// pragmático (não existe ainda uma tela de configuração fina por admin —
// fica como evolução futura se o Vini quiser ajustar por unidade/categoria
// sem alterar código). Horas úteis não são consideradas (dias corridos),
// simplificação aceitável dado o volume atual da operação.
const SLA_HORAS_POR_CATEGORIA: Record<CategoriaChamado, number> = {
  REDE: 4,
  ACESSOS: 4,
  SOFTWARE: 8,
  HARDWARE: 8,
  IMPRESSORA: 8,
  TELEFONIA: 8,
  IMOVIEW_CRM: 8,
  MANUTENCAO: 24,
  OUTROS: 24,
  SOLICITACAO_EQUIPAMENTO: 48,
};

// Prioridade ALTA reduz o prazo à metade (mínimo de 2h, pra nunca zerar);
// BAIXA dobra. MEDIA usa o valor-base da categoria sem ajuste.
function calcularSlaPrazo(categoria: CategoriaChamado, prioridade: Prioridade, dataAbertura: Date): Date {
  const base = SLA_HORAS_POR_CATEGORIA[categoria] ?? 24;
  const horas = prioridade === "ALTA" ? Math.max(2, base / 2) : prioridade === "BAIXA" ? base * 2 : base;
  return new Date(dataAbertura.getTime() + horas * 60 * 60 * 1000);
}

// unidadeId (o "local") e responsavelId (o "técnico") são obrigatórios desde
// 07/07/2026 a pedido do Vini — antes só existia o campo `local` (texto
// livre, opcional) e responsavelId só era preenchido quando alguém mexia no
// status. Agora quem abre o chamado já escolhe os dois no ato (unidadeId via
// GET /unidades, responsavelId via GET /tecnicos abaixo).
// `dataAberturaOriginal` (08/07/2026, item 1 da missão "Melhorias
// Adicionais" — Abertura de Chamados Offline): quando o chamado foi
// preenchido sem conexão e só chega ao servidor depois (ver
// src/offline/syncQueue.ts no frontend), a data/hora real da abertura é a
// que o colaborador registrou no aparelho, não o instante em que a
// sincronização finalmente aconteceu. Sem este campo, `dataAbertura`
// (default now()) registraria sempre o momento da sincronização — errado
// pra SLA e para o próprio colaborador, que abriu o chamado horas antes.
// Validação defensiva: rejeita datas no futuro (relógio do aparelho
// adiantado, ou tentativa de manipular o campo) e limita a 30 dias no
// passado — mais que suficiente para qualquer cenário real de fila offline,
// e evita que o campo vire uma forma de "backdatar" chamados arbitrariamente.
const LIMITE_RETROATIVO_DATA_ABERTURA_MS = 30 * 24 * 60 * 60 * 1000;

// Imoview CRM (09/07/2026) — campos dinâmicos condicionais, ver comentário
// em schema.prisma. `superRefine` (em vez de dois `.refine()` soltos) porque
// a mensagem de erro de cada regra precisa apontar pro campo certo
// (`tipoSolicitacaoImoview` vs `codigoImovel`) pro frontend conseguir
// destacar o campo específico, não só mostrar um erro genérico no formulário.
function validarCamposImoview(
  data: { categoria: CategoriaChamado; tipoSolicitacaoImoview?: TipoSolicitacaoImoview | null; codigoImovel?: string | null },
  ctx: z.RefinementCtx
) {
  if (data.categoria === "IMOVIEW_CRM" && !data.tipoSolicitacaoImoview) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Selecione o tipo da solicitação.",
      path: ["tipoSolicitacaoImoview"],
    });
  }
  if (data.tipoSolicitacaoImoview === "PROBLEMA_IMOVEL" && !data.codigoImovel?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o código do imóvel.",
      path: ["codigoImovel"],
    });
  }
}

const chamadoInputSchema = z
  .object({
    solicitanteId: z.string(),
    categoria: z.nativeEnum(CategoriaChamado),
    tipoSolicitacaoImoview: z.nativeEnum(TipoSolicitacaoImoview).optional().nullable(),
    codigoImovel: z.string().optional().nullable(),
    equipamentoId: z.string().optional().nullable(),
    descricao: z.string().min(3),
    unidadeId: z.string().min(1, "Selecione a unidade."),
    local: z.string().optional().nullable(),
    responsavelId: z.string().min(1, "Selecione o técnico responsável."),
    prioridade: z.nativeEnum(Prioridade).default("MEDIA"),
    fornecedorExterno: z.string().optional().nullable(),
    dataAberturaOriginal: z.coerce
      .date()
      .refine((d) => d.getTime() <= Date.now(), { message: "Data de abertura não pode estar no futuro." })
      .refine((d) => d.getTime() >= Date.now() - LIMITE_RETROATIVO_DATA_ABERTURA_MS, {
        message: "Data de abertura retroativa demais.",
      })
      .optional(),
  })
  .superRefine(validarCamposImoview);

// Atualização geral — separado do /status porque muda campos de conteúdo,
// não de fluxo. Mantido como PATCH parcial pra edição não perder outros
// campos já preenchidos (mesma convenção usada no resto do backend).
const chamadoUpdateSchema = z.object({
  categoria: z.nativeEnum(CategoriaChamado).optional(),
  tipoSolicitacaoImoview: z.nativeEnum(TipoSolicitacaoImoview).optional().nullable(),
  codigoImovel: z.string().optional().nullable(),
  equipamentoId: z.string().optional().nullable(),
  descricao: z.string().min(3).optional(),
  unidadeId: z.string().min(1).optional(),
  local: z.string().optional().nullable(),
  prioridade: z.nativeEnum(Prioridade).optional(),
  fornecedorExterno: z.string().optional().nullable(),
  valorPrevisto: z.coerce.number().min(0).optional().nullable(),
  valorFinal: z.coerce.number().min(0).optional().nullable(),
  observacoesInternas: z.string().optional().nullable(),
  solucaoAplicada: z.string().optional().nullable(),
});

const statusUpdateSchema = z.object({
  status: z.nativeEnum(StatusChamado),
  valorFinal: z.coerce.number().min(0).optional(),
});

// Não aceita mais null — desde que o técnico virou obrigatório na abertura
// (07/07/2026), "atribuir" deixou de ter um estado "sem responsável" pra
// voltar; essa rota agora serve só pra reatribuir a outro técnico.
const atribuirSchema = z.object({ responsavelId: z.string().min(1, "Selecione o técnico responsável.") });

const mensagemSchema = z.object({ mensagem: z.string().min(1) });

// Fase 2 (09/07/2026) — motivo é opcional (nem sempre há algo a acrescentar
// além de "reabrir"), mas quando preenchido vai pro evento da linha do
// tempo, pra quem administra entender o porquê sem precisar perguntar.
const reabrirSchema = z.object({ motivo: z.string().trim().min(1).optional() });

// Nota 1 a 5 (inteiro) — mesmo padrão de avaliação de atendimento usado no
// mercado (CSAT de 5 pontos), simples o bastante pra não exigir explicação
// na tela.
const avaliarSchema = z.object({
  nota: z.number().int().min(1, "A nota deve ser de 1 a 5.").max(5, "A nota deve ser de 1 a 5."),
  comentario: z.string().trim().max(2000).optional().nullable(),
});

// Campo só visível pra quem administra o chamado — nunca pro colaborador que
// abriu. Igual ao princípio já usado pra CPF de colaborador (mascarado na
// API, não só escondido na tela).
function paraResposta(chamado: ChamadoManutencao, papel: string) {
  if (papel === "COLABORADOR") {
    const { observacoesInternas, ...resto } = chamado;
    return resto;
  }
  return chamado;
}

// Achado do Vini (07/07/2026): o seletor "Técnico responsável" (e a exibição
// no detalhe do chamado) mostrava o e-mail — ninguém reconhece colega pelo
// e-mail de cabeça. Acopla o nome de exibição (ver utils/usuarios.ts) no
// campo `responsavel` já incluído na consulta, sem duplicar rota nem forçar
// o front a conhecer a relação aninhada com Colaborador.
function comNomeResponsavel<
  T extends { responsavel?: { id: string; email: string; colaborador?: { nomeCompleto: string } | null } | null }
>(chamado: T) {
  if (!chamado.responsavel) return chamado;
  const { colaborador, ...responsavel } = chamado.responsavel;
  return { ...chamado, responsavel: { ...responsavel, nome: nomeExibicaoUsuario(chamado.responsavel) } };
}

function tempoAtendimentoMs(chamado: Pick<ChamadoManutencao, "dataAbertura" | "dataConclusao">) {
  if (!chamado.dataConclusao) return null;
  return chamado.dataConclusao.getTime() - chamado.dataAbertura.getTime();
}

function podeVerChamado(
  chamado: { solicitanteId: string },
  user: { papel: string; colaboradorId: string | null }
) {
  if (user.papel === "COLABORADOR") return chamado.solicitanteId === user.colaboradorId;
  return true;
}

export default async function chamadosRoutes(app: FastifyInstance) {
  // Lista de quem pode ser atribuído como responsável por um chamado/
  // solicitação — usada pelo seletor "Atribuir técnico" (admin) e também
  // pelo formulário de autoatendimento do Portal do Colaborador (07/07/2026:
  // escolher o técnico virou obrigatório já na abertura, então qualquer
  // colaborador autenticado precisa conseguir ler esta lista, não só
  // ADMINISTRADOR/SUPORTE_TI — por isso sem requireRole aqui, só
  // autenticação. Só expõe id/nome (de exibição)/email/papel, nada sensível).
  // Reaproveita o Usuario/Papel que já existe (em vez de criar uma entidade
  // Técnico separada), preparado pra Fase 3 (Portal do Suporte de TI,
  // múltiplos técnicos).
  //
  // Achado do Vini (07/07/2026, tarde): contas puramente administrativas
  // (ex: admin@administrarimoveis.com.br, sem Colaborador vinculado — só
  // existe pra login/gestão do sistema) não deveriam aparecer como opção de
  // técnico pra atribuir chamado/solicitação. `colaboradorId: { not: null }`
  // filtra exatamente isso: só entra na lista quem é uma pessoa real da
  // equipe, com cadastro de colaborador — não qualquer usuário com papel
  // ADMINISTRADOR/SUPORTE_TI.
  app.get("/tecnicos", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const tecnicosBrutos = await app.prisma.usuario.findMany({
      where: { papel: { in: ["ADMINISTRADOR", "SUPORTE_TI"] }, ativo: true, colaboradorId: { not: null } },
      select: { id: true, email: true, papel: true, colaborador: { select: { nomeCompleto: true } } },
    });
    // Ordena pelo nome de exibição (não pelo e-mail) — é o que aparece no
    // seletor, faz sentido a lista já vir alfabética por ele.
    const tecnicos = tecnicosBrutos
      .map((t) => ({ id: t.id, email: t.email, papel: t.papel, nome: nomeExibicaoUsuario(t) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return reply.send(tecnicos);
  });

  app.get("/chamados-manutencao", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = paginationSchema
      .extend({
        status: z.nativeEnum(StatusChamado).optional(),
        categoria: z.nativeEnum(CategoriaChamado).optional(),
        prioridade: z.nativeEnum(Prioridade).optional(),
        responsavelId: z.string().optional(),
        unidadeId: z.string().optional(),
      })
      .parse(request.query);
    const { skip, take } = toSkipTake(query);

    const escopoColaborador =
      request.user.papel === "COLABORADOR" && request.user.colaboradorId
        ? { solicitanteId: request.user.colaboradorId }
        : {};

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoria ? { categoria: query.categoria } : {}),
      ...(query.prioridade ? { prioridade: query.prioridade } : {}),
      ...(query.responsavelId ? { responsavelId: query.responsavelId } : {}),
      ...(query.unidadeId ? { unidadeId: query.unidadeId } : {}),
      ...escopoColaborador,
    };

    const [items, total] = await Promise.all([
      app.prisma.chamadoManutencao.findMany({
        where,
        skip,
        take,
        orderBy: { dataAbertura: "desc" },
        include: {
          solicitante: { select: { id: true, nomeCompleto: true } },
          equipamento: true,
          responsavel: { select: { id: true, email: true, colaborador: { select: { nomeCompleto: true } } } },
          unidade: { select: { id: true, nome: true } },
        },
      }),
      app.prisma.chamadoManutencao.count({ where }),
    ]);

    const itemsComTempo = items.map((c) => ({
      ...paraResposta(comNomeResponsavel(c), request.user.papel),
      tempoAtendimentoMs: tempoAtendimentoMs(c),
    }));

    return reply.send(paginatedResponse(itemsComTempo, total, query));
  });

  app.get("/chamados-manutencao/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const chamado = await app.prisma.chamadoManutencao.findUnique({
      where: { id },
      include: {
        solicitante: { select: { id: true, nomeCompleto: true } },
        equipamento: true,
        responsavel: { select: { id: true, email: true, colaborador: { select: { nomeCompleto: true } } } },
        unidade: { select: { id: true, nome: true } },
        eventos: {
          orderBy: { criadoEm: "asc" },
          include: { autor: { select: { id: true, email: true, papel: true } } },
        },
      },
    });
    if (!chamado) return reply.code(404).send({ error: "Chamado não encontrado." });
    if (!podeVerChamado(chamado, request.user)) {
      return reply.code(403).send({ error: "Você não tem acesso a este chamado." });
    }

    return reply.send({
      ...paraResposta(comNomeResponsavel(chamado), request.user.papel),
      tempoAtendimentoMs: tempoAtendimentoMs(chamado),
    });
  });

  // Dashboard de indicadores de suporte (Fase 2, 09/07/2026) — restrito a
  // quem gerencia Chamados, mesma dupla ADMINISTRADOR/SUPORTE_TI de toda
  // rota de gestão deste módulo. `dias` filtra por dataAbertura (padrão: sem
  // filtro, olha o histórico inteiro) — combinado com `desde` explícito no
  // retorno pra a tela deixar claro qual período está sendo mostrado.
  // Cálculo feito em JS sobre um único findMany (em vez de vários groupBy)
  // porque a maioria dos números abaixo (tempo médio, taxa de reabertura,
  // nota média, atrasados) não são group-by simples — e o volume atual de
  // chamados da empresa é pequeno o bastante pra isso ser instantâneo sem
  // precisar de agregação no banco.
  app.get(
    "/chamados-manutencao/stats",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM_CHAMADO)] },
    async (request, reply) => {
      const query = z.object({ dias: z.coerce.number().int().positive().max(3650).optional() }).parse(request.query);
      const desde = query.dias ? new Date(Date.now() - query.dias * 24 * 60 * 60 * 1000) : undefined;
      const where = desde ? { dataAbertura: { gte: desde } } : {};

      const chamados = await app.prisma.chamadoManutencao.findMany({
        where,
        select: {
          status: true,
          categoria: true,
          prioridade: true,
          dataAbertura: true,
          dataConclusao: true,
          slaPrazo: true,
          reaberturas: true,
          avaliacaoNota: true,
          responsavelId: true,
          responsavel: { select: { id: true, email: true, colaborador: { select: { nomeCompleto: true } } } },
          unidadeId: true,
          unidade: { select: { id: true, nome: true } },
        },
      });

      const agora = Date.now();
      const porStatus: Partial<Record<StatusChamado, number>> = {};
      const porCategoria: Partial<Record<CategoriaChamado, number>> = {};
      const porUnidade = new Map<string, { unidadeId: string; nome: string; total: number }>();
      const porTecnico = new Map<
        string,
        { responsavelId: string; nome: string; total: number; somaResolucaoMs: number; qtdResolvidos: number }
      >();
      let chamadosAtrasados = 0;
      let terminaisComReabertura = 0;
      let totalTerminais = 0;
      let somaResolucaoMs = 0;
      let qtdResolvidos = 0;
      const distribuicaoNotas: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let somaNotas = 0;
      let qtdAvaliados = 0;

      for (const c of chamados) {
        porStatus[c.status] = (porStatus[c.status] ?? 0) + 1;
        porCategoria[c.categoria] = (porCategoria[c.categoria] ?? 0) + 1;

        const unidadeAtual = porUnidade.get(c.unidadeId) ?? { unidadeId: c.unidadeId, nome: c.unidade.nome, total: 0 };
        unidadeAtual.total += 1;
        porUnidade.set(c.unidadeId, unidadeAtual);

        if (c.responsavelId) {
          const nomeTecnico = c.responsavel ? nomeExibicaoUsuario(c.responsavel) : "—";
          const tecnicoAtual = porTecnico.get(c.responsavelId) ?? {
            responsavelId: c.responsavelId,
            nome: nomeTecnico,
            total: 0,
            somaResolucaoMs: 0,
            qtdResolvidos: 0,
          };
          tecnicoAtual.total += 1;
          if (c.dataConclusao) {
            tecnicoAtual.somaResolucaoMs += c.dataConclusao.getTime() - c.dataAbertura.getTime();
            tecnicoAtual.qtdResolvidos += 1;
          }
          porTecnico.set(c.responsavelId, tecnicoAtual);
        }

        const ehTerminal = STATUS_TERMINAIS.includes(c.status);
        if (ehTerminal) {
          totalTerminais += 1;
          if (c.reaberturas > 0) terminaisComReabertura += 1;
        }
        if (c.dataConclusao) {
          somaResolucaoMs += c.dataConclusao.getTime() - c.dataAbertura.getTime();
          qtdResolvidos += 1;
        }
        if (!ehTerminal && c.slaPrazo && c.slaPrazo.getTime() < agora) {
          chamadosAtrasados += 1;
        }
        if (c.avaliacaoNota) {
          somaNotas += c.avaliacaoNota;
          qtdAvaliados += 1;
          distribuicaoNotas[c.avaliacaoNota as 1 | 2 | 3 | 4 | 5] += 1;
        }
      }

      return reply.send({
        periodo: { dias: query.dias ?? null, desde: desde?.toISOString() ?? null },
        totalChamados: chamados.length,
        porStatus,
        porCategoria,
        porUnidade: Array.from(porUnidade.values()).sort((a, b) => b.total - a.total),
        porTecnico: Array.from(porTecnico.values())
          .map((t) => ({
            responsavelId: t.responsavelId,
            nome: t.nome,
            total: t.total,
            tempoMedioResolucaoMs: t.qtdResolvidos > 0 ? Math.round(t.somaResolucaoMs / t.qtdResolvidos) : null,
          }))
          .sort((a, b) => b.total - a.total),
        tempoMedioResolucaoMs: qtdResolvidos > 0 ? Math.round(somaResolucaoMs / qtdResolvidos) : null,
        chamadosAtrasados,
        taxaReaberturaPct: totalTerminais > 0 ? Math.round((terminaisComReabertura / totalTerminais) * 1000) / 10 : 0,
        avaliacao: {
          media: qtdAvaliados > 0 ? Math.round((somaNotas / qtdAvaliados) * 10) / 10 : null,
          totalAvaliados: qtdAvaliados,
          distribuicao: distribuicaoNotas,
        },
      });
    }
  );

  app.post("/chamados-manutencao", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = chamadoInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
    }
    if (request.user.papel === "COLABORADOR" && parsed.data.solicitanteId !== request.user.colaboradorId) {
      return reply.code(403).send({ error: "Você só pode abrir chamados em seu próprio nome." });
    }

    // Equipamento vinculado só pode ser um dos do PRÓPRIO solicitante
    // (07/08/2026, pedido do Vini) — o seletor no frontend já filtra assim
    // pra quem é COLABORADOR, mas a checagem de verdade é sempre aqui: sem
    // ela, uma chamada de API direta (fora da tela) poderia vincular
    // qualquer equipamento da empresa a um chamado aberto em nome de outra
    // pessoa. ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI continuam podendo
    // vincular qualquer equipamento (é comum abrir chamado sobre um
    // equipamento de outra pessoa/setor).
    if (parsed.data.equipamentoId && request.user.papel === "COLABORADOR") {
      const equipamentoDoSolicitante = await app.prisma.equipamento.findFirst({
        where: { id: parsed.data.equipamentoId, colaboradorId: parsed.data.solicitanteId },
        select: { id: true },
      });
      if (!equipamentoDoSolicitante) {
        return reply.code(403).send({ error: "Só é possível vincular um equipamento que esteja em seu próprio nome." });
      }
    }

    // `dataAberturaOriginal` some do objeto antes de virar `data` do Prisma
    // (não é uma coluna com esse nome) — quando presente, sobrescreve
    // dataAbertura; do contrário o default now() do schema segue valendo,
    // igual sempre foi.
    const { dataAberturaOriginal, ...dadosChamado } = parsed.data;
    const sincronizadoOffline = !!dataAberturaOriginal;
    const dataAberturaEfetiva = dataAberturaOriginal ?? new Date();

    const chamado = await app.prisma.$transaction(async (tx) => {
      const criado = await tx.chamadoManutencao.create({
        data: {
          ...dadosChamado,
          status: "ABERTO",
          ...(dataAberturaOriginal ? { dataAbertura: dataAberturaOriginal } : {}),
          // Fase 2 (09/07/2026) — SLA calculado já na abertura, ver
          // calcularSlaPrazo acima.
          slaPrazo: calcularSlaPrazo(dadosChamado.categoria, dadosChamado.prioridade, dataAberturaEfetiva),
        },
      });
      await tx.chamadoEvento.create({
        data: {
          chamadoId: criado.id,
          tipo: "ABERTURA",
          autorId: request.user.sub,
          // Rastro explícito de que este chamado passou pela fila offline —
          // útil pra quem administra entender por que dataAbertura e
          // criadoEm divergem bastante num caso específico, em vez de
          // parecer inconsistência de dados.
          ...(sincronizadoOffline ? { detalhe: { sincronizadoOffline: true } } : {}),
        },
      });

      // Automação de status do equipamento (21/07/2026, pedido do Vini:
      // "quando tiver uma manutenção ou chamado relacionado ao equipamento
      // aberto, ficar no status de em manutenção, deixar esta parte toda
      // automatizada") — `updateMany` com o filtro de status embutido (em
      // vez de update + checagem separada) evita "ressuscitar" um
      // equipamento já BAIXADO/PERDIDO/DESCARTADO só porque alguém abriu um
      // chamado contra ele por engano; nesses casos o status não muda.
      if (dadosChamado.equipamentoId) {
        await tx.equipamento.updateMany({
          where: { id: dadosChamado.equipamentoId, status: { notIn: ["BAIXADO", "PERDIDO", "DESCARTADO"] } },
          data: { status: "EM_MANUTENCAO" },
        });
      }

      return criado;
    });

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: sincronizadoOffline ? "CRIAR_SINCRONIZADO_OFFLINE" : "CRIAR",
      entidade: "ChamadoManutencao",
      entidadeId: chamado.id,
      ip: request.ip,
    });

    // Central de Notificações (Fase B, 09/07/2026).
    await notificarPorPapeis(app, [...PAPEIS_GERENCIAM_CHAMADO], {
      categoria: "CHAMADO",
      tipo: "CHAMADO_ABERTO",
      titulo: `Novo chamado #${chamado.numero} — ${CATEGORIA_CHAMADO_LABEL_PT[chamado.categoria]}`,
      mensagem: chamado.descricao.length > 140 ? `${chamado.descricao.slice(0, 140)}…` : chamado.descricao,
      prioridade: chamado.prioridade,
      entidade: "ChamadoManutencao",
      entidadeId: chamado.id,
      origemUsuarioId: request.user.sub,
    });
    // Tipo dedicado além do ABERTO acima, só quando já nasce prioridade
    // ALTA — dá pra quem gerencia filtrar/priorizar sem abrir cada chamado.
    if (chamado.prioridade === "ALTA") {
      await notificarPorPapeis(app, [...PAPEIS_GERENCIAM_CHAMADO], {
        categoria: "CHAMADO",
        tipo: "CHAMADO_PRIORIDADE_ALTA",
        titulo: `Chamado #${chamado.numero} é prioridade ALTA`,
        mensagem: `${CATEGORIA_CHAMADO_LABEL_PT[chamado.categoria]}: ${chamado.descricao.length > 140 ? `${chamado.descricao.slice(0, 140)}…` : chamado.descricao}`,
        prioridade: "ALTA",
        entidade: "ChamadoManutencao",
        entidadeId: chamado.id,
        origemUsuarioId: request.user.sub,
      });
    }

    avisarMudanca("chamados", ...(dadosChamado.equipamentoId ? (["equipamentos"] as const) : []));

    return reply.code(201).send(chamado);
  });

  app.patch(
    "/chamados-manutencao/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = chamadoUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      const anterior = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
      if (!anterior) return reply.code(404).send({ error: "Chamado não encontrado." });

      // Imoview CRM (09/07/2026) — PATCH é parcial (só os campos enviados),
      // então a validação de "categoria exige tipo" / "tipo PROBLEMA_IMOVEL
      // exige código" precisa considerar o valor JÁ SALVO de cada campo
      // quando ele não vem nesta requisição específica — ao contrário do
      // POST de abertura (chamadoInputSchema acima), que sempre valida o
      // objeto inteiro de uma vez.
      const categoriaEfetiva = parsed.data.categoria ?? anterior.categoria;
      const tipoEfetivo = "tipoSolicitacaoImoview" in parsed.data ? parsed.data.tipoSolicitacaoImoview : anterior.tipoSolicitacaoImoview;
      const codigoEfetivo = "codigoImovel" in parsed.data ? parsed.data.codigoImovel : anterior.codigoImovel;
      if (categoriaEfetiva === "IMOVIEW_CRM" && !tipoEfetivo) {
        return reply.code(400).send({ error: "Selecione o tipo da solicitação.", detalhes: { fieldErrors: { tipoSolicitacaoImoview: ["Selecione o tipo da solicitação."] } } });
      }
      if (tipoEfetivo === "PROBLEMA_IMOVEL" && !codigoEfetivo?.trim()) {
        return reply.code(400).send({ error: "Informe o código do imóvel.", detalhes: { fieldErrors: { codigoImovel: ["Informe o código do imóvel."] } } });
      }

      // Fase 2 (09/07/2026): categoria e/ou prioridade mudando recalcula o
      // prazo de SLA a partir da data de abertura original — mas só enquanto
      // o chamado ainda está em andamento; depois de RESOLVIDO/ENCERRADO o
      // prazo já cumpriu seu papel (indicador histórico), editar categoria
      // numa edição tardia não deveria mexer nele.
      const dadosParaSalvar: typeof parsed.data & { slaPrazo?: Date } = { ...parsed.data };
      if ((parsed.data.categoria || parsed.data.prioridade) && !STATUS_TERMINAIS.includes(anterior.status)) {
        const prioridadeEfetiva = parsed.data.prioridade ?? anterior.prioridade;
        dadosParaSalvar.slaPrazo = calcularSlaPrazo(categoriaEfetiva, prioridadeEfetiva, anterior.dataAbertura);
      }

      const chamado = await app.prisma.$transaction(async (tx) => {
        const atualizado = await tx.chamadoManutencao.update({ where: { id }, data: dadosParaSalvar });
        await tx.chamadoEvento.create({
          data: {
            chamadoId: id,
            tipo: "ATUALIZACAO",
            autorId: request.user.sub,
            detalhe: { camposAlterados: Object.keys(parsed.data) },
          },
        });
        return atualizado;
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ATUALIZAR",
        entidade: "ChamadoManutencao",
        entidadeId: id,
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — só quando a
      // prioridade MUDA pra ALTA agora (não em toda edição, nem se já era
      // ALTA antes e continua sendo).
      if (chamado.prioridade === "ALTA" && anterior.prioridade !== "ALTA") {
        await notificarPorPapeis(app, [...PAPEIS_GERENCIAM_CHAMADO], {
          categoria: "CHAMADO",
          tipo: "CHAMADO_PRIORIDADE_ALTA",
          titulo: `Chamado #${chamado.numero} virou prioridade ALTA`,
          mensagem: `${CATEGORIA_CHAMADO_LABEL_PT[chamado.categoria]} — reclassificado para prioridade ALTA.`,
          prioridade: "ALTA",
          entidade: "ChamadoManutencao",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      }

      avisarMudanca("chamados");

      return reply.send(chamado);
    }
  );

  app.patch(
    "/chamados-manutencao/:id/status",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = statusUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }

      const anterior = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
      if (!anterior) return reply.code(404).send({ error: "Chamado não encontrado." });

      const concluindo = STATUS_TERMINAIS.includes(parsed.data.status);

      const chamado = await app.prisma.$transaction(async (tx) => {
        const atualizado = await tx.chamadoManutencao.update({
          where: { id },
          data: {
            status: parsed.data.status,
            // Achado de auditoria (10/07/2026, Ciclo de Evolução Contínua):
            // este update sobrescrevia responsavelId com quem clicou a
            // mudança de status — resquício do fluxo ANTIGO descrito no
            // comentário acima (linhas 109-113), de antes de responsavelId
            // virar obrigatório na abertura e ganhar rota própria de
            // atribuição (/atribuir, logo abaixo). Na prática, um gestor
            // arrastando um card no Kanban "roubava" o chamado do técnico
            // de verdade sem querer, corrompendo estatística por técnico e
            // o filtro "atribuídos a mim" do Portal de Suporte. Mudar
            // responsável agora só acontece via /atribuir, de propósito.
            valorFinal: parsed.data.valorFinal,
            dataConclusao: concluindo ? new Date() : null,
          },
        });
        await tx.chamadoEvento.create({
          data: {
            chamadoId: id,
            tipo: "MUDANCA_STATUS",
            autorId: request.user.sub,
            detalhe: { de: anterior.status, para: parsed.data.status },
          },
        });

        // Automação de status do equipamento (21/07/2026, pedido do Vini) —
        // ao concluir (RESOLVIDO/ENCERRADO) um chamado vinculado a um
        // equipamento, tira ele de EM_MANUTENCAO. Duas guardas antes de
        // mexer: (1) o status atual do equipamento ainda precisa ser
        // EM_MANUTENCAO — se foi trocado manualmente nesse meio tempo (ex:
        // BAIXADO), a automação respeita a decisão manual e não sobrescreve;
        // (2) não pode existir NENHUM outro chamado aberto pro mesmo
        // equipamento — senão reverteria o status enquanto outro chamado
        // ainda está em andamento. Volta pra EM_USO se o equipamento tem
        // dono atual, ou DISPONIVEL se está em estoque.
        if (concluindo && anterior.equipamentoId) {
          const [equipamentoAtual, outroChamadoAberto] = await Promise.all([
            tx.equipamento.findUnique({ where: { id: anterior.equipamentoId } }),
            tx.chamadoManutencao.findFirst({
              where: { equipamentoId: anterior.equipamentoId, id: { not: id }, status: { notIn: STATUS_TERMINAIS } },
            }),
          ]);
          if (equipamentoAtual?.status === "EM_MANUTENCAO" && !outroChamadoAberto) {
            await tx.equipamento.update({
              where: { id: anterior.equipamentoId },
              data: { status: equipamentoAtual.colaboradorId ? "EM_USO" : "DISPONIVEL" },
            });
          }
        }

        return atualizado;
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: `STATUS_${parsed.data.status}`,
        entidade: "ChamadoManutencao",
        entidadeId: id,
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — avisa quem abriu o
      // chamado (se tiver login) que o status mudou; RESOLVIDO usa o tipo
      // dedicado (é a notícia que a pessoa está esperando), os demais usam
      // o tipo genérico de mudança de status.
      await notificarSolicitanteChamado(app, anterior.solicitanteId, {
        categoria: "CHAMADO",
        tipo: parsed.data.status === "RESOLVIDO" ? "CHAMADO_RESOLVIDO" : "CHAMADO_STATUS_MUDOU",
        titulo: `Chamado #${anterior.numero} — ${STATUS_CHAMADO_LABEL_PT[parsed.data.status]}`,
        mensagem: `Seu chamado #${anterior.numero} agora está: ${STATUS_CHAMADO_LABEL_PT[parsed.data.status]}.`,
        entidade: "ChamadoManutencao",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });

      avisarMudanca("chamados", ...(anterior.equipamentoId ? (["equipamentos"] as const) : []));

      return reply.send(chamado);
    }
  );

  // Atribuição de técnico responsável — separada do /status porque, ao
  // contrário do fluxo antigo (que só marcava responsavelId de quem mexeu no
  // status por último), agora dá pra atribuir sem necessariamente mudar o
  // status, preparando terreno pro Portal do Suporte de TI (Fase 3).
  app.patch(
    "/chamados-manutencao/:id/atribuir",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR", "SUPORTE_TI")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = atribuirSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      const anterior = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
      if (!anterior) return reply.code(404).send({ error: "Chamado não encontrado." });

      const chamado = await app.prisma.$transaction(async (tx) => {
        const atualizado = await tx.chamadoManutencao.update({
          where: { id },
          data: { responsavelId: parsed.data.responsavelId },
        });
        await tx.chamadoEvento.create({
          data: {
            chamadoId: id,
            tipo: "ATRIBUICAO",
            autorId: request.user.sub,
            detalhe: { de: anterior.responsavelId, para: parsed.data.responsavelId },
          },
        });
        return atualizado;
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ATRIBUIR_RESPONSAVEL",
        entidade: "ChamadoManutencao",
        entidadeId: id,
        ip: request.ip,
      });

      // Central de Notificações (Fase B, 09/07/2026) — avisa o técnico
      // recém-atribuído (não dispara nada se ele estiver se autoatribuindo).
      await notificar(app, {
        destinatarioIds: [parsed.data.responsavelId],
        categoria: "CHAMADO",
        tipo: "CHAMADO_ATRIBUIDO",
        titulo: `Chamado #${anterior.numero} atribuído a você`,
        mensagem: `${CATEGORIA_CHAMADO_LABEL_PT[anterior.categoria]} — ${STATUS_CHAMADO_LABEL_PT[anterior.status]}.`,
        entidade: "ChamadoManutencao",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });

      avisarMudanca("chamados");

      return reply.send(chamado);
    }
  );

  // Reabertura (Fase 2, 09/07/2026) — só faz sentido a partir de um status
  // terminal (RESOLVIDO/ENCERRADO); reabrir um chamado que já está em
  // andamento não tem efeito nenhum, então é rejeitado explicitamente em vez
  // de virar um no-op silencioso. Quem pode reabrir: quem administra o
  // módulo, ou o próprio colaborador que abriu o chamado (ele é quem sabe se
  // o problema realmente foi resolvido) — mesmo espírito de podeVerChamado,
  // só que mais restrito (não basta "ver", precisa ser o dono ou gerenciar).
  app.patch("/chamados-manutencao/:id/reabrir", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = reabrirSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
    }
    const anterior = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
    if (!anterior) return reply.code(404).send({ error: "Chamado não encontrado." });

    const ehGestor = (PAPEIS_GERENCIAM_CHAMADO as readonly string[]).includes(request.user.papel);
    const ehSolicitante = request.user.papel === "COLABORADOR" && anterior.solicitanteId === request.user.colaboradorId;
    if (!ehGestor && !ehSolicitante) {
      return reply.code(403).send({ error: "Você não pode reabrir este chamado." });
    }
    if (!STATUS_TERMINAIS.includes(anterior.status)) {
      return reply.code(400).send({ error: "Só é possível reabrir um chamado resolvido ou encerrado." });
    }

    const chamado = await app.prisma.$transaction(async (tx) => {
      const atualizado = await tx.chamadoManutencao.update({
        where: { id },
        data: {
          status: "ABERTO",
          dataConclusao: null,
          reaberturas: { increment: 1 },
          // Prazo de SLA reinicia a partir de agora — o chamado está,
          // efetivamente, começando de novo.
          slaPrazo: calcularSlaPrazo(anterior.categoria, anterior.prioridade, new Date()),
        },
      });
      await tx.chamadoEvento.create({
        data: {
          chamadoId: id,
          tipo: "REABERTURA",
          autorId: request.user.sub,
          ...(parsed.data.motivo ? { detalhe: { motivo: parsed.data.motivo } } : {}),
        },
      });
      return atualizado;
    });

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "REABRIR",
      entidade: "ChamadoManutencao",
      entidadeId: id,
      ip: request.ip,
    });

    // Central de Notificações — avisa "o outro lado": se foi o colaborador
    // que reabriu, avisa quem gerencia + o técnico já atribuído; se foi
    // gestão que reabriu, avisa o colaborador (se tiver login).
    if (ehSolicitante) {
      await notificarPorPapeis(
        app,
        [...PAPEIS_GERENCIAM_CHAMADO],
        {
          categoria: "CHAMADO",
          tipo: "CHAMADO_REABERTO",
          titulo: `Chamado #${anterior.numero} foi reaberto`,
          mensagem: parsed.data.motivo || `${CATEGORIA_CHAMADO_LABEL_PT[anterior.categoria]} — reaberto pelo solicitante.`,
          prioridade: anterior.prioridade,
          entidade: "ChamadoManutencao",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        },
        anterior.responsavelId ? [anterior.responsavelId] : []
      );
    } else {
      await notificarSolicitanteChamado(app, anterior.solicitanteId, {
        categoria: "CHAMADO",
        tipo: "CHAMADO_REABERTO",
        titulo: `Chamado #${anterior.numero} foi reaberto`,
        mensagem: parsed.data.motivo || `Seu chamado #${anterior.numero} foi reaberto pelo suporte.`,
        entidade: "ChamadoManutencao",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });
    }

    avisarMudanca("chamados");

    return reply.send(chamado);
  });

  // Avaliação pós-atendimento (Fase 2, 09/07/2026) — só o colaborador que
  // abriu o chamado avalia (é a experiência dele que está sendo medida), e
  // só depois que o chamado chega a um status terminal (não faz sentido
  // avaliar um atendimento que ainda está em andamento). Sobrescreve a nota
  // anterior se houver (não acumula histórico de notas no chamado — o
  // histórico completo de cada avaliação enviada já fica preservado na
  // linha do tempo via ChamadoEvento).
  app.patch("/chamados-manutencao/:id/avaliar", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = avaliarSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
    }
    const anterior = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
    if (!anterior) return reply.code(404).send({ error: "Chamado não encontrado." });

    if (request.user.papel !== "COLABORADOR" || anterior.solicitanteId !== request.user.colaboradorId) {
      return reply.code(403).send({ error: "Só quem abriu o chamado pode avaliar o atendimento." });
    }
    if (!STATUS_TERMINAIS.includes(anterior.status)) {
      return reply.code(400).send({ error: "Só é possível avaliar um chamado depois que ele for resolvido ou encerrado." });
    }

    const chamado = await app.prisma.$transaction(async (tx) => {
      const atualizado = await tx.chamadoManutencao.update({
        where: { id },
        data: {
          avaliacaoNota: parsed.data.nota,
          avaliacaoComentario: parsed.data.comentario || null,
          avaliadoEm: new Date(),
        },
      });
      await tx.chamadoEvento.create({
        data: {
          chamadoId: id,
          tipo: "AVALIACAO",
          autorId: request.user.sub,
          detalhe: { nota: parsed.data.nota, comentario: parsed.data.comentario || null },
        },
      });
      return atualizado;
    });

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "AVALIAR",
      entidade: "ChamadoManutencao",
      entidadeId: id,
      detalhe: { nota: parsed.data.nota },
      ip: request.ip,
    });

    // Nota baixa (1 ou 2) merece atenção de quem gerencia — não trava nada,
    // só sinaliza pra alguém olhar o caso.
    if (parsed.data.nota <= 2) {
      await notificarPorPapeis(app, [...PAPEIS_GERENCIAM_CHAMADO], {
        categoria: "CHAMADO",
        tipo: "CHAMADO_AVALIACAO_BAIXA",
        titulo: `Chamado #${anterior.numero} recebeu avaliação baixa (${parsed.data.nota}/5)`,
        mensagem: parsed.data.comentario || "O colaborador não deixou comentário.",
        prioridade: "ALTA",
        entidade: "ChamadoManutencao",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });
    }

    return reply.send(chamado);
  });

  // Chat colaborador↔suporte — qualquer um dos dois lados pode escrever,
  // desde que tenha acesso de leitura ao chamado (mesma regra do GET /:id).
  app.post("/chamados-manutencao/:id/mensagens", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = mensagemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
    }
    const chamado = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
    if (!chamado) return reply.code(404).send({ error: "Chamado não encontrado." });
    if (!podeVerChamado(chamado, request.user)) {
      return reply.code(403).send({ error: "Você não tem acesso a este chamado." });
    }

    const evento = await app.prisma.chamadoEvento.create({
      data: {
        chamadoId: id,
        tipo: "MENSAGEM",
        autorId: request.user.sub,
        mensagem: parsed.data.mensagem,
      },
      include: { autor: { select: { id: true, email: true, papel: true } } },
    });

    // Central de Notificações (Fase B, 09/07/2026) — avisa "o outro lado" da
    // conversa: se quem escreveu foi o colaborador que abriu o chamado,
    // avisa quem gerencia + o técnico já atribuído (se houver); se foi
    // alguém do suporte, avisa só o colaborador (se ele tiver login).
    const preview = parsed.data.mensagem.length > 140 ? `${parsed.data.mensagem.slice(0, 140)}…` : parsed.data.mensagem;
    if (request.user.papel === "COLABORADOR") {
      await notificarPorPapeis(
        app,
        [...PAPEIS_GERENCIAM_CHAMADO],
        {
          categoria: "CHAMADO",
          tipo: "CHAMADO_MENSAGEM_NOVA",
          titulo: `Nova mensagem no chamado #${chamado.numero}`,
          mensagem: preview,
          entidade: "ChamadoManutencao",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        },
        chamado.responsavelId ? [chamado.responsavelId] : []
      );
    } else {
      await notificarSolicitanteChamado(app, chamado.solicitanteId, {
        categoria: "CHAMADO",
        tipo: "CHAMADO_MENSAGEM_NOVA",
        titulo: `Nova mensagem no seu chamado #${chamado.numero}`,
        mensagem: preview,
        entidade: "ChamadoManutencao",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });
    }

    return reply.code(201).send(evento);
  });

  // Upload de anexo (Fase de armazenamento decidida em 06/07/2026 — Railway
  // Volume, ver comentário em schema.prisma). Mesma regra de visibilidade da
  // rota de mensagens: qualquer lado que já pode ver o chamado pode anexar
  // (colaborador anexando foto do problema, suporte anexando comprovante).
  // O anexo entra na própria linha do tempo como um ChamadoEvento tipo
  // ANEXO — não existe uma tabela separada de anexo, de propósito (ver nota
  // no schema, anexoUrl/detalhe já existiam preparados pra isso).
  app.post("/chamados-manutencao/:id/anexos", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const chamado = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
    if (!chamado) return reply.code(404).send({ error: "Chamado não encontrado." });
    if (!podeVerChamado(chamado, request.user)) {
      return reply.code(403).send({ error: "Você não tem acesso a este chamado." });
    }

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Nenhum arquivo enviado." });

    if (!MIME_TYPES_PERMITIDOS.has(file.mimetype)) {
      // Ainda precisa drenar o stream mesmo rejeitando, senão a conexão
      // trava esperando o corpo ser consumido.
      await file.file.resume();
      return reply.code(400).send({
        error: "Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou PDF.",
      });
    }

    const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(id, file.filename);
    await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });

    try {
      await pipeline(file.file, fs.createWriteStream(caminhoAbsoluto));
    } catch (err) {
      await fs.promises.rm(caminhoAbsoluto, { force: true });
      throw err;
    }

    const { size: tamanhoBytes } = await fs.promises.stat(caminhoAbsoluto);

    // Checagem explícita pós-gravação, não só o `truncated` do busboy: desde
    // 08/07/2026 o teto do parser multipart (server.ts) é compartilhado com
    // o anexo de mensagem (20MB), maior que o limite próprio de chamado
    // (10MB) — sem isso, um arquivo entre 10MB e 20MB passaria batido aqui.
    if (file.file.truncated || tamanhoBytes > TAMANHO_MAXIMO_BYTES) {
      await fs.promises.rm(caminhoAbsoluto, { force: true });
      return reply.code(413).send({
        error: `Arquivo excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)}MB).`,
      });
    }

    const evento = await app.prisma.chamadoEvento.create({
      data: {
        chamadoId: id,
        tipo: "ANEXO",
        autorId: request.user.sub,
        anexoUrl: caminhoRelativo,
        detalhe: {
          nomeArquivoOriginal: file.filename,
          mimeType: file.mimetype,
          tamanhoBytes,
        },
      },
      include: { autor: { select: { id: true, email: true, papel: true } } },
    });

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "ANEXAR_ARQUIVO",
      entidade: "ChamadoManutencao",
      entidadeId: id,
      detalhe: { nomeArquivoOriginal: file.filename, tamanhoBytes },
      ip: request.ip,
    });

    return reply.code(201).send(evento);
  });

  // Download do anexo — sempre passa por aqui (nunca é servido como arquivo
  // estático público), porque é assim que o anexo continua respeitando a
  // mesma regra de acesso do chamado sem precisar de URL assinada com
  // expiração: quem não tem podeVerChamado nem chega a saber se o arquivo
  // existe.
  app.get(
    "/chamados-manutencao/:id/eventos/:eventoId/anexo",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, eventoId } = request.params as { id: string; eventoId: string };
      const chamado = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
      if (!chamado) return reply.code(404).send({ error: "Chamado não encontrado." });
      if (!podeVerChamado(chamado, request.user)) {
        return reply.code(403).send({ error: "Você não tem acesso a este chamado." });
      }

      const evento = await app.prisma.chamadoEvento.findUnique({ where: { id: eventoId } });
      if (!evento || evento.chamadoId !== id || evento.tipo !== "ANEXO" || !evento.anexoUrl) {
        return reply.code(404).send({ error: "Anexo não encontrado." });
      }

      const caminhoAbsoluto = caminhoAbsolutoDoAnexo(evento.anexoUrl);
      if (!caminhoAbsoluto || !fs.existsSync(caminhoAbsoluto)) {
        return reply.code(404).send({ error: "Arquivo não encontrado no armazenamento." });
      }

      const detalhe = (evento.detalhe as Record<string, unknown> | null) ?? {};
      const mimeType = (detalhe.mimeType as string) || "application/octet-stream";
      const nomeOriginal = ((detalhe.nomeArquivoOriginal as string) || "anexo").replace(/"/g, "");

      reply.header("Content-Disposition", `inline; filename="${nomeOriginal}"`);
      return reply.type(mimeType).send(fs.createReadStream(caminhoAbsoluto));
    }
  );

  // Correção de um evento do histórico lançado por erro (ex: mensagem de
  // teste, nota digitada no chamado errado) — restrito a Administrador
  // porque histórico deveria ser confiável por padrão; existe só pra corrigir
  // engano, não pra uso corrente do dia a dia. Quando o evento é um ANEXO,
  // remove também o arquivo físico do volume — senão o espaço (limitado,
  // 500MB) nunca é liberado, mesmo com o registro apagado do banco.
  app.delete(
    "/chamados-manutencao/:id/eventos/:eventoId",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id, eventoId } = request.params as { id: string; eventoId: string };
      const evento = await app.prisma.chamadoEvento.findUnique({ where: { id: eventoId } });
      if (!evento || evento.chamadoId !== id) return reply.code(404).send({ error: "Evento não encontrado." });
      if (evento.tipo === "ANEXO") removerArquivoAnexo(evento.anexoUrl);
      await app.prisma.chamadoEvento.delete({ where: { id: eventoId } });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "ChamadoEvento",
        entidadeId: eventoId,
        detalhe: { chamadoId: id, tipo: evento.tipo },
        ip: request.ip,
      });
      return reply.code(204).send();
    }
  );

  // Exclusão definitiva do chamado inteiro (diferente da rota acima, que só
  // corrige um evento pontual) — pra corrigir chamado criado por engano
  // (duplicado, teste). ChamadoEvento tem onDelete: Cascade, então o
  // histórico/chat inteiro do chamado é apagado junto automaticamente pelo
  // banco — mas isso é só a linha do banco; os arquivos de anexo em disco
  // não somem sozinhos, por isso o passo extra abaixo antes de excluir. Só
  // ADMINISTRADOR: é mais sensível que corrigir um evento isolado.
  app.delete(
    "/chamados-manutencao/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const chamado = await app.prisma.chamadoManutencao.findUnique({ where: { id } });
      if (!chamado) return reply.code(404).send({ error: "Chamado não encontrado." });
      const eventosComAnexo = await app.prisma.chamadoEvento.findMany({
        where: { chamadoId: id, tipo: "ANEXO" },
        select: { anexoUrl: true },
      });
      eventosComAnexo.forEach((ev) => removerArquivoAnexo(ev.anexoUrl));
      await app.prisma.chamadoManutencao.delete({ where: { id } });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "ChamadoManutencao",
        entidadeId: id,
        detalhe: { numero: chamado.numero, categoria: chamado.categoria },
        ip: request.ip,
      });
      avisarMudanca("chamados");
      return reply.code(204).send();
    }
  );
}
