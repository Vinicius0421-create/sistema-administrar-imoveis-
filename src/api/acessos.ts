import { apiRequest } from "../lib/apiClient";
import { AcessoSistema } from "../types";

export interface AcessoInput {
  colaboradorId: string;
  sistemaId: string;
  status?: AcessoSistema["status"];
  observacoes?: string | null;
}

export const acessosApi = {
  // Sem paginação no backend (lista costuma ser pequena: colaboradores x sistemas).
  listAll: () => apiRequest<AcessoSistema[]>("/acessos-sistema"),

  create: (data: AcessoInput) => apiRequest<AcessoSistema>("/acessos-sistema", { method: "POST", body: data }),

  // Corrige sistema vinculado errado e/ou edita a observação sem precisar
  // excluir e recriar (o que perderia a dataConcessao original).
  // Achado de auditoria C4 (22/07/2026): colaboradorId também editável — o
  // backend já aceita (ver acessos.routes.ts), faltava só o frontend.
  update: (id: string, data: { sistemaId?: string; colaboradorId?: string; observacoes?: string | null }) =>
    apiRequest<AcessoSistema>(`/acessos-sistema/${id}`, { method: "PATCH", body: data }),

  alternarStatus: (id: string) =>
    apiRequest<AcessoSistema>(`/acessos-sistema/${id}/alternar-status`, { method: "POST" }),

  remove: (id: string) => apiRequest<void>(`/acessos-sistema/${id}`, { method: "DELETE" }),
};
