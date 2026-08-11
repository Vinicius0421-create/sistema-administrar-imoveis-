// Barramento de eventos minúsculo pra manter os componentes que leem a fila
// de chamados offline (indicador de conexão, lista de Chamados, Portal do
// Colaborador) em sincronia entre si sem precisar de Context/Redux só pra
// isso — o estado de verdade mora no IndexedDB (ver db.ts); isto é só o
// "avise quem estiver interessado que algo mudou lá".
const ALVO = new EventTarget();
const NOME_EVENTO = "chamados-offline-mudou";

export function emitirMudancaFilaChamados(): void {
  ALVO.dispatchEvent(new Event(NOME_EVENTO));
}

export function ouvirMudancaFilaChamados(callback: () => void): () => void {
  ALVO.addEventListener(NOME_EVENTO, callback);
  return () => ALVO.removeEventListener(NOME_EVENTO, callback);
}
