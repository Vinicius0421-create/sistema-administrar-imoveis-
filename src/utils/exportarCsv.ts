// Utilitário compartilhado de exportação em lista (10/07/2026, pedido do
// Vini: "adiciona uma forma de sempre que eu quiser puxar uma lista
// específica, por exemplo, corretores das unidade, ou, atendentes só de
// Itaúna, sempre puxando as informações mais importantes... faça essa
// implementação para todo o sistema").
//
// Decisão de arquitetura: gera o CSV inteiramente a partir da lista JÁ
// FILTRADA que a própria página tem em mãos (o mesmo array usado para
// desenhar os cartões na tela). Isso segue à risca o padrão que o sistema
// inteiro já usa — cada página busca o dataset completo uma vez
// (useAppData) e filtra 100% no cliente (nenhuma página manda filtro pro
// servidor hoje) — em vez de criar um segundo caminho de busca/exportação
// que precisaria ser mantido em paralelo. "Puxar uma lista específica" na
// prática vira: escolher os filtros na tela (setor, unidade, cargo, busca
// etc.) e clicar em Exportar — o CSV sai com exatamente o que está sendo
// mostrado, nunca mais nem menos.
//
// Separador ";" (não ",") de propósito: Excel em português (padrão de
// quem trabalha na imobiliária) trata "," como separador decimal, então CSV
// com "," como delimitador de campo abre errado (tudo numa coluna só) a
// menos que a pessoa importe manualmente. ";" é o que o Excel pt-BR espera
// por padrão ao abrir um .csv com duplo-clique.

export interface ColunaExportacao<T> {
  /** Título da coluna, exibido na primeira linha do CSV. */
  cabecalho: string;
  /** Extrai o valor da coluna a partir de um item da lista. */
  valor: (item: T) => string | number | null | undefined;
}

function escaparCampoCsv(valor: string): string {
  // Regra padrão de CSV (RFC 4180): só precisa envolver em aspas quando o
  // campo contém o separador, aspas ou quebra de linha — aspas internas
  // são escapadas dobrando-as.
  if (/[";\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

export function gerarCsv<T>(itens: T[], colunas: ColunaExportacao<T>[]): string {
  const linhas = [
    colunas.map((c) => escaparCampoCsv(c.cabecalho)).join(";"),
    ...itens.map((item) => colunas.map((c) => escaparCampoCsv(String(c.valor(item) ?? ""))).join(";")),
  ];
  // BOM UTF-8 no início do arquivo: sem ele, o Excel abre acentos/ç como
  // caracteres quebrados em CSVs UTF-8 (comportamento clássico e conhecido
  // do Excel, que só respeita UTF-8 sem BOM em Libre/Google Sheets).
  return "﻿" + linhas.join("\r\n");
}

function nomeArquivoComData(nomeBase: string): string {
  // new Date() puro é usado só aqui, no momento real do clique do usuário
  // (não em código de fluxo/replay) — cada exportação carimba a data em que
  // foi gerada, útil pra quem salva o CSV pra registro/histórico.
  const hoje = new Date();
  const yyyy = hoje.getFullYear();
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  const dd = String(hoje.getDate()).padStart(2, "0");
  return `${nomeBase}_${yyyy}-${mm}-${dd}.csv`;
}

function baixarCsv(conteudo: string, nomeBase: string): void {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivoComData(nomeBase);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exporta uma lista (já filtrada pela página) como CSV e dispara o download
 * no navegador. `nomeBase` não deve incluir extensão nem data — ambas são
 * adicionadas automaticamente (ex.: "colaboradores" vira
 * "colaboradores_2026-07-10.csv").
 */
export function exportarListaCsv<T>(itens: T[], colunas: ColunaExportacao<T>[], nomeBase: string): void {
  baixarCsv(gerarCsv(itens, colunas), nomeBase);
}
