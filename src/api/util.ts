import { PaginatedResponse } from "../types";

// A maioria das telas do sistema precisa da lista inteira (ex: para montar
// os KPIs da Home, filtrar no cliente, etc.), não de paginação visível ao
// usuário. Esta função varre todas as páginas da API (limite de 100 por
// página) e devolve a lista completa — funciona bem no volume atual da
// empresa (dezenas de registros por módulo); se o volume crescer muito,
// as telas que hoje usam isso são candidatas naturais a ganhar paginação
// de verdade na UI.
//
// Achado A1 do check-up (22/07/2026): até aqui as páginas 2..N eram
// buscadas uma de cada vez, num loop `for` sequencial — cada página
// esperava a resposta da anterior antes de sair, mesmo as páginas sendo
// totalmente independentes entre si. Irrelevante com poucas páginas (o
// volume atual), mas é a primeira coisa a degradar quando o número de
// registros crescer. Agora a 1ª página continua sendo buscada sozinha (é
// dela que vem `meta.totalPages`, precisamos saber quantas faltam antes de
// pedir o resto), e as páginas restantes saem todas de uma vez com
// `Promise.all` — o tempo total passa a ser "o da página mais lenta", não
// "a soma de todas". `Promise.all` preserva a ordem do array de entrada
// (não a ordem de chegada), então o resultado final sai na mesma ordem de
// antes mesmo que uma página responda antes da outra.
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PaginatedResponse<T>>
): Promise<T[]> {
  const pageSize = 100;
  const primeira = await fetchPage(1, pageSize);
  const totalPaginas = primeira.meta.totalPages;
  // 0 itens ou só 1 página: nada para paralelizar — evita um Promise.all
  // vazio à toa e cobre o caso de `totalPages` vir 0/undefined da API.
  if (!totalPaginas || totalPaginas <= 1) return [...primeira.items];
  const restantes = await Promise.all(
    Array.from({ length: totalPaginas - 1 }, (_, indice) => fetchPage(indice + 2, pageSize))
  );
  return [...primeira.items, ...restantes.flatMap((resposta) => resposta.items)];
}
