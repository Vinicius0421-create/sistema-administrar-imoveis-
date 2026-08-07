import { apiDownloadBlob, apiRequest, apiUpload } from "../lib/apiClient";
import { ChamadoEvento, ChamadoManutencao, ChamadoStats, PaginatedResponse, Papel, StatusChamado } from "../types";
import { fetchAllPages } from "./util";

export interface Tecnico {
  id: string;
  email: string;
  // Nome de exibição — nome do colaborador vinculado ao usuário, com
  // fallback pro e-mail quando não há colaborador vinculado (ex: conta
  // puramente administrativa). Ver comentário em usuarios.ts no backend.
  // Adicionado em 07/07/2026 a pedido do Vini — o seletor mostrava e-mail.
  nome: string;
  papel: Papel;
}

export interface ChamadoInput {
  solicitanteId: string;
  categoria: ChamadoManutencao["categoria"];
  // Imoview CRM (09/07/2026) — ver comentário em types.ts.
  tipoSolicitacaoImoview?: ChamadoManutencao["tipoSolicitacaoImoview"];
  codigoImovel?: string | null;
  equipamentoId?: string | null;
  descricao: string;
  // Obrigatórios desde 07/07/2026 — ver comentário em types.ts.
  unidadeId: string;
  local?: string | null;
  responsavelId: string;
  prioridade: ChamadoManutencao["prioridade"];
  fornecedorExterno?: string | null;
  // Abertura de Chamados Offline (08/07/2026) — preenchido só quando o
  // chamado foi criado enquanto sem conexão e está sendo sincronizado agora
  // (ver src/offline/chamadosOffline.ts); preserva a data/hora real da
  // abertura em vez de registrar o momento da sincronização. ISO 8601.
  dataAberturaOriginal?: string;
}

export interface ChamadoUpdateInput {
  categoria?: ChamadoManutencao["categoria"];
  // Imoview CRM (09/07/2026) — ver comentário em types.ts.
  tipoSolicitacaoImoview?: ChamadoManutencao["tipoSolicitacaoImoview"];
  codigoImovel?: string | null;
  equipamentoId?: string | null;
  descricao?: string;
  unidadeId?: string;
  local?: string | null;
  prioridade?: ChamadoManutencao["prioridade"];
  fornecedorExterno?: string | null;
  valorPrevisto?: number | null;
  valorFinal?: number | null;
  observacoesInternas?: string | null;
  solucaoAplicada?: string | null;
}

export const chamadosApi = {
  listAll: () =>
    fetchAllPages<ChamadoManutencao>((page, pageSize) =>
      apiRequest<PaginatedResponse<ChamadoManutencao>>("/chamados-manutencao", { query: { page, pageSize } })
    ),

  getOne: (id: string) => apiRequest<ChamadoManutencao>(`/chamados-manutencao/${id}`),

  create: (data: ChamadoInput) => apiRequest<ChamadoManutencao>("/chamados-manutencao", { method: "POST", body: data }),

  update: (id: string, data: ChamadoUpdateInput) =>
    apiRequest<ChamadoManutencao>(`/chamados-manutencao/${id}`, { method: "PATCH", body: data }),

  mudarStatus: (id: string, status: StatusChamado, valorFinal?: number) =>
    apiRequest<ChamadoManutencao>(`/chamados-manutencao/${id}/status`, {
      method: "PATCH",
      body: { status, valorFinal },
    }),

  // Desde 07/07/2026 responsavelId é obrigatório (não dá mais pra
  // "desatribuir" — ver comentário em chamados.routes.ts) — atribuir sempre
  // troca por outro técnico, nunca zera.
  atribuir: (id: string, responsavelId: string) =>
    apiRequest<ChamadoManutencao>(`/chamados-manutencao/${id}/atribuir`, {
      method: "PATCH",
      body: { responsavelId },
    }),

  enviarMensagem: (id: string, mensagem: string) =>
    apiRequest<ChamadoEvento>(`/chamados-manutencao/${id}/mensagens`, { method: "POST", body: { mensagem } }),

  removerEvento: (id: string, eventoId: string) =>
    apiRequest<void>(`/chamados-manutencao/${id}/eventos/${eventoId}`, { method: "DELETE" }),

  // Armazenamento em Railway Volume, decisão de 06/07/2026 (ver
  // Plano_Evolucao_Sistema_Corporativo.md no projeto Claude) — o anexo entra
  // como um ChamadoEvento tipo ANEXO, junto do resto da linha do tempo.
  anexar: (id: string, file: File) => apiUpload<ChamadoEvento>(`/chamados-manutencao/${id}/anexos`, file),

  baixarAnexo: (id: string, eventoId: string) =>
    apiDownloadBlob(`/chamados-manutencao/${id}/eventos/${eventoId}/anexo`),

  remove: (id: string) => apiRequest<void>(`/chamados-manutencao/${id}`, { method: "DELETE" }),

  tecnicos: () => apiRequest<Tecnico[]>("/tecnicos"),

  // Fase 2 — Melhorias Estruturais (09/07/2026): reabertura (gestão ou o
  // próprio solicitante), avaliação pós-atendimento (só o solicitante) e o
  // dashboard de indicadores de suporte (só quem gerencia — ver
  // requireRole na rota).
  reabrir: (id: string, motivo?: string) =>
    apiRequest<ChamadoManutencao>(`/chamados-manutencao/${id}/reabrir`, { method: "PATCH", body: { motivo } }),

  avaliar: (id: string, nota: number, comentario?: string) =>
    apiRequest<ChamadoManutencao>(`/chamados-manutencao/${id}/avaliar`, { method: "PATCH", body: { nota, comentario } }),

  stats: (dias?: number) => apiRequest<ChamadoStats>("/chamados-manutencao/stats", { query: dias ? { dias } : undefined }),
};
