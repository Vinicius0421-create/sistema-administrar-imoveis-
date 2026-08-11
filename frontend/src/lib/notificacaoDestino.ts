import { Colaborador, Notificacao } from "../types";

// Pop-up clicável de notificação (09/07/2026, pedido do Vini: "a notificação
// chegar em pop-up e conseguir clicar e ir no destino da notificação") —
// este arquivo é o único ponto que decide, a partir de `categoria` +
// `entidade`/`entidadeId` (gravados pelo backend em notificacoes.service.ts,
// ver comentário lá: cada rota que dispara notificar()/notificarPorPapeis()
// já registra de qual registro se trata), PARA ONDE um clique deve navegar.
// Um só lugar de regra, reaproveitado tanto pelo AppShell (equipe interna,
// navegação por módulo) quanto pelo Portal do Colaborador (navegação por
// `tela` + id selecionado) — ver App.tsx e PortalColaborador.tsx.
//
// `entidade` nem sempre aponta pro registro "certo" pra abrir na tela: a
// categoria USUARIO é gravada com `entidade: "Usuario"` (id da CONTA de
// login) em alguns disparos e `entidade: "Colaborador"` (id do CADASTRO) em
// outros — a tela de Colaboradores só conhece o id de cadastro. Por isso
// recebe a lista de colaboradores como parâmetro: quando vem "Usuario",
// resolve pelo relacionamento `colaborador.usuario.id` antes de decidir o
// destino final.
export type DestinoNotificacao =
  | { tipo: "chamado"; id: string }
  | { tipo: "solicitacaoEquipamento"; id: string }
  | { tipo: "solicitacaoPapelaria"; id: string }
  | { tipo: "equipamento"; id: string }
  | { tipo: "linha"; id: string }
  | { tipo: "colaborador"; id: string }
  | { tipo: "movimentacoes" }
  | { tipo: "mensagemDireta"; usuarioId: string }
  // "Recentes" unificado (09/07/2026, pedido do Vini) — mensagem de canal
  // agora também notifica (ver comentário de resolverMembrosCanal no
  // backend); o clique precisa saber tanto QUAL canal (id) quanto o TIPO,
  // já que cada um usa uma lista separada. Ganhou "setor-unidade" e
  // "empresa" no redesenho de 21/07/2026 (ver TipoCanalUrl em
  // api/mensagens.ts) — mesmos 4 tipos de canal que existem hoje.
  | { tipo: "mensagemCanal"; canalTipo: "unidade" | "setor" | "setor-unidade" | "empresa"; id: string }
  // Aniversariantes do próximo mês (17/07/2026, ver aniversariosJob.ts no
  // backend) — categoria SISTEMA com `entidade: "AniversariantesMes"`; o
  // clique leva direto pro Calendário anual dentro de Colaboradores, já na
  // aba certa, em vez de cair na lista padrão.
  | { tipo: "calendarioAniversarios" }
  // Financeiro (22/07/2026) — hoje só estorno de pagamento; sem id de
  // destino específico (a tela de Pagamentos não tem deep-link por
  // pagamento ainda), mesmo padrão de "movimentacoes" abaixo.
  | { tipo: "pagamento" }
  | { tipo: "nenhum" };

export function resolverDestinoNotificacao(n: Notificacao, colaboradores: Colaborador[]): DestinoNotificacao {
  switch (n.categoria) {
    case "CHAMADO":
      return n.entidadeId ? { tipo: "chamado", id: n.entidadeId } : { tipo: "nenhum" };

    case "SOLICITACAO_EQUIPAMENTO":
      return n.entidadeId ? { tipo: "solicitacaoEquipamento", id: n.entidadeId } : { tipo: "nenhum" };

    case "SOLICITACAO_PAPELARIA":
      return n.entidadeId ? { tipo: "solicitacaoPapelaria", id: n.entidadeId } : { tipo: "nenhum" };

    case "PATRIMONIO":
      return n.entidadeId ? { tipo: "equipamento", id: n.entidadeId } : { tipo: "nenhum" };

    case "LINHA_TELEFONICA":
      return n.entidadeId ? { tipo: "linha", id: n.entidadeId } : { tipo: "nenhum" };

    case "USUARIO": {
      if (!n.entidadeId) return { tipo: "nenhum" };
      if (n.entidade === "Colaborador") return { tipo: "colaborador", id: n.entidadeId };
      if (n.entidade === "Usuario") {
        const colaborador = colaboradores.find((c) => c.usuario?.id === n.entidadeId);
        return colaborador ? { tipo: "colaborador", id: colaborador.id } : { tipo: "nenhum" };
      }
      if (n.entidade === "MovimentacaoColaborador") return { tipo: "movimentacoes" };
      return { tipo: "nenhum" };
    }

    // DIRETA usa `origemUsuarioId` (sempre quem mandou a mensagem, o id que
    // a tela de Mensagens precisa pra abrir a conversa certa — mais direto
    // que `entidadeId`, que aponta pro id da Mensagem em si, não pro
    // interlocutor). Canal (09/07/2026, +2 tipos no redesenho de 21/07/2026)
    // usa `entidade`/`entidadeId` do jeito padrão do resto deste arquivo —
    // "CanalUnidade"/"CanalSetor"/"CanalSetorUnidade"/"CanalEmpresa" + o id
    // (ou a chave composta, pra setor-unidade) do canal (ver
    // mensagens.routes.ts).
    case "MENSAGEM":
      if (n.entidade === "CanalUnidade" && n.entidadeId) return { tipo: "mensagemCanal", canalTipo: "unidade", id: n.entidadeId };
      if (n.entidade === "CanalSetor" && n.entidadeId) return { tipo: "mensagemCanal", canalTipo: "setor", id: n.entidadeId };
      if (n.entidade === "CanalSetorUnidade" && n.entidadeId)
        return { tipo: "mensagemCanal", canalTipo: "setor-unidade", id: n.entidadeId };
      if (n.entidade === "CanalEmpresa" && n.entidadeId) return { tipo: "mensagemCanal", canalTipo: "empresa", id: n.entidadeId };
      return n.origemUsuarioId ? { tipo: "mensagemDireta", usuarioId: n.origemUsuarioId } : { tipo: "nenhum" };

    case "SISTEMA":
      if (n.entidade === "AniversariantesMes") return { tipo: "calendarioAniversarios" };
      return { tipo: "nenhum" };

    case "FINANCEIRO":
      return { tipo: "pagamento" };

    default:
      return { tipo: "nenhum" };
  }
}
