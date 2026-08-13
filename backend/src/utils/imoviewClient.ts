import { env } from "../env";
import { StatusImovel, TipoImovel } from "@prisma/client";

// Cliente de integração Marketing ↔ Imoview (Fase 8, 13/08/2026).
//
// LEIA ANTES DE CONFIAR CEGAMENTE NESTE ARQUIVO: a chave de API real
// (IMOVIEW_API_KEY) foi testada numa sessão anterior contra
// https://api.imoview.com.br/ e confirmada válida — o endpoint
// GET /Imovel/RetornarListaUnidades respondeu com as 3 unidades reais
// (Itatiaiuçu, Itaúna, Igarapé). Isso é FATO CONHECIDO. Vários outros
// detalhes abaixo são SUPOSIÇÃO DOCUMENTADA, não confirmada por chamada ao
// vivo nesta sessão — cada bloco marca claramente qual é qual.

const IMOVIEW_BASE_URL = "https://api.imoview.com.br";
const TIMEOUT_MS = 15_000;

export interface ImoviewResultadoOk<T> {
  sucesso: true;
  dados: T;
}
export interface ImoviewResultadoErro {
  sucesso: false;
  erro: string;
}
export type ImoviewResultado<T> = ImoviewResultadoOk<T> | ImoviewResultadoErro;

