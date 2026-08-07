// Item 1 da missão "Melhorias Adicionais" (08/07/2026, pedido do Vini) —
// Abertura de Chamados Offline. Escolha de arquitetura: IndexedDB (não
// localStorage) porque precisa guardar os arquivos anexados (fotos) como
// Blob — localStorage só guarda string e tem limite baixo (~5MB no total),
// inviável pra foto de celular. Sem biblioteca externa (Dexie/idb): o uso
// aqui é simples o bastante (uma tabela, chave única, sem índice composto)
// que a API nativa do navegador resolve sem a complexidade extra de mais
// uma dependência pra manter.
//
// Deliberadamente SEM Service Worker / Background Sync API: o pedido é
// explícito que não é necessário tornar o sistema inteiro utilizável
// offline, só a abertura de chamado precisa sobreviver à falta de conexão.
// Background Sync (a API do browser que sincronizaria em segundo plano
// mesmo com a aba fechada) não existe no Safari/iOS — parte real do público
// (colaborador de campo com iPhone) simplesmente não teria esse recurso, e
// silenciosamente perderia a garantia de sincronização. Em vez disso, a fila
// é processada em primeiro plano: ao detectar `online` e a cada intervalo
// curto enquanto o app está aberto (ver useConexao.ts) — mais simples, mais
// previsível de testar, e funciona em qualquer navegador.

const DB_NOME = "administrar_imoveis_offline";
const DB_VERSAO = 1;
export const STORE_CHAMADOS_PENDENTES = "chamados_pendentes";

let dbPromise: Promise<IDBDatabase> | null = null;

function abrirDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, DB_VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHAMADOS_PENDENTES)) {
        db.createObjectStore(STORE_CHAMADOS_PENDENTES, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function dbPut<T>(store: string, valor: T): Promise<void> {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(valor);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDelete(store: string, chave: string): Promise<void> {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(chave);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Disponibilidade defensiva: IndexedDB existe em toda a matriz de
// navegadores-alvo (Chrome/Safari/Firefox, desktop e mobile) há muitos anos,
// mas navegação anônima/privada em alguns navegadores mais antigos podia
// bloquear. Quem chama (ver chamadosOffline.ts) trata a ausência caindo de
// volta pro comportamento anterior (erro de rede normal, sem fila offline)
// em vez de quebrar a tela.
export function indexedDbDisponivel(): boolean {
  return typeof indexedDB !== "undefined";
}
