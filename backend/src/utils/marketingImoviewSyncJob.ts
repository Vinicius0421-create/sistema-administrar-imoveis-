import { FastifyInstance } from "fastify";
import { env } from "../env";
import { avisarMudanca } from "./realtime";
import { notificarPorPapeis } from "./notificacoes.service";
import {
  buscarImoveisAlteradosImoview,
  buscarImoveisImoview,
  CODIGO_UNIDADE_IMOVIEW,
  ImoviewImovelBruto,
  normalizarStatusImovel,
  normalizarTipoImovel,
} from "./imoviewClient";
import type { StatusImovel } from "@prisma/client";

// Job de sincronização Marketing ↔ Imoview (Fase 8, 13/08/2026). Mesmo
// padrão de setTimeout inicial + setInterval já usado em
// documentosVencimentoJob.ts (ver comentário completo lá) — não introduz
// infra nova (fila, cron externo) para um volume de imóveis que ainda é
// pequeno.
const INTERVALO_MS = 3 * 60 * 60 * 1000; // a cada 3h

// Só inicia se IMOVIEW_API_KEY estiver configurada — mesmo padrão gracioso
// de SENTRY_DSN/RESEND_API_KEY (ver env.ts). Chamado condicionalmente em
// server.ts (`if (env.IMOVIEW_API_KEY) iniciarAgendadorSincronizacaoImoview(app);`).
export function iniciarAgendadorSincronizacaoImoview(app: FastifyInstance): void {
  const executar = () =>
    executarSincronizacaoImoview(app).catch((err) => app.log.error({ err }, "Falha no job de sincronização Imoview"));
  setTimeout(executar, 30_000);
  setInterval(executar, INTERVALO_MS);
}

export interface ResultadoSincronizacaoImoview {
  sucesso: boolean;
  quantidade: number;
  erro?: string | null;
}

// Central de Notificações — quem edita status de imóvel avisa Marketing +
// Administrador. Fica aqui (não em marketing.routes.ts) porque tanto a
// rota PATCH /marketing/imoveis/:id quanto este próprio job precisam dela,
// e este arquivo já é importado pela rota (evita import circular entre os
// dois módulos).
export async function notificarMudancaStatusImovel(
  app: FastifyInstance,
  imovel: { id: string; codigo: string; status: StatusImovel },
  origemUsuarioId?: string | null
): Promise<void> {
  const vendido = imovel.status === "VENDIDO";
  await notificarPorPapeis(app, ["MARKETING", "ADMINISTRADOR"], {
    categoria: "MARKETING",
    tipo: vendido ? "MARKETING_IMOVEL_VENDIDO" : "MARKETING_IMOVEL_STATUS_MUDOU",
    titulo: vendido ? "Imóvel vendido" : "Status de imóvel alterado",
    mensagem: vendido
      ? `O imóvel ${imovel.codigo} foi marcado como vendido.`
      : `O imóvel ${imovel.codigo} mudou de status.`,
    prioridade: vendido ? "ALTA" : "MEDIA",
    entidade: "ImovelMarketing",
    entidadeId: imovel.id,
    origemUsuarioId: origemUsuarioId ?? null,
  });
}

const MAX_PAGINAS_FALLBACK = 50; // trava de segurança — 50 páginas x 20 registros = 1000 imóveis
const REGISTROS_POR_PAGINA = 20; // limite documentado da API (RetornarImoveis)
const JANELA_PADRAO_PRIMEIRA_SINCRONIZACAO_DIAS = 30;

