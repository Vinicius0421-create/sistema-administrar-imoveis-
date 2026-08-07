import { apiRequest } from "../lib/apiClient";
import { ResultadoBusca } from "../types";

// Busca Global (Onda 2.1 do redesign, 21/07/2026) — ver ComandoPaleta.tsx
// (componente) e busca.routes.ts (backend, mesmo shape de resultado).
export const buscaApi = {
  buscar: (q: string) => apiRequest<{ resultados: ResultadoBusca[] }>("/busca", { query: { q } }),
};
