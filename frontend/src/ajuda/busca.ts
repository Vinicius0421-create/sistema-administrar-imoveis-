import { ArtigoAjuda, PerguntaFrequente } from "./conteudo";

// Motor de busca do Assistente de Ajuda (17/07/2026, pedido do Vini: "gostei
// da ideia de um assistente de IA" — mas, depois de ele ver os custos reais
// de chamar a API da Anthropic por mensagem, escolheu explicitamente a
// versão 100% gratuita: busca por palavra-chave sobre o conteúdo que já
// existe em conteudo.ts, sem nenhuma chamada de IA de verdade. Este arquivo
// é só o motor de pontuação — nenhuma rede, nenhum custo, roda inteiro no
// navegador da pessoa.
//
// `normalizar` foi movida de CentralAjuda.tsx pra cá pra não duplicar a
// mesma função em dois arquivos — ambos (a busca simples da Central de Ajuda
// e este motor mais elaborado do Assistente) precisam do mesmo tratamento de
// acento/maiúscula.

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Palavras que não ajudam a distinguir um artigo do outro — filtradas antes
// de pontuar, senão toda pergunta com "como" ou "que" bateria com quase
// tudo. Curta de propósito: cobre só o que realmente aparece com frequência
// em perguntas do dia a dia, não é uma lista linguística completa.
const PARE_PALAVRAS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "um", "uma", "uns", "umas",
  "e", "é", "que", "pra", "para", "com", "sem", "como", "no", "na", "nos", "nas",
  "meu", "minha", "meus", "minhas", "eu", "voce", "você", "tem", "ha", "há",
  "onde", "quando", "porque", "por", "qual", "quais", "isso", "esse", "essa",
  "este", "esta", "isto", "ao", "aos", "à", "às", "se", "sua", "seu", "suas",
  "seus", "ou", "mas", "muito", "muita", "já", "ja", "não", "nao", "consigo",
  "preciso", "quero", "gostaria", "fazer", "faço", "faco",
]);

// Sinônimos das perguntas mais comuns do dia a dia (17/07/2026) — cobre a
// forma como colaborador de verdade pergunta ("meu notebook quebrou",
// "esqueci minha senha") sem precisar reescrever conteudo.ts pra incluir
// cada variação de palavra. Curado a partir dos módulos de maior tráfego
// esperado (login, equipamento, chamado, papelaria); ampliar aqui é seguro
// e não exige tocar em nenhum artigo.
//
// As chaves são RADICAIS (prefixo), não palavras exatas — "quebr" casa com
// "quebrou", "quebrado", "quebrando" etc. Português conjuga muito o verbo;
// exigir a forma exata (como numa primeira versão deste arquivo) deixava
// perguntas super comuns tipo "meu notebook quebrou" sem achar o artigo de
// Chamados, porque a palavra digitada nunca era exatamente a do dicionário.
const SINONIMOS: Record<string, string[]> = {
  senha: ["login", "entrar", "acessar", "acesso"],
  esqu: ["recuperar", "redefinir", "trocar"], // esqueci, esqueceu, esquecer
  notebook: ["computador", "laptop", "equipamento", "maquina", "máquina"],
  celular: ["telefone", "smartphone", "equipamento"],
  chamad: ["manutencao", "manutenção", "problema", "defeito", "ti", "suporte"], // chamado, chamados
  quebr: ["defeito", "problema", "manutencao", "manutenção", "chamado"], // quebrou, quebrado, quebrando, quebrar
  defeit: ["problema", "manutencao", "manutenção", "chamado"], // defeito, defeituoso
  papelaria: ["material", "escritorio", "escritório", "caneta", "papel"],
  feria: ["férias", "folga"], // férias, ferias
  demit: ["desligar", "desligamento", "demissao", "demissão"], // demitir, demitido, demissão
  contrat: ["admitir", "admissao", "admissão", "novo"], // contratar, contratação, contratado
};
const RADICAIS = Object.keys(SINONIMOS);

function expandirTermos(palavras: string[]): string[] {
  const expandido = new Set(palavras);
  for (const p of palavras) {
    const radical = RADICAIS.find((r) => p.startsWith(r));
    if (radical) SINONIMOS[radical].forEach((s) => expandido.add(normalizar(s)));
  }
  return [...expandido];
}

export function termosDaPergunta(pergunta: string): string[] {
  const palavras = normalizar(pergunta)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !PARE_PALAVRAS.has(p));
  return expandirTermos(palavras);
}

export interface ResultadoBusca {
  artigo: ArtigoAjuda;
  score: number;
  // Quando uma pergunta do FAQ do artigo bate bem com o que foi digitado, a
  // resposta pronta dela é o retorno mais direto que dá pra dar sem ser IA
  // de verdade — mostrado no lugar do resumo genérico do artigo.
  faqDestaque: PerguntaFrequente | null;
}

function contarOcorrencias(termos: string[], texto: string): number {
  const normalizado = normalizar(texto);
  return termos.reduce((soma, t) => soma + (normalizado.includes(t) ? 1 : 0), 0);
}

// Pontuação por soma de pesos: título e perguntas de FAQ pesam mais porque
// são os campos mais "parecidos" com uma pergunta real de alguém — é o que
// faz a resposta parecer entender a pergunta, mesmo sem nenhum modelo de
// linguagem por trás.
export function responderPergunta(pergunta: string, artigos: ArtigoAjuda[], limite = 4): ResultadoBusca[] {
  const termos = termosDaPergunta(pergunta);
  if (termos.length === 0) return [];

  const resultados: (ResultadoBusca & { tituloMatches: number })[] = artigos.map((artigo) => {
    const tituloMatches = contarOcorrencias(termos, artigo.titulo);
    let score = 0;
    score += tituloMatches * 5;
    score += contarOcorrencias(termos, artigo.resumo) * 3;
    score += contarOcorrencias(termos, artigo.objetivo) * 2;
    score += contarOcorrencias(termos, artigo.quandoUsar) * 2;
    score += artigo.passoAPasso.reduce((soma, p) => soma + contarOcorrencias(termos, p), 0);
    score += (artigo.boasPraticas ?? []).reduce((soma, p) => soma + contarOcorrencias(termos, p), 0);
    score += (artigo.errosComuns ?? []).reduce((soma, p) => soma + contarOcorrencias(termos, p), 0);

    let melhorFaqScore = 0;
    let faqDestaque: PerguntaFrequente | null = null;
    for (const f of artigo.faq ?? []) {
      const s = contarOcorrencias(termos, f.pergunta) * 4 + contarOcorrencias(termos, f.resposta);
      if (s > melhorFaqScore) {
        melhorFaqScore = s;
        faqDestaque = f;
      }
    }
    score += melhorFaqScore;

    return { artigo, score, faqDestaque: melhorFaqScore > 0 ? faqDestaque : null, tituloMatches };
  });

  // Em empate de score (comum, já que a pontuação é uma soma de inteiros
  // baseada em presença/ausência de termo), desempata por quantos termos da
  // pergunta aparecem no TÍTULO — o sinal mais específico que existe, ao
  // contrário de um FAQ genérico que só bateu por causa de uma palavra
  // comum na resposta. Achado real: "meu notebook quebrou" empatava exato
  // entre o artigo de Chamados de Manutenção e o de "Abrindo chamados sem
  // internet" — sem este desempate, a ordem original do array decidia, e o
  // artigo errado (o de conectividade offline) ganhava só por vir antes.
  return resultados
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.tituloMatches - a.tituloMatches)
    .slice(0, limite)
    .map(({ artigo, score, faqDestaque }) => ({ artigo, score, faqDestaque }));
}
