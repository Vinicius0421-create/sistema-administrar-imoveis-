import { apiRequest, tokenStore } from "../lib/apiClient";
import { CategoriaNotificacao, Notificacao, PaginatedResponse, PreferenciaNotificacao, Prioridade } from "../types";

// Central de Notificações (Fase B, 09/07/2026, pedido do Vini) — mesmo padrão
// de cliente de API já usado no resto do sistema. Ver
// src/routes/notificacoes.routes.ts no backend para o contrato completo.

export interface NotificacoesQuery {
  page?: number;
  pageSize?: number;
  categoria?: CategoriaNotificacao;
  prioridade?: Prioridade;
  lida?: boolean;
  busca?: string;
}

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3333";

export const notificacoesApi = {
  list: (query: NotificacoesQuery) =>
    apiRequest<PaginatedResponse<Notificacao>>("/notificacoes", { query: query as Record<string, string | number | boolean | undefined> }),

  contagemNaoLidas: () => apiRequest<{ total: number }>("/notificacoes/nao-lidas/contagem"),

  marcarLida: (id: string) => apiRequest<Notificacao>(`/notificacoes/${id}/lida`, { method: "PATCH" }),

  marcarTodasLidas: () => apiRequest<{ atualizadas: number }>("/notificacoes/marcar-todas-lidas", { method: "PATCH" }),

  remover: (id: string) => apiRequest<void>(`/notificacoes/${id}`, { method: "DELETE" }),

  preferencias: () => apiRequest<PreferenciaNotificacao>("/notificacoes/preferencias"),

  atualizarPreferencias: (data: Partial<Omit<PreferenciaNotificacao, "usuarioId" | "atualizadoEm">>) =>
    apiRequest<PreferenciaNotificacao>("/notificacoes/preferencias", { method: "PATCH", body: data }),

  // SSE não consegue mandar header Authorization (EventSource do navegador não
  // suporta headers customizados) — o token de acesso atual (em memória, ver
  // tokenStore em lib/apiClient.ts) viaja via querystring, mesma decisão já
  // tomada e documentada no backend (notificacoes.routes.ts). Monta a URL na
  // hora de cada chamada (não uma constante), porque o token muda quando é
  // renovado — quem usa isto (useNotificacoesStream) sempre pede uma URL nova
  // antes de cada tentativa de conexão/reconexão.
  urlStream: (): string | null => {
    const token = tokenStore.get()?.accessToken;
    if (!token) return null;
    return `${API_URL.replace(/\/$/, "")}/notificacoes/stream?token=${encodeURIComponent(token)}`;
  },
};
