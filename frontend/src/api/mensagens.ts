import { apiDownloadBlob, apiRequest, apiUpload } from "../lib/apiClient";
import { Papel } from "../types";

// Chat interno (07/07/2026, pedido do Vini) — ver comentário do model
// Mensagem em schema.prisma (backend) pro desenho geral. Busca por polling
// simples (ver useMensagensPolling em pages/Mensagens.tsx), sem WebSocket.
//
// Redesenho da Central de Comunicação (Fase 1, 21/07/2026, pedido do Vini:
// "criar uma Central de Comunicação limpa, organizada, inteligente e
// escalável... controlado automaticamente pelas permissões") — dois tipos de
// canal novos, ver comentário completo em mensagens.routes.ts (backend):
//   CANAL_SETOR_UNIDADE — "meu departamento", de verdade restrito a 1 unidade.
//   CANAL_EMPRESA        — "Avisos da Empresa", singleton, todo mundo acessa.
export type TipoMensagem = "DIRETA" | "CANAL_UNIDADE" | "CANAL_SETOR" | "CANAL_SETOR_UNIDADE" | "CANAL_EMPRESA";

// Segmento de URL usado nas rotas /mensagens/canal/:tipoUrl/... — mapeamento
// 1:1 com TipoMensagem (exceto DIRETA, que tem rotas próprias).
export type TipoCanalUrl = "unidade" | "setor" | "setor-unidade" | "empresa";

// Fase 2 (21/07/2026) — algumas rotas novas (fixados, arquivos
// compartilhados) tratam "a conversa" de forma unificada, incluindo DIRETA
// como só mais um tipo de conversa (ver tipoConversaUrlParaEnum no backend).
export type TipoConversaUrl = TipoCanalUrl | "direta";

export const CANAL_EMPRESA_ID = "empresa";

export function tipoParaUrl(tipo: Exclude<TipoMensagem, "DIRETA">): TipoCanalUrl {
  if (tipo === "CANAL_UNIDADE") return "unidade";
  if (tipo === "CANAL_SETOR") return "setor";
  if (tipo === "CANAL_SETOR_UNIDADE") return "setor-unidade";
  return "empresa";
}

export function tipoParaUrlConversa(tipo: TipoMensagem): TipoConversaUrl {
  if (tipo === "DIRETA") return "direta";
  return tipoParaUrl(tipo);
}

// Mesmo conjunto fixo de emojis validado no backend (ver
// EMOJIS_REACAO_PERMITIDOS em mensagens.routes.ts) — usado pra montar a
// barra de reação rápida sem depender de um picker de emoji livre.
export const EMOJIS_REACAO_PERMITIDOS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "👏", "✅", "🔥"] as const;
export type EmojiReacao = (typeof EMOJIS_REACAO_PERMITIDOS)[number];

export type ModoNotificacaoCanal = "TODAS" | "MENCOES" | "SILENCIADO";

// Chave composta de um canal Setor×Unidade — mesmo formato usado no backend
// (ver chaveSetorUnidade em canaisMensagem.ts). Usada como `alvoId` de
// CANAL_SETOR_UNIDADE em toda parte (URL, LeituraCanal, Favoritos).
export function chaveSetorUnidade(unidadeId: string, setorId: string): string {
  return `${unidadeId}:${setorId}`;
}

export interface AutorMensagem {
  id: string;
  email: string;
  papel: Papel;
  colaborador?: { nomeCompleto: string } | null;
}

// Reação agrupada (Fase 2, 21/07/2026) — 1 entrada por emoji já usado nesta
// mensagem, com a lista de quem reagiu (pra destacar "você reagiu" e pro
// tooltip de nomes).
export interface ReacaoAgrupada {
  emoji: string;
  usuarioIds: string[];
}

