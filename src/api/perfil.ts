import { apiRequest, apiUpload, apiDownloadBlob } from "../lib/apiClient";
import { PagamentoColaborador, TelefoneColaborador, TipoPagamentoColaborador } from "../types";

// Meu histórico de pagamentos, no Portal do Colaborador (21/07/2026, pedido
// do Vini: a folha de pagamento não estava disponível pro colaborador ver a
// própria). Reaproveita o tipo PagamentoColaborador (mesmo formato usado na
// tela de gestão), só acrescentando o resumo da folha — a rota de
// autoatendimento inclui isso porque, sem acesso à tela de folhas, é o
// único jeito do colaborador saber "isso é referente a que competência".
export interface PagamentoDoPortal extends PagamentoColaborador {
  folha: { numero: number; competencia: string; tipo: TipoPagamentoColaborador } | null;
}

export interface PerfilResponse {
  id: string;
  email: string;
  papel: string;
  contaCriadaEm: string;
  colaborador: {
    nomeCompleto: string;
    // Múltiplos telefones (07/08/2026) — `telefonePrincipal` é o atalho pra
    // quem só quer mostrar "um número" (ex: cabeçalho do menu); `telefones`
    // é a lista completa, pra quem precisar de todos.
    telefonePrincipal: string | null;
    telefones: TelefoneColaborador[];
    temFoto: boolean;
    cargo: string | null;
    setor: string | null;
  } | null;
}

export interface SessaoAtiva {
  id: string;
  criadoEm: string;
  expiraEm: string;
  atual: boolean;
}

export type Tema = "CLARO" | "ESCURO" | "SISTEMA";

export interface PreferenciaUsuario {
  usuarioId: string;
  tema: Tema;
}

export const perfilApi = {
  obter: () => apiRequest<PerfilResponse>("/perfil"),

  // Preferências pessoais de conta (10/07/2026, pedido do Vini: "crie
  // preferências, não tem nenhuma" → "tema do sistema e etc"). Ver
  // theme/ThemeContext.tsx, único consumidor destas duas funções.
  obterPreferencias: () => apiRequest<PreferenciaUsuario>("/perfil/preferencias"),

  atualizarPreferencias: (data: { tema: Tema }) =>
    apiRequest<PreferenciaUsuario>("/perfil/preferencias", { method: "PATCH", body: data }),

  enviarFoto: (file: File) => apiUpload<{ ok: true }>("/perfil/foto", file),

  removerFoto: () => apiRequest<void>("/perfil/foto", { method: "DELETE" }),

  // Uma tag <img src="..."> comum não manda o header Authorization — por
  // isso a foto é buscada como Blob (mesmo padrão de anexo de
  // chamado/mensagem, ver apiDownloadBlob em lib/apiClient.ts) e convertida
  // em object URL por quem chamar (ver FotoPerfil em
  // components/MenuUsuario.tsx, responsável por revogar a URL depois de
  // usar).
  baixarFoto: () => apiDownloadBlob("/perfil/foto"),

  sessoes: () => apiRequest<SessaoAtiva[]>("/perfil/sessoes"),

  encerrarSessao: (id: string) => apiRequest<void>(`/perfil/sessoes/${id}`, { method: "DELETE" }),

  encerrarOutrasSessoes: () =>
    apiRequest<{ encerradas: number }>("/perfil/sessoes/encerrar-outras", { method: "POST" }),

  meusPagamentos: () => apiRequest<PagamentoDoPortal[]>("/perfil/pagamentos"),

  baixarMeuRecibo: (pagamentoId: string) => apiDownloadBlob(`/perfil/pagamentos/${pagamentoId}/recibo`),
};
