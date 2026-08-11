// Cliente HTTP central. O access token vive só em memória (nunca em
// localStorage/sessionStorage) — um token acessível via JavaScript em
// storage persistente é um alvo maior para roubo via XSS. O refresh token
// (08/07/2026, Persistência de Login) NÃO passa mais por aqui: ele vive num
// cookie httpOnly gerenciado inteiramente pelo backend (ver
// setRefreshCookie em auth.routes.ts), invisível a este arquivo e a
// qualquer JavaScript da página — a única coisa que este cliente precisa
// fazer é mandar `credentials: "include"` em toda chamada, para o navegador
// anexar/aceitar esse cookie mesmo sendo frontend (Vercel) e backend
// (Railway) domínios diferentes. Isso resolve o bug relatado pelo Vini
// (07/07/2026: "o sistema desconecta o usuário sempre que a página é
// atualizada") sem piorar a superfície de ataque de XSS — pelo contrário,
// melhora: antes o refresh token passava (mesmo que brevemente) por
// variável JS; agora nunca fica acessível a script nenhum.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3333";

// Achado de auditoria (06/07/2026): nenhuma chamada tinha timeout — numa
// rede de celular ruim (o caso comum do colaborador em campo), uma requisição
// que trava não falha nunca; a UI fica com o botão em "Salvando..." pra
// sempre, sem erro nenhum aparecer. 20s é folgado o bastante pra 3G/4G lento
// não disparar falso-positivo, mas curto o bastante pra não deixar a pessoa
// esperando indefinidamente.
const TIMEOUT_MS = 20_000;

// Upload/download de anexo (até 10MB — ver TAMANHO_MAXIMO_BYTES no backend)
// tende a demorar mais que uma chamada JSON comum numa rede de celular
// ruim; timeout mais folgado evita cancelar um envio que só está lento.
const TIMEOUT_UPLOAD_MS = 60_000;

function timeoutSignal(ms: number = TIMEOUT_MS): AbortSignal {
  // AbortSignal.timeout existe nos browsers modernos; fallback manual cobre
  // qualquer ambiente mais antigo sem quebrar a chamada.
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

type Tokens = { accessToken: string } | null;

let tokens: Tokens = null;
let onUnauthorized: (() => void) | null = null;
let onSenhaTrocaObrigatoria: (() => void) | null = null;

export const tokenStore = {
  set(t: Tokens) {
    tokens = t;
  },
  get(): Tokens {
    return tokens;
  },
  setAccessToken(accessToken: string) {
    tokens = { accessToken };
  },
  clear() {
    tokens = null;
  },
  setUnauthorizedHandler(fn: () => void) {
    onUnauthorized = fn;
  },
  // Disparado quando a API recusa uma chamada com o código
  // SENHA_TROCA_OBRIGATORIA (ver src/plugins/auth.ts no backend) — sinaliza
  // que o estado local ficou desatualizado em relação ao que o token carrega
  // e a tela de troca de senha precisa assumir. Rede de segurança; o caminho
  // normal já é decidido em App.tsx a partir de user.precisaTrocarSenha.
  setSenhaTrocaObrigatoriaHandler(fn: () => void) {
    onSenhaTrocaObrigatoria = fn;
  },
};

export class ApiError extends Error {
  status: number;
  detalhes?: unknown;
  codigo?: string;
  constructor(status: number, message: string, detalhes?: unknown, codigo?: string) {
    super(message);
    this.status = status;
    this.detalhes = detalhes;
    this.codigo = codigo;
  }
}

// Achado de auditoria (09/07/2026, "sessão fantasma" relatada pelo Vini: a
// lista "Sessões ativas" do Menu do Usuário só crescia, com linhas que
// nunca correspondiam a um dispositivo de verdade) — `apiRequest`,
// `apiUpload` e `apiDownloadBlob`, os 3 abaixo, cada um chama
// `refreshAccessToken()` de forma totalmente independente ao ver um 401. O
// Menu do Usuário abre disparando "GET /perfil" e "GET /perfil/sessoes" em
// paralelo (ver MenuUsuario.tsx) — depois de ~15min parado noutra tela
// (vida do access token, ver JWT_ACCESS_EXPIRES_IN no backend), os DOIS
// tomam 401 ao mesmo tempo e cada chamada tentava renovar sozinha, mandando
// duas requisições simultâneas de "POST /auth/refresh" com o MESMO cookie
// de refresh token ainda válido. O backend gira o refresh token a cada uso
// (rotação, ver auth.routes.ts) — a primeira requisição a chegar revoga o
// token velho e cria um novo; a segunda, que already partiu com o token
// agora revogado, toma 401 e o backend LIMPA o cookie (clearRefreshCookie),
// apagando por cima o cookie do token novo que a primeira acabara de
// setar. Resultado: uma sessão nova (linha órfã) fica no banco sem nunca
// ser revogada nem reconhecida pelo cookie do navegador — some da tela só
// depois de expirar sozinha em 7 dias (JWT_REFRESH_EXPIRES_IN_DAYS).
//
// Corrigido represando (dedup) as chamadas concorrentes numa única
// promise compartilhada: a primeira chamada de fato dispara o
// POST /auth/refresh; qualquer chamada que chegue enquanto essa primeira
// ainda está em voo simplesmente espera o MESMO resultado, em vez de
// disparar uma segunda requisição concorrente.
let refreshEmVoo: Promise<boolean> | null = null;

// Tenta renovar o access token usando o refresh token que mora no cookie
// httpOnly — nunca lido nem enviado manualmente por este arquivo, o
// `credentials: "include"` é o suficiente para o navegador anexá-lo
// sozinho. Usada tanto pelo retry automático de um 401 (abaixo) quanto por
// `tentarRestaurarSessao` (AuthContext.tsx), chamada uma vez no boot do app
// para restaurar a sessão depois de um F5 ou de fechar/reabrir o navegador,
// sem exigir login de novo — desde que o cookie ainda seja válido.
export async function refreshAccessToken(): Promise<boolean> {
  if (refreshEmVoo) return refreshEmVoo;

  refreshEmVoo = (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        signal: timeoutSignal(),
      });
    } catch {
      return false;
    }
    if (!res.ok) {
      tokenStore.clear();
      return false;
    }
    const data = await res.json();
    tokenStore.set({ accessToken: data.accessToken });
    return true;
  })();

  try {
    return await refreshEmVoo;
  } finally {
    // Libera pra próxima vez que um 401 acontecer (ex: 15min depois) — só
    // dedup enquanto a renovação está genuinamente em andamento.
    refreshEmVoo = null;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(API_URL.replace(/\/$/, "") + path);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    });
  }
  return url.toString();
}

