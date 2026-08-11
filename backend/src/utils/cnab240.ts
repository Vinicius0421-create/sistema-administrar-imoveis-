// ============================================================
// GERADOR CNAB 240 — SICOOB — TED (pagamento de colaboradores)
// ============================================================
// Porte 1:1 do script Python homologado (cnab240_sicoob_planilha.py,
// fornecido pelo Vini em 20/07/2026) — o layout gerado por aquele script já
// foi processado com sucesso pelo Sicoob (Remessa nº 08), então CADA função
// daqui reproduz exatamente a função homônima do Python, sem "melhorias" de
// layout. A validação disso não é de leitura: o teste de porte gera a
// Remessa 08 com os mesmos dados/data/hora/sequencial e compara BYTE A BYTE
// com o arquivo real processado pelo banco (ver relatório do módulo).
//
// Única diferença funcional deliberada: `codigoIdentificacao` (campo "Nº do
// documento atribuído pela empresa", 20 posições no Segmento A) deixa de
// ser fixo "1" e passa a carregar o número do pagamento no sistema — o
// banco devolve esse campo no arquivo de retorno, e é ele que permite a
// baixa automática localizar cada pagamento com precisão. Para o banco é
// um campo livre da empresa; o layout não muda em nada.

import { Decimal } from "@prisma/client/runtime/library";

