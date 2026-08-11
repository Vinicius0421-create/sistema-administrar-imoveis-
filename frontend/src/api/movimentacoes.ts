import { apiRequest } from "../lib/apiClient";
import { MovimentacaoColaborador } from "../types";

export interface MovimentacaoInput {
  colaboradorId: string;
  tipo: MovimentacaoColaborador["tipo"];
  unidadeAnteriorId?: string | null;
  setorAnteriorId?: string | null;
  novaUnidadeId?: string | null;
  novoSetorId?: string | null;
  observacoes?: string | null;
  // Achado de auditoria S9 (22/07/2026) — opcional, padrão "hoje" quando
  // omitido (mesmo comportamento de antes desta mudança).
  data?: string | null;
}

export const movimentacoesApi = {
  // Só Admin/Gestor têm permissão nesta rota (ver preHandler no backend);
  // colaboradores comuns simplesmente não chamam esta API.
  listAll: () => apiRequest<MovimentacaoColaborador[]>("/movimentacoes-colaboradores"),

  create: (data: MovimentacaoInput) =>
    apiRequest<MovimentacaoColaborador>("/movimentacoes-colaboradores", { method: "POST", body: data }),

  // Achado de auditoria S1 (22/07/2026): o backend agora recusa (409)
  // concluir um desligamento com equipamento/linha/acesso ainda pendente,
  // a menos que `confirmarPendencias: true` seja enviado explicitamente.
  concluir: (id: string, confirmarPendencias?: boolean) =>
    apiRequest<MovimentacaoColaborador>(`/movimentacoes-colaboradores/${id}/concluir`, {
      method: "POST",
      body: confirmarPendencias ? { confirmarPendencias: true } : undefined,
    }),

  remove: (id: string) => apiRequest<void>(`/movimentacoes-colaboradores/${id}`, { method: "DELETE" }),
};
