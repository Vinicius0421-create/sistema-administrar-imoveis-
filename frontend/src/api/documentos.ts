import { apiDownloadBlob, apiRequest, apiUpload } from "../lib/apiClient";
import { DocumentoColaborador, DocumentoColaboradorEvento, PaginatedResponse, StatusDocumentoColaborador, TipoDocumento } from "../types";
import { fetchAllPages } from "./util";

// RH — Documentos de colaborador (11/08/2026). Mesmo padrão de cliente de
// API do resto do sistema (ver solicitacoesPapelaria.ts) — ver
// src/routes/documentos.routes.ts no backend para o contrato completo.

export interface TipoDocumentoInput {
  nome: string;
  descricao?: string;
  exigeValidade?: boolean;
  diasAntecedenciaAlerta?: number[];
}

export interface FiltrosDocumentos {
  status?: StatusDocumentoColaborador;
  colaboradorId?: string;
  tipoDocumentoId?: string;
  vencendo?: boolean;
}

export const tiposDocumentoApi = {
  list: (incluirInativos = false) =>
    apiRequest<TipoDocumento[]>("/tipos-documento", { query: incluirInativos ? { incluirInativos: "true" } : undefined }),

  create: (data: TipoDocumentoInput) => apiRequest<TipoDocumento>("/tipos-documento", { method: "POST", body: data }),

  update: (id: string, data: Partial<TipoDocumentoInput> & { status?: "ATIVO" | "INATIVO" }) =>
    apiRequest<TipoDocumento>(`/tipos-documento/${id}`, { method: "PATCH", body: data }),
};

export const documentosColaboradorApi = {
  // Painel do RH/Admin — todos os documentos, com filtros.
  listAll: (filtros: FiltrosDocumentos = {}) =>
    fetchAllPages<DocumentoColaborador>((page, pageSize) =>
      apiRequest<PaginatedResponse<DocumentoColaborador>>("/documentos-colaborador", { query: { page, pageSize, ...filtros } })
    ),

  // Portal do colaborador — só os próprios.
  meus: () =>
    fetchAllPages<DocumentoColaborador>((page, pageSize) =>
      apiRequest<PaginatedResponse<DocumentoColaborador>>("/documentos-colaborador/meus", { query: { page, pageSize } })
    ),

  getOne: (id: string) => apiRequest<DocumentoColaborador>(`/documentos-colaborador/${id}`),

  solicitar: (data: { colaboradorId: string; tipoDocumentoId: string; observacaoSolicitacao?: string }) =>
    apiRequest<DocumentoColaborador>("/documentos-colaborador", { method: "POST", body: data }),

  enviar: (id: string, file: File) => apiUpload<DocumentoColaborador>(`/documentos-colaborador/${id}/enviar`, file),

  analisar: (id: string, data: { aprovado: boolean; motivoRejeicao?: string; dataValidade?: string }) =>
    apiRequest<DocumentoColaborador>(`/documentos-colaborador/${id}/analisar`, { method: "PATCH", body: data }),

  cancelar: (id: string) => apiRequest<DocumentoColaborador>(`/documentos-colaborador/${id}/cancelar`, { method: "PATCH" }),

  comentar: (id: string, mensagem: string) =>
    apiRequest<DocumentoColaboradorEvento>(`/documentos-colaborador/${id}/comentarios`, { method: "POST", body: { mensagem } }),

  baixarArquivo: (id: string) => apiDownloadBlob(`/documentos-colaborador/${id}/arquivo`),
};
