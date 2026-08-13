import { FastifyInstance } from "fastify";
import { AuthPayload } from "../plugins/auth";

// Controle de acesso a canal de chat interno (08/07/2026, pedido do Vini:
// "garanta que eles conseguem conversar apenas nos canais deles, ou seja,
// venda só em venda, etc"). Ver comentário do model AcessoCanalExtra em
// schema.prisma pro desenho completo.
//
// ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI continuam irrestritos — são os
// papéis que já usavam o chat antes desta mudança, com acesso total a todos
// os canais (mesmo comportamento de antes). A restrição só vale pra
// COLABORADOR, que agora também ganha acesso ao chat (antes não tinha
// nenhum) mas só nos canais do próprio setor/unidade + exceções concedidas.
export type PermissaoCanais =
  | { irrestrito: true }
  | { irrestrito: false; setores: Set<string>; unidades: Set<string> };

export async function carregarPermissaoCanais(app: FastifyInstance, usuario: AuthPayload): Promise<PermissaoCanais> {
  if (usuario.papel !== "COLABORADOR") return { irrestrito: true };

  // colaboradorId já vem embutido no JWT (ver AuthPayload) — sem precisar
  // buscar o Usuario de novo só pra achar essa FK.
  const colaboradorId = usuario.colaboradorId;
  if (!colaboradorId) return { irrestrito: false, setores: new Set(), unidades: new Set() };

  const colaborador = await app.prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { setorId: true, unidadeId: true },
  });

  const setores = new Set<string>();
  const unidades = new Set<string>();
  if (colaborador?.setorId) setores.add(colaborador.setorId);
  if (colaborador?.unidadeId) unidades.add(colaborador.unidadeId);

  const extras = await app.prisma.acessoCanalExtra.findMany({
    where: {
      OR: [{ colaboradorId }, colaborador?.setorId ? { setorOrigemId: colaborador.setorId } : { id: "" }],
    },
  });
  for (const extra of extras) {
    if (extra.tipo === "CANAL_SETOR" && extra.setorDestinoId) setores.add(extra.setorDestinoId);
    if (extra.tipo === "CANAL_UNIDADE" && extra.unidadeDestinoId) unidades.add(extra.unidadeDestinoId);
  }

  return { irrestrito: false, setores, unidades };
}

export function podeAcessarCanal(
  permissao: PermissaoCanais,
  tipo: "CANAL_UNIDADE" | "CANAL_SETOR" | "CANAL_SETOR_UNIDADE" | "CANAL_EMPRESA",
  id: string
): boolean {
  // CANAL_EMPRESA (recuperado 12/08/2026 — valor de enum já existente em
  // produção, sem o restante da feature reconstruído na recuperação) é o
  // canal da empresa inteira por definição — todo mundo autenticado tem
  // acesso, mesmo COLABORADOR sem nenhuma exceção via AcessoCanalExtra.
  if (tipo === "CANAL_EMPRESA") return true;
  if (permissao.irrestrito) return true;
  // CANAL_SETOR_UNIDADE: mesmo achado — valor de enum recuperado sem
  // nenhuma rota que o crie ou documente a regra original de acesso. Trata
  // como CANAL_SETOR (mais restritivo que liberar geral) até a feature real
  // ser reconstruída, se um dia for necessária.
  return tipo === "CANAL_UNIDADE" ? permissao.unidades.has(id) : permissao.setores.has(id);
}

// "Recentes" unificado (09/07/2026, pedido do Vini) — resolve QUEM deve
// receber uma notificação de mensagem nova neste canal. Deliberadamente
// diferente de "quem PODE acessar o canal" (podeAcessarCanal acima): acesso
// irrestrito (ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI) significa "pode
// entrar em qualquer canal se quiser", não "é membro de todos os canais" —
// notificar esses três papéis a cada mensagem de QUALQUER unidade/setor do
// sistema inteiro geraria o volume desproporcional que o comentário original
// de mensagens.routes.ts já tinha identificado como problema. Por isso a
// audiência aqui é só quem de fato "pertence" ao canal: colaboradores cujo
// setor/unidade de casa é este, mais quem ganhou acesso extra a ESTE canal
// específico via AcessoCanalExtra (pontual ou por setor inteiro) — o mesmo
// universo de pessoas que carregarPermissaoCanais liberaria pra um
// COLABORADOR, só que calculado a partir do canal em vez de a partir da
// pessoa.
export async function resolverMembrosCanal(
  app: FastifyInstance,
  tipo: "CANAL_UNIDADE" | "CANAL_SETOR",
  id: string
): Promise<string[]> {
  const filtroHome = tipo === "CANAL_UNIDADE" ? { unidadeId: id } : { setorId: id };
  const filtroExtra = tipo === "CANAL_UNIDADE" ? { unidadeDestinoId: id } : { setorDestinoId: id };

  const [colaboradoresHome, extras] = await Promise.all([
    app.prisma.colaborador.findMany({
      where: filtroHome,
      select: { usuario: { select: { id: true, ativo: true } } },
    }),
    app.prisma.acessoCanalExtra.findMany({ where: { tipo, ...filtroExtra } }),
  ]);

  const colaboradorIdsExtra = extras.map((e) => e.colaboradorId).filter((v): v is string => !!v);
  const setorOrigemIds = extras.map((e) => e.setorOrigemId).filter((v): v is string => !!v);

  const [porColaboradorExtra, porSetorOrigemExtra] = await Promise.all([
    colaboradorIdsExtra.length
      ? app.prisma.colaborador.findMany({
          where: { id: { in: colaboradorIdsExtra } },
          select: { usuario: { select: { id: true, ativo: true } } },
        })
      : Promise.resolve([]),
    setorOrigemIds.length
      ? app.prisma.colaborador.findMany({
          where: { setorId: { in: setorOrigemIds } },
          select: { usuario: { select: { id: true, ativo: true } } },
        })
      : Promise.resolve([]),
  ]);

  const ids = new Set<string>();
  for (const c of [...colaboradoresHome, ...porColaboradorExtra, ...porSetorOrigemExtra]) {
    if (c.usuario?.id && c.usuario.ativo) ids.add(c.usuario.id);
  }
  return Array.from(ids);
}
