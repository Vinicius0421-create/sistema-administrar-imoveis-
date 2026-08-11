import React, { useMemo, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { Button, cardClicavelProps, COLORS, EmptyState, FOCUS_RING_CLASS, KPICard, PageHeader, SearchBox, Select, Stamp } from "../components/ui";
import { ChamadoDetalhe } from "../components/ChamadoDetalhe";
import { AlertTriangle, ClipboardList, UserCircle2, Wrench, X } from "../components/icons";
import {
  CATEGORIA_CHAMADO_LABEL, CATEGORIAS_CHAMADO, CategoriaChamado, ChamadoManutencao,
  PRIORIDADE_LABEL, PRIORIDADE_TONE, Prioridade, STATUS_CHAMADO_LABEL, STATUS_CHAMADO_TONE, StatusChamado,
} from "../types";

interface Props {
  data: AppData;
  usuarioId: string;
  onChanged: () => void;
}

const STATUS_ENCERRADOS: StatusChamado[] = ["RESOLVIDO", "ENCERRADO"];
const ORDEM_PRIORIDADE: Record<Prioridade, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };

type Visao = "TODOS" | "MEUS" | "FILA";

// Portal do Suporte de TI (Fase 3 da Evolução Completa) — diferente do
// Kanban de Chamados que Administrador/Gestor usam (pensado pra visão
// gerencial de "todas as colunas de status"), este é o ponto de partida do
// dia a dia de quem atende: uma fila única, ordenada por prioridade e depois
// por quem está esperando há mais tempo, com filtro rápido entre "meus
// chamados", "fila" (sem ninguém responsável ainda) e tudo. O chat, a
// atribuição de técnico e as observações internas usam o mesmo
// ChamadoDetalhe.tsx já construído na Fase 2 — nada foi duplicado aqui.
export function PortalSuportePage({ data, usuarioId, onChanged }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>("FILA");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroPrioridade, setFiltroPrioridade] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [incluirEncerrados, setIncluirEncerrados] = useState(false);
  // Achado de auditoria (06/07/2026): não dava pra buscar por texto — quem
  // atende ao telefone e já sabe o nome do colaborador ou parte da descrição
  // do problema tinha que rolar a fila inteira lendo card por card.
  const [busca, setBusca] = useState("");

  const abertos = useMemo(
    () => data.chamados.filter((c) => incluirEncerrados || !STATUS_ENCERRADOS.includes(c.status)),
    [data.chamados, incluirEncerrados]
  );

  const meusChamados = useMemo(() => abertos.filter((c) => c.responsavelId === usuarioId), [abertos, usuarioId]);
  const filaSemDono = useMemo(() => abertos.filter((c) => !c.responsavelId), [abertos]);

  const base = visao === "MEUS" ? meusChamados : visao === "FILA" ? filaSemDono : abertos;

  // Achado de auditoria (06/07/2026): os filtros de categoria/prioridade/
  // status só afetavam a lista embaixo — os 3 cards de KPI continuavam
  // mostrando o total geral de cada visão, sem refletir os filtros ativos.
  // Alguém filtrando "categoria: Elétrica" via 2 chamados na lista mas o
  // card "Na fila" continuava dizendo 15 — parecia inconsistência/bug.
  // aplicarFiltros fica isolado pra ser reaproveitado tanto nos KPIs quanto
  // na lista final, sempre com os mesmos critérios.
  const buscaNorm = busca.toLowerCase();
  function aplicarFiltros(lista: ChamadoManutencao[]) {
    return lista
      .filter((c) => !filtroCategoria || c.categoria === filtroCategoria)
      .filter((c) => !filtroPrioridade || c.prioridade === filtroPrioridade)
      .filter((c) => !filtroStatus || c.status === filtroStatus)
      .filter(
        (c) =>
          !busca ||
          (c.solicitante?.nomeCompleto || "").toLowerCase().includes(buscaNorm) ||
          c.descricao.toLowerCase().includes(buscaNorm) ||
          String(c.numero).includes(buscaNorm)
      );
  }

  const filaComFiltros = useMemo(() => aplicarFiltros(filaSemDono).length, [filaSemDono, filtroCategoria, filtroPrioridade, filtroStatus, busca]);
  const meusComFiltros = useMemo(() => aplicarFiltros(meusChamados).length, [meusChamados, filtroCategoria, filtroPrioridade, filtroStatus, busca]);
  const altaPrioridadeComFiltros = useMemo(
    () => aplicarFiltros(abertos).filter((c) => c.prioridade === "ALTA").length,
    [abertos, filtroCategoria, filtroPrioridade, filtroStatus, busca]
  );

  const filtrosAtivos = !!(filtroCategoria || filtroPrioridade || filtroStatus || busca);
  function limparFiltros() {
    setFiltroCategoria("");
    setFiltroPrioridade("");
    setFiltroStatus("");
    setBusca("");
  }

  const filtrados = useMemo(() => {
    return aplicarFiltros(base)
      .slice()
      .sort((a, b) => {
        const p = ORDEM_PRIORIDADE[a.prioridade] - ORDEM_PRIORIDADE[b.prioridade];
        if (p !== 0) return p;
        return new Date(a.dataAbertura).getTime() - new Date(b.dataAbertura).getTime();
      });
  }, [base, filtroCategoria, filtroPrioridade, filtroStatus, busca]);

  function diasEmAberto(c: ChamadoManutencao) {
    const ms = Date.now() - new Date(c.dataAbertura).getTime();
    const dias = Math.floor(ms / 86_400_000);
    if (dias <= 0) return "aberto hoje";
    if (dias === 1) return "1 dia em aberto";
    return `${dias} dias em aberto`;
  }

  return (
    <div>
      <PageHeader title="Portal do Suporte de TI" icon={Wrench} subtitle="Sua fila de atendimento — priorizada, do mais urgente pro mais antigo." />

      <div className="grid grid-cols-3 gap-3 mb-5">
        <KPICard label="Na fila (sem técnico)" value={filaComFiltros} icon={ClipboardList} accent={COLORS.brass} onClick={() => setVisao("FILA")} />
        <KPICard label="Atribuídos a mim" value={meusComFiltros} icon={UserCircle2} accent={COLORS.ink} onClick={() => setVisao("MEUS")} />
        <KPICard label="Alta prioridade em aberto" value={altaPrioridadeComFiltros} icon={AlertTriangle} accent="#b91c1c" />
      </div>
      {filtrosAtivos && (
        <p className="text-xs text-gray-400 dark:text-slate-500 -mt-3 mb-3">Os números acima já refletem os filtros ativos abaixo.</p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded-lg border border-gray-300 dark:border-slate-600 overflow-hidden text-sm">
          {(["FILA", "MEUS", "TODOS"] as Visao[]).map((v) => (
            <button
              key={v}
              onClick={() => setVisao(v)}
              className={`px-3 py-1.5 ${visao === v ? "text-white" : "text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"}`}
              style={visao === v ? { background: COLORS.chrome } : undefined}
            >
              {v === "FILA" ? "Fila (sem técnico)" : v === "MEUS" ? "Meus chamados" : "Todos"}
            </button>
          ))}
        </div>
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por colaborador, descrição ou nº..." />
        <Select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
          <option value="">Todas as categorias</option>
          {CATEGORIAS_CHAMADO.map((c) => <option key={c} value={c}>{CATEGORIA_CHAMADO_LABEL[c]}</option>)}
        </Select>
        <Select value={filtroPrioridade} onChange={(e) => setFiltroPrioridade(e.target.value)}>
          <option value="">Todas as prioridades</option>
          <option value="ALTA">Alta</option>
          <option value="MEDIA">Média</option>
          <option value="BAIXA">Baixa</option>
        </Select>
        <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_CHAMADO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 ml-1">
          <input type="checkbox" checked={incluirEncerrados} onChange={(e) => setIncluirEncerrados(e.target.checked)} />
          incluir resolvidos/encerrados
        </label>
        {filtrosAtivos && (
          <button
            onClick={limparFiltros}
            className="flex items-center gap-1 text-xs text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 font-semibold ml-1"
            title="Limpar todos os filtros"
          >
            <X size={12} /> Limpar filtros
          </button>
        )}
      </div>

      {filtrados.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          text={filtrosAtivos ? "Nenhum chamado encontrado com os filtros atuais." : "Nenhum chamado nessa visão — fila em dia."}
        />
      ) : (
        <div className="space-y-2">
          {filtrados.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              {...cardClicavelProps(() => setSelectedId(c.id))}
              className={`bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-3 flex items-center justify-between gap-3 cursor-pointer hover:border-brand-600/50 ${FOCUS_RING_CLASS}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 dark:text-slate-500 text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>#{c.numero}</span>
                  <p className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{c.solicitante?.nomeCompleto}</p>
                  <Stamp tone={PRIORIDADE_TONE[c.prioridade]}>{PRIORIDADE_LABEL[c.prioridade]}</Stamp>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{CATEGORIA_CHAMADO_LABEL[c.categoria]} · {c.descricao}</p>
                <p className="text-xs text-gray-400 dark:text-slate-500">{diasEmAberto(c)}{c.local ? ` · ${c.local}` : ""}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <Stamp tone={STATUS_CHAMADO_TONE[c.status]}>{STATUS_CHAMADO_LABEL[c.status]}</Stamp>
                <span className="text-[11px] text-gray-400 dark:text-slate-500">{c.responsavel?.nome || "sem técnico"}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <ChamadoDetalhe
          chamadoId={selectedId}
          papel="SUPORTE_TI"
          podeGerenciar
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
          colaboradores={data.colaboradores}
          equipamentos={data.equipamentos}
        />
      )}
    </div>
  );
}
