import React, { useMemo, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { movimentacoesApi, MovimentacaoInput } from "../api/movimentacoes";
import { ApiError } from "../lib/apiClient";
import { Button, COLORS, EmptyState, Field, fmtDate, Modal, PageHeader, Paginacao, SearchBox, Select, Stamp, TextArea, TextInput, usePaginacaoCliente } from "../components/ui";
import { CheckCircle2, Plus, Repeat, X } from "../components/icons";
import { STATUS_MOVIMENTACAO_LABEL, STATUS_MOVIMENTACAO_TONE, StatusMovimentacao, TIPO_MOVIMENTACAO_LABEL, TipoMovimentacao } from "../types";
import { useFeedback } from "../contexts/FeedbackContext";

interface Props {
  data: AppData;
  readOnly: boolean;
  onChanged: () => void;
  // Atalho rápido do Dashboard (Fase 3, 14/07/2026) — mesmo mecanismo já
  // usado nas outras telas (ver abrirNovo em Colaboradores.tsx).
  abrirNovo?: boolean;
}

export function MovimentacoesPage({ data, readOnly, onChanged, abrirNovo }: Props) {
  const { sucesso } = useFeedback();
  const [editing, setEditing] = useState(() => !!abrirNovo && !readOnly);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(null);
  // Achado de auditoria (06/07/2026): sem busca, achar a movimentação de um
  // colaborador específico numa lista já grande exigia rolar tudo.
  const [busca, setBusca] = useState("");
  // Achado de auditoria F4 (Fase 2, 22/07/2026): não havia nenhum filtro por
  // status — quem usa esta tela pro fluxo de desligamento (F1/F2/S1) tinha
  // que rolar a lista inteira pra achar o que ainda estava PENDENTE em meio
  // a tudo que já foi CONCLUIDA. "" = todos, mesmo padrão de filtro (Select
  // com opção "Todos") já usado em SolicitacoesPapelaria.tsx.
  const [filtroStatus, setFiltroStatus] = useState<StatusMovimentacao | "">("");
  // Modernização de filtros (07/08/2026, pedido do Vini) — faltava filtrar
  // por tipo (Admissão/Desligamento/Transferência de Unidade/Transferência
  // de Setor/Promoção): quem quer só ver o histórico de promoções, por
  // exemplo, tinha que ler o rótulo de cada card manualmente.
  const [filtroTipo, setFiltroTipo] = useState<TipoMovimentacao | "">("");

  // Ordenação clicável (Fase 3, 14/07/2026) — "Mais recentes" é o padrão
  // (mantém o comportamento de sempre, que já vinha ordenado por data do
  // backend); as outras opções são adicionais.
  const [ordenacao, setOrdenacao] = useState<"data_recente" | "data_antiga" | "colaborador_asc">("data_recente");

  const filtrosAtivos = !!(busca || filtroStatus || filtroTipo);
  function limparFiltros() {
    setBusca("");
    setFiltroStatus("");
    setFiltroTipo("");
  }

  const movimentacoesFiltradas = useMemo(
    () =>
      data.movimentacoes
        .filter((m) => (m.colaborador?.nomeCompleto || "").toLowerCase().includes(busca.toLowerCase()))
        .filter((m) => !filtroStatus || m.status === filtroStatus)
        .filter((m) => !filtroTipo || m.tipo === filtroTipo)
        .sort((a, b) => {
          if (ordenacao === "colaborador_asc") {
            return (a.colaborador?.nomeCompleto || "").localeCompare(b.colaborador?.nomeCompleto || "");
          }
          const diff = new Date(b.data).getTime() - new Date(a.data).getTime();
          return ordenacao === "data_recente" ? diff : -diff;
        }),
    [data.movimentacoes, busca, filtroStatus, filtroTipo, ordenacao]
  );
  // Paginação no cliente (Fase 2, 14/07/2026, tarefa #153) — lista já vem
  // inteira do servidor (fetchAllPages), só a exibição é fatiada.
  const { itensPagina, pagina, totalPaginas, setPagina, total, inicioExibicao, fimExibicao } =
    usePaginacaoCliente(movimentacoesFiltradas, 24);

  async function salvar(form: MovimentacaoInput) {
    setSalvando(true);
    setErro(null);
    try {
      await movimentacoesApi.create(form);
      await onChanged();
      setEditing(false);
      sucesso("Movimentação registrada.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  // Achado de auditoria (06/07/2026): não havia como marcar uma movimentação
  // como concluída depois de revisar o checklist de devolução/transferência —
  // ela ficava "Pendente" pra sempre, mesmo já resolvida na prática.
  //
  // Achado de auditoria S1 (22/07/2026): "Concluir" marcava tudo como
  // revisado mesmo com o checklist de devolução ainda pendente (equipamento/
  // linha/acesso ainda em nome do ex-colaborador), ignorando o próprio aviso
  // que a tela mostra ao lado do botão. Agora o backend recusa (409) com uma
  // mensagem nomeando o que falta; aqui isso vira um pedido de confirmação
  // explícita (`pendenciaConfirmar`) em vez de só mostrar o erro — a pessoa
  // decide conscientemente se quer concluir mesmo assim.
  const [pendenciaConfirmar, setPendenciaConfirmar] = useState<{ id: string; mensagem: string } | null>(null);

  async function concluir(id: string, confirmarPendencias?: boolean) {
    setPendente(id);
    setErro(null);
    try {
      await movimentacoesApi.concluir(id, confirmarPendencias);
      await onChanged();
      setPendenciaConfirmar(null);
      sucesso("Movimentação concluída.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && !confirmarPendencias) {
        setPendenciaConfirmar({ id, mensagem: e.message });
      } else {
        setErro(e instanceof ApiError ? e.message : "Não foi possível concluir esta movimentação.");
      }
    } finally {
      setPendente(null);
    }
  }

  // Entidade "folha" — excluir uma movimentação não afeta mais nada,
  // serve pra corrigir registro criado por engano (duplicado, teste).
  async function excluir(id: string) {
    setPendente(id);
    setErro(null);
    try {
      await movimentacoesApi.remove(id);
      await onChanged();
      setExcluindo(null);
      sucesso("Movimentação excluída.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
    } finally {
      setPendente(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Movimentações de Colaboradores"
        subtitle={`${movimentacoesFiltradas.length} de ${data.movimentacoes.length} registros`}
        actions={
          !readOnly && (
            <Button variant="accent" onClick={() => setEditing(true)}>
              <Plus size={16} /> Nova Movimentação
            </Button>
          )
        }
      />

      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}

      {data.movimentacoes.length === 0 ? (
        <EmptyState icon={Repeat} text="Nenhuma movimentação registrada ainda. Admissões, desligamentos e transferências aparecerão aqui." />
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por colaborador..." />
            {/* Achado de auditoria F4 (Fase 2, 22/07/2026): não havia filtro
                de status nesta tela — quem acompanha o fluxo de desligamento
                (F1/F2/S1) precisa achar rápido o que ainda está PENDENTE. */}
            <Select aria-label="Filtrar por status" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as StatusMovimentacao | "")}>
              <option value="">Todos os status</option>
              <option value="PENDENTE">{STATUS_MOVIMENTACAO_LABEL.PENDENTE}</option>
              <option value="CONCLUIDA">{STATUS_MOVIMENTACAO_LABEL.CONCLUIDA}</option>
            </Select>
            <Select aria-label="Filtrar por tipo" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoMovimentacao | "")}>
              <option value="">Todos os tipos</option>
              {Object.entries(TIPO_MOVIMENTACAO_LABEL).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </Select>
            <Select aria-label="Ordenar por" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as typeof ordenacao)}>
              <option value="data_recente">Mais recentes</option>
              <option value="data_antiga">Mais antigas</option>
              <option value="colaborador_asc">Colaborador (A-Z)</option>
            </Select>
            {filtrosAtivos && <Button variant="ghost" onClick={limparFiltros}>Limpar filtros</Button>}
          </div>
          {movimentacoesFiltradas.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">Nenhuma movimentação encontrada com os filtros atuais.</p>
          ) : (
            <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {itensPagina.map((m) => (
                <div key={m.id} className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{m.colaborador?.nomeCompleto} — {TIPO_MOVIMENTACAO_LABEL[m.tipo]}</p>
                    <div className="flex items-center gap-2">
                      <Stamp tone={STATUS_MOVIMENTACAO_TONE[m.status]}>{STATUS_MOVIMENTACAO_LABEL[m.status]}</Stamp>
                      {!readOnly && m.status === "PENDENTE" && (
                        <button
                          className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-50 flex items-center gap-1 text-xs font-semibold"
                          title="Marcar como concluída"
                          disabled={pendente === m.id}
                          onClick={() => concluir(m.id)}
                        >
                          <CheckCircle2 size={14} /> Concluir
                        </button>
                      )}
                      {!readOnly && (
                        excluindo === m.id ? (
                          <span className="flex items-center gap-1 text-xs">
                            <button className="text-brand-700 dark:text-brand-400 font-semibold" disabled={pendente === m.id} onClick={() => excluir(m.id)}>confirmar</button>
                            <button className="text-gray-500 dark:text-slate-400" onClick={() => setExcluindo(null)}>cancelar</button>
                          </span>
                        ) : (
                          // Achado de auditoria (06/07/2026): mesma correção de
                          // área de toque aplicada em Historico.tsx/Acessos.tsx.
                          <button
                            className="text-gray-500 dark:text-slate-400 hover:text-brand-600 p-1.5 -m-1.5"
                            title="Excluir esta movimentação"
                            aria-label="Excluir esta movimentação"
                            onClick={() => setExcluindo(m.id)}
                          >
                            <X size={13} />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{fmtDate(m.data)}</p>
                  {(m.tipo === "TRANSFERENCIA_UNIDADE" || m.tipo === "TRANSFERENCIA_SETOR") && (
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                      {m.tipo === "TRANSFERENCIA_UNIDADE"
                        ? `${data.dominios.unidades.find((u) => u.id === m.unidadeAnteriorId)?.nome || "—"} → ${data.dominios.unidades.find((u) => u.id === m.novaUnidadeId)?.nome || "—"}`
                        : `${data.dominios.setores.find((s) => s.id === m.setorAnteriorId)?.nome || "—"} → ${data.dominios.setores.find((s) => s.id === m.novoSetorId)?.nome || "—"}`}
                    </p>
                  )}
                  {m.tipo === "DESLIGAMENTO" && m.colaborador && (
                    <div className="mt-2 bg-brand-700/5 border border-brand-700/20 rounded-[var(--radius-control)] p-2 text-xs">
                      <p className="font-semibold text-brand-900 dark:text-brand-300 mb-1">⚠ Checklist de devolução:</p>
                      <p>
                        {m.colaborador._count.equipamentos} equipamento(s), {m.colaborador._count.linhas} linha(s),{" "}
                        {m.colaborador._count.acessos} acesso(s) vinculados — revisar antes de concluir.
                      </p>
                    </div>
                  )}
                  {/* Achado de auditoria S1 (22/07/2026) — banner de segunda
                      confirmação quando o backend recusou concluir por ainda
                      haver checklist pendente; só aparece no card certo. */}
                  {pendenciaConfirmar?.id === m.id && (
                    <div className="mt-2 bg-brand-700/10 border border-brand-700/30 rounded-[var(--radius-control)] p-2 text-xs">
                      <p className="text-brand-900 dark:text-brand-300 mb-1.5">{pendenciaConfirmar.mensagem}</p>
                      <div className="flex items-center gap-3">
                        <button
                          className="text-brand-700 dark:text-brand-400 font-semibold"
                          disabled={pendente === m.id}
                          onClick={() => concluir(m.id, true)}
                        >
                          concluir mesmo assim
                        </button>
                        <button className="text-gray-500 dark:text-slate-400" onClick={() => setPendenciaConfirmar(null)}>cancelar</button>
                      </div>
                    </div>
                  )}
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
              itemLabel="movimentações"
            />
            </>
          )}
        </>
      )}

      {editing && (
        <MovimentacaoForm
          colaboradores={data.colaboradores}
          unidades={data.dominios.unidades}
          setores={data.dominios.setores}
          onSave={salvar}
          onClose={() => { setEditing(false); setErro(null); }}
          salvando={salvando}
          erro={erro}
        />
      )}
    </div>
  );
}

function MovimentacaoForm({
  colaboradores, unidades, setores, onSave, onClose, salvando, erro,
}: {
  colaboradores: AppData["colaboradores"];
  unidades: AppData["dominios"]["unidades"];
  setores: AppData["dominios"]["setores"];
  onSave: (form: MovimentacaoInput) => void;
  onClose: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const [colaboradorId, setColaboradorId] = useState("");
  const [tipo, setTipo] = useState<TipoMovimentacao>("ADMISSAO");
  const [novaUnidadeId, setNovaUnidadeId] = useState("");
  const [novoSetorId, setNovoSetorId] = useState("");
  const [observacoes, setObservacoes] = useState("");
  // Achado de auditoria S9 (22/07/2026) — antes a movimentação sempre usava
  // a data de envio do formulário; agora dá pra registrar algo retroativo
  // (ex: uma transferência que já aconteceu na semana passada). Padrão:
  // hoje, editável.
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));

  const colaboradorSelecionado = colaboradores.find((c) => c.id === colaboradorId);

  // Achado de auditoria (06/07/2026): o formulário registrava só "houve uma
  // transferência de unidade/setor", sem capturar PARA ONDE — a informação
  // mais importante do registro ficava de fora, obrigando quem visse depois
  // a ir perguntar verbalmente. A unidade/setor "anterior" é derivada
  // automaticamente do cadastro atual do colaborador no momento do envio,
  // sem exigir que a pessoa preencha isso manualmente.
  function submeter() {
    if (!colaboradorId) return;
    onSave({
      colaboradorId,
      tipo,
      unidadeAnteriorId: tipo === "TRANSFERENCIA_UNIDADE" ? colaboradorSelecionado?.unidadeId ?? null : null,
      setorAnteriorId: tipo === "TRANSFERENCIA_SETOR" ? colaboradorSelecionado?.setorId ?? null : null,
      novaUnidadeId: tipo === "TRANSFERENCIA_UNIDADE" ? novaUnidadeId || null : null,
      novoSetorId: tipo === "TRANSFERENCIA_SETOR" ? novoSetorId || null : null,
      observacoes: observacoes || null,
      data: data || null,
    });
  }

  const faltaDestino =
    (tipo === "TRANSFERENCIA_UNIDADE" && !novaUnidadeId) || (tipo === "TRANSFERENCIA_SETOR" && !novoSetorId);

  return (
    <Modal title="Nova Movimentação" onClose={onClose}>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}
      <Field label="Colaborador">
        <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
          <option value="">—</option>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
        </Select>
      </Field>
      <Field label="Tipo">
        <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimentacao)}>
          {(Object.keys(TIPO_MOVIMENTACAO_LABEL) as TipoMovimentacao[]).map((t) => (
            <option key={t} value={t}>{TIPO_MOVIMENTACAO_LABEL[t]}</option>
          ))}
        </Select>
      </Field>
      {tipo === "TRANSFERENCIA_UNIDADE" && (
        <Field label={`Nova unidade${colaboradorSelecionado ? ` (atual: ${unidades.find((u) => u.id === colaboradorSelecionado.unidadeId)?.nome || "—"})` : ""}`}>
          <Select value={novaUnidadeId} onChange={(e) => setNovaUnidadeId(e.target.value)}>
            <option value="">—</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Field>
      )}
      {tipo === "TRANSFERENCIA_SETOR" && (
        <Field label={`Novo setor${colaboradorSelecionado ? ` (atual: ${setores.find((s) => s.id === colaboradorSelecionado.setorId)?.nome || "—"})` : ""}`}>
          <Select value={novoSetorId} onChange={(e) => setNovoSetorId(e.target.value)}>
            <option value="">—</option>
            {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </Select>
        </Field>
      )}
      {/* Achado de auditoria S9 (22/07/2026) — antes não existia, sempre
          usava a data de envio; agora editável, padrão "hoje". */}
      <Field label="Data">
        <TextInput type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </Field>
      <Field label="Observações">
        <TextArea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={!colaboradorId || faltaDestino || salvando} onClick={submeter}>
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </Modal>
  );
}
