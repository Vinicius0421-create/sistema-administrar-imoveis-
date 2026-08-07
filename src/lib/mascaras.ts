/**
 * Padronização Global de Máscaras, Formatos e Validações (Fase 3, 09/07/2026,
 * pedido do Vini) — contraparte no frontend de src/utils/validacao.ts no
 * backend: funções de MÁSCARA VISUAL aplicadas em tempo real, enquanto a
 * pessoa digita, nos campos que têm um formato oficial reconhecido (CPF,
 * CNPJ, telefone).
 *
 * Importante: isso é só a camada de apresentação. O valor persistido
 * continua sendo dígitos puros (ver o comentário de cabeçalho em
 * validacao.ts, no backend, pra entender por quê) — a máscara aqui existe
 * só pra a pessoa ver o que está digitando formatado como o padrão oficial
 * (000.000.000-00, 00.000.000/0000-00, (00) 00000-0000), sem afetar o que
 * é de fato salvo. O backend já normaliza o valor antes de gravar, então
 * mandar mascarado ou não faz diferença zero pro resultado final — a
 * máscara aqui é puramente UX.
 *
 * Todas as funções abaixo são "progressivas": recebem o valor atual do
 * campo (que pode ter qualquer mistura de dígitos e pontuação, inclusive
 * parcial, a cada tecla digitada) e devolvem a versão formatada até onde
 * já foi digitado — sem exigir que a pessoa digite a pontuação ela mesma.
 */

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// 000.000.000-00
export function maskCpf(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

// 00.000.000/0000-00
export function maskCnpj(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `/${p4}`;
  if (p5) out += `-${p5}`;
  return out;
}

// (00) 0000-0000 (fixo, até 10 dígitos) ou (00) 00000-0000 (celular, 11
// dígitos) — a troca de agrupamento (4+4 pro fixo, 5+4 pro celular)
// acontece automaticamente assim que o 11º dígito é digitado, mesmo padrão
// que qualquer máscara de telefone BR já conhecida (ex: a do próprio
// Whatsapp Web).
export function maskTelefone(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  const meio = d.length <= 10 ? resto.slice(0, 4) : resto.slice(0, 5);
  const fim = d.length <= 10 ? resto.slice(4, 8) : resto.slice(5, 9);
  let out = `(${ddd}) ${meio}`;
  if (fim) out += `-${fim}`;
  return out;
}

// 00000-000
export function maskCep(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 8);
  const p1 = d.slice(0, 5);
  const p2 = d.slice(5, 8);
  return p2 ? `${p1}-${p2}` : p1;
}

// Parse de valor monetário digitado livremente (achado de auditoria F6,
// Fase 2, 22/07/2026) — aceita vírgula E ponto como separador decimal (ex:
// "1234.56", "1234,56", "1.234,56"), sempre devolvendo um number com ponto.
// Antes do checkup, só um dos modais de lançamento de pagamento (o de lote)
// tinha essa tolerância — o modal de lançamento individual/avulso usava
// Number(valor) puro, quebrando com valor digitado usando vírgula. Extraída
// aqui pra ser a ÚNICA função de parse de moeda usada em todo formulário de
// valor em R$ (avulso, lote, salário/adiantamento padrão do colaborador),
// garantindo comportamento idêntico em qualquer lugar do sistema.
export function parseValorMonetario(valor: string): number {
  const limpo = valor.trim();
  if (!limpo) return 0;
  // Com vírgula presente, ela É o separador decimal — qualquer ponto antes
  // dela é separador de milhar e precisa sair (ex: "1.234,56" → "1234.56").
  // Sem vírgula, um eventual ponto já é o separador decimal padrão.
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}