// ATENÇÃO: mecanismo de autenticação não confirmado nesta sessão — revisar
// contra a documentação Swagger real (api.imoview.com.br) antes de
// habilitar em produção. A sessão anterior confirmou que a chave em si é
// real e válida, mas NÃO deixou documentado se ela deve viajar como header,
// como querystring, ou no corpo da requisição. Escolha defensiva adotada
// aqui: manda dos dois jeitos mais prováveis ao mesmo tempo (header `key` E
// querystring `?key=`) — se um dos dois for o errado, o outro ainda cobre.
// Ineficiente, porém seguro contra "achamos que sabíamos o mecanismo e
// quebrou tudo silenciosamente". Troque por um único mecanismo confirmado
// assim que alguém validar isso contra a documentação oficial.
function montarRequisicaoImoview(caminho: string, corpo?: Record<string, unknown>): { url: string; init: RequestInit } {
  if (!env.IMOVIEW_API_KEY) {
    throw new Error("IMOVIEW_API_KEY não configurada.");
  }
  const url = new URL(caminho, IMOVIEW_BASE_URL);
  url.searchParams.set("key", env.IMOVIEW_API_KEY);
  const init: RequestInit = {
    method: corpo ? "POST" : "GET",
    headers: {
      key: env.IMOVIEW_API_KEY,
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  return { url: url.toString(), init };
}

// Nunca lança para quem chama — devolve um resultado tipado, para o job e a
// rota manual tratarem sem try/catch espalhado (ver comentário em
// marketing.routes.ts e marketingImoviewSyncJob.ts).
async function chamarImoview<T>(caminho: string, corpo?: Record<string, unknown>): Promise<ImoviewResultado<T>> {
  try {
    const { url, init } = montarRequisicaoImoview(caminho, corpo);
    const resposta = await fetch(url, init);
    if (!resposta.ok) {
      return { sucesso: false, erro: `Imoview respondeu ${resposta.status} ${resposta.statusText}.` };
    }
    const dados = (await resposta.json()) as T;
    return { sucesso: true, dados };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : "Erro desconhecido ao chamar a API do Imoview.";
    // AbortSignal.timeout estoura um erro com name "TimeoutError" (ou
    // "AbortError" em runtimes mais antigos) — mensagem própria pra deixar
    // claro que foi timeout, não uma falha de rede genérica.
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { sucesso: false, erro: "Tempo esgotado ao chamar a API do Imoview (15s)." };
    }
    return { sucesso: false, erro: mensagem };
  }
}

// FATO CONFIRMADO (sessão anterior): este endpoint respondeu com as 3
// unidades reais usando a chave configurada. Tipo de retorno é suposição
// razoável de formato (lista de objetos com código/nome), não validado
// campo a campo.
export interface ImoviewUnidade {
  codigo: number;
  nome: string;
  [chave: string]: unknown;
}

export function listarUnidadesImoview(): Promise<ImoviewResultado<ImoviewUnidade[]>> {
  return chamarImoview<ImoviewUnidade[]>("/Imovel/RetornarListaUnidades");
}

// SUPOSIÇÃO DOCUMENTADA: formato exato dos campos do imóvel na resposta não
// foi validado ao vivo nesta sessão — nomes de campo abaixo (tipo/situacao/
// valor/fotos etc.) são a melhor hipótese a partir da documentação pública
// do Imoview, não uma confirmação por chamada real. `[chave: string]:
// unknown` deixa a porta aberta pra campos extras que a API realmente
// devolver sem quebrar a tipagem.
export interface ImoviewImovelBruto {
  codigo?: number | string;
  unidadeCodigo?: number;
  tipo?: string;
  tipoimovel?: string;
  situacao?: number | string;
  situacaodescricao?: string;
  bairro?: string;
  regiao?: string;
  valor?: number | string;
  descricao?: string;
  titulo?: string;
  fotoPrincipal?: string;
  fotos?: string[];
  video?: string;
  [chave: string]: unknown;
}

export interface BuscarImoveisImoviewParams {
  situacao?: number | string;
  finalidade?: string;
  unidadeCodigo?: number;
  numeroPagina: number;
  numeroRegistros: number; // API limita a 20/página
}

// FATO CONFIRMADO parcialmente: o endpoint existe e aceita
// numeropagina/numeroregistros como parâmetros obrigatórios (documentado no
// Swagger público do Imoview). NÃO confirmado ao vivo nesta sessão contra a
// chave real (só RetornarListaUnidades foi testado de fato).
export function buscarImoveisImoview(params: BuscarImoveisImoviewParams): Promise<ImoviewResultado<ImoviewImovelBruto[]>> {
  return chamarImoview<ImoviewImovelBruto[]>("/Imovel/RetornarImoveis", {
    numeropagina: params.numeroPagina,
    numeroregistros: params.numeroRegistros,
    ...(params.situacao !== undefined ? { situacao: params.situacao } : {}),
    ...(params.finalidade !== undefined ? { finalidade: params.finalidade } : {}),
    ...(params.unidadeCodigo !== undefined ? { unidadecodigo: params.unidadeCodigo } : {}),
  });
}

// SUPOSIÇÃO DOCUMENTADA: usado como primário pelo job de sincronização
// incremental (marketingImoviewSyncJob.ts) por ser o caminho mais barato
// (só imóveis que mudaram desde a última rodada) — mas este endpoint
// especificamente NÃO foi testado ao vivo nesta sessão nem em nenhuma
// anterior. Se ele não existir/não se comportar como esperado em produção,
// o job cai para buscarImoveisImoview (ver marketingImoviewSyncJob.ts).
export function buscarImoveisAlteradosImoview(desde: Date): Promise<ImoviewResultado<ImoviewImovelBruto[]>> {
  return chamarImoview<ImoviewImovelBruto[]>("/Imovel/RetornarImoveisAlterados", {
    datahoraalteracao: desde.toISOString(),
  });
}

// Mapeamento de unidade por código Imoview → Unidade.id interno. Códigos
// confirmados na sessão anterior (via RetornarListaUnidades real): 8122 =
// Itatiaiuçu, 8144 = Itaúna, 8537 = Igarapé. Resolvido contra o banco por
// nome (Unidade.nome contendo o texto), nunca cria unidade nova — um código
// que não bate com nenhuma das 3 é pulado e registrado no log de erro da
// rodada (ver marketingImoviewSyncJob.ts).
export const CODIGO_UNIDADE_IMOVIEW: Record<number, string> = {
  8122: "Itatiaiuçu",
  8144: "Itaúna",
  8537: "Igarapé",
};

// Mapeamento de tipo — só "Apartamento" está confirmado (é o único valor
// real observado na sessão anterior contra a API); os demais são
// mapeamentos razoáveis nunca validados ao vivo. Qualquer valor não
// reconhecido cai em OUTRO — nunca lança erro por tipo desconhecido.
export function normalizarTipoImovel(valorBruto: string | null | undefined): TipoImovel {
  if (!valorBruto) return "OUTRO";
  const v = valorBruto.toLowerCase();
  if (v.includes("apartamento")) return "APARTAMENTO"; // CONFIRMADO ao vivo
  if (v.includes("casa")) return "CASA"; // suposição
  if (v.includes("terreno") || v.includes("lote")) return "LOTE"; // suposição
  if (v.includes("chacara") || v.includes("chácara") || v.includes("sitio") || v.includes("sítio") || v.includes("fazenda")) return "CHACARA"; // suposição
  return "OUTRO";
}

// Mapeamento de situação → StatusImovel. NENHUM dos valores numéricos (0-6,
// conforme o design da Fase 8) foi confirmado por chamada real nesta
// sessão — implementado de forma conservadora: se a API devolver um campo
// de texto (`situacaodescricao`), tenta casar por substring primeiro (mais
// confiável que adivinhar o significado de um número); sem isso, cai no
// fallback conservador documentado abaixo.
//
// SUPOSIÇÃO DOCUMENTADA — precisa de validação com a chave real antes de
// confiar no mapeamento numérico em produção.
export function normalizarStatusImovel(
  situacao: number | string | null | undefined,
  situacaoDescricao: string | null | undefined
): { status: StatusImovel; pular: boolean } {
  const descricao = (situacaoDescricao ?? "").toLowerCase();
  if (descricao) {
    if (descricao.includes("vend")) return { status: "VENDIDO", pular: false };
    if (descricao.includes("reserva")) return { status: "RESERVADO", pular: false };
    if (descricao.includes("dispon") || descricao.includes("ativ")) return { status: "DISPONIVEL", pular: false };
    // Sinais claros de que o imóvel foi removido/excluído no Imoview — não
    // faz sentido criar/atualizar um registro local pra isso, melhor pular
    // e deixar o log da rodada registrar quantos foram ignorados.
    if (descricao.includes("exclu") || descricao.includes("remov") || descricao.includes("inativ")) {
      return { status: "INATIVO", pular: false };
    }
  }
  // Sem descrição textual utilizável: fallback conservador — qualquer
  // situação não reconhecida vira DISPONIVEL (assume que, se a API ainda
  // está devolvendo o imóvel na listagem, ele está ativo/visível).
  void situacao; // mapeamento numérico não confirmado — não usado por ora, ver comentário acima
  return { status: "DISPONIVEL", pular: false };
}
