// Split automático do PDF bruto da folha de pagamento (21/07/2026, pedido
// do Vini) — recebe um único PDF com todos os recibos da folha, separa
// página a página e tenta identificar de quem é cada recibo (por CPF, e se
// não achar CPF, por nome) contra os colaboradores que TÊM pagamento
// lançado nesta folha. Nunca adivinha: página sem CPF/nome reconhecível, ou
// cujo colaborador identificado não tem pagamento nesta folha, entra na
// lista de "não identificados" pra quem está lançando decidir manualmente
// (ver rota de anexo manual avulso em pagamentos.routes.ts) — mesmo
// princípio já usado na importação em lote de dados bancários desta sessão:
// nunca inventar um vínculo, só reportar o que não deu pra resolver
// automaticamente.
//
// Assunção deliberada: 1 página = 1 recibo. É o formato mais comum de lote
// de contracheque gerado por folha/ERP de RH; um recibo de múltiplas
// páginas por pessoa não é tratado automaticamente (a página extra cairia
// em "não identificada" por não ter um CPF/nome reconhecível de novo, ou
// seria atribuída à pessoa errada se por acaso citar outro nome) — pra
// esses casos, o upload manual avulso por colaborador resolve.
//
// pdfjs-dist@2.16.105 (build legacy, CommonJS) — versão deliberadamente
// antiga: extração de texto puro não depende de canvas/rendering, e essa
// versão é testada e estável em Node sem dependência nativa nenhuma (a
// versão mais recente da lib é ESM-only, o que complicaria o require()
// neste projeto CommonJS sem ganho nenhum pra extração de texto).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
import { PDFDocument } from "pdf-lib";

export interface CandidatoRecibo {
  colaboradorId: string;
  nomeCompleto: string;
  // Todos os CPFs válidos pra bater contra o texto da página — o cadastro
  // (Colaborador.cpf) e o do favorecido nos dados bancários
  // (DadosBancariosColaborador.favorecidoCpf), quando divergem (ex: nome/
  // CPF de casada, corrigido só no favorecido).
  cpfs: string[];
}

export interface PaginaIdentificada {
  pagina: number; // 1-based, pra exibir pro usuário
  colaboradorId: string;
  motivoIdentificacao: "cpf" | "nome";
}

export interface PaginaNaoIdentificada {
  pagina: number;
  motivo: string;
  // Primeiros ~180 caracteres do texto da página, só pra ajudar quem for
  // resolver manualmente a reconhecer do que se trata — nunca usado pra
  // decidir nada sozinho.
  amostraTexto: string;
}

function somenteDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Lookbehind/lookahead negativos pra nunca casar um pedaço de sequência
// numérica MAIOR (ex: os 14 dígitos do CNPJ da empresa, que aparece no
// próprio recibo — achado ao testar contra os PDFs reais que o Vini
// mandou) — sem isso, uma janela de 11 dígitos dentro do CNPJ de 14 podia
// ser lida como "CPF" por engano. Com a checagem, só bate um token de
// exatamente 11 dígitos isolado (cercado por não-dígito ou borda do texto).
const REGEX_CPF = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;

// Extrai o texto de cada página do PDF, na ordem — usado tanto pra
// identificar de quem é o recibo quanto pra dar a amostra de texto de
// páginas não identificadas.
export async function extrairTextoPorPagina(bytes: Buffer | Uint8Array): Promise<string[]> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const paginas: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const texto = content.items.map((item: any) => ("str" in item ? item.str : "")).join(" ");
    paginas.push(texto);
  }
  return paginas;
}

// Divide o PDF original em um PDF de página única por página, na mesma
// ordem — cada um vira o arquivo físico salvo como recibo de um colaborador.
export async function dividirPorPagina(bytes: Buffer | Uint8Array): Promise<Uint8Array[]> {
  const original = await PDFDocument.load(bytes);
  const totalPaginas = original.getPageCount();
  const resultado: Uint8Array[] = [];
  for (let i = 0; i < totalPaginas; i++) {
    const novo = await PDFDocument.create();
    const [pagina] = await novo.copyPages(original, [i]);
    novo.addPage(pagina);
    resultado.push(await novo.save());
  }
  return resultado;
}

// Tenta identificar o dono de uma página pelo texto extraído: primeiro por
// CPF (mais confiável — 11 dígitos exatos, baixíssima chance de colisão),
// só cai pro nome se nenhum CPF do texto bater com nenhum candidato.
export function identificarPagina(texto: string, candidatos: CandidatoRecibo[]): { colaboradorId: string; motivo: "cpf" | "nome" } | null {
  const cpfsNoTexto = (texto.match(REGEX_CPF) || []).map(somenteDigitos).filter((d) => d.length === 11);
  if (cpfsNoTexto.length > 0) {
    for (const candidato of candidatos) {
      if (candidato.cpfs.some((cpf) => cpfsNoTexto.includes(cpf))) {
        return { colaboradorId: candidato.colaboradorId, motivo: "cpf" };
      }
    }
  }

  const textoNormalizado = normalizarNome(texto);
  // Nome completo inteiro precisa aparecer como substring — evita falso
  // positivo de sobrenome comum (ex: "Silva") batendo com a pessoa errada.
  // Só considerado quando o nome tem pelo menos 2 palavras (nome+sobrenome),
  // pra não bater por acidente com um nome de 1 palavra curto demais.
  for (const candidato of candidatos) {
    const nomeNormalizado = normalizarNome(candidato.nomeCompleto);
    if (nomeNormalizado.split(" ").length >= 2 && textoNormalizado.includes(nomeNormalizado)) {
      return { colaboradorId: candidato.colaboradorId, motivo: "nome" };
    }
  }

  return null;
}
