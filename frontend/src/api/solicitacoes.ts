import { apiRequest } from "../lib/apiClient";
import { PaginatedResponse, SolicitacaoEquipamento, StatusSolicitacao } from "../types";
import { fetchAllPages } from "./util";

export interface SolicitacaoInput {
  solicitanteId: string;
  // categoriaId/produtoId (09/07/2026) — opcionais: item "fora do catálogo"
  // continua existindo, ver comentário no backend em solicitacoes.routes.ts.
  categoriaId?: string | null;
  produtoId?: string | null;
  item: string;
  justificativa?: string | null;
  prioridade: SolicitacaoEquipamento["prioridade"];
  loteId?: string | null;
  quantidade: number;
  valorUnitario: number;
  // Fornecedor/loja (17/07/2026) — opcional na criação; pra papel
  // COLABORADOR o backend força valor 0 e fornecedor null de qualquer
  // forma (quem define é o responsável pela compra, depois).
  fornecedor?: string | null;
  // Obrigatórios desde 07/07/2026 — ver comentário em types.ts.
  unidadeId: string;
  tecnicoResponsavelId: string;
}

export const solicitacoesApi = {
  listAll: () =>
    fetchAllPages<SolicitacaoEquipamento>((page, pageSize) =>
      apiRequest<PaginatedResponse<SolicitacaoEquipamento>>("/solicitacoes-equipamento", { query: { page, pageSize } })
    ),

  create: (data: SolicitacaoInput) =>
    apiRequest<SolicitacaoEquipamento>("/solicitacoes-equipamento", { method: "POST", body: data }),

  // motivo (achado de auditoria S2, 22/07/2026) — só é de fato exigido pelo
  // backend quando `status === "REPROVADO"" (ver solicitacoes.routes.ts);
  // nas demais transições continua opcional/ignorado, mesmo contrato de
  // sempre pras outras mudanças de coluna do Kanban.
  mudarStatus: (id: string, status: StatusSolicitacao, motivo?: string) =>
    apiRequest<SolicitacaoEquipamento>(`/solicitacoes-equipamento/${id}/status`, { method: "PATCH", body: { status, motivo } }),

  remove: (id: string) => apiRequest<void>(`/solicitacoes-equipamento/${id}`, { method: "DELETE" }),

  // Valor e fornecedor da compra (17/07/2026, pedido do Vini) — editável só
  // por quem cuida da compra (Admin/Suporte TI/Financeiro); o backend audita
  // o antes/depois de cada mudança.
  atualizarDetalhesCompra: (id: string, dados: { valorUnitario?: number; fornecedor?: string | null }) =>
    apiRequest<SolicitacaoEquipamento>(`/solicitacoes-equipamento/${id}/detalhes-compra`, { method: "PATCH", body: dados }),

  // Fornecedores já usados em solicitações anteriores — viram sugestões no
  // campo de fornecedor (somadas à lista fixa de lojas conhecidas).
  listarFornecedores: () =>
    apiRequest<{ fornecedores: string[] }>("/solicitacoes-equipamento/fornecedores"),
};
