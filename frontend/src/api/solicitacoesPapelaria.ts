import { apiRequest } from "../lib/apiClient";
import {
  EventoSolicitacaoPapelaria, PaginatedResponse, Papel, Prioridade, SolicitacaoPapelaria,
  StatusSolicitacaoPapelaria, TipoSolicitacaoPapelaria, UnidadeMedidaProduto,
} from "../types";
import { fetchAllPages } from "./util";

// Módulo "Papelaria e Compras" (09/07/2026, pedido do Vini) — mesmo padrão de
// cliente de API já usado em chamados.ts, submódulo irmão de
// solicitacoes.ts (equipamento). Ver
// src/routes/solicitacoesPapelaria.routes.ts no backend para o contrato
// completo.

// Quem pode ser escolhido como "responsável" ao abrir uma solicitação em
// nome de outra pessoa — só ADMINISTRADOR/GESTOR_COORDENADOR podem fazer
// essa escolha (ver comentário em SolicitacoesPapelaria.tsx), e mesmo assim
// só entre colegas que também têm acesso de gestão a este módulo (por isso a
// lista já vem pré-filtrada pelo backend, sem incluir COLABORADOR/SUPORTE_TI).
export interface Gestor {
  id: string;
  email: string;
  papel: Papel;
  nome: string;
}

export interface ItemSolicitacaoPapelariaInput {
  produtoId?: string | null;
  // Obrigatório só quando produtoId não é informado (item avulso, fora do
  // catálogo) — ver .refine() equivalente no backend.
  nomeProduto?: string;
  categoriaId: string;
  quantidade: number;
  unidadeMedida?: UnidadeMedidaProduto;
  observacoes?: string | null;
}

export interface SolicitacaoPapelariaInput {
  unidadeId: string;
  // Ausente = usuário logado. Ver regra de permissão em
  // solicitacoesPapelaria.routes.ts (só ADMINISTRADOR/GESTOR_COORDENADOR
  // podem informar outra pessoa).
  responsavelId?: string;
  tipo: TipoSolicitacaoPapelaria;
  prioridade?: Prioridade;
  // Obrigatória (não-vazia) quando tipo === "AVULSA" — validado aqui e de
  // novo no backend (.refine()), a mesma regra nos dois lados.
  justificativa?: string | null;
  observacoes?: string | null;
  itens: ItemSolicitacaoPapelariaInput[];
  // true faz a solicitação já nascer ENVIADA em vez de RASCUNHO.
  enviarAgora?: boolean;
}

export interface SolicitacaoPapelariaUpdateInput {
  unidadeId?: string;
  tipo?: TipoSolicitacaoPapelaria;
  prioridade?: Prioridade;
  justificativa?: string | null;
  observacoes?: string | null;
  itens?: ItemSolicitacaoPapelariaInput[];
}

export interface DashboardSolicitacoesPapelaria {
  abertas: number;
  concluidas: number;
  urgentes: number;
  remessasMensaisRealizadas: number;
  tempoMedioAtendimentoMs: number | null;
  porUnidade: { unidadeId: string; nome: string; total: number }[];
  // "YYYY-MM", últimos 6 meses incluindo o atual — ver rota /dashboard.
  porPeriodo: { mes: string; total: number }[];
}

export const solicitacoesPapelariaApi = {
  listAll: () =>
    fetchAllPages<SolicitacaoPapelaria>((page, pageSize) =>
      apiRequest<PaginatedResponse<SolicitacaoPapelaria>>("/solicitacoes-papelaria", { query: { page, pageSize } })
    ),

  getOne: (id: string) => apiRequest<SolicitacaoPapelaria>(`/solicitacoes-papelaria/${id}`),

  create: (data: SolicitacaoPapelariaInput) =>
    apiRequest<SolicitacaoPapelaria>("/solicitacoes-papelaria", { method: "POST", body: data }),

  // Só é aceito pelo backend enquanto status é RASCUNHO ou ENVIADA (409 caso
  // contrário) — ver comentário no formulário de edição do detalhe.
  update: (id: string, data: SolicitacaoPapelariaUpdateInput) =>
    apiRequest<SolicitacaoPapelaria>(`/solicitacoes-papelaria/${id}`, { method: "PATCH", body: data }),

  // motivo (achado de auditoria S2, 22/07/2026) — só exigido pelo backend
  // quando `status === "REPROVADA"` (ver solicitacoesPapelaria.routes.ts);
  // nas demais transições do Kanban continua opcional, sem mudar contrato.
  mudarStatus: (id: string, status: StatusSolicitacaoPapelaria, motivo?: string) =>
    apiRequest<SolicitacaoPapelaria>(`/solicitacoes-papelaria/${id}/status`, { method: "PATCH", body: { status, motivo } }),

  comentar: (id: string, mensagem: string) =>
    apiRequest<EventoSolicitacaoPapelaria>(`/solicitacoes-papelaria/${id}/comentarios`, { method: "POST", body: { mensagem } }),

  removerEvento: (id: string, eventoId: string) =>
    apiRequest<void>(`/solicitacoes-papelaria/${id}/eventos/${eventoId}`, { method: "DELETE" }),

  remove: (id: string) => apiRequest<void>(`/solicitacoes-papelaria/${id}`, { method: "DELETE" }),

  gestores: () => apiRequest<Gestor[]>("/solicitacoes-papelaria/gestores"),

  dashboard: () => apiRequest<DashboardSolicitacoesPapelaria>("/solicitacoes-papelaria/dashboard"),
};
