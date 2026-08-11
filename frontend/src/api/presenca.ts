import { apiRequest } from "../lib/apiClient";

// Presença — Fase 2 da Central de Comunicação (21/07/2026, pedido do Vini:
// "status online" e "status ausente"). Ver comentário completo do cálculo
// em utils/presenca.ts (backend): o status nunca é gravado, é sempre
// DERIVADO na hora a partir do último heartbeat — por isso o cliente só
// precisa mandar um heartbeat periódico e consultar status em lote.
export type StatusPresenca = "online" | "ausente" | "offline";

export const presencaApi = {
  // Chamado a cada ~30s enquanto a aba está em foco (ver usePresencaHeartbeat
  // em pages/Mensagens.tsx) — nunca em background, pra não fingir presença
  // de quem só deixou a aba aberta minimizada.
  heartbeat: () => apiRequest<void>("/presenca", { method: "PATCH" }),

  // Consulta em lote — evita 1 requisição por contato/membro de canal.
  status: (usuarioIds: string[]) => {
    if (usuarioIds.length === 0) return Promise.resolve({} as Record<string, StatusPresenca>);
    return apiRequest<Record<string, StatusPresenca>>("/presenca", { query: { ids: usuarioIds.join(",") } });
  },
};
