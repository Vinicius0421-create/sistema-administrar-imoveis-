// Ponte SSE → Mensagens.tsx (achado M4 do check-up, Fase 2, 22/07/2026).
//
// O resto do sistema já reage a mudanças em tempo real através de UMA
// conexão SSE só (ver useNotificacoesStream.ts), consumida por
// <CentralNotificacoes> e traduzida em refetch por recurso via
// `aplicarEventoDados`/`refetch` em useAppData.ts (ver comentário lá). Isso
// funciona porque todo recurso ali é parte de `AppData` — um estado único,
// carregado uma vez em App.tsx e repassado como prop pra baixo.
//
// "mensagens" não é assim: o chat busca e mantém o próprio estado dentro de
// Mensagens.tsx (conversas, thread aberta etc.), montado sob demanda e às
// vezes em mais de um lugar ao mesmo tempo na árvore (AppShell normal via
// `activeModule === "mensagens"`, ou embutido dentro do Portal do
// Colaborador — ver MensagensPage em PortalColaborador.tsx). Não há um
// único componente "dono" pra receber uma prop de callback do jeito que
// useAppData.refetch faz.
//
// Solução: um pub/sub bem pequeno, singleton do módulo (sobrevive à troca de
// qual componente está montado, mas não a um F5 — não precisa, a conexão SSE
// também não sobrevive). App.tsx (topo, onde <CentralNotificacoes> já recebe
// o evento "dados" cru) chama `emitirMensagensAtualizadas()` sempre que o
// evento inclui "mensagens" entre as entidades avisadas pelo backend (ver
// avisarMudanca("mensagens") em mensagens.routes.ts). Mensagens.tsx assina
// via `assinarMensagensAtualizadas` num useEffect e dispara os mesmos
// `carregarConversas`/`carregarThread` que o polling já usava — o SSE vira
// só um "psiu, recarrega agora" mais rápido, sem duplicar a lógica de busca.
type Ouvinte = () => void;

const ouvintes = new Set<Ouvinte>();

export function emitirMensagensAtualizadas(): void {
  ouvintes.forEach((fn) => {
    try {
      fn();
    } catch {
      // um ouvinte quebrado não deve impedir os demais de serem avisados
    }
  });
}

// Retorna a função de cancelamento — mesma convenção de um cleanup de
// useEffect (`useEffect(() => assinarMensagensAtualizadas(fn), [])`).
export function assinarMensagensAtualizadas(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}
