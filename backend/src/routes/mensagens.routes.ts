import { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { MultipartFile } from "@fastify/multipart";
import { registrarAuditoria } from "../utils/audit";
import {
  caminhoAbsolutoDoAnexo,
  caminhoParaNovoAnexo,
  MIME_TYPES_PERMITIDOS_MENSAGEM,
  removerArquivoAnexo,
  TAMANHO_MAXIMO_BYTES_MENSAGEM,
} from "../utils/anexos";
import { carregarPermissaoCanais, podeAcessarCanal, resolverMembrosCanal } from "../utils/canaisMensagem";
import { notificar } from "../utils/notificacoes.service";
import { nomeExibicaoUsuario } from "../utils/usuarios";

// Chat interno (07/07/2026, pedido do Vini: "criar um jeito de conversar
// entre os usuários"). Duas opções foram apresentadas — mensagens diretas
// simples ou tempo real via WebSocket — e ele escolheu "direto + canais por
// unidade/setor", mantendo a base simples (busca por polling, sem
// WebSocket): dá conta do tamanho do time hoje sem introduzir infra nova
// pra testar antes de ir pra produção. Ver comentário do model Mensagem em
// schema.prisma pro desenho dos dois modos.
//
// Atualização de 08/07/2026 (pedido do Vini: "os colaboradores não
// conseguem mandar mensagem nos canais... garanta que eles conseguem
// conversar apenas nos canais deles"): mensagem direta continua livre pra
// qualquer autenticado (sem dado novo exposto — a lista de colegas já é
// visível via GET /colaboradores). Canal (unidade/setor) agora é
// restringido pra papel COLABORADOR via carregarPermissaoCanais — ver
// src/utils/canaisMensagem.ts. ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI
// continuam irrestritos, mesmo comportamento de antes.

const MENSAGENS_PASTA_ANEXO = "mensagens";

const enviarSchema = z
  .object({
    tipo: z.enum(["DIRETA", "CANAL_UNIDADE", "CANAL_SETOR"]),
    destinatarioId: z.string().optional(),
    unidadeId: z.string().optional(),
    setorId: z.string().optional(),
    // Opcional agora (antes exigia min(1)) — uma mensagem pode ser só um
    // anexo, sem texto nenhum. A regra "precisa ter pelo menos um dos dois"
    // é validada à parte, depois de saber se veio arquivo (ver rota abaixo).
    conteudo: z.string().trim().max(4000).optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.tipo === "DIRETA" && !data.destinatarioId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["destinatarioId"], message: "Informe o destinatário." });
    }
    if (data.tipo === "CANAL_UNIDADE" && !data.unidadeId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unidadeId"], message: "Informe a unidade." });
    }
    if (data.tipo === "CANAL_SETOR" && !data.setorId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["setorId"], message: "Informe o setor." });
    }
  });

const acessoExtraSchema = z
  .object({
    colaboradorId: z.string().optional().nullable(),
    setorOrigemId: z.string().optional().nullable(),
    tipo: z.enum(["CANAL_UNIDADE", "CANAL_SETOR"]),
    setorDestinoId: z.string().optional().nullable(),
    unidadeDestinoId: z.string().optional().nullable(),
    observacao: z.string().trim().max(300).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const origens = [data.colaboradorId, data.setorOrigemId].filter(Boolean);
    if (origens.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["colaboradorId"],
        message: "Informe exatamente um: colaboradorId (exceção pontual) ou setorOrigemId (regra pro setor inteiro).",
      });
    }
    if (data.tipo === "CANAL_SETOR" && !data.setorDestinoId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["setorDestinoId"], message: "Informe o setor concedido." });
    }
    if (data.tipo === "CANAL_UNIDADE" && !data.unidadeDestinoId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unidadeDestinoId"], message: "Informe a unidade concedida." });
    }
  });

const AUTOR_SELECT = { select: { id: true, email: true, papel: true, colaborador: { select: { nomeCompleto: true } } } };

