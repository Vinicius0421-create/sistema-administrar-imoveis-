import { FastifyInstance } from "fastify";
import { CategoriaNotificacao, Papel, Prioridade, TipoNotificacao } from "@prisma/client";
import { enviarParaUsuario } from "./sseHub";

// Central de Notificações (Fase B, 09/07/2026, pedido do Vini) — este arquivo
// é o único ponto de entrada pra criar notificações; todas as ~30 rotas que
// disparam um evento (chamados, solicitações, papelaria, patrimônio, linhas,
// usuários, sistema) chamam `notificar()` ou `notificarPorPapeis()` daqui,
// nunca escrevem em `Notificacao` diretamente — mesmo racional de
// `registrarAuditoria()`: um lugar só pra aplicar regra (aqui, preferências
// do usuário) sem repetir em cada rota.
//
// "Direcionamento inteligente" (pedido explícito): quem manda a notificação
// já resolve os destinatários certos por papel/dono do registro (é regra de
// negócio de cada módulo, não deste arquivo) — o que ESTE arquivo garante é
// que, entre os destinatários resolvidos, só recebe de fato quem não
// silenciou aquela categoria e cuja prioridade mínima configurada permite.

const ORDEM_PRIORIDADE: Record<Prioridade, number> = { BAIXA: 0, MEDIA: 1, ALTA: 2 };

export interface NotificarInput {
  destinatarioIds: string[];
  categoria: CategoriaNotificacao;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  prioridade?: Prioridade;
  entidade?: string;
  entidadeId?: string;
  origemUsuarioId?: string | null;
  // Por padrão, quem originou a ação não recebe notificação da própria
  // ação (ex: quem abriu o chamado não precisa de um aviso "chamado
  // aberto" sobre o chamado que ele mesmo acabou de abrir na tela). Casos
  // legítimos de exceção (raros) podem passar `false`.
  excluirOrigem?: boolean;
}

/**
 * Cria uma notificação para cada destinatário elegível (depois de aplicar
 * as preferências de cada um) e empurra em tempo real via SSE pra quem
 * estiver com a Central de Notificações conectada agora. Nunca lança —
 * mesma garantia de `registrarAuditoria()`: uma falha aqui não pode
 * derrubar a ação principal que disparou o evento.
 */
export async function notificar(app: FastifyInstance, input: NotificarInput): Promise<void> {
  try {
    const prioridade = input.prioridade ?? "MEDIA";
    const excluirOrigem = input.excluirOrigem !== false;

    const idsUnicos = Array.from(new Set(input.destinatarioIds)).filter(
      (id) => !excluirOrigem || id !== input.origemUsuarioId
    );
    if (idsUnicos.length === 0) return;

    const preferencias = await app.prisma.preferenciaNotificacao.findMany({
      where: { usuarioId: { in: idsUnicos } },
    });
    const preferenciaPorUsuario = new Map(preferencias.map((p) => [p.usuarioId, p]));

    const elegiveis = idsUnicos.filter((id) => {
      const pref = preferenciaPorUsuario.get(id);
      if (!pref) return true; // sem preferência salva ainda = default (recebe tudo)
      if (pref.categoriasSilenciadas.includes(input.categoria)) return false;
      if (ORDEM_PRIORIDADE[prioridade] < ORDEM_PRIORIDADE[pref.prioridadeMinima]) return false;
      return true;
    });
    if (elegiveis.length === 0) return;

    // create() individual (não createMany) propositalmente: o volume por
    // evento é sempre pequeno (um punhado de pessoas do time, nunca a base
    // inteira), e só assim recebemos de volta id/criadoEm reais de cada
    // linha pra empurrar via SSE imediatamente — createMany não devolve as
    // linhas criadas.
    await Promise.all(
      elegiveis.map(async (destinatarioId) => {
        const criada = await app.prisma.notificacao.create({
          data: {
            destinatarioId,
            origemUsuarioId: input.origemUsuarioId ?? null,
            categoria: input.categoria,
            tipo: input.tipo,
            titulo: input.titulo,
            mensagem: input.mensagem,
            prioridade,
            entidade: input.entidade ?? null,
            entidadeId: input.entidadeId ?? null,
          },
        });
        enviarParaUsuario(destinatarioId, "notificacao", criada);
      })
    );
  } catch (err) {
    app.log.error({ err }, "Falha ao criar notificação(ões)");
  }
}

/**
 * Atalho pro caso mais comum: "todo mundo com este(s) papel(is), ativo".
 * `extras` permite somar ids específicos que não vêm só do papel (ex: o
 * técnico responsável atribuído a um chamado, além de todo ADMINISTRADOR).
 */
export async function notificarPorPapeis(
  app: FastifyInstance,
  papeis: Papel[],
  input: Omit<NotificarInput, "destinatarioIds">,
  extras: string[] = []
): Promise<void> {
  const usuarios = await app.prisma.usuario.findMany({
    where: { papel: { in: papeis }, ativo: true },
    select: { id: true },
  });
  const destinatarioIds = [...usuarios.map((u) => u.id), ...extras];
  await notificar(app, { ...input, destinatarioIds });
}