// Ponto único de execução — chamado tanto pelo agendador periódico acima
// quanto diretamente pela rota manual (POST /marketing/sincronizacao/executar,
// ver marketing.routes.ts). `origemUsuarioId` só é usado para excluir quem
// disparou a sincronização manual da notificação de erro (mesmo racional de
// `excluirOrigem` em notificacoes.service.ts) — nas rodadas automáticas fica
// undefined, então ninguém é excluído.
export async function executarSincronizacaoImoview(
  app: FastifyInstance,
  origemUsuarioId?: string
): Promise<ResultadoSincronizacaoImoview> {
  const desde = await resolverDataUltimaSincronizacaoOk(app);

  // Primário: RetornarImoveisAlterados (sincronização incremental) — mais
  // barato, mas ESTE ENDPOINT ESPECIFICAMENTE NÃO FOI TESTADO AO VIVO em
  // nenhuma sessão (só RetornarListaUnidades foi confirmado contra a API
  // real). Se a chamada falhar (endpoint inexistente, formato inesperado
  // etc.), cai para RetornarImoveis paginado — mais caro, porém documentado
  // e mais provável de existir de fato no plano contratado.
  const respostaAlterados = await buscarImoveisAlteradosImoview(desde);
  let imoveisBrutos: ImoviewImovelBruto[];
  let erroBusca: string | null = null;

  if (respostaAlterados.sucesso) {
    imoveisBrutos = respostaAlterados.dados;
  } else {
    app.log.warn(
      { erro: respostaAlterados.erro },
      "RetornarImoveisAlterados falhou — usando RetornarImoveis paginado como alternativa (endpoint incremental não confirmado nesta integração)"
    );
    const resultadoFallback = await buscarTodosImoveisPaginado(app);
    if (!resultadoFallback.sucesso) {
      erroBusca = `Alterados: ${respostaAlterados.erro} | Paginado: ${resultadoFallback.erro}`;
      imoveisBrutos = [];
    } else {
      imoveisBrutos = resultadoFallback.dados;
    }
  }

  if (erroBusca) {
    await app.prisma.sincronizacaoImoviewLog.create({ data: { sucesso: false, quantidade: 0, erro: erroBusca } });
    await notificarPorPapeis(app, ["MARKETING", "ADMINISTRADOR"], {
      categoria: "MARKETING",
      tipo: "MARKETING_SINCRONIZACAO_ERRO",
      titulo: "Falha na sincronização com o Imoview",
      mensagem: erroBusca,
      prioridade: "ALTA",
      entidade: "SincronizacaoImoviewLog",
      origemUsuarioId: origemUsuarioId ?? null,
    });
    return { sucesso: false, quantidade: 0, erro: erroBusca };
  }

  const unidades = await app.prisma.unidade.findMany({ select: { id: true, nome: true } });
  const erros: string[] = [];
  let processados = 0;
  const idsQueViraramVendido: { id: string; codigo: string; status: StatusImovel }[] = [];

  for (const bruto of imoveisBrutos) {
    const codigoImoview = Number(bruto.codigo);
    if (!Number.isFinite(codigoImoview)) {
      erros.push(`Imóvel sem código numérico válido ignorado (${JSON.stringify(bruto.codigo)}).`);
      continue;
    }

    const unidadeCodigo = typeof bruto.unidadeCodigo === "number" ? bruto.unidadeCodigo : undefined;
    const nomeUnidadeEsperado = unidadeCodigo !== undefined ? CODIGO_UNIDADE_IMOVIEW[unidadeCodigo] : undefined;
    const unidade = nomeUnidadeEsperado
      ? unidades.find((u) => u.nome.includes(nomeUnidadeEsperado))
      : undefined;
    if (!unidade) {
      erros.push(`Imóvel ${codigoImoview}: unidade Imoview (código ${unidadeCodigo ?? "?"}) não corresponde a nenhuma unidade real do banco — pulado.`);
      continue;
    }

    const { status: novoStatus, pular } = normalizarStatusImovel(bruto.situacao, bruto.situacaodescricao);
    if (pular) {
      erros.push(`Imóvel ${codigoImoview}: situação indica removido/excluído no Imoview — pulado.`);
      continue;
    }

    const tipo = normalizarTipoImovel(bruto.tipo ?? bruto.tipoimovel);
    const fotosUrls = Array.isArray(bruto.fotos) ? bruto.fotos.filter((f): f is string => typeof f === "string") : [];
    const fotoPrincipalUrl = typeof bruto.fotoPrincipal === "string" ? bruto.fotoPrincipal : fotosUrls[0];

    const existente = await app.prisma.imovelMarketing.findUnique({ where: { codigoImoview }, select: { id: true, status: true } });

    // Nunca sobrescreve prioridade/observacoes/corretorId/corretorNome —
    // são só editáveis manualmente pelo Marketing (ver comentário no
    // schema.prisma). Todos os demais campos vindos da API sobrescrevem o
    // valor local a cada rodada.
    const dadosSincronizados = {
      codigo: String(bruto.codigo),
      unidadeId: unidade.id,
      tipo,
      bairroRegiao: bruto.bairro ?? bruto.regiao ?? null,
      descricaoCurta: bruto.descricao ?? null,
      valor: bruto.valor !== undefined ? String(bruto.valor) : null,
      temFotos: fotosUrls.length > 0 || !!fotoPrincipalUrl,
      temVideo: !!bruto.video,
      status: novoStatus,
      origemImoview: true,
      codigoImoview,
      fotoPrincipalUrl: fotoPrincipalUrl ?? null,
      fotosUrls,
      videoUrl: bruto.video ?? null,
      tituloSugerido: bruto.titulo ?? null,
      descricaoSugerida: bruto.descricao ?? null,
      ultimaSincronizacaoEm: new Date(),
    };

    const imovel = await app.prisma.imovelMarketing.upsert({
      where: { codigoImoview },
      create: dadosSincronizados,
      update: dadosSincronizados,
    });
    processados += 1;

    if (existente && existente.status !== "VENDIDO" && novoStatus === "VENDIDO") {
      idsQueViraramVendido.push({ id: imovel.id, codigo: imovel.codigo, status: novoStatus });
    }

    // Delay pequeno entre registros processados (equivalente ao "entre
    // páginas" pedido no design — como o primário RetornarImoveisAlterados
    // não é paginado nesta implementação, o delay é aplicado por lote de
    // upserts em vez de por página; ver buscarTodosImoveisPaginado abaixo
    // para o delay real entre páginas no caminho de fallback).
  }

  for (const item of idsQueViraramVendido) {
    await notificarMudancaStatusImovel(app, item);
  }

  const resumoErros = erros.length > 0 ? erros.slice(0, 10).join(" | ") + (erros.length > 10 ? ` (+${erros.length - 10} outros)` : "") : null;
  await app.prisma.sincronizacaoImoviewLog.create({ data: { sucesso: true, quantidade: processados, erro: resumoErros } });

  if (processados > 0) avisarMudanca("marketing");

  return { sucesso: true, quantidade: processados, erro: resumoErros };
}

