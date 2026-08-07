import { FastifyInstance } from "fastify";
import { z } from "zod";
import { CategoriaNotificacao, Prioridade } from "@prisma/client";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarConexao, removerConexao } from "../utils/sseHub";
import { AuthPayload } from "../plugins/auth";
import { env } from "../env";

// Origens liberadas pra CORS, mesma lista usada pelo @fastify/cors global em
// server.ts (ver ali o comentário sobre o bug de 05/07/2026 causado por
// preflight faltando). A rota /notificacoes/stream PRECISA montar seu
// próprio cabeçalho CORS na mão: ela responde escrevendo direto em
// `reply.raw` e chama `reply.hijack()` logo depois de `writeHead`, o que
// tira a resposta do ciclo de vida normal do Fastify — o hook onSend do
// @fastify/cors, que injeta Access-Control-Allow-Origin em toda outra rota,
// nunca chega a rodar aqui. Sem isso, o EventSource do navegador (que, ao
// contrário do curl usado nos testes manuais deste recurso, aplica CORS de
// verdade) recebia a resposta bloqueada silenciosamente — mesma classe de
// bug do preflight, só que numa rota que nem passa por preflight (SSE é
// "simple request", sem OPTIONS antes).
const ORIGENS_PERMITIDAS = env.CORS_ORIGIN.split(",").map((o) => o.trim());