export interface Mensagem {
  id: string;
  tipo: TipoMensagem;
  remetenteId: string;
  destinatarioId: string | null;
  unidadeId: string | null;
  setorId: string | null;
  conteudo: string;
  anexoUrl: string | null;
  anexoNomeOriginal: string | null;
  anexoTipo: string | null;
  anexoTamanhoBytes: number | null;
  lidaEm: string | null;
  criadoEm: string;
  remetente: AutorMensagem;
  // Fase 2 da Central de Comunicação (21/07/2026) — resposta em thread,
  // reações, fixação e contagem de respostas. Presentes em toda rota de
  // leitura que passou pelo MENSAGEM_INCLUDE_FASE2/formatarMensagem no
  // backend; ausentes (undefined) nas poucas rotas mais leves que não
  // precisam disso (ex: GET /mensagens/conversas, GET .../anexos).
  respostaAId?: string | null;
  reacoes?: ReacaoAgrupada[];
  fixada?: boolean;
  totalRespostas?: number;
}

// "Recentes" unificado (09/07/2026, atualizado 21/07/2026) — GET
// /mensagens/conversas devolve todos os tipos misturados na mesma lista,
// ordenados só por data da última mensagem; `tipo` decide o que renderizar
// (nome do contato vs "# nome do canal") e pra onde navegar ao clicar.
export type ConversaResumo =
  | { tipo: "DIRETA"; contato: AutorMensagem; ultimaMensagem: Mensagem; naoLidas: number }
  | {
      tipo: "CANAL_UNIDADE" | "CANAL_SETOR" | "CANAL_SETOR_UNIDADE" | "CANAL_EMPRESA";
      id: string;
      nome: string;
      ultimaMensagem: Mensagem;
      naoLidas: number;
    };

export interface CanalDominio {
  id: string;
  nome: string;
}

// Um canal "meu departamento" (CANAL_SETOR_UNIDADE) dentro da árvore de uma
// Unidade — `chave` é o alvoId usado em toda rota (chaveSetorUnidade).
export interface SetorNaUnidade extends CanalDominio {
  chave: string;
}

export interface UnidadeCanais {
  id: string;
  nome: string;
  // true se este usuário acessa o canal CANAL_UNIDADE ("minha equipe", a
  // unidade inteira) desta unidade — hoje só o Gestor da própria unidade
  // (ou irrestrito) tem isso automaticamente.
  acessoEquipe: boolean;
  setores: SetorNaUnidade[];
}

// Árvore hierárquica que alimenta a aba "Canais" da barra lateral (Fase 1 do
// redesenho, 21/07/2026): 📁 Unidade > 📂 Setores, mais os setores "globais"
// (TI/RH, alcançáveis de qualquer unidade) e o canal único de Avisos da
// Empresa. Já vem filtrada pelo backend conforme a permissão do usuário
// logado — o frontend nunca decide "posso ver isso", só renderiza o que
// veio.
export interface CanaisDisponiveis {
  irrestrito: boolean;
  canalEmpresa: CanalDominio;
  unidades: UnidadeCanais[];
  setoresGlobais: CanalDominio[];
}

interface EnviarMensagemInput {
  tipo: TipoMensagem;
  destinatarioId?: string;
  unidadeId?: string;
  setorId?: string;
  conteudo: string;
  // Resposta em thread (Fase 2, 21/07/2026) — id da mensagem-pai; o resto
  // dos campos continua normal (a mesma conversa aberta na tela), o backend
  // só CONFERE que bate com a conversa da mensagem-pai.
  respostaAId?: string;
}

