import React, { useMemo, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { historicoApi } from "../api/historico";
import { ApiError } from "../lib/apiClient";
import { fmtDate, EmptyState, PageHeader, Paginacao, Select, Stamp, usePaginacaoCliente } from "../components/ui";
import { HistoryIcon, X } from "../components/icons";
import { useFeedback } from "../contexts/FeedbackContext";

const TIPO_EVENTO_LABEL: Record<string, string> = {
  ENTREGA: "Entrega",
  TROCA: "Troca",
  DEVOLUCAO: "Devolução",
  MANUTENCAO: "Manutenção",
  BAIXA: "Baixa",
};

// Página só aparece no menu pra ADMINISTRADOR (ver NAV em App.tsx) — o
// próprio backend também restringe a exclusão a esse papel, então o botão
// abaixo pode ficar sempre visível aqui sem checagem extra de papel.
export function HistoricoPage({ data, onChanged }: { data: AppData; onChanged: () => void }) {
  const { sucesso } = useFeedback();
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Ordenação clicável (Fase 3, 14/07/2026) — "Mais recentes" é o padrão.
  const [ordenacao, setOrdenacao] = useState<"data_recente" | "data_antiga" | "equipamento_asc">("data_recente");
  const historicoOrdenado = useMemo(
    () =>
      [...data.historico].sort((a, b) => {
        if (ordenacao === "equipamento_asc") {
          return (a.equipamento?.tipo || "").localeCompare(b.equipamento?.tipo || "");
        }
        const diff = new Date(b.data).getTime() - new Date(a.data).getTime();
        return ordenacao === "data_recente" ? diff : -diff;
      }),
    [data.historico, ordenacao]
  );
  // Paginação no cliente (Fase 2, 14/07/2026, tarefa #153) — sobre a lista
  // já ordenada acima.
  const { itensPagina, pagina, totalPaginas, setPagina, total, inicioExibicao, fimExibicao } =
    usePaginacaoCliente(historicoOrdenado, 24);

  // Entidade "folha" — excluir um registro de histórico não desfaz a troca
  // em si (o equipamento já está com quem está), só remove a linha do
  // registro. Serve pra corrigir engano (teste, duplicado).
  async function excluir(id: string) {
    setPendente(id);
    setErro(null);
    try {
      await historicoApi.remove(id);
      await onChanged();
      setExcluindo(null);
      // Achado de auditoria (S10, 22/07/2026): esta era a única tela do
      // sistema que seguia o padrão useFeedback em outros lugares mas ficava
      // sem confirmação visual ao excluir — usuário não tinha como saber se
      // o clique realmente funcionou.
      sucesso("Registro de histórico excluído com sucesso.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
    } finally {
      setPendente(null);
    }
  }

  return (
    <div>
      <PageHeader title="Histórico de Trocas" subtitle="Gerado automaticamente sempre que um equipamento muda de colaborador." />
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}
      {data.historico.length === 0 ? (
        <EmptyState icon={HistoryIcon} text="Nenhuma troca registrada ainda." />
      ) : (
        <>
        {/* Ordenação clicável (Fase 3, 14/07/2026) — esta tela nunca teve
            barra de filtro nenhuma (não tinha o que filtrar até aqui). */}
        <div className="flex flex-wrap gap-3 mb-4">
          <Select aria-label="Ordenar por" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as typeof ordenacao)}>
            <option value="data_recente">Mais recentes</option>
            <option value="data_antiga">Mais antigas</option>
            <option value="equipamento_asc">Equipamento (A-Z)</option>
          </Select>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {itensPagina.map((h) => (
            <div key={h.id} className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-3 text-sm">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900 dark:text-slate-100">{h.equipamento?.tipo} {h.equipamento?.modelo || ""}</p>
                <div className="flex items-center gap-2">
                  <Stamp>{TIPO_EVENTO_LABEL[h.tipoEvento] || h.tipoEvento}</Stamp>
                  {excluindo === h.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <button className="text-brand-700 dark:text-brand-400 font-semibold" disabled={pendente === h.id} onClick={() => excluir(h.id)}>confirmar</button>
                      <button className="text-gray-500 dark:text-slate-400" onClick={() => setExcluindo(null)}>cancelar</button>
                    </span>
                  ) : (
                    // Achado de auditoria (06/07/2026): área clicável era só o
                    // ícone de 13px — praticamente impossível de acertar no
                    // celular. p-1.5 -m-1.5 aumenta a área de toque sem mudar
                    // o layout visual (a margem negativa compensa o padding).
                    <button
                      className="text-gray-500 dark:text-slate-400 hover:text-brand-600 p-1.5 -m-1.5"
                      title="Excluir este registro"
                      aria-label="Excluir este registro"
                      onClick={() => setExcluindo(h.id)}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                {h.colaboradorOrigem?.nomeCompleto || "—"} → {h.colaboradorDestino?.nomeCompleto || "(estoque)"}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500">{fmtDate(h.data)}</p>
            </div>
          ))}
        </div>
        <Paginacao
          pagina={pagina}
          totalPaginas={totalPaginas}
          onChange={setPagina}
          total={total}
          inicioExibicao={inicioExibicao}
          fimExibicao={fimExibicao}
          itemLabel="registros"
        />
        </>
      )}
    </div>
  );
}
