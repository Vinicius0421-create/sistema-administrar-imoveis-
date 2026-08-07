import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

// Nome de exibição de um Usuario — pedido do Vini (07/07/2026): os seletores
// de "técnico responsável" (chamados, solicitações) mostravam o e-mail, que
// ninguém reconhece de cara. Usuario não tem campo "nome" próprio — só tem,
// opcionalmente, um Colaborador vinculado (nem todo usuário tem: contas
// puramente administrativas, como o admin@ inicial do seed, não têm
// colaborador cadastrado). Por isso o fallback pro e-mail continua existindo,
// só deixa de ser o caminho normal.
export function nomeExibicaoUsuario(usuario: {
  email: string;
  colaborador?: { nomeCompleto: string } | null;
}): string {
  return usuario.colaborador?.nomeCompleto || usuario.email;
}

// RECONSTRUÍDO 07/08/2026 — o corpo original desta função não foi encontrado
// em nenhuma transcrição desta sessão (só sobreviveram os dois pontos de uso
// em colaboradores.routes.ts, via import). Reconstruído com base nesse uso
// real: chamada quando um Colaborador transiciona para status INATIVO
// (edição direta ou POST /desligar) e o comentário explícito no código
// original ("colaborador desligado continuava conseguindo logar até alguém
// desativar manualmente" — achado do Ciclo de Evolução Contínua Nº 3,
// 10/07/2026). Retorna uma lista de operações Prisma PRONTAS para entrar
// junto em um `$transaction([...])` — nunca as executa sozinha — mesmo
// padrão já usado nas duas chamadas reais (ver colaboradores.routes.ts).
//
// Cobre os dois vetores de acesso que o sistema realmente modela hoje:
//   1) Usuario vinculado → desativado (ativo: false) e todos os refresh
//      tokens ainda válidos são revogados, derrubando qualquer sessão ativa
//      imediatamente (não só bloqueando logins futuros).
//   2) Concessões de acesso a sistemas externos (AcessoSistema) que ainda
//      estejam ATIVO → passam para REVOGADO com dataRevogacao preenchida
//      (mesmo enum usado por "alternar-status" em acessos.routes.ts, mas
//      REVOGADO — não BLOQUEADO — para diferenciar "saiu da empresa" de
//      "acesso suspenso temporariamente").
//
// ⚠️ Por ser reconstrução (não recuperação verbatim), revisar com o Vini
// antes de confiar 100% neste fluxo em produção — ver
// Recuperacao_Codigo_Fonte_07-08-2026.md.
export async function prepararRevogacaoAcessoDesligamento(
  app: FastifyInstance,
  colaboradorId: string
): Promise<Prisma.PrismaPromise<unknown>[]> {
  const operacoes: Prisma.PrismaPromise<unknown>[] = [];

  const usuario = await app.prisma.usuario.findUnique({
    where: { colaboradorId },
    select: { id: true, ativo: true },
  });
  if (usuario && usuario.ativo) {
    operacoes.push(
      app.prisma.usuario.update({
        where: { id: usuario.id },
        data: { ativo: false },
      })
    );
    operacoes.push(
      app.prisma.refreshToken.updateMany({
        where: { usuarioId: usuario.id, revogadoEm: null },
        data: { revogadoEm: new Date() },
      })
    );
  }

  const acessosAtivos = await app.prisma.acessoSistema.findMany({
    where: { colaboradorId, status: "ATIVO" },
    select: { id: true },
  });
  if (acessosAtivos.length > 0) {
    operacoes.push(
      app.prisma.acessoSistema.updateMany({
        where: { id: { in: acessosAtivos.map((a) => a.id) } },
        data: { status: "REVOGADO", dataRevogacao: new Date() },
      })
    );
  }

  return operacoes;
}
