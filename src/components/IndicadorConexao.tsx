import React, { useEffect, useState } from "react";
import { useConexao } from "../offline/useConexao";
import { COLORS } from "./ui";

// Indicador de conexão pedido no item 1 da missão "Melhorias Adicionais"
// (08/07/2026) — 3 estados mínimos exigidos: 🟢 Online, 🟡 Sincronizando,
// 🔴 Offline. Uma única instância vive no header do AppShell/Portal (ver
// App.tsx) — é ela quem de fato aciona `useConexao` (detecção de
// online/offline + disparo de sincronização); o restante do app só lê o
// resultado via `useChamadosPendentes`.
export function IndicadorConexao() {
  const { status, pendentes, sincronizarAgora, ultimaSincronizacao } = useConexao();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!ultimaSincronizacao) return;
    const plural = ultimaSincronizacao.quantidade > 1 ? "s" : "";
    setToast(`${ultimaSincronizacao.quantidade} chamado${plural} sincronizado${plural} com sucesso.`);
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [ultimaSincronizacao]);

  const comErro = pendentes.some((p) => p.status === "erro");

  const CONFIG: Record<typeof status, { emoji: string; texto: string; cor: string }> = {
    online: { emoji: "🟢", texto: "Online", cor: "text-emerald-700 dark:text-emerald-400" },
    sincronizando: { emoji: "🟡", texto: "Sincronizando...", cor: "text-amber-700 dark:text-amber-400" },
    offline: { emoji: "🔴", texto: "Offline", cor: "text-brand-700 dark:text-brand-400" },
  };
  const cfg = CONFIG[status];

  // Nada pra mostrar: online, sem nenhum chamado pendente — não vale ocupar
  // espaço permanente na tela por um estado que é o normal 99% do tempo.
  if (status === "online" && pendentes.length === 0 && !toast) return null;

  return (
    <div className="relative">
      <button
        onClick={pendentes.length > 0 && status !== "sincronizando" ? sincronizarAgora : undefined}
        title={
          pendentes.length > 0
            ? `${pendentes.length} chamado(s) aguardando sincronização${comErro ? " (algum com erro — toque para tentar de novo)" : ""}`
            : cfg.texto
        }
        className={`flex items-center gap-1.5 text-xs font-medium ${cfg.cor} ${pendentes.length > 0 ? "cursor-pointer hover:underline" : "cursor-default"}`}
      >
        <span aria-hidden="true">{cfg.emoji}</span>
        <span className="hidden sm:inline">{cfg.texto}</span>
        {pendentes.length > 0 && (
          // Padronização de Animações (10/07/2026): mesmo efeito "pop" do
          // badge de notificações não lidas (CentralNotificacoes.tsx) — a
          // troca de `key` força o React a remontar o `<span>` sempre que a
          // contagem muda, disparando a animação de entrada de novo a cada
          // atualização, em vez de só no primeiro aparecimento.
          <span
            key={pendentes.length}
            className="bg-current/10 rounded-full px-1.5 py-0.5 text-[10px] font-bold animate-[toastIn_var(--motion-fast)_var(--motion-ease)]"
            style={{ color: "inherit" }}
          >
            {pendentes.length}
          </span>
        )}
      </button>
      {toast && (
        <div
          role="status"
          className="absolute right-0 top-full mt-2 z-30 whitespace-nowrap rounded-lg px-3 py-2 text-xs text-white shadow-lg animate-[fadeIn_var(--motion-fast)_ease-out]"
          style={{ background: COLORS.chrome }}
        >
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
