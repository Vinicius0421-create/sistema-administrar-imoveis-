import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { Papel, StatusAtivoInativo, StatusDocumentoColaborador } from "@prisma/client";
import { paginationSchema, toSkipTake, paginatedResponse } from "../utils/pagination";
import { registrarAuditoria } from "../utils/audit";
import { notificar, notificarPorPapeis } from "../utils/notificacoes.service";
import { avisarMudanca } from "../utils/realtime";
import {
  caminhoAbsolutoDoAnexo,
  caminhoParaNovoAnexo,
  MIME_TYPES_PERMITIDOS,
  removerArquivoAnexo,
  TAMANHO_MAXIMO_BYTES,
} from "../utils/anexos";

// RH — Documentos de colaborador (11/08/2026, Fase RH da Evolução Completa).
// Reaproveita Colaborador/Usuario existentes (não duplica cadastro) e segue
// os mesmos padrões já estabelecidos no resto do backend:
//   - timeline unificada por evento (DocumentoColaboradorEvento), mesmo
//     racional de ChamadoEvento/EventoSolicitacaoPapelaria;
//   - upload no volume compartilhado (utils/anexos.ts), mesmo fluxo do termo
//     de responsabilidade em colaboradores.routes.ts;
//   - notificar()/notificarPorPapeis() como único ponto de criação de
//     notificação (utils/notificacoes.service.ts);
//   - avisarMudanca("documentos") ao fim de toda escrita relevante, pro
//     realtime de listas (useAppData.ts no frontend).
//
// RBAC: ADMINISTRADOR e RH administram o catálogo e o fluxo (solicitar,
// analisar, cancelar). Qualquer colaborador autenticado só enxerga e envia
// os PRÓPRIOS documentos — nunca os de outra pessoa, mesmo sabendo o id.

const PAPEIS_GERENCIAM: Papel[] = ["ADMINISTRADOR", "RH"];

const STATUS_ANALISAVEIS: StatusDocumentoColaborador[] = ["ENVIADO", "EM_ANALISE"];

function ehGestorDocumento(papel: Papel): boolean {
  return PAPEIS_GERENCIAM.includes(papel);
}

const tipoDocumentoInputSchema = z.object({
  nome: z.string().min(2).max(120),
  descricao: z.string().max(500).optional(),
  exigeValidade: z.boolean().optional(),
  diasAntecedenciaAlerta: z.array(z.number().int().positive()).min(1).optional(),
});

const tipoDocumentoUpdateSchema = tipoDocumentoInputSchema.partial().extend({
  status: z.nativeEnum(StatusAtivoInativo).optional(),
});

const solicitarDocumentoSchema = z.object({
  colaboradorId: z.string().min(1),
  tipoDocumentoId: z.string().min(1),
  observacaoSolicitacao: z.string().max(1000).optional(),
});

const analisarDocumentoSchema = z
  .object({
    aprovado: z.boolean(),
    motivoRejeicao: z.string().max(1000).optional(),
    dataValidade: z.coerce.date().optional(),
  })
  .refine((v) => v.aprovado || !!v.motivoRejeicao, {
    message: "Informe o motivo da rejeição.",
    path: ["motivoRejeicao"],
  });

const comentarioSchema = z.object({ mensagem: z.string().min(1).max(1000) });

const listQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(StatusDocumentoColaborador).optional(),
  colaboradorId: z.string().optional(),
  tipoDocumentoId: z.string().optional(),
  // "vencendo": aprovado, com validade, ainda não vencida, dentro dos
  // próximos 30 dias — atalho de filtro pro painel do RH, sem precisar
  // calcular a data no cliente.
  vencendo: z.coerce.boolean().optional(),
});

