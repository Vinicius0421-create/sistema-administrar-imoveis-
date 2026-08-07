import { TelefoneColaborador } from "../types";

// Múltiplos telefones por colaborador (07/08/2026) — em todo lugar que antes
// mostrava "o telefone" (card resumido, export CSV, comparação com a linha
// corporativa em Linhas.tsx, busca em "colaboradores sem linha"), agora
// mostra o PRINCIPAL da lista (sempre existe no máximo um, ver
// normalizarTelefonesParaGravacao no backend); cai pro primeiro item se por
// algum motivo nenhum estiver marcado (não deveria acontecer, mas evita
// sumir um número por causa de dado legado/import). Extraído pra cá
// (07/08/2026) porque passou a ser usado em mais de uma página
// (Colaboradores.tsx e Linhas.tsx) — antes era local a Colaboradores.tsx.
export function telefonePrincipal(c: { telefones?: TelefoneColaborador[] }): string | null {
  const lista = c.telefones ?? [];
  return lista.find((t) => t.principal)?.numero ?? lista[0]?.numero ?? null;
}
