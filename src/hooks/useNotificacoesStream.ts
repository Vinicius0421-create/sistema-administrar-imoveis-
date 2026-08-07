import { useCallback, useEffect, useRef, useState } from "react";
import { notificacoesApi } from "../api/notificacoes";
import { Notificacao } from "../types";

// Central de Notificações (Fase B, 09/07/2026, pedido do Vini) — hook de
// conexão SSE com reconexão MANUAL, não o auto-reconnect nativo do
// EventSource. Motivo: o token de acesso vive só em memória (ver
// tokenStore em lib/apiClient.ts, decisão de hardening contra XSS já
// documentada lá) e é renovado só de forma reativa, num 401 (não existe
// timer proativo de refresh em AuthContext.tsx). O EventSource nativo, ao
// perder a conexão, reconecta sozinho usando a MESMA URL original — ou
// seja, com o MESMO token, que pode já estar expirado, e ficaria
// tentando pra sempre sem nunca pegar um token novo. Este hook fecha a
// conexão manualmente em erro e monta uma URL nova (com o token atual) a
// cada tentativa, com backoff exponencial até um teto de 60s.
// "Tudo instantâneo" (09/07/2026, pedido do Vini) — reaproveita esta MESMA
// conexão SSE (já autenticada, já com reconexão robusta acima) pra também
// carregar um segundo tipo de evento, "dados": um aviso de "recurso X
// mudou" empurrado pelo backend depois de qualquer criação/edição/exclusão
// relevante (ver avisarMudanca em utils/realtime.ts no backend). Só o nome
// do recurso viaja no evento, nunca o dado em si — quem recebe decide
// sozinho como recarregar (ver useAppData.ts, que é quem de fato consome
// isto hoje, via a prop onDados repassada por App.tsx/PortalColaborador.tsx
// através de <CentralNotificacoes>, o único lugar que já mantém esta
// conexão aberta). Evita abrir uma SEGUNDA conexão SSE só pra isso — mais
// barato pro navegador (que já limita conexões simultâneas por origem) e
// pro backend (metade das conexões em memória no sseHub).
export interface EventoDados {
  entidades: string[];
}

interface Options {
  ativo: boolean; // só conecta quando true (usuário autenticado)
  onNotificacao?: (n: Notificacao) => void;
  onDados?: (evento: EventoDados) => void;
}

export function useNotificacoesStream({ ativo, onNotificacao, onDados }: Options) {
  const [naoLidas, setNaoLidas] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const tentativaRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const desmontadoRef = useRef(false);
  const onNotificacaoRef = useRef(onNotificacao);
  onNotificacaoRef.current = onNotificacao;
  const onDadosRef = useRef(onDados);
  onDadosRef.current = onDados;

  const conectar = useCallback(() => {
    if (desmontadoRef.current) return;
    const url = notificacoesApi.urlStream();
    if (!url) return; // sem token ainda (ex: logout em andamento) - não tenta

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("conectado", (ev) => {
      tentativaRef.current = 0;
      try {
        const dados = JSON.parse((ev as MessageEvent).data);
        if (typeof dados.naoLidas === "number") setNaoLidas(dados.naoLidas);
      } catch {
        // ignora payload malformado - não é crítico, a contagem via API
        // (efeito abaixo) cobre esse caso
      }
    });

    es.addEventListener("notificacao", (ev) => {
      try {
        const notificacao = JSON.parse((ev as MessageEvent).data) as Notificacao;
        setNaoLidas((n) => n + 1);
        onNotificacaoRef.current?.(notificacao);
      } catch {
        // payload malformado - ignora esta notificação específica
      }
    });

    es.addEventListener("dados", (ev) => {
      try {
        const evento = JSON.parse((ev as MessageEvent).data) as EventoDados;
        onDadosRef.current?.(evento);
      } catch {
        // payload malformado - ignora este evento específico (mesma postura
        // defensiva do listener "notificacao" acima)
      }
    });

    es.onerror = () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
      if (desmontadoRef.current) return;
      const espera = Math.min(60000, 3000 * 2 ** tentativaRef.current);
      tentativaRef.current += 1;
      timeoutRef.current = window.setTimeout(conectar, espera);
    };
  }, []);

  useEffect(() => {
    desmontadoRef.current = false;
    if (!ativo) return;
    conectar();
    return () => {
      desmontadoRef.current = true;
      esRef.current?.close();
      esRef.current = null;
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [ativo, conectar]);

  // Cobre o intervalo antes do SSE conectar (primeiro paint) e qualquer rede
  // que bloqueie SSE por completo (proxy corporativo, extensão) — sem isso,
  // o sino ficaria com badge zerado indefinidamente nesses casos.
  useEffect(() => {
    if (!ativo) return;
    notificacoesApi
      .contagemNaoLidas()
      .then((r) => setNaoLidas(r.total))
      .catch(() => {});
  }, [ativo]);

  const marcarComoLidaLocal = useCallback((quantidade = 1) => {
    setNaoLidas((n) => Math.max(0, n - quantidade));
  }, []);

  const zerarNaoLidas = useCallback(() => setNaoLidas(0), []);

  const refetchContagem = useCallback(() => {
    notificacoesApi
      .contagemNaoLidas()
      .then((r) => setNaoLidas(r.total))
      .catch(() => {});
  }, []);

  return { naoLidas, marcarComoLidaLocal, zerarNaoLidas, refetchContagem };
}
