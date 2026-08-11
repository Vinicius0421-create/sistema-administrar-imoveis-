import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { TemaUsuario } from "@prisma/client";
import { hashToken } from "../utils/tokens";
import { registrarAuditoria } from "../utils/audit";
import {
  caminhoAbsolutoDoAnexo,
  caminhoParaNovoAnexo,
  MIME_TYPES_PERMITIDOS,
  removerArquivoAnexo,
  TAMANHO_MAXIMO_BYTES,
} from "../utils/anexos";

// Item 3 da missão "Melhorias Adicionais" (08/07/2026, pedido do Vini):
// centralizar as informações do usuário logado (foto, dados pessoais,
// sessões ativas) num único lugar. Rota própria (em vez de espalhar em
// auth.routes.ts ou colaboradores.routes.ts) porque o assunto aqui é
// sempre "o usuário autenticado vendo/editando A SI MESMO" — nenhuma
// dessas rotas aceita id de outra pessoa, ao contrário de
// colaboradores.routes.ts (que é a tela de gestão, usada por
// ADMINISTRADOR/RH sobre QUALQUER colaborador). Reaproveita a mesma infra
// de arquivo (ANEXOS_DIR/Railway Volume) já usada por anexo de chamado e
// termo de responsabilidade — ver utils/anexos.ts.
export default async function perfilRoutes(app: FastifyInstance) {
  // GET /perfil — dados consolidados pro menu do usuário: além do que
  // /auth/me já devolve (usado no boot da sessão), inclui cargo/setor/
  // telefone/foto, que só fazem sentido quando o menu é aberto de fato —
  // por isso é uma chamada separada, sob demanda, em vez de inflar
  // /auth/me (chamado em todo boot e todo refresh).
  app.get("/perfil", { preHandler: [app.authenticate] }, async (request, reply) => {
    const usuario = await app.prisma.usuario.findUnique({
      where: { id: request.user.sub },
      select: {
        id: true,
        email: true,
        papel: true,
        criadoEm: true,
        colaborador: {
          select: {
            id: true,
            nomeCompleto: true,
            // Múltiplos telefones (07/08/2026) — o menu do usuário só
            // precisa de UM número pra mostrar (telefonePrincipal abaixo),
            // mas devolve a lista completa também, pronta pra uma tela
            // futura de "meu perfil" que edite os próprios telefones.
            telefones: { orderBy: [{ principal: "desc" }, { criadoEm: "asc" }] },
            fotoUrl: true,
            cargo: { select: { nome: true } },
            setor: { select: { nome: true } },
          },
        },
      },
    });
    if (!usuario) return reply.code(404).send({ error: "Usuário não encontrado." });

    return reply.send({
      id: usuario.id,
      email: usuario.email,
      papel: usuario.papel,
      contaCriadaEm: usuario.criadoEm,
      colaborador: usuario.colaborador
        ? {
            nomeCompleto: usuario.colaborador.nomeCompleto,
            telefonePrincipal: usuario.colaborador.telefones.find((t) => t.principal)?.numero
              ?? usuario.colaborador.telefones[0]?.numero
              ?? null,
            telefones: usuario.colaborador.telefones,
            temFoto: !!usuario.colaborador.fotoUrl,
            cargo: usuario.colaborador.cargo?.nome ?? null,
            setor: usuario.colaborador.setor?.nome ?? null,
          }
        : null,
    });
  });

  // POST /perfil/foto — autoatendimento: só a própria foto, nunca a de
  // outro colaborador (isso continua sendo feito por um ADMINISTRADOR/
  // GESTOR_COORDENADOR via POST /colaboradores/:id/termo-responsabilidade,
  // rota diferente). Exige colaboradorId vinculado — contas "puras" (ex: o
  // admin semente, sem cadastro de colaborador) não têm onde guardar a
  // foto; a mensagem explica isso em vez de um 404/500 genérico.
  app.post("/perfil/foto", { preHandler: [app.authenticate] }, async (request, reply) => {
    const colaboradorId = request.user.colaboradorId;
    if (!colaboradorId) {
      return reply.code(400).send({
        error: "Sua conta não está vinculada a um cadastro de colaborador — não há onde salvar a foto.",
      });
    }

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Nenhum arquivo enviado." });

    if (!MIME_TYPES_PERMITIDOS.has(file.mimetype) || file.mimetype === "application/pdf") {
      await file.file.resume();
      return reply.code(400).send({ error: "Envie uma imagem (JPEG, PNG, WEBP ou GIF)." });
    }

    const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(`foto-perfil-${colaboradorId}`, file.filename);
    await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });

    try {
      await pipeline(file.file, fs.createWriteStream(caminhoAbsoluto));
    } catch (err) {
      await fs.promises.rm(caminhoAbsoluto, { force: true });
      throw err;
    }

    // Mesma checagem pós-gravação documentada em colaboradores.routes.ts
    // (termo de responsabilidade): o teto do parser multipart é
    // compartilhado com o anexo de mensagem (20MB), maior que o limite
    // próprio de foto de perfil (10MB, mesmo teto de MIME_TYPES_PERMITIDOS).
    const { size } = await fs.promises.stat(caminhoAbsoluto);
    if (file.file.truncated || size > TAMANHO_MAXIMO_BYTES) {
      await fs.promises.rm(caminhoAbsoluto, { force: true });
      return reply.code(413).send({
        error: `Imagem excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)}MB).`,
      });
    }

    const colaborador = await app.prisma.colaborador.findUnique({ where: { id: colaboradorId } });
    const fotoAntiga = colaborador?.fotoUrl;

    await app.prisma.colaborador.update({
      where: { id: colaboradorId },
      data: { fotoUrl: caminhoRelativo },
    });

    if (fotoAntiga) removerArquivoAnexo(fotoAntiga);

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "ATUALIZAR_FOTO_PERFIL",
      entidade: "Colaborador",
      entidadeId: colaboradorId,
      ip: request.ip,
    });

    return reply.code(201).send({ ok: true });
  });

  // GET /perfil/foto — serve a própria foto. Só o dono vê pelo próprio
  // token (não existe rota pública nem rota "ver foto de outro colaborador"
  // — fora do escopo do menu do usuário; se algum dia fizer sentido exibir
  // foto de colega em outra tela, essa é uma decisão de produto separada,
  // com sua própria regra de visibilidade).
  app.get("/perfil/foto", { preHandler: [app.authenticate] }, async (request, reply) => {
    const colaboradorId = request.user.colaboradorId;
    if (!colaboradorId) return reply.code(404).send({ error: "Sem foto cadastrada." });

    const colaborador = await app.prisma.colaborador.findUnique({ where: { id: colaboradorId } });
    if (!colaborador?.fotoUrl) return reply.code(404).send({ error: "Sem foto cadastrada." });

    const caminhoAbsoluto = caminhoAbsolutoDoAnexo(colaborador.fotoUrl);
    if (!caminhoAbsoluto || !fs.existsSync(caminhoAbsoluto)) {
      return reply.code(404).send({ error: "Arquivo não encontrado no armazenamento." });
    }

    return reply.send(fs.createReadStream(caminhoAbsoluto));
  });

  app.delete("/perfil/foto", { preHandler: [app.authenticate] }, async (request, reply) => {
    const colaboradorId = request.user.colaboradorId;
    if (!colaboradorId) return reply.code(204).send();

    const colaborador = await app.prisma.colaborador.findUnique({ where: { id: colaboradorId } });
    if (!colaborador?.fotoUrl) return reply.code(204).send();

    removerArquivoAnexo(colaborador.fotoUrl);
    await app.prisma.colaborador.update({ where: { id: colaboradorId }, data: { fotoUrl: null } });

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "REMOVER_FOTO_PERFIL",
      entidade: "Colaborador",
      entidadeId: colaboradorId,
      ip: request.ip,
    });

    return reply.code(204).send();
  });

  // GET /perfil/sessoes — "Segurança da conta": lista os refresh tokens
  // ativos (não revogados, não expirados) do usuário — cada um representa,
  // na prática, um navegador/dispositivo com sessão persistente aberta (ver
  // Persistência de Login, item 2 da mesma missão). Marca `atual: true` na
  // sessão cujo token bate com o cookie httpOnly desta própria requisição —
  // é o único jeito de saber "qual dessas sou eu agora" sem inventar um id
  // de sessão separado do refresh token.
  app.get("/perfil/sessoes", { preHandler: [app.authenticate] }, async (request, reply) => {
    const cookieAtual = request.cookies["rt"];
    const hashAtual = cookieAtual ? hashToken(cookieAtual) : null;

    const sessoes = await app.prisma.refreshToken.findMany({
      where: { usuarioId: request.user.sub, revogadoEm: null, expiraEm: { gt: new Date() } },
      orderBy: { criadoEm: "desc" },
      select: { id: true, criadoEm: true, expiraEm: true, tokenHash: true },
    });

    return reply.send(
      sessoes.map((s) => ({
        id: s.id,
        criadoEm: s.criadoEm,
        expiraEm: s.expiraEm,
        atual: hashAtual !== null && s.tokenHash === hashAtual,
      }))
    );
  });

  // DELETE /perfil/sessoes/:id — encerra uma sessão específica (ex: "não
  // reconheço esse acesso, vou revogar"). Sempre checa usuarioId — nunca
  // deixa revogar sessão de outra pessoa mesmo sabendo o id.
  app.delete("/perfil/sessoes/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const resultado = await app.prisma.refreshToken.updateMany({
      where: { id, usuarioId: request.user.sub, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
    if (resultado.count === 0) {
      return reply.code(404).send({ error: "Sessão não encontrada." });
    }
    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "ENCERRAR_SESSAO",
      entidade: "RefreshToken",
      entidadeId: id,
      ip: request.ip,
    });
    return reply.code(204).send();
  });

  // POST /perfil/sessoes/encerrar-outras — "saí de todo lugar, menos
  // daqui" — útil depois de perder um celular/notebook sem lembrar de
  // deslogar antes. Preserva a sessão atual (identificada pelo cookie desta
  // requisição) para não derrubar a própria pessoa no ato.
  app.post("/perfil/sessoes/encerrar-outras", { preHandler: [app.authenticate] }, async (request, reply) => {
    const cookieAtual = request.cookies["rt"];
    const hashAtual = cookieAtual ? hashToken(cookieAtual) : null;

    const where = hashAtual
      ? { usuarioId: request.user.sub, revogadoEm: null, tokenHash: { not: hashAtual } }
      : { usuarioId: request.user.sub, revogadoEm: null };

    const resultado = await app.prisma.refreshToken.updateMany({ where, data: { revogadoEm: new Date() } });

    await registrarAuditoria(app, {
      usuarioId: request.user.sub,
      acao: "ENCERRAR_OUTRAS_SESSOES",
      entidade: "Usuario",
      entidadeId: request.user.sub,
      detalhe: { quantidade: resultado.count },
      ip: request.ip,
    });

    return reply.send({ encerradas: resultado.count });
  });

  // Preferências pessoais de conta (10/07/2026, pedido do Vini: "crie
  // preferências, não tem nenhuma" → "tema do sistema e etc"). Mesmo
  // padrão de /notificacoes/preferencias: sem :id de propósito (sempre a
  // do próprio usuário logado), GET devolve um default quando não há linha
  // salva ainda, PATCH faz upsert.
  app.get("/perfil/preferencias", { preHandler: [app.authenticate] }, async (request, reply) => {
    const pref = await app.prisma.preferenciaUsuario.findUnique({ where: { usuarioId: request.user.sub } });
    return reply.send(pref ?? { usuarioId: request.user.sub, tema: "SISTEMA" as TemaUsuario });
  });

  const preferenciaUsuarioSchema = z.object({
    tema: z.nativeEnum(TemaUsuario),
  });

  app.patch("/perfil/preferencias", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = preferenciaUsuarioSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

    const pref = await app.prisma.preferenciaUsuario.upsert({
      where: { usuarioId: request.user.sub },
      update: { tema: parsed.data.tema },
      create: { usuarioId: request.user.sub, tema: parsed.data.tema },
    });
    return reply.send(pref);
  });
}