// Central de Notificações (Fase B, 09/07/2026, pedido do Vini) — rotas de
// consumo: stream em tempo real (SSE), listagem paginada com filtros,
// contagem de não lidas, marcar lida (uma/todas), excluir e preferências por
// usuário. A CRIAÇÃO de notificação não tem rota própria — ela só acontece
// via notificacoes.service.ts, chamado de dentro de cada rota de domínio que
// já sabe quem deve ser avisado (ver notificacoes.service.ts).
//
// Toda rota aqui é sempre escopada a `request.user.sub` — ninguém lê, marca
// ou apaga notificação de outra pessoa, nem mesmo ADMINISTRADOR (não existe
// caso de uso legítimo pra isso, ao contrário de auditoria/chamados, que têm
// visão administrativa por design).
export default async function notificacoesRoutes(app: FastifyInstance) {
  // SSE não consegue mandar header Authorization (EventSource do navegador
  // não suporta headers customizados) — por isso, só esta rota aceita o
  // token de acesso via querystring, verificado manualmente com o mesmo
  // segredo/assinatura de sempre (ver plugins/auth.ts). O token de acesso já
  // é de vida curta (mesma política do resto do sistema), e a conexão roda
  // inteira sobre HTTPS — é o trade-off padrão de SSE autenticado.
  app.get("/notificacoes/stream", async (request, reply) => {
    const { token } = request.query as { token?: string };
    if (!token) return reply.code(401).send({ error: "Token ausente." });

    let usuario: AuthPayload;
    try {
      usuario = app.jwt.verify<AuthPayload>(token);
    } catch {
      return reply.code(401).send({ error: "Token inválido ou expirado." });
    }

    const origem = request.headers.origin;
    const cabecalhos: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Evita que proxy/CDN tente comprimir ou dar buffer no stream (Railway
      // fica atrás de proxy reverso — sem isso o navegador só recebe os
      // eventos em lote, quebrando a ideia de "tempo real").
      "X-Accel-Buffering": "no",
    };
    if (origem && ORIGENS_PERMITIDAS.includes(origem)) {
      cabecalhos["Access-Control-Allow-Origin"] = origem;
      cabecalhos["Vary"] = "Origin";
    }
    reply.raw.writeHead(200, cabecalhos);
    reply.hijack();

    const contagem = await app.prisma.notificacao.count({ where: { destinatarioId: usuario.sub, lida: false } });
    reply.raw.write(`event: conectado\ndata: ${JSON.stringify({ naoLidas: contagem })}\n\n`);

    registrarConexao(usuario.sub, reply);

    // Comentário SSE (linha iniciada com ":") a cada 25s só pra manter a
    // conexão viva atravessando qualquer proxy/load balancer com timeout de
    // inatividade — não é um evento de verdade, o cliente ignora.
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      removerConexao(usuario.sub, reply);
    });
  });

  app.get("/notificacoes", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = paginationSchema
      .extend({
        categoria: z.nativeEnum(CategoriaNotificacao).optional(),
        prioridade: z.nativeEnum(Prioridade).optional(),
        lida: z.coerce.boolean().optional(),
        busca: z.string().optional(),
      })
      .parse(request.query);
    const { skip, take } = toSkipTake(query);

    const where = {
      destinatarioId: request.user.sub,
      ...(query.categoria ? { categoria: query.categoria } : {}),
      ...(query.prioridade ? { prioridade: query.prioridade } : {}),
      ...(query.lida !== undefined ? { lida: query.lida } : {}),
      ...(query.busca
        ? {
            OR: [
              { titulo: { contains: query.busca, mode: "insensitive" as const } },
              { mensagem: { contains: query.busca, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      app.prisma.notificacao.findMany({ where, skip, take, orderBy: { criadoEm: "desc" } }),
      app.prisma.notificacao.count({ where }),
    ]);

    return reply.send(paginatedResponse(items, total, query));
  });

  app.get("/notificacoes/nao-lidas/contagem", { preHandler: [app.authenticate] }, async (request, reply) => {
    const total = await app.prisma.notificacao.count({ where: { destinatarioId: request.user.sub, lida: false } });
    return reply.send({ total });
  });

  app.patch("/notificacoes/:id/lida", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const notificacao = await app.prisma.notificacao.findUnique({ where: { id } });
    if (!notificacao || notificacao.destinatarioId !== request.user.sub) {
      return reply.code(404).send({ error: "Notificação não encontrada." });
    }
    const atualizada = await app.prisma.notificacao.update({
      where: { id },
      data: { lida: true, lidaEm: new Date() },
    });
    return reply.send(atualizada);
  });

  app.patch("/notificacoes/marcar-todas-lidas", { preHandler: [app.authenticate] }, async (request, reply) => {
    const resultado = await app.prisma.notificacao.updateMany({
      where: { destinatarioId: request.user.sub, lida: false },
      data: { lida: true, lidaEm: new Date() },
    });
    return reply.send({ atualizadas: resultado.count });
  });

  app.delete("/notificacoes/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const notificacao = await app.prisma.notificacao.findUnique({ where: { id } });
    if (!notificacao || notificacao.destinatarioId !== request.user.sub) {
      return reply.code(404).send({ error: "Notificação não encontrada." });
    }
    await app.prisma.notificacao.delete({ where: { id } });
    return reply.code(204).send();
  });

  // Preferências — sempre a do próprio usuário logado (não tem :id na rota
  // de propósito, evita até a possibilidade de alguém tentar ler/mudar a
  // preferência de outra pessoa).
  app.get("/notificacoes/preferencias", { preHandler: [app.authenticate] }, async (request, reply) => {
    const pref = await app.prisma.preferenciaNotificacao.findUnique({ where: { usuarioId: request.user.sub } });
    // Sem linha salva ainda = default (recebe tudo, som e navegador
    // ligados) — devolve o default sem gravar nada, só grava quando a
    // pessoa realmente mudar algo (PATCH abaixo faz upsert).
    return reply.send(
      pref ?? {
        usuarioId: request.user.sub,
        categoriasSilenciadas: [],
        prioridadeMinima: "BAIXA",
        som: true,
        notificacaoNavegador: true,
      }
    );
  });

  const preferenciaSchema = z.object({
    categoriasSilenciadas: z.array(z.nativeEnum(CategoriaNotificacao)).optional(),
    prioridadeMinima: z.nativeEnum(Prioridade).optional(),
    som: z.boolean().optional(),
    notificacaoNavegador: z.boolean().optional(),
  });

  app.patch("/notificacoes/preferencias", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = preferenciaSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

    const pref = await app.prisma.preferenciaNotificacao.upsert({
      where: { usuarioId: request.user.sub },
      update: parsed.data,
      create: {
        usuarioId: request.user.sub,
        categoriasSilenciadas: parsed.data.categoriasSilenciadas ?? [],
        prioridadeMinima: parsed.data.prioridadeMinima ?? "BAIXA",
        som: parsed.data.som ?? true,
        notificacaoNavegador: parsed.data.notificacaoNavegador ?? true,
      },
    });
    return reply.send(pref);
  });
}