// ---------- helpers (equivalentes aos do Python) ----------
export function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function removeAccents(value: unknown): string {
  return String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function normalizeText(value: unknown): string {
  return removeAccents(value).toUpperCase().trim().split(/\s+/).join(" ");
}

export function fitAlpha(value: unknown, size: number): string {
  const v = normalizeText(value);
  return v.slice(0, size).padEnd(size, " ");
}

export function fitNum(value: unknown, size: number): string {
  const v = onlyDigits(value);
  return v.slice(0, size).padStart(size, "0");
}

// Valor monetário em centavos, com arredondamento HALF_UP (igual ao
// ROUND_HALF_UP do Decimal do Python) — nunca float.
export function fitDecimalMoney(valor: Decimal | string | number, size = 15): string {
  const dec = new Decimal(valor);
  const cents = dec.mul(100).toDecimalPlaces(0, 4 /* ROUND_HALF_UP */);
  return cents.toFixed(0).padStart(size, "0");
}

function formatDateDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getFullYear()}`;
}

function formatTimeHHMMSS(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

function padLine240(parts: string[]): string {
  const line = parts.join("");
  if (line.length > 240) throw new Error(`Linha CNAB excedeu 240 posições: ${line.length}`);
  return line.padEnd(240, " ");
}

function agenciaComDv(agencia: string, dv: string): string {
  return (onlyDigits(agencia) + onlyDigits(dv)).slice(0, 5).padStart(5, "0");
}

function codigoTipoInscricao(documento: string): string {
  return onlyDigits(documento).length === 14 ? "2" : "1";
}

const CAMARA_TED = "018";
const FINALIDADE_TED = "00010";
const FORMA_LANCAMENTO_TED = "41";

// ---------- tipos ----------
export interface EmpresaCnab {
  bancoCodigo: string;
  bancoNome: string;
  razaoSocial: string;
  cnpj: string;
  convenio: string;
  agencia: string;
  agenciaDv: string;
  conta: string;
  contaDv: string;
  endereco: string;
  numero: string;
  complemento: string;
  cidade: string;
  cep: string;
  uf: string;
  sequencialRemessa: number;
}

export interface FavorecidoCnab {
  nome: string;
  cpf: string;
  bancoCodigo: string;
  agencia: string;
  agenciaDv: string;
  conta: string;
  contaDv: string;
  valor: Decimal;
  codigoIdentificacao: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  cep: string;
  uf: string;
}

// ---------- registros ----------
function headerArquivo(e: EmpresaCnab, dataGeracao: Date): string {
  return padLine240([
    fitNum(e.bancoCodigo, 3),
    "0000",
    "0",
    " ".repeat(9),
    codigoTipoInscricao(e.cnpj),
    fitNum(e.cnpj, 14),
    fitAlpha(e.convenio, 20),
    agenciaComDv(e.agencia, e.agenciaDv),
    " ",
    fitNum(onlyDigits(e.conta), 12),
    fitAlpha(e.contaDv, 1),
    " ",
    fitAlpha(e.razaoSocial, 30),
    fitAlpha(e.bancoNome, 30),
    " ".repeat(10),
    "1",
    formatDateDDMMYYYY(dataGeracao),
    formatTimeHHMMSS(dataGeracao),
    fitNum(e.sequencialRemessa, 6),
    "081",
    "00000",
    " ".repeat(20),
    " ".repeat(20),
    " ".repeat(29),
  ]);
}

function headerLote(e: EmpresaCnab, lote: number): string {
  return padLine240([
    fitNum(e.bancoCodigo, 3),
    fitNum(lote, 4),
    "1",
    "C",
    "20",
    FORMA_LANCAMENTO_TED,
    "045",
    " ",
    codigoTipoInscricao(e.cnpj),
    fitNum(e.cnpj, 14),
    fitAlpha(e.convenio, 20),
    agenciaComDv(e.agencia, e.agenciaDv),
    " ",
    fitNum(onlyDigits(e.conta), 12),
    fitAlpha(e.contaDv, 1),
    " ",
    fitAlpha(e.razaoSocial, 30),
    fitAlpha(e.endereco, 30),
    fitNum(e.numero, 5),
    fitAlpha(e.complemento, 15),
    fitAlpha("", 20),
    fitAlpha(e.cidade, 20),
    fitNum(e.cep, 8),
    fitAlpha(e.uf, 2),
    " ".repeat(8),
    "01",
    " ".repeat(28),
  ]);
}

function segmentoA(e: EmpresaCnab, f: FavorecidoCnab, lote: number, seq: number, dataPagamento: Date): string {
  return padLine240([
    fitNum(e.bancoCodigo, 3),
    fitNum(lote, 4),
    "3",
    fitNum(seq, 5),
    "A",
    "0",
    "00",
    CAMARA_TED,
    fitNum(f.bancoCodigo, 3),
    fitNum(f.agencia, 5),
    fitAlpha(f.agenciaDv, 1),
    fitNum(onlyDigits(f.conta), 12),
    fitAlpha(f.contaDv, 1),
    " ",
    fitAlpha(f.nome, 30),
    fitNum(f.codigoIdentificacao, 20),
    formatDateDDMMYYYY(dataPagamento),
    "BRL",
    fitNum("", 15),
    fitDecimalMoney(f.valor, 15),
    fitAlpha("", 20),
    fitNum("", 8),
    fitDecimalMoney(new Decimal("0.00"), 15),
    fitAlpha("", 42),
    FINALIDADE_TED,
    fitAlpha("", 5),
    "0",
    " ".repeat(10),
  ]);
}

function segmentoB(e: EmpresaCnab, f: FavorecidoCnab, lote: number, seq: number, dataPagamento: Date): string {
  return padLine240([
    fitNum(e.bancoCodigo, 3),
    fitNum(lote, 4),
    "3",
    fitNum(seq, 5),
    "B",
    "000",
    codigoTipoInscricao(f.cpf),
    fitNum(f.cpf, 14),
    fitAlpha(f.endereco, 30),
    fitAlpha(f.numero, 5),
    fitAlpha(f.complemento, 15),
    fitAlpha(f.bairro, 15),
    fitAlpha(f.cidade, 20),
    fitNum(f.cep, 8),
    fitAlpha(f.uf, 2),
    formatDateDDMMYYYY(dataPagamento),
    fitDecimalMoney(f.valor, 15),
    fitDecimalMoney(new Decimal("0.00"), 15),
    fitDecimalMoney(new Decimal("0.00"), 15),
    fitDecimalMoney(new Decimal("0.00"), 15),
    fitDecimalMoney(new Decimal("0.00"), 15),
    fitAlpha(f.codigoIdentificacao, 13),
    " ".repeat(17),
  ]);
}

function trailerLote(e: EmpresaCnab, lote: number, totalRegistros: number, totalValor: Decimal): string {
  return padLine240([
    fitNum(e.bancoCodigo, 3),
    fitNum(lote, 4),
    "5",
    " ".repeat(9),
    fitNum(totalRegistros, 6),
    fitDecimalMoney(totalValor, 18),
    fitNum("", 18),
    " ".repeat(171),
    " ".repeat(10),
  ]);
}

function trailerArquivo(e: EmpresaCnab, totalLotes: number, totalRegistros: number): string {
  return padLine240([
    fitNum(e.bancoCodigo, 3),
    "9999",
    "9",
    " ".repeat(9),
    fitNum(totalLotes, 6),
    fitNum(totalRegistros, 6),
    fitNum("", 6),
    " ".repeat(205),
  ]);
}

// ---------- geração ----------
export function gerarCnab240(
  empresa: EmpresaCnab,
  favorecidos: FavorecidoCnab[],
  dataPagamento: Date,
  dataGeracao: Date
): { conteudo: string; totalValor: Decimal } {
  if (favorecidos.length === 0) throw new Error("É necessário informar ao menos um favorecido.");

  const lote = 1;
  const linhas: string[] = [];
  linhas.push(headerArquivo(empresa, dataGeracao));
  linhas.push(headerLote(empresa, lote));

  let seq = 1;
  let totalValor = new Decimal("0.00");
  for (const f of favorecidos) {
    linhas.push(segmentoA(empresa, f, lote, seq, dataPagamento));
    seq += 1;
    linhas.push(segmentoB(empresa, f, lote, seq, dataPagamento));
    seq += 1;
    totalValor = totalValor.add(f.valor);
  }

  const totalRegistrosLote = favorecidos.length * 2 + 2;
  linhas.push(trailerLote(empresa, lote, totalRegistrosLote, totalValor));
  const totalRegistrosArquivo = linhas.length + 1;
  linhas.push(trailerArquivo(empresa, 1, totalRegistrosArquivo));

  for (const [i, linha] of linhas.entries()) {
    if (linha.length !== 240) throw new Error(`Linha ${i + 1} não possui 240 posições. Atual: ${linha.length}`);
  }

  return { conteudo: linhas.join("\r\n") + "\r\n", totalValor };
}

// ---------- leitura do arquivo de RETORNO ----------
// O retorno do banco segue o mesmo desenho de 240 posições. O que interessa
// pra baixa automática: em cada Segmento A, o "Nº do documento atribuído
// pela empresa" (posições 74–93 — é o codigoIdentificacao que NÓS enviamos,
// devolvido de volta) e os códigos de ocorrência (posições 231–240, até 5
// códigos de 2 caracteres). "00" (ou "BD" em agendamento confirmado)
// significa pago/efetivado; qualquer outro código é rejeição/aviso, e o
// significado textual fica registrado no pagamento pra consulta.
export interface OcorrenciaRetorno {
  codigoIdentificacao: string;
  ocorrencias: string[];
  pago: boolean;
  valorCentavos: string;
}

export function lerRetornoCnab240(conteudo: string): { sequencialRetorno: string; itens: OcorrenciaRetorno[] } {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length > 0);
  let sequencialRetorno = "";
  const itens: OcorrenciaRetorno[] = [];

  for (const linha of linhas) {
    if (linha.length < 240) continue;
    const tipoRegistro = linha[7];
    if (tipoRegistro === "0") {
      sequencialRetorno = linha.slice(157, 163);
      continue;
    }
    if (tipoRegistro !== "3") continue;
    const segmento = linha[13];
    if (segmento !== "A") continue;

    const codigoIdentificacao = linha.slice(73, 93).trim().replace(/^0+/, "") || "0";
    const valorCentavos = linha.slice(119, 134);
    const ocorrenciasBrutas = linha.slice(230, 240);
    const ocorrencias: string[] = [];
    for (let i = 0; i < 10; i += 2) {
      const oc = ocorrenciasBrutas.slice(i, i + 2).trim();
      if (oc) ocorrencias.push(oc);
    }
    const pago = ocorrencias.length === 0 || ocorrencias.every((o) => o === "00" || o === "BD");
    itens.push({ codigoIdentificacao, ocorrencias, pago, valorCentavos });
  }

  return { sequencialRetorno, itens };
}

// Descrições das ocorrências mais comuns do CNAB 240 de pagamentos (febraban
// / Sicoob) — usadas só pra exibir o motivo em texto; a lista não precisa
// ser exaustiva (código desconhecido aparece como "código XX").
export const DESCRICAO_OCORRENCIA: Record<string, string> = {
  "00": "Crédito ou débito efetivado",
  BD: "Inclusão efetuada com sucesso (agendado)",
  AE: "Data de efetivação alterada",
  AG: "Número do lote inválido",
  AH: "Número sequencial do registro no lote inválido",
  AJ: "Tipo de movimento inválido",
  AL: "Código do banco favorecido inválido",
  AM: "Agência do favorecido inválida",
  AN: "Conta corrente do favorecido inválida",
  AO: "Nome do favorecido não informado",
  AP: "Data de pagamento inválida",
  AQ: "Valor do pagamento inválido",
  AR: "Valor do pagamento excede o saldo disponível",
  BC: "Inscrição (CPF/CNPJ) do favorecido inválida",
  BN: "CPF/CNPJ divergente do cadastro do banco favorecido",
  HA: "Lote não aceito",
  HB: "Inscrição da empresa inválida para o contrato",
  HC: "Convênio com a empresa inexistente/inválido",
  TA: "Lote não aceito - totais divergentes",
  ZA: "Transferência devolvida pelo banco favorecido",
  ZB: "Transferência devolvida - conta destino inválida",
  ZD: "Crédito não efetivado - conta encerrada",
  ZE: "Crédito não efetivado - conta bloqueada",
};