export default async function documentosRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------
  // Catálogo de tipos de documento
  // ---------------------------------------------------------------------

  app.get("/tipos-documento", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { incluirInativos } = request.query as { incluirInativos?: string };
    const podeVerInativos = ehGestorDocumento(request.user.papel) && incluirInativos === "true";

    const tipos = await app.prisma.tipoDocumento.findMany({
      where: podeVerInativos ? {} : { status: "ATIVO" },
      orderBy: { nome: "asc" },
    });
    return reply.send(tipos);
  });

  app.post(
    "/tipos-documento",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM)] },
    async (request, reply) => {
      const parsed = tipoDocumentoInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const tipo = await app.prisma.tipoDocumento.create({
        data: {
          nome: parsed.data.nome,
          descricao: parsed.data.descricao,
          exigeValidade: parsed.data.exigeValidade ?? false,
          diasAntecedenciaAlerta: parsed.data.diasAntecedenciaAlerta ?? [30, 15, 7, 1],
        },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR_TIPO_DOCUMENTO",
        entidade: "TipoDocumento",
        entidadeId: tipo.id,
        detalhe: { nome: tipo.nome },
        ip: request.ip,
      });

      return reply.code(201).send(tipo);
    }
  );

  app.patch(
    "/tipos-documento/:id",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = tipoDocumentoUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const existente = await app.prisma.tipoDocumento.findUnique({ where: { id } });
      if (!existente) return reply.code(404).send({ error: "Tipo de documento não encontrado." });

      const tipo = await app.prisma.tipoDocumento.update({ where: { id }, data: parsed.data });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "ATUALIZAR_TIPO_DOCUMENTO",
        entidade: "TipoDocumento",
        entidadeId: id,
        detalhe: parsed.data,
        ip: request.ip,
      });

      return reply.send(tipo);
    }
  );

  // ---------------------------------------------------------------------
  // Documentos de colaborador
  // ---------------------------------------------------------------------

  app.post(
    "/documentos-colaborador",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM)] },
    async (request, reply) => {
      const parsed = solicitarDocumentoSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const [colaborador, tipoDocumento] = await Promise.all([
        app.prisma.colaborador.findUnique({ where: { id: parsed.data.colaboradorId } }),
        app.prisma.tipoDocumento.findUnique({ where: { id: parsed.data.tipoDocumentoId } }),
      ]);
      if (!colaborador) return reply.code(400).send({ error: "Colaborador não encontrado." });
      if (!tipoDocumento) return reply.code(400).send({ error: "Tipo de documento não encontrado." });

      const usuarioColaborador = await app.prisma.usuario.findUnique({ where: { colaboradorId: colaborador.id } });

      const documento = await app.prisma.documentoColaborador.create({
        data: {
          colaboradorId: colaborador.id,
          tipoDocumentoId: tipoDocumento.id,
          solicitadoPorId: request.user.sub,
          observacaoSolicitacao: parsed.data.observacaoSolicitacao,
        },
      });

      await app.prisma.documentoColaboradorEvento.create({
        data: {
          documentoId: documento.id,
          tipo: "SOLICITACAO",
          autorId: request.user.sub,
          mensagem: parsed.data.observacaoSolicitacao ?? null,
        },
      });

      if (usuarioColaborador) {
        await notificar(app, {
          destinatarioIds: [usuarioColaborador.id],
          categoria: "DOCUMENTO",
          tipo: "DOCUMENTO_SOLICITADO",
          titulo: "Novo documento solicitado",
          mensagem: `O RH solicitou o envio de "${tipoDocumento.nome}".`,
          entidade: "DocumentoColaborador",
          entidadeId: documento.id,
          origemUsuarioId: request.user.sub,
        });
      }

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "SOLICITAR_DOCUMENTO_COLABORADOR",
        entidade: "DocumentoColaborador",
        entidadeId: documento.id,
        detalhe: { colaboradorId: colaborador.id, tipoDocumento: tipoDocumento.nome },
        ip: request.ip,
      });

      avisarMudanca("documentos");

      return reply.code(201).send(documento);
    }
  );

  app.get(
    "/documentos-colaborador",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM)] },
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);
      const { skip, take } = toSkipTake(query);

      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.colaboradorId ? { colaboradorId: query.colaboradorId } : {}),
        ...(query.tipoDocumentoId ? { tipoDocumentoId: query.tipoDocumentoId } : {}),
        ...(query.vencendo
          ? {
              status: "APROVADO" as const,
              dataValidade: {
                gte: new Date(),
                lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              },
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        app.prisma.documentoColaborador.findMany({
          where,
          skip,
          take,
          orderBy: { criadoEm: "desc" },
          include: {
            colaborador: { select: { id: true, nomeCompleto: true } },
            tipoDocumento: { select: { id: true, nome: true, exigeValidade: true } },
          },
        }),
        app.prisma.documentoColaborador.count({ where }),
      ]);

      return reply.send(paginatedResponse(items, total, query));
    }
  );

  app.get("/documentos-colaborador/meus", { preHandler: [app.authenticate] }, async (request, reply) => {
    const colaboradorId = request.user.colaboradorId;
    if (!colaboradorId) return reply.send(paginatedResponse([], 0, { page: 1, pageSize: 20 }));

    const query = paginationSchema.parse(request.query);
    const { skip, take } = toSkipTake(query);

    const [items, total] = await Promise.all([
      app.prisma.documentoColaborador.findMany({
        where: { colaboradorId },
        skip,
        take,
        orderBy: { criadoEm: "desc" },
        include: { tipoDocumento: { select: { id: true, nome: true, descricao: true, exigeValidade: true } } },
      }),
      app.prisma.documentoColaborador.count({ where: { colaboradorId } }),
    ]);

    return reply.send(paginatedResponse(items, total, query));
  });

  app.get("/documentos-colaborador/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const documento = await app.prisma.documentoColaborador.findUnique({
      where: { id },
      include: {
        colaborador: { select: { id: true, nomeCompleto: true } },
        tipoDocumento: true,
        eventos: { orderBy: { criadoEm: "asc" }, include: { autor: { select: { id: true, email: true } } } },
      },
    });
    if (!documento) return reply.code(404).send({ error: "Documento não encontrado." });

    const ehDono = documento.colaboradorId === request.user.colaboradorId;
    if (!ehDono && !ehGestorDocumento(request.user.papel)) {
      return reply.code(403).send({ error: "Você não tem permissão para ver este documento." });
    }

    return reply.send(documento);
  });

  // POST /documentos-colaborador/:id/enviar — só o próprio dono, nunca RH
  // enviando "no lugar de" (se o RH tiver o arquivo em mãos, o fluxo
  // correto é orientar o colaborador a enviar, mantendo a autoria real do
  // envio rastreável).
  app.post("/documentos-colaborador/:id/enviar", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const documento = await app.prisma.documentoColaborador.findUnique({
      where: { id },
      include: { tipoDocumento: true },
    });
    if (!documento) return reply.code(404).send({ error: "Documento não encontrado." });
    if (documento.colaboradorId !== request.user.colaboradorId) {
      return reply.code(403).send({ error: "Você só pode enviar os próprios documentos." });
    }
    if (documento.status === "CANCELADO") {
      return reply.code(400).send({ error: "Esta solicitação foi cancelada e não aceita mais envio." });
    }

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Nenhum arquivo enviado." });
    if (!MIME_TYPES_PERMITIDOS.has(file.mimetype)) {
      await file.file.resume();
      return reply.code(400).send({ error: "Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou PDF." });
    }

    const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(`documento-${id}`, file.filename);
    await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });

    try {
      await pipeline(file.file, fs.createWriteStream(caminhoAbsoluto));
    } catch (err) {
      await fs.promises.rm(caminhoAbsoluto, { force: true });
      throw err;
    }

    const { size } = await fs.promises.stat(caminhoAbsoluto);
    if (file.file.truncated || size > TAMANHO_MAXIMO_BYTES) {
      await fs.promises.rm(caminhoAbsoluto, { force: true });
      return reply.code(413).send({
        error: `Arquivo excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)}MB).`,
      });
    }

    const arquivoAntigo = documento.arquivoUrl;
    // Reenvio depois de rejeitado/expirado volta pro início do fluxo de
    // análise — nunca herda uma aprovação/validade antiga.
    const atualizado = await app.prisma.documentoColaborador.update({
      where: { id },
      data: {
        status: "ENVIADO",
        arquivoUrl: caminhoRelativo,
        arquivoNomeOriginal: file.filename,
        arquivoTipo: file.mimetype,
        arquivoTamanhoBytes: size,
        enviadoEm: new Date(),
        dataValidade: null,
        analisadoPorId: null,
        analisadoEm: null,
        motivoRejeicao: null,
        alertasVencimentoEnviados: [],
      },
    });
    if (arquivoAntigo) removerArquivoAnexo(arquivoAntigo);

    await app.prisma.documentoColaboradorEvento.create({
      data: { documentoId: id, tipo: "ENVIO", autorId: request.user.sub },
    });

    await notificarPorPapeis(
      app,
      PAPEIS_GERENCIAM,
      {
        categoria: "DOCUMENTO",
        tipo: "DOCUMENTO_ENVIADO",
        titulo: "Documento enviado para análise",
        mensagem: `Documento "${documento.tipoDocumento.nome}" enviado — aguardando análise.`,
        entidade: "DocumentoColaborador",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      }
    );

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "ENVIAR_DOCUMENTO_COLABORADOR",
      entidade: "DocumentoColaborador",
      entidadeId: id,
      ip: request.ip,
    });

    avisarMudanca("documentos");

    return reply.code(201).send(atualizado);
  });

  app.patch(
    "/documentos-colaborador/:id/analisar",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = analisarDocumentoSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const documento = await app.prisma.documentoColaborador.findUnique({
        where: { id },
        include: { tipoDocumento: true },
      });
      if (!documento) return reply.code(404).send({ error: "Documento não encontrado." });
      if (!STATUS_ANALISAVEIS.includes(documento.status)) {
        return reply.code(400).send({ error: `Documento no status ${documento.status} não pode ser analisado agora.` });
      }
      if (parsed.data.aprovado && documento.tipoDocumento.exigeValidade && !parsed.data.dataValidade) {
        return reply.code(400).send({ error: "Este tipo de documento exige data de validade para ser aprovado." });
      }

      const usuarioColaborador = await app.prisma.usuario.findUnique({ where: { colaboradorId: documento.colaboradorId } });

      const atualizado = await app.prisma.documentoColaborador.update({
        where: { id },
        data: {
          status: parsed.data.aprovado ? "APROVADO" : "REJEITADO",
          dataValidade: parsed.data.aprovado ? parsed.data.dataValidade ?? null : null,
          analisadoPorId: request.user.sub,
          analisadoEm: new Date(),
          motivoRejeicao: parsed.data.aprovado ? null : parsed.data.motivoRejeicao,
        },
      });

      await app.prisma.documentoColaboradorEvento.create({
        data: {
          documentoId: id,
          tipo: parsed.data.aprovado ? "ANALISE_APROVADA" : "ANALISE_REJEITADA",
          autorId: request.user.sub,
          mensagem: parsed.data.aprovado ? null : parsed.data.motivoRejeicao,
        },
      });

      if (usuarioColaborador) {
        await notificar(app, {
          destinatarioIds: [usuarioColaborador.id],
          categoria: "DOCUMENTO",
          tipo: parsed.data.aprovado ? "DOCUMENTO_APROVADO" : "DOCUMENTO_REJEITADO",
          titulo: parsed.data.aprovado ? "Documento aprovado" : "Documento rejeitado",
          mensagem: parsed.data.aprovado
            ? `Seu documento "${documento.tipoDocumento.nome}" foi aprovado.`
            : `Seu documento "${documento.tipoDocumento.nome}" foi rejeitado: ${parsed.data.motivoRejeicao}`,
          prioridade: parsed.data.aprovado ? "MEDIA" : "ALTA",
          entidade: "DocumentoColaborador",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      }

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: parsed.data.aprovado ? "APROVAR_DOCUMENTO_COLABORADOR" : "REJEITAR_DOCUMENTO_COLABORADOR",
        entidade: "DocumentoColaborador",
        entidadeId: id,
        detalhe: parsed.data,
        ip: request.ip,
      });

      avisarMudanca("documentos");

      return reply.send(atualizado);
    }
  );

  app.patch(
    "/documentos-colaborador/:id/cancelar",
    { preHandler: [app.authenticate, app.requireRole(...PAPEIS_GERENCIAM)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const documento = await app.prisma.documentoColaborador.findUnique({ where: { id } });
      if (!documento) return reply.code(404).send({ error: "Documento não encontrado." });
      if (documento.status === "CANCELADO") return reply.send(documento);

      const atualizado = await app.prisma.documentoColaborador.update({
        where: { id },
        data: { status: "CANCELADO" },
      });

      await app.prisma.documentoColaboradorEvento.create({
        data: { documentoId: id, tipo: "CANCELADO", autorId: request.user.sub },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CANCELAR_DOCUMENTO_COLABORADOR",
        entidade: "DocumentoColaborador",
        entidadeId: id,
        ip: request.ip,
      });

      avisarMudanca("documentos");

      return reply.send(atualizado);
    }
  );

  app.post("/documentos-colaborador/:id/comentarios", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = comentarioSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

    const documento = await app.prisma.documentoColaborador.findUnique({
      where: { id },
      include: { tipoDocumento: true },
    });
    if (!documento) return reply.code(404).send({ error: "Documento não encontrado." });

    const ehDono = documento.colaboradorId === request.user.colaboradorId;
    if (!ehDono && !ehGestorDocumento(request.user.papel)) {
      return reply.code(403).send({ error: "Você não tem permissão para comentar neste documento." });
    }

    const evento = await app.prisma.documentoColaboradorEvento.create({
      data: { documentoId: id, tipo: "COMENTARIO", autorId: request.user.sub, mensagem: parsed.data.mensagem },
    });

    // Notifica "o outro lado" da conversa — RH quando quem comentou foi o
    // colaborador, o colaborador quando quem comentou foi o RH/Admin.
    if (ehDono) {
      await notificarPorPapeis(app, PAPEIS_GERENCIAM, {
        categoria: "DOCUMENTO",
        tipo: "DOCUMENTO_COMENTARIO",
        titulo: "Novo comentário em documento",
        mensagem: `Comentário em "${documento.tipoDocumento.nome}": ${parsed.data.mensagem}`,
        entidade: "DocumentoColaborador",
        entidadeId: id,
        origemUsuarioId: request.user.sub,
      });
    } else {
      const usuarioColaborador = await app.prisma.usuario.findUnique({ where: { colaboradorId: documento.colaboradorId } });
      if (usuarioColaborador) {
        await notificar(app, {
          destinatarioIds: [usuarioColaborador.id],
          categoria: "DOCUMENTO",
          tipo: "DOCUMENTO_COMENTARIO",
          titulo: "Novo comentário em documento",
          mensagem: `Comentário em "${documento.tipoDocumento.nome}": ${parsed.data.mensagem}`,
          entidade: "DocumentoColaborador",
          entidadeId: id,
          origemUsuarioId: request.user.sub,
        });
      }
    }

    avisarMudanca("documentos");

    return reply.code(201).send(evento);
  });

  app.get("/documentos-colaborador/:id/arquivo", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const documento = await app.prisma.documentoColaborador.findUnique({ where: { id } });
    if (!documento || !documento.arquivoUrl) return reply.code(404).send({ error: "Arquivo não encontrado." });

    const ehDono = documento.colaboradorId === request.user.colaboradorId;
    if (!ehDono && !ehGestorDocumento(request.user.papel)) {
      return reply.code(403).send({ error: "Você não tem permissão para baixar este arquivo." });
    }

    const caminhoAbsoluto = caminhoAbsolutoDoAnexo(documento.arquivoUrl);
    if (!caminhoAbsoluto || !fs.existsSync(caminhoAbsoluto)) {
      return reply.code(404).send({ error: "Arquivo não encontrado no armazenamento." });
    }

    const nomeOriginal = (documento.arquivoNomeOriginal || "documento").replace(/"/g, "");
    reply.header("Content-Disposition", `inline; filename="${nomeOriginal}"`);
    if (documento.arquivoTipo) reply.header("Content-Type", documento.arquivoTipo);

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "BAIXAR_DOCUMENTO_COLABORADOR",
      entidade: "DocumentoColaborador",
      entidadeId: id,
      ip: request.ip,
    });

    return reply.send(fs.createReadStream(caminhoAbsoluto));
  });
}
