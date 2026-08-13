import { enviarParaTodos } from "./sseHub";

// "Tudo instantâneo" (09/07/2026, pedido do Vini): antes, cada tela só se
// atualizava sozinha depois de UMA AÇÃO NAQUELA MESMA TELA (o `onChanged`
// de cada página só dá refetch do próprio recurso) — então tanto (a) uma
// mudança feita por OUTRA pessoa em outra aba/dispositivo quanto (b) uma
// mudança feita pela MESMA pessoa mas que afeta uma tela diferente da que
// ela estava editando (ex: vincular uma linha a um colaborador em Linhas
// Telefônicas não recarregava a lista de Colaboradores, que deriva
// `linhaCorporativa` da linha vinculada — exatamente o caso relatado:
// "cadastrei a linha da Anielle, tive que atualizar pra ela sair de
// pessoal pra corporativas") só refletiam depois de um F5 manual.
//
// A correção: todo lugar que muda dado relevante pra alguma lista de
// `AppData` (ver useAppData.ts no frontend) chama `avisarMudanca(...)`
// aqui, no fim do handler, DEPOIS que a escrita no banco já foi
// confirmada. Isto empurra um evento SSE "dados" pra TODA MUNDO conectado
// (ver enviarParaTodos em sseHub.ts) — o frontend (useAppData.ts) escuta
// esse evento e chama o mesmo `refetch()` que já usava depois de uma ação
// local, só que agora disparado remotamente também. O payload nunca leva o
// dado em si, só o nome do recurso — quem recebe busca a versão atual via
// API normal (autenticada, com todas as regras de escopo por papel já
// aplicadas), então isto não é um jeito novo de ler dado, só um "psiu,
// recarrega X" mais rápido que os 8s de polling que Mensagens.tsx usa (e
// mais barato que fazer toda tela pollar o tempo todo).
//
// IMPORTANTE pra quem adicionar uma rota nova: se a rota cria/edita/apaga
// algo que aparece em mais de uma lista (ex: linhas ⇄ colaboradores,
// movimentações ⇄ colaboradores, equipamentos ⇄ histórico), avisa TODOS os
// recursos afetados, não só o "dono" da rota — é exatamente esse tipo de
// acoplamento esquecido que causou o bug relatado.
export type RecursoDados =
  | "colaboradores"
  | "equipamentos"
  | "linhas"
  | "acessos"
  | "lotes"
  | "solicitacoes"
  | "chamados"
  | "movimentacoes"
  | "historico"
  | "solicitacoesPapelaria"
  // Pagamentos CNAB (20/07/2026) — folhas/pagamentos/remessas.
  | "pagamentos"
  | "dominios"
  // RH — Documentos de colaborador (11/08/2026)
  | "documentos"
  // Marketing Imobiliário — Banco de Imóveis (13/08/2026)
  | "marketing";

export function avisarMudanca(...recursos: RecursoDados[]): void {
  if (recursos.length === 0) return;
  enviarParaTodos("dados", { entidades: Array.from(new Set(recursos)) });
}
