import { useCallback, useEffect, useRef, useState } from "react";
import { ChamadoPendente, listarChamadosPendentes, processarFilaChamados } from "./chamadosOffline";
import { ouvirMudancaFilaChamados } from "./eventos";

export type StatusConexao = "online" | "offline" | "sincronizando";

// Intervalo de nova tentativa enquanto o app está aberto e há chamados
// pendentes — cobre o caso "voltou a internet mas o evento `online` do
// navegador não disparou de forma confiável" (acontece em Wi-Fi instável) e
// também retry de erro transitório do servidor (não precisa que a pessoa
// feche e reabra o app).
const INTERVALO_RETRY_MS = 20_000;

// Hook central da Abertura de Chamados Offline (item 1, 08/07/2026): uma
// única instância montada no AppShell (ver IndicadorConexao.tsx) cuida de
// detectar online/offline, dar retry automático e disparar a sincronização;
// telas individuais (Chamados.tsx, PortalColaborador.tsx) usam
// `useChamadosPendentes` abaixo só pra LER a lista/contagem atual e mesclar
// na própria tela — não duplicam a lógica de sincronização.
export function useConexao() {
  const [statusRede, setStatusRede] = useState<"online" | "offline">(
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online"
  );
  const [sincronizando, setSincronizando] = useState(false);
  const [pendentes, setPendentes] = useState<ChamadoPendente[]>([]);
  const [ultimaSincronizacao, setUltimaSincronizacao] = useState<{ quantidade: number; em: number } | null>(null);
  const processandoRef = useRef(false);

  const recarregarPendentes = useCallback(() => {
    listarChamadosPendentes().then(setPendentes);
  }, []);

  const sincronizarAgora = useCallback(async () => {
    if (processandoRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    processandoRef.current = true;
    setSincronizando(true);
    try {
      const resultado = await processarFilaChamados();
      if (resultado.sincronizados.length > 0) {
        setUltimaSincronizacao({ quantidade: resultado.sincronizados.length, em: Date.now() });
      }
    } finally {
      setSincronizando(false);
      processandoRef.current = false;
    }
  }, []);

  useEffect(() => {
    recarregarPendentes();
    const pararDeOuvir = ouvirMudancaFilaChamados(recarregarPendentes);
    return pararDeOuvir;
  }, [recarregarPendentes]);

  useEffect(() => {
    function aoFicarOnline() {
      setStatusRede("online");
      sincronizarAgora();
    }
    function aoFicarOffline() {
      setStatusRede("offline");
    }
    window.addEventListener("online", aoFicarOnline);
    window.addEventListener("offline", aoFicarOffline);
    // Tenta uma vez já na montagem (ex: F5 com fila pendente de uma sessão
    // anterior e a conexão já estava de volta).
    sincronizarAgora();
    return () => {
      window.removeEventListener("online", aoFicarOnline);
      window.removeEventListener("offline", aoFicarOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (statusRede !== "online" || pendentes.length === 0) return;
    const t = setInterval(sincronizarAgora, INTERVALO_RETRY_MS);
    return () => clearInterval(t);
  }, [statusRede, pendentes.length, sincronizarAgora]);

  const status: StatusConexao = sincronizando ? "sincronizando" : statusRede;

  return { status, pendentes, sincronizarAgora, ultimaSincronizacao };
}

// Versão "somente leitura" pra telas que só precisam mesclar os chamados
// pendentes na própria lista (ver Chamados.tsx/PortalColaborador.tsx) sem
// assumir a responsabilidade de detectar conexão/disparar sync — isso já é
// feito uma única vez pela instância de useConexao no AppShell.
export function useChamadosPendentes(): ChamadoPendente[] {
  const [pendentes, setPendentes] = useState<ChamadoPendente[]>([]);

  useEffect(() => {
    listarChamadosPendentes().then(setPendentes);
    return ouvirMudancaFilaChamados(() => listarChamadosPendentes().then(setPendentes));
  }, []);

  return pendentes;
}
