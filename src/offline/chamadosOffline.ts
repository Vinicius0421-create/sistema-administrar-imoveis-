import { chamadosApi, ChamadoInput } from "../api/chamados";
import { ApiError } from "../lib/apiClient";
import { dbDelete, dbGetAll, dbPut, indexedDbDisponivel, STORE_CHAMADOS_PENDENTES } from "./db";
import { emitirMudancaFilaChamados } from "./eventos";

// Fila de sincronização de chamados abertos offline — ver justificativa de
// arquitetura (IndexedDB, sem Service Worker/Background Sync) em db.ts.

export interface AnexoPendente {
  nome: string;
  tipo: string;
  blob: Blob;
}

export interface ChamadoPendente {
  localId: string;
  payload: ChamadoInput;
  anexos: AnexoPendente[];
  // Quantos dos `anexos` (na mesma ordem) já foram confirmados no servidor —
  // ao retomar depois de uma falha no meio do envio, começa exatamente daqui
  // em vez de reenviar tudo (evita anexo duplicado). Ver processarFila.
  anexosEnviados: number;
  remoteId: string | null;
  status: "pendente" | "sincronizando" | "erro";
  erro?: string;
  tentativas: number;
  // Data/hora real de abertura, capturada no aparelho no instante em que o
  // colaborador salvou o formulário — é isso que preserva a abertura
  // original mesmo que a sincronização só aconteça horas depois (ver
  // dataAberturaOriginal em chamados.routes.ts no backend).
  criadoEmLocal: string;
}

function gerarLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback defensivo — navegador muito antigo sem crypto.randomUUID.
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// `remoteId` (opcional): usado quando o chamado em si já foi criado com
// sucesso online e só os anexos que vieram a falhar por queda de conexão no
// meio do envio — ver abrirChamadoComSuporteOffline. Nesse caso a fila só
// precisa terminar de enviar os anexos restantes, nunca recriar o chamado.
export async function salvarChamadoPendente(payload: ChamadoInput, arquivos: File[], remoteId: string | null = null): Promise<string> {
  const localId = gerarLocalId();
  const anexos: AnexoPendente[] = arquivos.map((f) => ({ nome: f.name, tipo: f.type, blob: f }));
  const item: ChamadoPendente = {
    localId,
    payload,
    anexos,
    anexosEnviados: 0,
    remoteId,
    status: "pendente",
    tentativas: 0,
    criadoEmLocal: new Date().toISOString(),
  };
  await dbPut(STORE_CHAMADOS_PENDENTES, item);
  emitirMudancaFilaChamados();
  return localId;
}

export async function listarChamadosPendentes(): Promise<ChamadoPendente[]> {
  if (!indexedDbDisponivel()) return [];
  const itens = await dbGetAll<ChamadoPendente>(STORE_CHAMADOS_PENDENTES);
  // Mais recentes primeiro, mesma ordem que a lista de chamados normal usa.
  return itens.sort((a, b) => b.criadoEmLocal.localeCompare(a.criadoEmLocal));
}

export async function removerChamadoPendente(localId: string): Promise<void> {
  await dbDelete(STORE_CHAMADOS_PENDENTES, localId);
  emitirMudancaFilaChamados();
}

// Converte o Blob salvo de volta em File antes de enviar — a API de upload
// (apiUpload, ver lib/apiClient.ts) espera um File por causa do .name usado
// no FormData; o Blob puro guardado no IndexedDB não carrega esse metadado.
function blobParaFile(anexo: AnexoPendente): File {
  return new File([anexo.blob], anexo.nome, { type: anexo.tipo });
}

// Erro de rede genuíno (offline, timeout, DNS etc.) — ApiError com status 0
// é como apiClient.ts sinaliza isso (ver comentário lá). Qualquer outro
// status (400, 403, 404...) significa que o servidor respondeu de verdade,
// então o problema é outro (dado inválido, permissão, recurso removido
// nesse meio tempo) — não adianta tentar de novo sem intervenção.
export function erroDeRede(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

export interface ResultadoSincronizacao {
  sincronizados: ChamadoPendente[];
  comErro: number;
  aindaOffline: boolean;
}

// Processa a fila inteira, um item por vez (não em paralelo — evita várias
// abertura de chamado simultâneas competindo por banda numa conexão ruim,
// que é exatamente o cenário mais provável de estar processando a fila).
// Retoma de onde cada item parou: se o chamado já foi criado numa tentativa
// anterior (remoteId presente) mas um anexo falhou no meio, não recria o
// chamado — só continua enviando os anexos que faltam. É isso que evita
// duplicidade de envio pedida na missão.
export async function processarFilaChamados(): Promise<ResultadoSincronizacao> {
  const sincronizados: ChamadoPendente[] = [];
  let comErro = 0;
  let aindaOffline = false;

  if (!indexedDbDisponivel()) return { sincronizados, comErro, aindaOffline };

  const pendentes = (await listarChamadosPendentes()).filter((i) => i.status !== "sincronizando");

  for (const item of pendentes) {
    if (aindaOffline) break; // já confirmamos que a conexão caiu de novo nesta rodada — sem tentar o resto agora.

    item.status = "sincronizando";
    await dbPut(STORE_CHAMADOS_PENDENTES, item);
    emitirMudancaFilaChamados();

    try {
      if (!item.remoteId) {
        const criado = await chamadosApi.create({ ...item.payload, dataAberturaOriginal: item.criadoEmLocal });
        item.remoteId = criado.id;
        await dbPut(STORE_CHAMADOS_PENDENTES, item);
      }

      for (let i = item.anexosEnviados; i < item.anexos.length; i++) {
        await chamadosApi.anexar(item.remoteId, blobParaFile(item.anexos[i]));
        item.anexosEnviados = i + 1;
        await dbPut(STORE_CHAMADOS_PENDENTES, item);
      }

      await removerChamadoPendente(item.localId);
      sincronizados.push(item);
    } catch (e) {
      item.tentativas += 1;
      if (erroDeRede(e)) {
        aindaOffline = true;
        item.status = "pendente";
        item.erro = undefined;
      } else {
        item.status = "erro";
        item.erro = e instanceof ApiError ? e.message : "Não foi possível sincronizar este chamado.";
        comErro += 1;
      }
      await dbPut(STORE_CHAMADOS_PENDENTES, item);
      emitirMudancaFilaChamados();
    }
  }

  return { sincronizados, comErro, aindaOffline };
}
