// Precisa ser o primeiro import do arquivo — é assim que o Sentry consegue
// instrumentar automaticamente tudo que é carregado depois dele. Sem
// SENTRY_DSN configurado, não faz nada (ver src/instrument.ts).
import "./instrument";

import Fastify, { FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import * as Sentry from "@sentry/node";
import { Prisma } from "@prisma/client";

import { env } from "./env";
import prismaPlugin from "./plugins/prisma";
import authPlugin from "./plugins/auth";
import { garantirDiretorioAnexos, TAMANHO_MAXIMO_BYTES_MENSAGEM } from "./utils/anexos";

import authRoutes from "./routes/auth.routes";
import colaboradoresRoutes from "./routes/colaboradores.routes";
import equipamentosRoutes from "./routes/equipamentos.routes";
import linhasRoutes from "./routes/linhas.routes";
import acessosRoutes from "./routes/acessos.routes";
import lotesRoutes from "./routes/lotes.routes";
import solicitacoesRoutes from "./routes/solicitacoes.routes";
import chamadosRoutes from "./routes/chamados.routes";
import movimentacoesRoutes from "./routes/movimentacoes.routes";
import historicoRoutes from "./routes/historico.routes";
import dominiosRoutes from "./routes/dominios.routes";
import mensagensRoutes from "./routes/mensagens.routes";
import perfilRoutes from "./routes/perfil.routes";
import solicitacoesPapelariaRoutes from "./routes/solicitacoesPapelaria.routes";
import notificacoesRoutes from "./routes/notificacoes.routes";
import documentosRoutes from "./routes/documentos.routes";
import { iniciarAgendadorVencimentoDocumentos } from "./utils/documentosVencimentoJob";
// Pagamentos / CNAB240 (reativado 12/08/2026, pedido do Vini) — os 5 models
// que faltavam (FolhaPagamento, PagamentoColaborador, RemessaCnab,
// DadosBancariosColaborador, ConfiguracaoPagamento) foram reconstruídos
// contra a estrutura real de produção (auditoria coluna a coluna, zero
// divergência confirmada via prisma migrate diff antes de reativar).
import pagamentosRoutes from "./routes/pagamentos.routes";
import solicitacoesServicoRoutes from "./routes/solicitacoesServico.routes";
// NOTA (recuperação 07/08/2026): src/utils/aniversariosJob.ts não foi
// encontrado em nenhuma transcrição desta sessão — desativado temporariamente
// até ser reconstruído. Ver Recuperacao_Codigo_Fonte_07-08-2026.md.
// import { iniciarAgendadorAniversariantes } from "./utils/aniversariosJob";

async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
  });

  // Reporta pro Sentry qualquer erro 5xx (e falhas antes mesmo de chegar
  // numa rota) sem interferir no app.setErrorHandler abaixo, que continua
  // sendo o único responsável por montar a resposta enviada ao cliente —
  // vira um "no-op" se SENTRY_DSN não estiver configurado.
  Sentry.setupFastifyErrorHandler(app);

  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
    // @fastify/cors (diferente do pacote "cors" do Express) usa
    // 'GET,HEAD,POST' como default quando `methods` não é informado
    // explicitamente. Sem isso, todo PUT/PATCH/DELETE feito pelo navegador
    // falha no preflight (o navegador some com a chamada real depois do
    // OPTIONS "bem sucedido", sem gerar nenhum log de erro) — é exatamente
    // o bug relatado pelo Vini em 05/07/2026 (editar/excluir equipamento).
    // Testes anteriores via curl com JWT próprio nunca pegaram isso porque
    // curl não aplica CORS — só o navegador de verdade é afetado.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });
  // Persistência de login (08/07/2026, pedido do Vini — antes disso, F5
  // desconectava o usuário porque os tokens só viviam em memória JS). O
  // refresh token passa a viajar num cookie httpOnly (inacessível a
  // JavaScript, então um XSS não consegue mais lê-lo — só o access token,
  // de vida curta, continua em memória no front). Não usa cookie assinado
  // (`secret`) porque o valor em si já é opaco/alta entropia e comparado
  // via hash no banco (ver utils/tokens.ts) — o mesmo desenho de segurança
  // que o refresh token já tinha antes, só mudando ONDE ele mora no
  // navegador. Ver setRefreshCookie em auth.routes.ts para as opções do
  // cookie (httpOnly/secure/sameSite/maxAge).
  await app.register(cookie);
  await app.register(sensible);

  // Limite global generoso; rotas sensíveis (login) recebem um limite mais
  // apertado registrado localmente na própria rota, para conter força bruta
  // sem prejudicar o uso normal do resto da API.
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  // Upload de anexo (chamado, termo de responsabilidade, mensagem — ver
  // src/utils/anexos.ts) — limite de tamanho aplicado aqui pega qualquer
  // rota que use request.file()/request.parts(), sem precisar repetir a
  // config em cada uma. `files: 1` porque o fluxo é um anexo por requisição
  // (várias fotos = várias chamadas do endpoint, não um multipart com N
  // arquivos de uma vez) — mantém a rota simples dos dois lados.
  //
  // O teto aqui é o maior entre os limites por rota (hoje,
  // TAMANHO_MAXIMO_BYTES_MENSAGEM = 20MB, pra caber vídeo curto de chat —
  // ver mensagens.routes.ts) — o `@fastify/multipart` só permite UM
  // registro do parser multipart por instância (ele usa fastify-plugin, que
  // quebra o encapsulamento normal do Fastify), então não dá pra ter um
  // limite "global" diferente por rota aqui. Cada rota com limite menor
  // (chamado/termo, 10MB — ver TAMANHO_MAXIMO_BYTES) faz sua própria
  // checagem explícita de tamanho pós-gravação (fs.stat), em vez de confiar
  // só no truncamento do busboy — esse `fileSize` vira só o teto absoluto/
  // backstop que corta uploads claramente exagerados o mais cedo possível.
  await app.register(multipart, {
    limits: { fileSize: TAMANHO_MAXIMO_BYTES_MENSAGEM, files: 1 },
  });
  garantirDiretorioAnexos();

  await app.register(prismaPlugin);
  await app.register(authPlugin);

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  await app.register(authRoutes, {
    // @fastify/rate-limit permite sobrescrever por rota via config; login
    // fica mais restrito para dificultar tentativa de força bruta de senha.
  });
  await app.register(colaboradoresRoutes);
  await app.register(equipamentosRoutes);
  await app.register(linhasRoutes);
  await app.register(acessosRoutes);
  await app.register(lotesRoutes);
  await app.register(solicitacoesRoutes);
  await app.register(chamadosRoutes);
  await app.register(movimentacoesRoutes);
  await app.register(historicoRoutes);
  await app.register(dominiosRoutes);
  await app.register(mensagensRoutes);
  await app.register(perfilRoutes);
  await app.register(solicitacoesPapelariaRoutes);
  await app.register(notificacoesRoutes);
  await app.register(documentosRoutes);
  // Pagamentos CNAB 240 (20/07/2026, pedido do Vini; reativado 12/08/2026)
  await app.register(pagamentosRoutes);
  await app.register(solicitacoesServicoRoutes);

  // Etapa 3 (auditoria de backend, 08/07/2026): várias rotas de POST/PUT
  // aceitam um id de referência (colaboradorId, unidadeId, equipamentoId,
  // sistemaId etc.) sem checar antes se ele existe de verdade — um id
  // inválido (digitado errado, copiado de outro ambiente, ou um registro
  // excluído entre a tela carregar e o formulário ser enviado) virava
  // exceção não tratada do Prisma e caía aqui como 500 genérico, sem
  // explicar o que realmente aconteceu. Tratar os códigos mais comuns do
  // Prisma aqui, de forma centralizada, evita ter que repetir esse
  // try/catch em cada rota (e esquecer alguma) — rotas que já tratam um
  // código específico com mensagem melhor (ver P2002 em colaboradores/
  // linhas.routes.ts) continuam funcionando normalmente, porque só chegam
  // aqui exceções que ninguém pegou antes.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        return reply.code(400).send({
          error: "Referência inválida — um dos itens vinculados (colaborador, unidade, equipamento, sistema etc.) não existe ou foi removido.",
        });
      }
      if (error.code === "P2025") {
        return reply.code(404).send({ error: "Registro não encontrado." });
      }
      if (error.code === "P2002") {
        return reply.code(409).send({ error: "Já existe um registro com esse valor único (ver campos obrigatoriamente diferentes)." });
      }
    }

    request.log.error({ err: error }, "Erro não tratado");
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: statusCode === 500 ? "Erro interno do servidor." : error.message,
    });
  });

  // Notificação de aniversariantes do próximo mês pro RH (17/07/2026, ver
  // utils/aniversariosJob.ts) — desativado, ver nota de import acima.
  // iniciarAgendadorAniversariantes(app);

  // Vencimento de documentos de RH (11/08/2026) — expira documento aprovado
  // vencido e alerta antecedência configurada por tipo de documento.
  iniciarAgendadorVencimentoDocumentos(app);

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