async function doFetch(path: string, options: RequestOptions): Promise<Response> {
  // Content-Type só é enviado quando existe corpo de fato. O Fastify (parser
  // JSON padrão) rejeita com 400 FST_ERR_CTP_EMPTY_JSON_BODY qualquer
  // requisição que declare "Content-Type: application/json" mas mande corpo
  // vazio — o que sempre foi o caso de todo DELETE e de POSTs sem corpo
  // (devolver ao estoque, alternar-status) daqui. Esse bug ficou invisível
  // enquanto o CORS do backend bloqueava PUT/PATCH/DELETE antes mesmo de
  // chegar ao servidor (ver nota em server.ts); ao corrigir o CORS, essas
  // chamadas passaram a chegar de verdade e bateram nesse segundo problema.
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;

  return fetch(buildUrl(path, options.query), {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "include",
    signal: timeoutSignal(),
  });
}

// Faz a requisição; se voltar 401 (access token expirado), tenta renovar
// uma única vez e repete a chamada original antes de desistir.
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await doFetch(path, options);
  } catch {
    // AbortError (timeout) ou falha de rede — sem isso, a Promise rejeitava
    // com um erro técnico do fetch/DOM ("The operation was aborted") em vez
    // de uma mensagem que o colaborador entenda.
    throw new ApiError(0, "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
  }

  // Não há mais como checar client-side se existe refresh token (ele vive
  // num cookie httpOnly, invisível a este código) — tenta renovar sempre que
  // um 401 acontece; se não houver cookie válido, /auth/refresh volta 401
  // rápido e cai no tratamento de sessão expirada logo abaixo, sem custo
  // relevante.
  if (res.status === 401) {
    const renovou = await refreshAccessToken();
    if (renovou) {
      try {
        res = await doFetch(path, options);
      } catch {
        throw new ApiError(0, "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
      }
    }
  }

  if (res.status === 401) {
    tokenStore.clear();
    onUnauthorized?.();
    throw new ApiError(401, "Sessão expirada. Faça login novamente.");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json() : undefined;

  if (!res.ok) {
    if (payload?.codigo === "SENHA_TROCA_OBRIGATORIA") {
      onSenhaTrocaObrigatoria?.();
    }
    throw new ApiError(res.status, payload?.error || `Erro ${res.status}`, payload?.detalhes, payload?.codigo);
  }

  return payload as T;
}

// Lê o corpo de erro (JSON, se houver) de uma Response não-ok, reaproveitado
// pelos dois helpers abaixo — mesma extração de mensagem/código feita em
// apiRequest, sem duplicar a lógica duas vezes.
async function erroDaResposta(res: Response): Promise<ApiError> {
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json().catch(() => undefined) : undefined;
  if (payload?.codigo === "SENHA_TROCA_OBRIGATORIA") onSenhaTrocaObrigatoria?.();
  return new ApiError(res.status, payload?.error || `Erro ${res.status}`, payload?.detalhes, payload?.codigo);
}

// Upload de anexo (chamado de manutenção, termo de responsabilidade,
// mensagem do chat — ver src/routes/*.routes.ts no backend). Não reaproveita
// doFetch/apiRequest porque multipart precisa de FormData como corpo e NUNCA
// deve setar Content-Type manualmente — o browser define o boundary sozinho
// a partir do FormData.
//
// `campos` (08/07/2026, chat interno) — campos de texto extras enviados
// junto do arquivo na MESMA requisição (ex: tipo/conteudo da mensagem).
// Precisam ser anexados ANTES do arquivo no FormData: o backend usa
// request.parts() e decide se tem anexo permitido/válido só depois de já
// ter lido todos os campos de texto (ver mensagens.routes.ts).
export async function apiUpload<T>(path: string, file: File, campos?: Record<string, string>): Promise<T> {
  const body = new FormData();
  if (campos) {
    for (const [chave, valor] of Object.entries(campos)) body.append(chave, valor);
  }
  body.append("file", file);

  async function tentar(): Promise<Response> {
    const headers: Record<string, string> = {};
    if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
    return fetch(buildUrl(path), { method: "POST", headers, body, credentials: "include", signal: timeoutSignal(TIMEOUT_UPLOAD_MS) });
  }

  let res: Response;
  try {
    res = await tentar();
  } catch {
    throw new ApiError(0, "Não foi possível enviar o arquivo. Verifique sua internet e tente novamente.");
  }
  // Mesmo raciocínio do retry em apiRequest acima (refresh token só existe
  // como cookie httpOnly agora, sem como checar antes de tentar).
  if (res.status === 401) {
    if (await refreshAccessToken()) {
      try {
        res = await tentar();
      } catch {
        throw new ApiError(0, "Não foi possível enviar o arquivo. Verifique sua internet e tente novamente.");
      }
    }
  }
  if (res.status === 401) {
    tokenStore.clear();
    onUnauthorized?.();
    throw new ApiError(401, "Sessão expirada. Faça login novamente.");
  }
  if (!res.ok) throw await erroDaResposta(res);
  return (await res.json()) as T;
}

// Download de anexo — precisa passar o header Authorization, o que uma tag
// <img>/<a> comum não faz sozinha; por isso busca como Blob aqui e quem
// chamar cria a object URL (e é responsável por revogar com
// URL.revokeObjectURL depois de usar, pra não vazar memória).
export async function apiDownloadBlob(path: string): Promise<{ blob: Blob; nomeArquivo: string | null }> {
  async function tentar(): Promise<Response> {
    const headers: Record<string, string> = {};
    if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
    return fetch(buildUrl(path), { method: "GET", headers, credentials: "include", signal: timeoutSignal(TIMEOUT_UPLOAD_MS) });
  }

  let res: Response;
  try {
    res = await tentar();
  } catch {
    throw new ApiError(0, "Não foi possível baixar o arquivo. Verifique sua internet e tente novamente.");
  }
  // Mesmo raciocínio do retry em apiRequest acima (refresh token só existe
  // como cookie httpOnly agora, sem como checar antes de tentar).
  if (res.status === 401) {
    if (await refreshAccessToken()) {
      try {
        res = await tentar();
      } catch {
        throw new ApiError(0, "Não foi possível baixar o arquivo. Verifique sua internet e tente novamente.");
      }
    }
  }
  if (res.status === 401) {
    tokenStore.clear();
    onUnauthorized?.();
    throw new ApiError(401, "Sessão expirada. Faça login novamente.");
  }
  if (!res.ok) throw await erroDaResposta(res);

  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]*)"/);
  return { blob: await res.blob(), nomeArquivo: match?.[1] || null };
}
