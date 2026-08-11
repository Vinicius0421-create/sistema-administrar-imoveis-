import { chamadosApi, ChamadoInput } from "../api/chamados";
import { ChamadoManutencao } from "../types";
import { ApiError } from "../lib/apiClient";
import { erroDeRede, salvarChamadoPendente } from "./chamadosOffline";

export type ResultadoAberturaChamado =
  | { modo: "enviado"; chamado: ChamadoManutencao; anexosComErro: string[] }
  | { modo: "pendente" };

// Ponto único usado tanto por Chamados.tsx (Administrador/Suporte/Gestor)
// quanto por PortalColaborador.tsx (autoatendimento) para abrir um chamado
// já considerando a possibilidade de estar sem conexão — item 1 da missão
// "Melhorias Adicionais" (08/07/2026). Mantém as duas telas usando
// exatamente a mesma lógica de fallback em vez de duplicá-la.
export async function abrirChamadoComSuporteOffline(payload: ChamadoInput, arquivos: File[]): Promise<ResultadoAberturaChamado> {
  // Curto-circuito proativo: se o navegador já sabe que está offline, nem
  // tenta a chamada (evita esperar o timeout de 20s de apiClient.ts à toa).
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await salvarChamadoPendente(payload, arquivos);
    return { modo: "pendente" };
  }

  let criado: ChamadoManutencao;
  try {
    criado = await chamadosApi.create(payload);
  } catch (e) {
    if (erroDeRede(e)) {
      await salvarChamadoPendente(payload, arquivos);
      return { modo: "pendente" };
    }
    throw e;
  }

  // O chamado em si já está criado e é real a partir daqui — uma falha nos
  // anexos não pode mais virar "salvo offline" (isso duplicaria o chamado
  // na sincronização). Anexo que falha por queda de conexão no meio do
  // envio entra na fila só pra completar o que falta, já com o remoteId
  // certo; falha por outro motivo (raro, já que o formulário valida
  // tipo/tamanho antes) só é reportada, sem travar o restante.
  const anexosComErro: string[] = [];
  for (let i = 0; i < arquivos.length; i++) {
    try {
      await chamadosApi.anexar(criado.id, arquivos[i]);
    } catch (e) {
      if (erroDeRede(e)) {
        await salvarChamadoPendente(payload, arquivos.slice(i), criado.id);
        break;
      }
      anexosComErro.push(arquivos[i].name + (e instanceof ApiError ? ` (${e.message})` : ""));
    }
  }

  return { modo: "enviado", chamado: criado, anexosComErro };
}
