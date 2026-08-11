import { apiDownloadBlob, apiRequest, apiUpload } from "../lib/apiClient";
import { Colaborador, MovimentacaoColaborador, PaginatedResponse, Papel, TipoTelefoneColaborador } from "../types";
import { fetchAllPages } from "./util";

// Espelha o item de `telefones` aceito por POST/PUT /colaboradores no
// backend (07/08/2026) — `tipo`/`principal` têm default no schema do
// backend, então ficam opcionais aqui também.
export interface TelefoneColaboradorInput {
  numero: string;
  tipo?: TipoTelefoneColaborador;
  principal?: boolean;
  observacao?: string | null;
}

export interface ColaboradorInput {
  nomeCompleto: string;
  cpf?: string | null;
  contaFuncao?: boolean;
  email?: string | null;
  telefones?: TelefoneColaboradorInput[];
  unidadeId?: string | null;
  setorId?: string | null;
  cargoId?: string | null;
  status: Colaborador["status"];
  dataAdmissao?: string | null;
  dataNascimento?: string | null;
  observacoes?: string | null;
}

export const colaboradoresApi = {
  listAll: () =>
    fetchAllPages<Colaborador>((page, pageSize) =>
      apiRequest<PaginatedResponse<Colaborador>>("/colaboradores", { query: { page, pageSize } })
    ),

  get: (id: string) => apiRequest<Colaborador>(`/colaboradores/${id}`),

  create: (data: ColaboradorInput) =>
    apiRequest<Colaborador>("/colaboradores", { method: "POST", body: data }),

  update: (id: string, data: Partial<ColaboradorInput>) =>
    apiRequest<Colaborador>(`/colaboradores/${id}`, { method: "PUT", body: data }),

  // Desligamento unificado (17/07/2026, ver DesligamentoModal.tsx) — o
  // backend também devolve a MovimentacaoColaborador criada junto (tipo
  // DESLIGAMENTO), usada logo em seguida pra decidir se dá pra chamar
  // movimentacoesApi.concluir nela imediatamente.
  desligar: (id: string) =>
    apiRequest<{ colaborador: Colaborador; movimentacao: MovimentacaoColaborador }>(
      `/colaboradores/${id}/desligar`,
      { method: "POST" }
    ),

  // Exclusão definitiva — o backend recusa (409) se o colaborador já tiver
  // qualquer histórico real (equipamento, linha, acesso, login, solicitação,
  // chamado ou movimentação). Nesses casos, use "desligar" em vez disso.
  remove: (id: string) => apiRequest<void>(`/colaboradores/${id}`, { method: "DELETE" }),

  resetarSenha: (id: string) =>
    apiRequest<{ senhaTemporaria: string; usuario: { id: string; email: string } }>(
      `/colaboradores/${id}/resetar-senha`,
      { method: "POST" }
    ),

  // Concede login a um colaborador que ainda não tem — 409 se já tiver.
  criarAcesso: (id: string, data: { papel: Papel; email?: string | null }) =>
    apiRequest<{ senhaTemporaria: string; usuario: { id: string; email: string; papel: Papel } }>(
      `/colaboradores/${id}/criar-acesso`,
      { method: "POST", body: data }
    ),

  // Promove/rebaixa um acesso já existente (ex: virou suporte de TI).
  alterarPapelUsuario: (id: string, papel: Papel) =>
    apiRequest<{ id: string; email: string; papel: Papel }>(
      `/colaboradores/${id}/usuario`,
      { method: "PATCH", body: { papel } }
    ),

  // Termo de responsabilidade de equipamento — anexo único, upload substitui
  // o anterior (07/07/2026, pedido do Vini). Mesmo padrão de multipart do
  // anexo de chamado (ver chamadosApi.anexar).
  anexarTermoResponsabilidade: (id: string, file: File) =>
    apiUpload<{ termoResponsabilidadeNomeOriginal: string; termoResponsabilidadeEnviadoEm: string }>(
      `/colaboradores/${id}/termo-responsabilidade`,
      file
    ),

  baixarTermoResponsabilidade: (id: string) => apiDownloadBlob(`/colaboradores/${id}/termo-responsabilidade`),

  removerTermoResponsabilidade: (id: string) =>
    apiRequest<void>(`/colaboradores/${id}/termo-responsabilidade`, { method: "DELETE" }),

  // Importação do Imoview (08/07/2026, pedido do Vini) — só faz o parse do
  // .xlsx exportado da tela "Usuários" do Imoview e casa por e-mail com quem
  // já existe. Não cria nada sozinho: a revisão/confirmação linha a linha
  // acontece em ImportarImoview.tsx, reaproveitando `create()` acima pra
  // cada linha nova que o admin confirmar (mesma validação de sempre,
  // inclusive CPF, que o Imoview nunca traz).
  importarImoviewPreview: (file: File) =>
    apiUpload<ImportarImoviewPreview>("/colaboradores/importar-imoview/preview", file),
};

export interface ImportarImoviewLinha {
  linha: number;
  nome: string;
  situacaoImoview: string;
  statusSugerido: Colaborador["status"];
  cargoImoview: string;
  perfilImoview: string;
  setorImoview: string;
  email: string;
  telefone: string;
  creci: string | null;
  existente: boolean;
  colaboradorExistenteId: string | null;
  colaboradorExistenteNome: string | null;
}

export interface ImportarImoviewPreview {
  linhas: ImportarImoviewLinha[];
  resumo: { total: number; novos: number; existentes: number };
}
