import { apiDownloadBlob, apiRequest, apiUpload } from "../lib/apiClient";
import {
  ConfiguracaoPagamento, DadosBancariosColaborador, FolhaPagamento, FormaPagamento, PagamentoColaborador,
  RemessaCnab, TipoPagamentoColaborador,
} from "../types";

// Pagamentos de Colaboradores — CNAB 240 Sicoob (20/07/2026, pedido do
// Vini). Todas as rotas exigem papel Admin/Financeiro (dados bancários
// também RH) — ver pagamentos.routes.ts no backend.

export interface DadosBancariosInput {
  bancoCodigo: string; bancoNome: string; agencia: string; agenciaDv?: string | null;
  conta: string; contaDv?: string | null; tipoConta: string;
  favorecidoNome?: string | null; favorecidoCpf?: string | null;
  endereco: string; numero: string; complemento?: string | null;
  bairro: string; cidade: string; cep: string; uf: string;
  // Dados financeiros padrão (21/07/2026) — só sugestão pro lançamento em
  // lote, nunca obrigatório.
  salarioPadrao?: number | null;
  valorAdiantamentoPadrao?: number | null;
}

export interface PagamentoInput {
  colaboradorId: string;
  tipo: TipoPagamentoColaborador;
  valor: number;
  dataPrevista?: string | null;
  formaPagamento?: FormaPagamento | null;
  observacoes?: string | null;
}

export interface PagamentoLoteItemInput {
  colaboradorId: string;
  valor: number;
  observacoes?: string | null;
}

// Página do PDF bruto que o split automático não conseguiu identificar (nem
// CPF, nem nome bateram com nenhum candidato). caminhoRelativo !== null
// significa que a página foi estacionada no servidor (ver
// PASTA_RECIBOS_PENDENTES no backend) e pode ser pré-visualizada/vinculada
// pelas rotas abaixo — null só ocorreria se o próprio PDF da página não
// pôde ser gerado (caso residual, tratado como "sem ação possível" na UI).
export interface PaginaNaoIdentificada {
  pagina: number;
  motivo: string;
  amostraTexto: string;
  caminhoRelativo: string | null;
}

