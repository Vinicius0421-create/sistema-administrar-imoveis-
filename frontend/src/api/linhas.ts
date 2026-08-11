import { apiRequest } from "../lib/apiClient";
import { LinhaTelefonica, PaginatedResponse } from "../types";
import { fetchAllPages } from "./util";

export interface LinhaInput {
  numero: string;
  operadora?: string | null;
  plano?: string | null;
  tipoPlano?: LinhaTelefonica["tipoPlano"];
  empresaId?: string | null;
  colaboradorId?: string | null;
  colaboradorInformado?: string | null;
  // Etapa 1 (08/07/2026) — ver LinhaTelefonica em types.ts.
  principal?: boolean;
  situacaoConferencia?: LinhaTelefonica["situacaoConferencia"];
  unidadeId?: string | null;
  status: LinhaTelefonica["status"];
  observacoes?: string | null;
}

export const linhasApi = {
  listAll: () =>
    fetchAllPages<LinhaTelefonica>((page, pageSize) =>
      apiRequest<PaginatedResponse<LinhaTelefonica>>("/linhas-telefonicas", { query: { page, pageSize } })
    ),

  create: (data: LinhaInput) => apiRequest<LinhaTelefonica>("/linhas-telefonicas", { method: "POST", body: data }),

  update: (id: string, data: Partial<LinhaInput>) =>
    apiRequest<LinhaTelefonica>(`/linhas-telefonicas/${id}`, { method: "PUT", body: data }),

  remove: (id: string) => apiRequest<void>(`/linhas-telefonicas/${id}`, { method: "DELETE" }),
};
