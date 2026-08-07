import { apiDownloadBlob, apiRequest, apiUpload } from "../lib/apiClient";
import { Equipamento, EquipamentoAnexo, PaginatedResponse } from "../types";
import { fetchAllPages } from "./util";

export interface EquipamentoInput {
  tipo: string;
  marca?: string | null;
  modelo?: string | null;
  numeroSerie?: string | null;
  patrimonio?: string | null;
  estadoConservacao?: Equipamento["estadoConservacao"];
  status: Equipamento["status"];
  colaboradorId?: string | null;
  observacoes?: string | null;
  categoriaId?: string | null;
  marcaId?: string | null;
  localizacao?: string | null;
  dataAquisicao?: string | null;
  // CMDB completo (Onda 3.1 do redesenho, 21/07/2026 — item 11 da
  // auditoria). `valorAquisicao` aceita string (o formulário manda como
  // texto) — o backend converte pra Decimal, mesmo padrão já usado em
  // outros valores monetários do sistema.
  garantiaAte?: string | null;
  fornecedor?: string | null;
  notaFiscal?: string | null;
  valorAquisicao?: string | null;
  vidaUtilMeses?: number | null;
  acessorioIds?: string[];
}

export const equipamentosApi = {
  listAll: () =>
    fetchAllPages<Equipamento>((page, pageSize) =>
      apiRequest<PaginatedResponse<Equipamento>>("/equipamentos", { query: { page, pageSize } })
    ),

  create: (data: EquipamentoInput) =>
    apiRequest<Equipamento>("/equipamentos", { method: "POST", body: data }),

  update: (id: string, data: Partial<EquipamentoInput>) =>
    apiRequest<Equipamento>(`/equipamentos/${id}`, { method: "PUT", body: data }),

  devolver: (id: string) => apiRequest<Equipamento>(`/equipamentos/${id}/devolver`, { method: "POST" }),

  remove: (id: string) => apiRequest<void>(`/equipamentos/${id}`, { method: "DELETE" }),

  // Foto do equipamento (17/07/2026, pedido do Vini: "permitir colocar foto
  // do equipamento também, para saber o estado em que se encontra") — anexo
  // único, upload substitui o anterior. Mesmo padrão de multipart do termo
  // de responsabilidade (ver colaboradoresApi.anexarTermoResponsabilidade).
  anexarFoto: (id: string, file: File) =>
    apiUpload<{ fotoNomeOriginal: string; fotoEnviadaEm: string }>(`/equipamentos/${id}/foto`, file),

  baixarFoto: (id: string) => apiDownloadBlob(`/equipamentos/${id}/foto`),

  removerFoto: (id: string) => apiRequest<void>(`/equipamentos/${id}/foto`, { method: "DELETE" }),

  // Anexos múltiplos (17/07/2026, pedido do Vini: "preciso que dê para
  // colocar várias fotos e anexos nos equipamentos") — cada chamada de
  // `anexarArquivo` adiciona 1 arquivo à lista, sem substituir os
  // anteriores (diferente de `anexarFoto` acima, mantido só por
  // compatibilidade). Pra seleção múltipla no front, chama uma vez por
  // arquivo escolhido.
  anexarArquivo: (id: string, file: File) =>
    apiUpload<EquipamentoAnexo>(`/equipamentos/${id}/anexos`, file),

  baixarAnexo: (id: string, anexoId: string) => apiDownloadBlob(`/equipamentos/${id}/anexos/${anexoId}`),

  removerAnexo: (id: string, anexoId: string) =>
    apiRequest<void>(`/equipamentos/${id}/anexos/${anexoId}`, { method: "DELETE" }),

  // Arrastar-e-soltar (17/07/2026) — manda a lista completa de ids na nova
  // ordem; a posição no array vira a ordem de exibição.
  reordenarAnexos: (id: string, anexoIds: string[]) =>
    apiRequest<void>(`/equipamentos/${id}/anexos/ordem`, { method: "PATCH", body: { anexoIds } }),

  // Termo de responsabilidade preenchido (17/07/2026, pedido do Vini) — PDF
  // gerado na hora pelo backend, fiel ao modelo oficial, com os dados do
  // colaborador atual e do(s) equipamento(s), pronto pra imprimir e assinar.
  // `todos` inclui todos os equipamentos em uso do colaborador num termo só.
  gerarTermoPreenchido: (id: string, todos = false) =>
    apiDownloadBlob(`/equipamentos/${id}/termo-preenchido${todos ? "?todos=1" : ""}`),
};
