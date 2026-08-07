import { colaboradorOperacionalmenteAtivo, Colaborador } from "../types";

// Calendário de Aniversários (17/07/2026, pedido do Vini: "o RH organiza os
// aniversários, temos até um calendário... preciso incluir este calendário
// no sistema, de forma interativo e conectada a tudo do sistema"). Decisão
// de design: NÃO criar um campo novo — `dataNascimento` já existe no
// cadastro do Colaborador desde 08/07/2026 e já segue a regra de
// visibilidade certa (só ADMINISTRADOR/GESTOR_COORDENADOR/RH recebem o
// valor real da API, ver PAPEIS_COM_CPF_COMPLETO no backend — os mesmos 3
// papéis que têm "Colaboradores" no menu, então nenhuma tela nova precisa
// de gate de permissão além do que a própria API já aplica). Ler direto do
// cadastro, em vez de duplicar a data em outro lugar, é o que torna isto
// "conectado a tudo do sistema": editar o cadastro já atualiza o
// calendário, e desligar alguém já tira a pessoa da lista (ao contrário do
// pôster estático, que exige lembrar de editar à mão nos dois casos).
export const MESES_PT_COMPLETO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export interface Aniversariante {
  colaborador: Colaborador;
  dia: number;
}

// Mesmo padrão de parse "sem fuso" já usado em `fmtDate` (ui.tsx) — data de
// nascimento vem como ISO (ex: "1990-05-15T00:00:00.000Z"); usar `new
// Date(iso).getMonth()` deslocaria o dia dependendo do fuso do navegador
// (meia-noite UTC pode virar o dia anterior em fusos negativos). Extrai
// ano/mês/dia direto da string, sem passar por conversão de fuso nenhuma.
function mesEDia(dataNascimento: string): { mes: number; dia: number } | null {
  const [, m, d] = dataNascimento.slice(0, 10).split("-");
  if (!m || !d) return null;
  return { mes: Number(m) - 1, dia: Number(d) };
}

// Agrupa por mês (0-11), cada mês já ordenado por dia — mesmo formato visual
// do pôster que o RH já usa (grade de 12 meses, "DD - Nome" em ordem
// crescente). Só considera colaboradores operacionalmente ativos (mesma
// regra usada em seletores de responsável no resto do sistema) — desligado
// não deveria aparecer aqui, e `dataNascimento` null (ninguém preencheu
// ainda, ou o papel logado não tem permissão de ver) é simplesmente
// ignorado em vez de virar um erro.
export function agruparAniversariantesPorMes(colaboradores: Colaborador[]): Aniversariante[][] {
  const porMes: Aniversariante[][] = Array.from({ length: 12 }, () => []);
  for (const c of colaboradores) {
    if (!c.dataNascimento || !colaboradorOperacionalmenteAtivo(c.status)) continue;
    const parsed = mesEDia(c.dataNascimento);
    if (!parsed) continue;
    porMes[parsed.mes].push({ colaborador: c, dia: parsed.dia });
  }
  porMes.forEach((mes) => mes.sort((a, b) => a.dia - b.dia));
  return porMes;
}

// Aniversariantes do mês atual (widget do Painel Geral) — mesmo agrupamento
// acima, só filtrando pro mês corrente. `mesReferencia` é injetável (em vez
// de sempre `new Date()`) só para facilitar teste; em uso real o chamador
// não precisa passar nada.
export function aniversariantesDoMes(colaboradores: Colaborador[], mesReferencia = new Date().getMonth()): Aniversariante[] {
  return agruparAniversariantesPorMes(colaboradores)[mesReferencia];
}

export interface ProximoAniversario {
  colaborador: Colaborador;
  mes: number; // 0-11
  dia: number;
  diasRestantes: number; // 0 = hoje, 1 = amanhã, etc.
}

// Destaque "Próximo aniversário" do Calendário anual (17/07/2026, pedido do
// Vini: calendário "de forma interativo e criativa") — varre os 12 meses já
// agrupados e acha a PRÓXIMA ocorrência de cada aniversário a partir de
// hoje, virando o ano quando a data já passou este ano (ex: hoje é
// dezembro e o próximo aniversário é em janeiro — cai em janeiro do ano
// seguinte, não deste). Usa só `new Date(ano, mes, dia)` com números
// inteiros (nunca `new Date(iso)` de uma string) — sem risco do bug de fuso
// que motivou o parse manual em `mesEDia` acima, porque aqui as duas datas
// comparadas (hoje e a data-alvo) nascem do mesmo jeito, no fuso local do
// navegador dos dois lados.
export function proximoAniversario(colaboradores: Colaborador[], hoje: Date = new Date()): ProximoAniversario | null {
  const porMes = agruparAniversariantesPorMes(colaboradores);
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  let melhor: { aniversariante: Aniversariante; mes: number; data: Date } | null = null;
  for (let mes = 0; mes < 12; mes++) {
    for (const a of porMes[mes]) {
      let data = new Date(hojeSemHora.getFullYear(), mes, a.dia);
      if (data < hojeSemHora) data = new Date(hojeSemHora.getFullYear() + 1, mes, a.dia);
      if (!melhor || data < melhor.data) melhor = { aniversariante: a, mes, data };
    }
  }
  if (!melhor) return null;

  const diasRestantes = Math.round((melhor.data.getTime() - hojeSemHora.getTime()) / 86_400_000);
  return { colaborador: melhor.aniversariante.colaborador, mes: melhor.mes, dia: melhor.aniversariante.dia, diasRestantes };
}
