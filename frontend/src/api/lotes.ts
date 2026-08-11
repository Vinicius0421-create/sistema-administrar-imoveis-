import { apiRequest } from "../lib/apiClient";
import { LoteRateio } from "../types";

export interface LoteInput {
  nome: string;
  descricao?: string | null;
  dataInicio?: string | null;
  status?: LoteRateio["status"];
}

export const lotesApi = {
  listAll: () => apiRequest<LoteRateio[]>("/lotes-rateio"),
  create: (data: LoteInput) => apiRequest<LoteRateio>("/lotes-rateio", { method: "POST", body: data }),
  fechar: (id: string) => apiRequest<LoteRateio>(`/lotes-rateio/${id}/fechar`, { method: "POST" }),
  remove: (id: string) => apiRequest<void>(`/lotes-rateio/${id}`, { method: "DELETE" }),
};
