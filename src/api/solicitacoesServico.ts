import { apiRequest } from "../lib/apiClient";
import { SolicitacaoServico } from "../types";

// Solicitações de Serviço (20/07/2026, pedido do Vini) — colaborador pede
// um serviço, TI atende, Financeiro contrata quando é pago. Ver
// solicitacoesServico.routes.ts no backend.

export const solicitacoesServicoApi = {
  list: () => apiRequest<SolicitacaoServico[]>("/solicitacoes-servico"),

  create: (dados: { solicitanteId: string; servico: string; descricao?: string | null; unidadeId?: string | null }) =>
    apiRequest<SolicitacaoServico>("/solicitacoes-servico", { method: "POST", body: dados }),

  atender: (id: string) =>
    apiRequest<SolicitacaoServico>(`/solicitacoes-servico/${id}/atender`, { method: "PATCH" }),

  encaminharFinanceiro: (id: string, dados: { fornecedor?: string | null; valorEstimado?: number | null; observacao?: string | null }) =>
    apiRequest<SolicitacaoServico>(`/solicitacoes-servico/${id}/encaminhar-financeiro`, { method: "PATCH", body: dados }),

  concluir: (id: string, observacao?: string | null) =>
    apiRequest<SolicitacaoServico>(`/solicitacoes-servico/${id}/concluir`, { method: "PATCH", body: { observacao } }),

  recusar: (id: string, motivo: string) =>
    apiRequest<SolicitacaoServico>(`/solicitacoes-servico/${id}/recusar`, { method: "PATCH", body: { motivo } }),

  // Timeline de comentário (achado S14 do checkup, 22/07/2026) — mesmo
  // padrão de comentar()/enviarMensagem() já usado em Papelaria/Chamado.
  comentar: (id: string, mensagem: string) =>
    apiRequest<SolicitacaoServico>(`/solicitacoes-servico/${id}/comentar`, { method: "POST", body: { mensagem } }),
};
