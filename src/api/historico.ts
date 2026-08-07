import { apiRequest } from "../lib/apiClient";
import { HistoricoTroca } from "../types";

export const historicoApi = {
  listAll: (equipamentoId?: string) =>
    apiRequest<HistoricoTroca[]>("/historico-trocas", { query: { equipamentoId } }),

  remove: (id: string) => apiRequest<void>(`/historico-trocas/${id}`, { method: "DELETE" }),
};