export default async function mensagensRoutes(app: FastifyInstance) {
  app.post("/mensagens", { preHandler: [app.authenticate] }, async (request, reply) => {
    // Mensagem pode vir como JSON puro (só texto, comportamento de sempre)
    // ou multipart (texto opcional + um arquivo), tudo numa requisição só —
    // mais simples pro cliente do que criar a mensagem e só depois anexar
    // (sem risco de mensagem "órfã" se o upload falhar no meio). Convenção
    // do lado do cliente (ver src/api/mensagens.ts no frontend): campos de
    // texto sempre antes do campo "file" no FormData, pra dar pra validar
    // tudo antes de decidir gravar o arquivo em disco.
    const camposBrutos: Record<string, unknown> = {};
    let arquivo: MultipartFile | null = null;

    if (request.isMultipart()) {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          arquivo = part;
          break;
        }
        camposBrutos[part.fieldname] = part.value;
      }
    } else {
      Object.assign(camposBrutos, (request.body as Record<string, unknown>) || {});
    }

    const parsed = enviarSchema.safeParse(camposBrutos);
    if (!parsed.success) {
      if (arquivo) await arquivo.file.resume();
      return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
    }
    const { tipo, destinatarioId, unidadeId, setorId, conteudo } = parsed.data;

    if (!conteudo.trim() && !arquivo) {
      return reply.code(400).send({ error: "Escreva uma mensagem ou anexe um arquivo." });
    }

    if (tipo === "DIRETA") {
      if (destinatarioId === request.user.sub) {
        if (arquivo) await arquivo.file.resume();
        return reply.code(400).send({ error: "Não é possível enviar mensagem para si mesmo." });
      }
      const destinatario = await app.prisma.usuario.findUnique({ where: { id: destinatarioId } });
      if (!destinatario || !destinatario.ativo) {
        if (arquivo) await arquivo.file.resume();
        return reply.code(404).send({ error: "Destinatário não encontrado ou inativo." });
      }
    }
    // `nomeCanal` guardado aqui fora (em vez de só dentro do if de validação)
    // porque o bloco de notificação lá embaixo precisa do nome pra montar o
    // título ("Nova mensagem em #Locação de ...") sem ter que buscar o
    // registro de novo.
    let nomeCanal: string | undefined;
    if (tipo === "CANAL_UNIDADE") {
      const unidade = await app.prisma.unidade.findUnique({ where: { id: unidadeId } });
      if (!unidade) {
        if (arquivo) await arquivo.file.resume();
        return reply.code(404).send({ error: "Unidade não encontrada." });
      }
      nomeCanal = unidade.nome;
    }
    if (tipo === "CANAL_SETOR") {
      const setor = await app.prisma.setor.findUnique({ where: { id: setorId } });
      if (!setor) {
        if (arquivo) await arquivo.file.resume();
        return reply.code(404).send({ error: "Setor não encontrado." });
      }
      nomeCanal = setor.nome;
    }

    if (tipo === "CANAL_UNIDADE" || tipo === "CANAL_SETOR") {
      const permissao = await carregarPermissaoCanais(app, request.user);
      const idAlvo = (tipo === "CANAL_UNIDADE" ? unidadeId : setorId) as string;
      if (!podeAcessarCanal(permissao, tipo, idAlvo)) {
        if (arquivo) await arquivo.file.resume();
        return reply.code(403).send({ error: "Você não tem acesso a este canal." });
      }
    }

    let dadosAnexo: {
      anexoUrl: string;
      anexoNomeOriginal: string;
      anexoTipo: string;
      anexoTamanhoBytes: number;
    } | null = null;

    if (arquivo) {
      if (!MIME_TYPES_PERMITIDOS_MENSAGEM.has(arquivo.mimetype)) {
        await arquivo.file.resume();
        return reply.code(400).send({
          error: "Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou vídeo (MP4, WEBM, MOV).",
        });
      }

      const { caminhoRelativo, caminhoAbsoluto } = caminhoParaNovoAnexo(MENSAGENS_PASTA_ANEXO, arquivo.filename);
      await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });

      try {
        await pipeline(arquivo.file, fs.createWriteStream(caminhoAbsoluto));
      } catch (err) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        throw err;
      }

      const { size: tamanhoBytes } = await fs.promises.stat(caminhoAbsoluto);
      if (arquivo.file.truncated || tamanhoBytes > TAMANHO_MAXIMO_BYTES_MENSAGEM) {
        await fs.promises.rm(caminhoAbsoluto, { force: true });
        return reply.code(413).send({
          error: `Arquivo excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES_MENSAGEM / 1024 / 1024)}MB).`,
        });
      }

      dadosAnexo = {
        anexoUrl: caminhoRelativo,
        anexoNomeOriginal: arquivo.filename,
        anexoTipo: arquivo.mimetype,
        anexoTamanhoBytes: tamanhoBytes,
      };
    }

    const mensagem = await app.prisma.mensagem.create({
      data: {
        tipo,
        remetenteId: request.user.sub,
        destinatarioId: tipo === "DIRETA" ? destinatarioId : null,
        unidadeId: tipo === "CANAL_UNIDADE" ? unidadeId : null,
        setorId: tipo === "CANAL_SETOR" ? setorId : null,
        conteudo: conteudo.trim(),
        ...(dadosAnexo ?? {}),
      },
      include: { remetente: AUTOR_SELECT },
    });

    // Central de Notificações (Fase B, 09/07/2026) — mensagem DIRETA tem um
    // destinatário único e óbvio (o próprio `destinatarioId` já é um id de
    // Usuario, sem precisar resolver colaborador→usuario como em outros
    // módulos).
    if (tipo === "DIRETA" && destinatarioId) {
      const preview = mensagem.conteudo.trim() || (dadosAnexo ? "Enviou um anexo." : "");
      await notificar(app, {
        destinatarioIds: [destinatarioId],
        categoria: "MENSAGEM",
        tipo: "MENSAGEM_DIRETA_NOVA",
        titulo: `Nova mensagem de ${nomeExibicaoUsuario(mensagem.remetente)}`,
        mensagem: preview.length > 140 ? `${preview.slice(0, 140)}…` : preview,
        entidade: "Mensagem",
        entidadeId: mensagem.id,
        origemUsuarioId: request.user.sub,
      });
    }

    // "Recentes" unificado (09/07/2026, pedido do Vini: "quero que os canais
    // fiquem nos recentes também" + notificação clicável) — mensagem de
    // canal agora também notifica, mas só quem de fato "pertence" ao canal
    // (ver o comentário de resolverMembrosCanal pra saber por que isso NÃO é
    // igual a "quem pode acessar o canal"), evitando o volume
    // desproporcional que motivou deixar isso de fora antes.
    if ((tipo === "CANAL_UNIDADE" || tipo === "CANAL_SETOR") && nomeCanal) {
      const idAlvo = (tipo === "CANAL_UNIDADE" ? unidadeId : setorId) as string;
      const membros = await resolverMembrosCanal(app, tipo, idAlvo);
      if (membros.length > 0) {
        const preview = mensagem.conteudo.trim() || (dadosAnexo ? "Enviou um anexo." : "");
        await notificar(app, {
          destinatarioIds: membros,
          categoria: "MENSAGEM",
          tipo: "MENSAGEM_CANAL_NOVA",
          titulo: `Nova mensagem em #${nomeCanal} de ${nomeExibicaoUsuario(mensagem.remetente)}`,
          mensagem: preview.length > 140 ? `${preview.slice(0, 140)}…` : preview,
          entidade: tipo === "CANAL_UNIDADE" ? "CanalUnidade" : "CanalSetor",
          entidadeId: idAlvo,
          origemUsuarioId: request.user.sub,
        });
      }
    }

    return reply.code(201).send(mensagem);
  });

  // "Recentes" unificado (09/07/2026, pedido do Vini: "só usei os canais até
  // agora, mas quero que eles fiquem nos recentes também") — antes esta
  // rota só olhava DIRETA; agora mistura, na mesma lista e ordenada só por
  // data da última mensagem, tanto conversa direta quanto qualquer canal
  // (unidade/setor) que o usuário tem acesso E que já tem pelo menos uma
  // mensagem. Feito em memória (não SQL agregado) de propósito, mesmo
  // racional de sempre: o volume de mensagens de um time deste tamanho é
  // pequeno, e isso evita uma query bruta só pra um "GROUP BY" que o Prisma
  // não expressa bem.
  //
  // Não lidas de canal: diferente de DIRETA (Mensagem.lidaEm, um campo só,
  // porque é sempre 1 remetente↔1 destinatário), um canal tem N
  // participantes lendo em momentos diferentes — por isso usa LeituraCanal
  // (1 linha por usuário×canal, "até quando eu já li"), nunca por mensagem
  // individual. Canal nunca aberto por esta pessoa (sem linha em
  // LeituraCanal) começa com 0 não lidas em vez do histórico inteiro — do
  // contrário, no dia em que este recurso foi lançado, todo mundo veria uma
  // enxurrada de "247 não lidas" em canais que já existiam há semanas. A
  // contagem só passa a valer a partir da primeira mensagem nova depois que
  // a pessoa abre o canal pela primeira vez.
  app.get("/mensagens/conversas", { preHandler: [app.authenticate] }, async (request, reply) => {
    const meuId = request.user.sub;

    const mensagensDiretas = await app.prisma.mensagem.findMany({
      where: { tipo: "DIRETA", OR: [{ remetenteId: meuId }, { destinatarioId: meuId }] },
      orderBy: { criadoEm: "asc" },
      include: { remetente: AUTOR_SELECT, destinatario: AUTOR_SELECT },
    });

    const porContato = new Map<string, any>();
    for (const m of mensagensDiretas) {
      const souEuRemetente = m.remetenteId === meuId;
      const contato = souEuRemetente ? m.destinatario : m.remetente;
      if (!contato) continue;
      const entrada = porContato.get(contato.id) || { tipo: "DIRETA" as const, contato, ultimaMensagem: m, naoLidas: 0 };
      entrada.ultimaMensagem = m;
      entrada.contato = contato;
      if (!souEuRemetente && !m.lidaEm) entrada.naoLidas += 1;
      porContato.set(contato.id, entrada);
    }

    const permissao = await carregarPermissaoCanais(app, request.user);
    let unidadesAcessiveis: { id: string; nome: string }[];
    let setoresAcessiveis: { id: string; nome: string }[];
    if (permissao.irrestrito) {
      [unidadesAcessiveis, setoresAcessiveis] = await Promise.all([
        app.prisma.unidade.findMany({ where: { status: "ATIVO" }, select: { id: true, nome: true } }),
        app.prisma.setor.findMany({ where: { status: "ATIVO" }, select: { id: true, nome: true } }),
      ]);
    } else {
      const idsUnidade = Array.from(permissao.unidades);
      const idsSetor = Array.from(permissao.setores);
      [unidadesAcessiveis, setoresAcessiveis] = await Promise.all([
        idsUnidade.length
          ? app.prisma.unidade.findMany({ where: { id: { in: idsUnidade } }, select: { id: true, nome: true } })
          : Promise.resolve([]),
        idsSetor.length
          ? app.prisma.setor.findMany({ where: { id: { in: idsSetor } }, select: { id: true, nome: true } })
          : Promise.resolve([]),
      ]);
    }

    const canaisRecentes: any[] = [];
    if (unidadesAcessiveis.length > 0 || setoresAcessiveis.length > 0) {
      const [mensagensUnidade, mensagensSetor, leituras] = await Promise.all([
        unidadesAcessiveis.length
          ? app.prisma.mensagem.findMany({
              where: { tipo: "CANAL_UNIDADE", unidadeId: { in: unidadesAcessiveis.map((u) => u.id) } },
              orderBy: { criadoEm: "asc" },
              include: { remetente: AUTOR_SELECT },
            })
          : Promise.resolve([]),
        setoresAcessiveis.length
          ? app.prisma.mensagem.findMany({
              where: { tipo: "CANAL_SETOR", setorId: { in: setoresAcessiveis.map((s) => s.id) } },
              orderBy: { criadoEm: "asc" },
              include: { remetente: AUTOR_SELECT },
            })
          : Promise.resolve([]),
        app.prisma.leituraCanal.findMany({ where: { usuarioId: meuId } }),
      ]);

      const lidaAteMap = new Map(leituras.map((l) => [`${l.tipo}:${l.canalId}`, l.lidaAte]));
      const nomePorChave = new Map<string, string>();
      for (const u of unidadesAcessiveis) nomePorChave.set(`CANAL_UNIDADE:${u.id}`, u.nome);
      for (const s of setoresAcessiveis) nomePorChave.set(`CANAL_SETOR:${s.id}`, s.nome);

      const porCanal = new Map<string, any>();
      for (const m of [...mensagensUnidade, ...mensagensSetor]) {
        const tipoCanal = m.tipo as "CANAL_UNIDADE" | "CANAL_SETOR";
        const idCanal = (tipoCanal === "CANAL_UNIDADE" ? m.unidadeId : m.setorId) as string;
        const chave = `${tipoCanal}:${idCanal}`;
        const entrada = porCanal.get(chave) || {
          tipo: tipoCanal,
          id: idCanal,
          nome: nomePorChave.get(chave) || "—",
          ultimaMensagem: m,
          naoLidas: 0,
        };
        entrada.ultimaMensagem = m;
        const lidaAte = lidaAteMap.get(chave);
        if (m.remetenteId !== meuId && lidaAte && m.criadoEm > lidaAte) entrada.naoLidas += 1;
        porCanal.set(chave, entrada);
      }
      canaisRecentes.push(...Array.from(porCanal.values()));
    }

    const recentes = [...Array.from(porContato.values()), ...canaisRecentes].sort(
      (a, b) => new Date(b.ultimaMensagem.criadoEm).getTime() - new Date(a.ultimaMensagem.criadoEm).getTime()
    );

    return reply.send(recentes);
  });

  // Marca como lida toda mensagem deste canal até agora — mesmo espírito de
  // PATCH /mensagens/direta/:usuarioId/lida, adaptado pro modelo de N
  // participantes (ver comentário de LeituraCanal em schema.prisma).
  // Upsert porque a primeira vez que a pessoa abre um canal ainda não tem
  // linha nenhuma em LeituraCanal.
  app.patch("/mensagens/canal/:tipo/:id/lida", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tipo, id } = request.params as { tipo: string; id: string };
    if (tipo !== "unidade" && tipo !== "setor") {
      return reply.code(400).send({ error: "Tipo de canal inválido — use 'unidade' ou 'setor'." });
    }
    const tipoEnum = tipo === "unidade" ? ("CANAL_UNIDADE" as const) : ("CANAL_SETOR" as const);
    const permissao = await carregarPermissaoCanais(app, request.user);
    if (!podeAcessarCanal(permissao, tipoEnum, id)) {
      return reply.code(403).send({ error: "Você não tem acesso a este canal." });
    }

    await app.prisma.leituraCanal.upsert({
      where: { usuarioId_tipo_canalId: { usuarioId: request.user.sub, tipo: tipoEnum, canalId: id } },
      update: { lidaAte: new Date() },
      create: { usuarioId: request.user.sub, tipo: tipoEnum, canalId: id, lidaAte: new Date() },
    });
    return reply.code(204).send();
  });

  // Contador leve pra badge de "não lidas" na barra lateral — separado de
  // /conversas pra não obrigar a tela inteira a recarregar só pra atualizar
  // um número (é chamado com mais frequência, no polling da AppShell). Inclui
  // canal desde 09/07/2026 (mesmo racional de "não lida" de /conversas acima
  // — só conta LeituraCanal já existente, nunca o histórico de um canal
  // nunca aberto).
  app.get("/mensagens/contadores", { preHandler: [app.authenticate] }, async (request, reply) => {
    const meuId = request.user.sub;
    const diretasNaoLidas = await app.prisma.mensagem.count({
      where: { tipo: "DIRETA", destinatarioId: meuId, lidaEm: null },
    });

    const leituras = await app.prisma.leituraCanal.findMany({ where: { usuarioId: meuId } });
    let canaisNaoLidas = 0;
    if (leituras.length > 0) {
      const contagens = await Promise.all(
        leituras.map((l) =>
          app.prisma.mensagem.count({
            where: {
              tipo: l.tipo,
              // CANAL_EMPRESA (canal da empresa inteira) não tem unidadeId/
              // setorId — não filtra por nenhum dos dois, só pelo tipo.
              ...(l.tipo === "CANAL_UNIDADE"
                ? { unidadeId: l.canalId }
                : l.tipo === "CANAL_SETOR"
                  ? { setorId: l.canalId }
                  : {}),
              criadoEm: { gt: l.lidaAte },
              remetenteId: { not: meuId },
            },
          })
        )
      );
      canaisNaoLidas = contagens.reduce((a, b) => a + b, 0);
    }

    return reply.send({ diretasNaoLidas, canaisNaoLidas, total: diretasNaoLidas + canaisNaoLidas });
  });

  // Canais (unidade/setor) que o usuário logado pode ver e postar — usado
  // pelo frontend pra montar a lista de canais sem tentar cada um e tomar
  // 403 (ver GET /mensagens/canal/:tipo/:id abaixo, que aplica a mesma regra
  // na leitura). Pra ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI devolve
  // tudo (irrestrito), igual ao comportamento de sempre.
  app.get("/mensagens/canais-disponiveis", { preHandler: [app.authenticate] }, async (request, reply) => {
    const [unidades, setores] = await Promise.all([
      app.prisma.unidade.findMany({ where: { status: "ATIVO" }, orderBy: { nome: "asc" } }),
      app.prisma.setor.findMany({ where: { status: "ATIVO" }, orderBy: { nome: "asc" } }),
    ]);

    const permissao = await carregarPermissaoCanais(app, request.user);
    if (permissao.irrestrito) {
      return reply.send({ unidades, setores, irrestrito: true });
    }

    return reply.send({
      unidades: unidades.filter((u) => permissao.unidades.has(u.id)),
      setores: setores.filter((s) => permissao.setores.has(s.id)),
      irrestrito: false,
    });
  });

  app.get("/mensagens/direta/:usuarioId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { usuarioId } = request.params as { usuarioId: string };
    const meuId = request.user.sub;

    const outroUsuario = await app.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!outroUsuario) return reply.code(404).send({ error: "Usuário não encontrado." });

    const mensagens = await app.prisma.mensagem.findMany({
      where: {
        tipo: "DIRETA",
        OR: [
          { remetenteId: meuId, destinatarioId: usuarioId },
          { remetenteId: usuarioId, destinatarioId: meuId },
        ],
      },
      orderBy: { criadoEm: "asc" },
      take: 200,
      include: { remetente: AUTOR_SELECT },
    });

    return reply.send(mensagens);
  });

  // Marca como lida toda mensagem que o outro usuário me mandou e ainda não
  // tinha sido lida — chamado quando a conversa é aberta na tela.
  app.patch("/mensagens/direta/:usuarioId/lida", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { usuarioId } = request.params as { usuarioId: string };
    await app.prisma.mensagem.updateMany({
      where: { tipo: "DIRETA", remetenteId: usuarioId, destinatarioId: request.user.sub, lidaEm: null },
      data: { lidaEm: new Date() },
    });
    return reply.code(204).send();
  });

  app.get("/mensagens/canal/:tipo/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tipo, id } = request.params as { tipo: string; id: string };
    if (tipo !== "unidade" && tipo !== "setor") {
      return reply.code(400).send({ error: "Tipo de canal inválido — use 'unidade' ou 'setor'." });
    }

    const tipoEnum = tipo === "unidade" ? ("CANAL_UNIDADE" as const) : ("CANAL_SETOR" as const);
    const permissao = await carregarPermissaoCanais(app, request.user);
    if (!podeAcessarCanal(permissao, tipoEnum, id)) {
      return reply.code(403).send({ error: "Você não tem acesso a este canal." });
    }

    const where = tipo === "unidade" ? { tipo: "CANAL_UNIDADE" as const, unidadeId: id } : { tipo: "CANAL_SETOR" as const, setorId: id };
    const mensagens = await app.prisma.mensagem.findMany({
      where,
      orderBy: { criadoEm: "asc" },
      take: 200,
      include: { remetente: AUTOR_SELECT },
    });

    return reply.send(mensagens);
  });

  // Anexo de mensagem (imagem/vídeo) — nunca servido como arquivo estático
  // público, mesmo padrão do termo de responsabilidade (ver
  // colaboradores.routes.ts). Checa acesso conforme o tipo da mensagem: em
  // canal, precisa ter acesso ao canal (mesma regra de leitura); em direta,
  // precisa ser remetente ou destinatário.
  app.get("/mensagens/:id/anexo", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const mensagem = await app.prisma.mensagem.findUnique({ where: { id } });
    if (!mensagem || !mensagem.anexoUrl) {
      return reply.code(404).send({ error: "Esta mensagem não tem anexo." });
    }

    if (mensagem.tipo === "DIRETA") {
      const souParte = mensagem.remetenteId === request.user.sub || mensagem.destinatarioId === request.user.sub;
      if (!souParte) return reply.code(403).send({ error: "Você não tem acesso a este anexo." });
    } else if (mensagem.tipo === "CANAL_EMPRESA") {
      // Canal da empresa inteira — sem unidadeId/setorId pra checar, e
      // podeAcessarCanal já libera geral pra este tipo.
    } else {
      const idAlvo = (mensagem.tipo === "CANAL_UNIDADE" ? mensagem.unidadeId : mensagem.setorId) as string;
      const permissao = await carregarPermissaoCanais(app, request.user);
      if (!podeAcessarCanal(permissao, mensagem.tipo, idAlvo)) {
        return reply.code(403).send({ error: "Você não tem acesso a este anexo." });
      }
    }

    const caminhoAbsoluto = caminhoAbsolutoDoAnexo(mensagem.anexoUrl);
    if (!caminhoAbsoluto || !fs.existsSync(caminhoAbsoluto)) {
      return reply.code(404).send({ error: "Arquivo não encontrado no armazenamento." });
    }

    const nomeOriginal = (mensagem.anexoNomeOriginal || "anexo").replace(/"/g, "");
    if (mensagem.anexoTipo) reply.header("Content-Type", mensagem.anexoTipo);
    reply.header("Content-Disposition", `inline; filename="${nomeOriginal}"`);
    return reply.send(fs.createReadStream(caminhoAbsoluto));
  });

  // Correção de mensagem enviada por engano — restrito a ADMINISTRADOR,
  // mesmo padrão do DELETE de ChamadoEvento (histórico deveria ser confiável
  // por padrão; existe só pra corrigir engano, não uso corrente).
  app.delete(
    "/mensagens/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const mensagem = await app.prisma.mensagem.findUnique({ where: { id } });
      if (!mensagem) return reply.code(404).send({ error: "Mensagem não encontrada." });
      if (mensagem.anexoUrl) removerArquivoAnexo(mensagem.anexoUrl);
      await app.prisma.mensagem.delete({ where: { id } });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "Mensagem",
        entidadeId: id,
        ip: request.ip,
      });
      return reply.code(204).send();
    }
  );

  // ---------------------------------------------------------------------
  // Administração dos acessos extra a canal (08/07/2026) — tela em
  // Configurações pro ADMINISTRADOR montar exceções tipo "Locação também
  // acompanha Sucesso do Cliente" ou dar acesso pontual a alguém, sem
  // precisar de migration/seed pra cada caso novo que aparecer depois.
  // ---------------------------------------------------------------------

  app.get(
    "/mensagens/acessos-canal-extra",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (_request, reply) => {
      const acessos = await app.prisma.acessoCanalExtra.findMany({
        include: {
          colaborador: { select: { id: true, nomeCompleto: true } },
          setorOrigem: { select: { id: true, nome: true } },
          setorDestino: { select: { id: true, nome: true } },
          unidadeDestino: { select: { id: true, nome: true } },
        },
        orderBy: { criadoEm: "desc" },
      });
      return reply.send(acessos);
    }
  );

  app.post(
    "/mensagens/acessos-canal-extra",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const parsed = acessoExtraSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });

      const acesso = await app.prisma.acessoCanalExtra.create({
        data: parsed.data,
        include: {
          colaborador: { select: { id: true, nomeCompleto: true } },
          setorOrigem: { select: { id: true, nome: true } },
          setorDestino: { select: { id: true, nome: true } },
          unidadeDestino: { select: { id: true, nome: true } },
        },
      });

      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "CRIAR",
        entidade: "AcessoCanalExtra",
        entidadeId: acesso.id,
        detalhe: parsed.data,
        ip: request.ip,
      });

      return reply.code(201).send(acesso);
    }
  );

  app.delete(
    "/mensagens/acessos-canal-extra/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const acesso = await app.prisma.acessoCanalExtra.findUnique({ where: { id } });
      if (!acesso) return reply.code(404).send({ error: "Acesso extra não encontrado." });

      await app.prisma.acessoCanalExtra.delete({ where: { id } });
      await registrarAuditoria(app, {
        usuarioId: request.user.sub,
        acao: "EXCLUIR",
        entidade: "AcessoCanalExtra",
        entidadeId: id,
        ip: request.ip,
      });

      return reply.code(204).send();
    }
  );
}