export const pagamentosApi = {
  configuracao: () => apiRequest<ConfiguracaoPagamento>("/pagamentos/configuracao"),
  salvarConfiguracao: (dados: Partial<ConfiguracaoPagamento>) =>
    apiRequest<ConfiguracaoPagamento>("/pagamentos/configuracao", { method: "PUT", body: dados }),

  dadosBancarios: (colaboradorId: string) =>
    apiRequest<DadosBancariosColaborador | null>(`/colaboradores/${colaboradorId}/dados-bancarios`),
  salvarDadosBancarios: (colaboradorId: string, dados: DadosBancariosInput) =>
    apiRequest<DadosBancariosColaborador>(`/colaboradores/${colaboradorId}/dados-bancarios`, { method: "PUT", body: dados }),

  historicoColaborador: (colaboradorId: string) =>
    apiRequest<PagamentoColaborador[]>(`/colaboradores/${colaboradorId}/pagamentos`),

  folhas: () => apiRequest<FolhaPagamento[]>("/folhas-pagamento"),
  criarFolha: (dados: { competencia: string; descricao?: string | null; tipo: TipoPagamentoColaborador; dataPagamento?: string | null }) =>
    apiRequest<FolhaPagamento>("/folhas-pagamento", { method: "POST", body: dados }),
  atualizarFolha: (id: string, dados: { descricao?: string | null; dataPagamento?: string | null }) =>
    apiRequest<FolhaPagamento>(`/folhas-pagamento/${id}`, { method: "PUT", body: dados }),
  excluirFolha: (id: string) => apiRequest<void>(`/folhas-pagamento/${id}`, { method: "DELETE" }),

  criarPagamento: (folhaId: string, dados: PagamentoInput) =>
    apiRequest<PagamentoColaborador>(`/folhas-pagamento/${folhaId}/pagamentos`, { method: "POST", body: dados }),
  criarPagamentosLote: (folhaId: string, itens: PagamentoLoteItemInput[]) =>
    apiRequest<{ criados: PagamentoColaborador[]; ignoradosPorJaExistir: string[] }>(
      `/folhas-pagamento/${folhaId}/pagamentos/lote`,
      { method: "POST", body: { itens } }
    ),
  atualizarPagamento: (id: string, dados: Partial<PagamentoInput>) =>
    apiRequest<PagamentoColaborador>(`/pagamentos-colaborador/${id}`, { method: "PUT", body: dados }),
  excluirPagamento: (id: string) => apiRequest<void>(`/pagamentos-colaborador/${id}`, { method: "DELETE" }),

  // Pagamentos avulsos (22/07/2026, pedido do Vini: "incluir pagamentos
  // avulsos em geral, apenas para ter registro, sem precisar de arquivo de
  // remessa nem nada") — mesmo formato de PagamentoInput, sem folhaId; a
  // edição/exclusão continua pelas rotas genéricas acima (atualizarPagamento/
  // excluirPagamento), já que um avulso é só um PagamentoColaborador sem
  // folha.
  pagamentosAvulsos: () => apiRequest<PagamentoColaborador[]>("/pagamentos-avulsos"),
  criarPagamentoAvulso: (dados: PagamentoInput) =>
    apiRequest<PagamentoColaborador>("/pagamentos-avulsos", { method: "POST", body: dados }),
  marcarPago: (id: string) => apiRequest<PagamentoColaborador>(`/pagamentos-colaborador/${id}/marcar-pago`, { method: "PATCH" }),

  // Estorno (22/07/2026, pedido do Vini: "muitas vezes o pagamento via Pix,
  // TED, etc é estornado e dias depois o financeiro descobre") — disponível
  // pra qualquer pagamento já PAGO, avulso ou de folha.
  estornarPagamento: (id: string, dados: { motivo: string; dataEstorno?: string | null }) =>
    apiRequest<PagamentoColaborador>(`/pagamentos-colaborador/${id}/estornar`, { method: "PATCH", body: dados }),

  // Recibos (21/07/2026, pedido do Vini) — split automático do PDF bruto da
  // folha inteira, com fallback de anexo manual avulso por pagamento.
  uploadRecibosFolha: (folhaId: string, file: File) =>
    apiUpload<{
      totalPaginas: number;
      vinculados: { pagina: number; colaborador: string; motivoIdentificacao: "cpf" | "nome" }[];
      naoIdentificados: PaginaNaoIdentificada[];
    }>(`/folhas-pagamento/${folhaId}/upload-recibos`, file),
  // Mesmo split automático, mas pro conjunto de avulsos em aberto (22/07/2026,
  // pedido do Vini: "adiciona aquele mesmo filtro de PDF bruto que tem em
  // remessa" pro pagamento avulso) — sem folhaId porque avulso não tem
  // agrupamento natural, ver upload-recibos em pagamentos-avulsos no backend.
  uploadRecibosAvulsos: (file: File) =>
    apiUpload<{
      totalPaginas: number;
      vinculados: { pagina: number; colaborador: string; motivoIdentificacao: "cpf" | "nome" }[];
      naoIdentificados: PaginaNaoIdentificada[];
    }>("/pagamentos-avulsos/upload-recibos", file),
  anexarReciboManual: (pagamentoId: string, file: File) =>
    apiUpload<{ reciboNomeOriginal: string; reciboEnviadoEm: string }>(`/pagamentos-colaborador/${pagamentoId}/recibo`, file),
  baixarRecibo: (pagamentoId: string) => apiDownloadBlob(`/pagamentos-colaborador/${pagamentoId}/recibo`),
  removerRecibo: (pagamentoId: string) => apiRequest<void>(`/pagamentos-colaborador/${pagamentoId}/recibo`, { method: "DELETE" }),

  // Achado do Vini (22/07/2026, testando o split na prática): uma página que
  // não bate automaticamente (ex: PDF misturando gente de folha com gente
  // avulsa, como o caso real "Ana Luiza/Ágata de folha + Daisy avulsa num
  // PDF só") ficava sem nenhuma forma de ser aproveitada — só reenviando o
  // PDF INTEIRO nervelha rota de anexo manual, o que colava o bruto inteiro
  // como "recibo" da pessoa errada. Agora cada página não identificada fica
  // estacionada no servidor (ver PASTA_RECIBOS_PENDENTES no backend) e pode
  // ser pré-visualizada e vinculada ao pagamento certo sem reenviar nada.
  previewReciboPendente: (caminhoRelativo: string) => apiDownloadBlob(`/recibos-pendentes/preview?caminho=${encodeURIComponent(caminhoRelativo)}`),
  vincularReciboPendente: (dados: { caminhoRelativo: string; pagamentoId: string }) =>
    apiRequest<{ colaborador: string }>("/recibos-pendentes/vincular", { method: "POST", body: dados }),

  gerarRemessa: (folhaId: string, dados: { dataPagamento?: string; pagamentoIds?: string[] }) =>
    apiRequest<RemessaCnab>(`/folhas-pagamento/${folhaId}/gerar-remessa`, { method: "POST", body: dados }),

  remessas: () => apiRequest<RemessaCnab[]>("/remessas-cnab"),
  baixarArquivoRemessa: (id: string) => apiDownloadBlob(`/remessas-cnab/${id}/arquivo`),
  mudarStatusRemessa: (id: string, status: "ENVIADA" | "CANCELADA") =>
    apiRequest<void>(`/remessas-cnab/${id}/status`, { method: "PATCH", body: { status } }),
  // Exclusão definitiva (22/07/2026, pedido do Vini: "poder excluir...
  // remessas que não forem lançadas") — só enquanto GERADA, ver gate no
  // backend (pagamentos.routes.ts).
  excluirRemessa: (id: string) => apiRequest<void>(`/remessas-cnab/${id}`, { method: "DELETE" }),
  importarRetorno: (file: File) =>
    apiUpload<{
      pagos: number;
      rejeitados: number;
      naoEncontrados: string[];
      rejeitadosDetalhe: { pagamentoId: string; colaborador: string; motivo: string }[];
      folhasFechadasAutomaticamente: number[];
    }>("/remessas-cnab/importar-retorno", file),
};