export const mensagensApi = {
  enviar: (data: EnviarMensagemInput) => apiRequest<Mensagem>("/mensagens", { method: "POST", body: data }),

  // Mesma rota de enviar(), só que multipart — ver apiUpload (o campo
  // "conteudo" pode vir vazio, uma mensagem pode ser só o anexo).
  enviarComAnexo: (data: EnviarMensagemInput, file: File) =>
    apiUpload<Mensagem>(
      "/mensagens",
      file,
      Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null)) as Record<string, string>
    ),

  conversas: () => apiRequest<ConversaResumo[]>("/mensagens/conversas"),

  contadores: () => apiRequest<{ diretasNaoLidas: number; canaisNaoLidas: number; total: number }>("/mensagens/contadores"),

  canaisDisponiveis: () => apiRequest<CanaisDisponiveis>("/mensagens/canais-disponiveis"),

  // "Visualizar como" (22/07/2026) — só ADMINISTRADOR; deixa conferir a
  // árvore de canais de qualquer outro usuário sem precisar da senha dele.
  // Existe porque a própria conta de Administrador é irrestrita por desenho
  // (vê tudo sempre), então nunca dava pra confirmar visualmente a
  // segmentação de um papel restrito (Gestor/Financeiro/Colaborador) olhando
  // só a própria tela.
  canaisDisponiveisComo: (usuarioId: string) =>
    apiRequest<{ usuario: { id: string; papel: Papel; nome: string | null }; canais: CanaisDisponiveis }>(
      `/mensagens/canais-disponiveis/como/${usuarioId}`
    ),

  thread: (usuarioId: string) => apiRequest<Mensagem[]>(`/mensagens/direta/${usuarioId}`),

  marcarLida: (usuarioId: string) => apiRequest<void>(`/mensagens/direta/${usuarioId}/lida`, { method: "PATCH" }),

  // `id` pode conter ":" (chave de setor-unidade) — sempre codificado, tanto
  // aqui quanto em marcarCanalLida abaixo.
  canal: (tipo: TipoCanalUrl, id: string) => apiRequest<Mensagem[]>(`/mensagens/canal/${tipo}/${encodeURIComponent(id)}`),

  // Membros de verdade de um canal (22/07/2026) — usado só pro autocomplete
  // de @menção no compose, pra não oferecer gente que não pertence ao canal
  // (não seria notificada de qualquer forma, ver comentário completo no
  // backend). Não confundir com "quem PODE acessar o canal" — é sobre quem
  // efetivamente é membro (mesma distinção de resolverMembrosCanal).
  membrosCanal: (tipo: TipoCanalUrl, id: string) =>
    apiRequest<{ usuarioId: string; nome: string }[]>(`/mensagens/canal/${tipo}/${encodeURIComponent(id)}/membros`),

  marcarCanalLida: (tipo: TipoCanalUrl, id: string) =>
    apiRequest<void>(`/mensagens/canal/${tipo}/${encodeURIComponent(id)}/lida`, { method: "PATCH" }),

  baixarAnexo: (mensagemId: string) => apiDownloadBlob(`/mensagens/${mensagemId}/anexo`),

  remover: (id: string) => apiRequest<void>(`/mensagens/${id}`, { method: "DELETE" }),

  // Resposta em thread (Fase 2, 21/07/2026) — respostas de UMA mensagem,
  // sempre 1 nível só.
  respostas: (mensagemId: string) => apiRequest<Mensagem[]>(`/mensagens/${mensagemId}/respostas`),

  // Indicador de leitura por mensagem (Fase 2) — em DIRETA, 0 ou 1 leitor
  // (o destinatário); em canal, quem já leu, derivado de LeituraCanal.
  leitores: (mensagemId: string) => apiRequest<{ leitores: string[] }>(`/mensagens/${mensagemId}/leitores`),

  // Histórico pesquisável (Fase 2) — busca em todas as conversas
  // acessíveis de uma vez, mínimo 2 caracteres (mesma regra do backend).
  buscar: (q: string) => apiRequest<Mensagem[]>("/mensagens/busca", { query: { q } }),
};

// Mensagens fixadas (Fase 2, 21/07/2026, pedido do Vini: "mensagens
// fixadas") — fixar/desfixar por mensagem + listagem por conversa (usa o
// tipo unificado TipoConversaUrl, que também aceita "direta").
export const fixadosApi = {
  fixar: (mensagemId: string) => apiRequest<{ fixada: true }>(`/mensagens/${mensagemId}/fixar`, { method: "POST" }),
  desfixar: (mensagemId: string) => apiRequest<void>(`/mensagens/${mensagemId}/fixar`, { method: "DELETE" }),
  listar: (tipo: TipoConversaUrl, id: string) =>
    apiRequest<Mensagem[]>(`/mensagens/conversa/${tipo}/${encodeURIComponent(id)}/fixados`),
};

// Reações em emoji (Fase 2, 21/07/2026, pedido do Vini: "reações") — toggle
// único: reagir de novo com o mesmo emoji remove.
export const reacoesApi = {
  reagir: (mensagemId: string, emoji: EmojiReacao) =>
    apiRequest<{ reacoes: ReacaoAgrupada[] }>(`/mensagens/${mensagemId}/reacoes`, { method: "POST", body: { emoji } }),
};

