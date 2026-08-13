import { apiRequest } from "../lib/apiClient";
import {
  CanalMarketing, ImovelMarketing, ObjetivoMarketing, OrigemLeadMarketing, PaginatedResponse,
  PrioridadeImovel, StatusImovel, StatusSincronizacaoImoview, TipoCriativoMarketing, TipoImovel,
} from "../types";

// Marketing Imobiliário (13/08/2026) — Banco de Imóveis + integração
// Imoview. Mesmo padrão de src/api/dominios.ts para os 4 domínios simples;
// GET /marketing/imoveis é paginado no servidor (ver
// paginationSchema/paginatedResponse no backend), diferente das listas
// pequenas de domínio que continuam vindo inteiras de uma vez.

export interface ImovelMarketingFiltros {
  page?: number;
  pageSize?: number;
  unidadeId?: string;
  tipo?: TipoImovel;
  status?: StatusImovel;
  prioridade?: PrioridadeImovel;
  busca?: string;
}

export interface ImovelMarketingInput {
  codigo: string;
  unidadeId: string;
  tipo: TipoImovel;
  bairroRegiao?: string | null;
  descricaoCurta?: string | null;
  valor?: string | number | null;
  corretorId?: string | null;
  corretorNome?: string | null;
  temFotos?: boolean;
  temVideo?: boolean;
  linkPasta?: string | null;
  prioridade?: PrioridadeImovel;
  status?: StatusImovel;
  observacoes?: string | null;
}

export const marketingApi = {
  listarImoveis: (filtros: ImovelMarketingFiltros = {}) =>
    apiRequest<PaginatedResponse<ImovelMarketing>>("/marketing/imoveis", { query: filtros as Record<string, any> }),

  buscarImovel: (id: string) => apiRequest<ImovelMarketing>(`/marketing/imoveis/${id}`),

  criarImovel: (data: ImovelMarketingInput) =>
    apiRequest<ImovelMarketing>("/marketing/imoveis", { method: "POST", body: data }),

  atualizarImovel: (id: string, data: Partial<ImovelMarketingInput>) =>
    apiRequest<ImovelMarketing>(`/marketing/imoveis/${id}`, { method: "PATCH", body: data }),

  // 4 domínios extensíveis — mesmo padrão create/update de dominiosApi.
  canais: () => apiRequest<CanalMarketing[]>("/canais-marketing"),
  criarCanal: (nome: string) => apiRequest<CanalMarketing>("/canais-marketing", { method: "POST", body: { nome } }),
  atualizarCanal: (id: string, data: Partial<Pick<CanalMarketing, "nome" | "status">>) =>
    apiRequest<CanalMarketing>(`/canais-marketing/${id}`, { method: "PATCH", body: data }),

  objetivos: () => apiRequest<ObjetivoMarketing[]>("/objetivos-marketing"),
  criarObjetivo: (nome: string) => apiRequest<ObjetivoMarketing>("/objetivos-marketing", { method: "POST", body: { nome } }),
  atualizarObjetivo: (id: string, data: Partial<Pick<ObjetivoMarketing, "nome" | "status">>) =>
    apiRequest<ObjetivoMarketing>(`/objetivos-marketing/${id}`, { method: "PATCH", body: data }),

  origensLead: () => apiRequest<OrigemLeadMarketing[]>("/origens-lead-marketing"),
  criarOrigemLead: (nome: string) => apiRequest<OrigemLeadMarketing>("/origens-lead-marketing", { method: "POST", body: { nome } }),
  atualizarOrigemLead: (id: string, data: Partial<Pick<OrigemLeadMarketing, "nome" | "status">>) =>
    apiRequest<OrigemLeadMarketing>(`/origens-lead-marketing/${id}`, { method: "PATCH", body: data }),

  tiposCriativo: () => apiRequest<TipoCriativoMarketing[]>("/tipos-criativo-marketing"),
  criarTipoCriativo: (nome: string) => apiRequest<TipoCriativoMarketing>("/tipos-criativo-marketing", { method: "POST", body: { nome } }),
  atualizarTipoCriativo: (id: string, data: Partial<Pick<TipoCriativoMarketing, "nome" | "status">>) =>
    apiRequest<TipoCriativoMarketing>(`/tipos-criativo-marketing/${id}`, { method: "PATCH", body: data }),

  // Sincronização com o Imoview (Fase 8).
  statusSincronizacao: () => apiRequest<StatusSincronizacaoImoview>("/marketing/sincronizacao/status"),
  executarSincronizacao: () =>
    apiRequest<{ sucesso: boolean; quantidade: number; erro?: string | null }>("/marketing/sincronizacao/executar", { method: "POST" }),
};