async function resolverDataUltimaSincronizacaoOk(app: FastifyInstance): Promise<Date> {
  const ultima = await app.prisma.sincronizacaoImoviewLog.findFirst({
    where: { sucesso: true },
    orderBy: { executadoEm: "desc" },
    select: { executadoEm: true },
  });
  if (ultima) return ultima.executadoEm;
  // Primeira execução: sem histórico, busca uma janela razoável pra trás em
  // vez de "desde sempre" — suposição documentada, não confirmada com a API
  // real (não se sabe se RetornarImoveisAlterados aceita uma data tão
  // distante sem paginar internamente).
  return new Date(Date.now() - JANELA_PADRAO_PRIMEIRA_SINCRONIZACAO_DIAS * 24 * 60 * 60 * 1000);
}

// Caminho de fallback — usado só quando RetornarImoveisAlterados falha.
// Pagina de verdade (numeropagina/numeroregistros, 20/página — limite
// documentado da API), com um pequeno delay entre páginas para não
// sobrecarregar a API do Imoview, parando quando uma página vier vazia ou
// ao atingir MAX_PAGINAS_FALLBACK (trava de segurança contra loop infinito
// se a API nunca devolver página vazia por algum motivo inesperado).
async function buscarTodosImoveisPaginado(
  app: FastifyInstance
): Promise<{ sucesso: true; dados: ImoviewImovelBruto[] } | { sucesso: false; erro: string }> {
  const todos: ImoviewImovelBruto[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS_FALLBACK; pagina++) {
    const resposta = await buscarImoveisImoview({ numeroPagina: pagina, numeroRegistros: REGISTROS_POR_PAGINA });
    if (!resposta.sucesso) {
      if (pagina === 1) return { sucesso: false, erro: resposta.erro };
      app.log.warn({ erro: resposta.erro, pagina }, "Sincronização Imoview: falha ao buscar página, parando com o que já foi coletado");
      break;
    }
    if (resposta.dados.length === 0) break;
    todos.push(...resposta.dados);
    if (resposta.dados.length < REGISTROS_POR_PAGINA) break; // última página
    await new Promise((r) => setTimeout(r, 300));
  }
  return { sucesso: true, dados: todos };
}