// Arquivos compartilhados (Fase 2, 21/07/2026, pedido do Vini: "arquivos
// compartilhados") — todo anexo já trocado na conversa; o download de cada
// um continua sendo mensagensApi.baixarAnexo.
export const arquivosCompartilhadosApi = {
  listar: (tipo: TipoConversaUrl, id: string) =>
    apiRequest<Mensagem[]>(`/mensagens/conversa/${tipo}/${encodeURIComponent(id)}/anexos`),
};

// Preferências de notificação por conversa (Fase 2, 21/07/2026, pedido do
// Vini: "notificações configuráveis") — separado das preferências globais
// por categoria (ver notificacoes.ts), esta é POR conversa específica.
export interface PreferenciaNotificacaoCanal {
  id: string;
  usuarioId: string;
  tipo: TipoMensagem;
  alvoId: string;
  modo: ModoNotificacaoCanal;
}

export const preferenciasNotificacaoCanalApi = {
  listar: () => apiRequest<PreferenciaNotificacaoCanal[]>("/mensagens/preferencias-notificacao"),
  atualizar: (tipo: TipoMensagem, alvoId: string, modo: ModoNotificacaoCanal) =>
    apiRequest<{ tipo: TipoMensagem; alvoId: string; modo: ModoNotificacaoCanal }>("/mensagens/preferencias-notificacao", {
      method: "PUT",
      body: { tipo, alvoId, modo },
    }),
};

// Favoritos (Fase 1 do redesenho, 21/07/2026, item "⭐ Favoritos" da barra
// lateral) — fixar uma conversa/canal no topo. `alvoId` segue a mesma
// convenção do resto do módulo: id da Unidade/Setor, chaveSetorUnidade(),
// CANAL_EMPRESA_ID, ou id do Usuario contato (DIRETA).
export interface Favorito {
  id: string;
  usuarioId: string;
  tipo: TipoMensagem;
  alvoId: string;
  criadoEm: string;
}

export const favoritosApi = {
  listar: () => apiRequest<Favorito[]>("/mensagens/favoritos"),
  adicionar: (tipo: TipoMensagem, alvoId: string) =>
    apiRequest<Favorito>("/mensagens/favoritos", { method: "POST", body: { tipo, alvoId } }),
  remover: (tipo: TipoMensagem, alvoId: string) =>
    apiRequest<void>(`/mensagens/favoritos/${tipo}/${encodeURIComponent(alvoId)}`, { method: "DELETE" }),
};

// Administração dos acessos extra a canal (tela em Configurações,
// ADMINISTRADOR) — ver AcessoCanalExtra em schema.prisma.
export interface AcessoCanalExtra {
  id: string;
  colaboradorId: string | null;
  colaborador: { id: string; nomeCompleto: string } | null;
  setorOrigemId: string | null;
  setorOrigem: { id: string; nome: string } | null;
  tipo: "CANAL_UNIDADE" | "CANAL_SETOR" | "CANAL_SETOR_UNIDADE";
  setorDestinoId: string | null;
  setorDestino: { id: string; nome: string } | null;
  unidadeDestinoId: string | null;
  unidadeDestino: { id: string; nome: string } | null;
  observacao: string | null;
  criadoEm: string;
}

export interface AcessoCanalExtraInput {
  colaboradorId?: string | null;
  setorOrigemId?: string | null;
  tipo: "CANAL_UNIDADE" | "CANAL_SETOR" | "CANAL_SETOR_UNIDADE";
  setorDestinoId?: string | null;
  unidadeDestinoId?: string | null;
  observacao?: string | null;
}

export const acessosCanalExtraApi = {
  listar: () => apiRequest<AcessoCanalExtra[]>("/mensagens/acessos-canal-extra"),
  criar: (data: AcessoCanalExtraInput) => apiRequest<AcessoCanalExtra>("/mensagens/acessos-canal-extra", { method: "POST", body: data }),
  remover: (id: string) => apiRequest<void>(`/mensagens/acessos-canal-extra/${id}`, { method: "DELETE" }),
};
