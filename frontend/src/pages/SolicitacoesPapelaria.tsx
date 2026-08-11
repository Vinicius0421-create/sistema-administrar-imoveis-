import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AppData } from "../hooks/useAppData";
import {
  DashboardSolicitacoesPapelaria, Gestor, ItemSolicitacaoPapelariaInput, solicitacoesPapelariaApi,
  SolicitacaoPapelariaInput, SolicitacaoPapelariaUpdateInput,
} from "../api/solicitacoesPapelaria";
import { ApiError } from "../lib/apiClient";
import {
  Button, cardClicavelProps, COLORS, Field, FOCUS_RING_CLASS, KanbanBoard, KPICard,
  LoadingState, Modal, PageHeader, Select, SimpleBarChart, Stamp, TextArea, TextInput, uid,
} from "../components/ui";
import { fmtDataHora, fmtDuracao } from "../components/ChamadoDetalhe";
import { TimelineEventos } from "../components/TimelineEventos";
import { SENTINELA_OUTRO, SeletorComOpcaoOutro } from "../components/SeletorComOpcaoOutro";
import {
  AlertTriangle, CheckCircle2, ClipboardList, Plus, Repeat, Send, ShoppingCart, Trash2, X,
} from "../components/icons";
import {
  CategoriaProdutoPapelaria, EventoSolicitacaoPapelaria, ItemSolicitacaoPapelaria, Papel, PRIORIDADE_LABEL,
  PRIORIDADE_TONE, Prioridade, ProdutoPapelaria, SolicitacaoPapelaria, SOLIC_PAPELARIA_STATUSES, STATUS_PAPELARIA_DECISAO,
  STATUS_SOLICITACAO_PAPELARIA_LABEL, STATUS_SOLICITACAO_PAPELARIA_TONE, StatusSolicitacaoPapelaria, TIPO_SOLICITACAO_PAPELARIA_LABEL,
  TipoSolicitacaoPapelaria, TRANSICOES_SOLIC_PAPELARIA, UNIDADE_MEDIDA_PRODUTO_LABEL, UnidadeMedidaProduto,
} from "../types";
import { useFeedback } from "../contexts/FeedbackContext";

// Módulo "Papelaria e Compras" (09/07/2026, pedido do Vini) — submódulo de
// Solicitações, ao lado de "Equipamentos" (ver SolicitacoesHub.tsx, que
// decide qual dos dois aparece pra cada papel). Estrutura deliberadamente
// espelhando Chamados.tsx + ChamadoDetalhe.tsx (Kanban + detalhe/timeline +
// comentário + controle de status) — é o mesmo padrão de "processo com
// linha do tempo de eventos" já validado no sistema, só com um domínio
// diferente (itens de uma remessa em vez de um problema técnico único).

interface Props {
  data: AppData;
  papel: Papel;
  readOnly: boolean;
  // Nomeado igual ao `podeAprovar` de Solicitacoes.tsx (equipamento), só que
  // aqui cobre TODA a gestão (criar/editar/aprovar/mudar status/comentar),
  // não só aprovação — reflete a regra confirmada com o Vini: RH tem esse
  // poder completo, mas só neste módulo.
  podeGerenciar: boolean;
  onChanged: () => void;
  // Semente vinda do dashboard/notificação — mesmo padrão de
  // abrirChamadoId/abrirSolicitacaoId já usado nos módulos irmãos.
  abrirSolicitacaoId?: string;
}

const COLUNAS_LABEL = Object.fromEntries(SOLIC_PAPELARIA_STATUSES.map((s) => [s, STATUS_SOLICITACAO_PAPELARIA_LABEL[s]]));

// Distinção visual MENSAL x AVULSA exigida explicitamente ("visualmente e no
// fluxo, distintas em toda a interface") — usado no cartão do Kanban, no
// detalhe e nos 2 cartões de seleção do formulário de nova solicitação.
// Verde/Repeat pra Mensal (ciclo normal, sem urgência); vermelho/Alerta pra
// Avulsa (fora do ciclo, exige justificativa).
export function TipoBadge({ tipo }: { tipo: TipoSolicitacaoPapelaria }) {
  const avulsa = tipo === "AVULSA";
  const cor = avulsa ? COLORS.brass : COLORS.sage;
  const Icon = avulsa ? AlertTriangle : Repeat;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={{ background: cor + "14", color: cor }}
    >
      <Icon size={11} /> {TIPO_SOLICITACAO_PAPELARIA_LABEL[tipo]}
    </span>
  );
}

function formatarMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${m}/${ano}`;
}

// Diferente de responsavel/aprovador (já resolvidos pelo backend pra
// `{id,email,nome}`), o autor de um evento vem cru com `colaborador`
// aninhado — ver comentário em EventoSolicitacaoPapelaria (types.ts).
function nomeAutor(autor: EventoSolicitacaoPapelaria["autor"]): string {
  if (!autor) return "—";
  return autor.colaborador?.nomeCompleto || autor.email;
}

const DESCRICAO_EVENTO_PAPELARIA: Record<string, (detalhe: Record<string, unknown> | null) => string> = {
  CRIACAO: (d) =>
    `Solicitação criada${d?.status ? ` — status inicial "${STATUS_SOLICITACAO_PAPELARIA_LABEL[d.status as StatusSolicitacaoPapelaria] || d.status}"` : ""}`,
  EDICAO: (d) => `Dados atualizados${d?.camposAlterados ? ` (${(d.camposAlterados as string[]).join(", ")})` : ""}`,
  MUDANCA_STATUS: (d) =>
    `Status alterado: ${STATUS_SOLICITACAO_PAPELARIA_LABEL[d?.de as StatusSolicitacaoPapelaria] || d?.de} → ${STATUS_SOLICITACAO_PAPELARIA_LABEL[d?.para as StatusSolicitacaoPapelaria] || d?.para}${d?.motivo ? ` — ${d.motivo}` : ""}`,
};

export function SolicitacoesPapelariaPage({ data, papel, readOnly, podeGerenciar, onChanged, abrirSolicitacaoId }: Props) {
  const { user } = useAuth();
  const { sucesso } = useFeedback();
  const [aba, setAba] = useState<"quadro" | "indicadores">("quadro");
  const [criando, setCriando] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(abrirSolicitacaoId || null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Só ADMINISTRADOR/GESTOR_COORDENADOR podem abrir "em nome de" outra
  // pessoa (RH sempre em nome próprio, mesmo podendo gerenciar depois) — ver
  // comentário equivalente em solicitacoesPapelaria.routes.ts.
  const [gestores, setGestores] = useState<Gestor[]>([]);
  useEffect(() => {
    solicitacoesPapelariaApi.gestores().then(setGestores).catch(() => setGestores([]));
  }, []);

  const podeEscolherResponsavel = papel === "ADMINISTRADOR" || papel === "GESTOR_COORDENADOR";
  // Mesmo filtro já aplicado em Chamados.tsx/Solicitacoes.tsx: "Não
  // identificado" é valor técnico de backfill, não uma opção real.
  const unidadesSelecionaveis = data.dominios.unidades.filter((u) => u.nome !== "Não identificado");

  const [filtros, setFiltros] = useState({
    unidadeId: "", tipo: "", status: "", prioridade: "", criadoPorId: "", numero: "", dataInicio: "", dataFim: "",
  });
  const filtrosVazios = { unidadeId: "", tipo: "", status: "", prioridade: "", criadoPorId: "", numero: "", dataInicio: "", dataFim: "" };
  const filtrosAtivos = Object.values(filtros).some((v) => v !== "");

  // Achado de investigação (22/07/2026) — o filtro de "solicitante" agora usa
  // criadoPorId (quem de fato abriu o pedido), não mais responsavelId (que
  // no caminho "em nome de" é quem foi designado pra cuidar da compra, não
  // quem pediu — ver comentário completo em types.ts/schema.prisma).
  const solicitantesDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    data.solicitacoesPapelaria.forEach((s) => { if (s.criadoPor) map.set(s.criadoPorId, s.criadoPor.nome); });
    return Array.from(map.entries()).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [data.solicitacoesPapelaria]);

  const filtradas = data.solicitacoesPapelaria.filter((s) =>
    (!filtros.unidadeId || s.unidadeId === filtros.unidadeId) &&
    (!filtros.tipo || s.tipo === filtros.tipo) &&
    (!filtros.status || s.status === filtros.status) &&
    (!filtros.prioridade || s.prioridade === filtros.prioridade) &&
    (!filtros.criadoPorId || s.criadoPorId === filtros.criadoPorId) &&
    (!filtros.numero || s.numero === Number(filtros.numero)) &&
    (!filtros.dataInicio || s.dataSolicitacao.slice(0, 10) >= filtros.dataInicio) &&
    (!filtros.dataFim || s.dataSolicitacao.slice(0, 10) <= filtros.dataFim)
  );

  // Validação de transição também no cliente (além do backend, que é a
  // fonte de verdade e recusa com 409 de qualquer forma) — evita um
  // arrastar-soltar no Kanban que sempre ia falhar silenciosamente virar só
  // uma mensagem de erro depois do fato.
  async function mudarStatus(id: string, novoStatus: string) {
    const atual = data.solicitacoesPapelaria.find((s) => s.id === id);
    if (atual && !TRANSICOES_SOLIC_PAPELARIA[atual.status].includes(novoStatus as StatusSolicitacaoPapelaria)) {
      setErro(
        `Não é possível mudar de "${STATUS_SOLICITACAO_PAPELARIA_LABEL[atual.status]}" para "${STATUS_SOLICITACAO_PAPELARIA_LABEL[novoStatus as StatusSolicitacaoPapelaria]}" diretamente.`
      );
      return;
    }
    try {
      await solicitacoesPapelariaApi.mudarStatus(id, novoStatus as StatusSolicitacaoPapelaria);
      await onChanged();
      sucesso(`Status alterado para "${STATUS_SOLICITACAO_PAPELARIA_LABEL[novoStatus as StatusSolicitacaoPapelaria]}".`);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível mudar o status.");
    }
  }

  async function salvar(form: SolicitacaoPapelariaInput) {
    setSalvando(true);
    setErro(null);
    try {
      await solicitacoesPapelariaApi.create(form);
      await onChanged();
      setCriando(false);
      sucesso("Solicitação registrada.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Papelaria e Compras"
        subtitle={
          aba === "quadro"
            ? 'Arraste os cartões entre as colunas para mudar o status (ou toque em um cartão e use "Mudar status")'
            : "Indicadores das remessas de papelaria e material de escritório"
        }
        actions={
          <>
            {/* Mesmo padrão visual de pílula já usado nos filtros de categoria
                da Central de Ajuda (CentralAjuda.tsx) — reaproveitado aqui como
                alternador entre o quadro operacional e os indicadores. */}
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-full p-1">
              <button
                onClick={() => setAba("quadro")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${aba === "quadro" ? "bg-slate-900 text-white" : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
              >
                Quadro
              </button>
              <button
                onClick={() => setAba("indicadores")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${aba === "indicadores" ? "bg-slate-900 text-white" : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
              >
                Indicadores
              </button>
            </div>
            {!readOnly && aba === "quadro" && (
              <Button variant="accent" className="flex-shrink-0" onClick={() => setCriando(true)}>
                <Plus size={16} /> Nova Solicitação
              </Button>
            )}
          </>
        }
      />

      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}

      {aba === "indicadores" ? (
        <IndicadoresPapelaria />
      ) : (
        <>
          {/* Padronização de layout (Fase 2, 14/07/2026, tarefa #152):
              gap-2/mb-3 → gap-3/mb-4, mesmo espaçamento das outras 6 telas
              de listagem com filtro (sem motivo funcional pra ser diferente). */}
          <div className="flex flex-wrap gap-3 mb-4">
            <Select aria-label="Filtrar por unidade" value={filtros.unidadeId} onChange={(e) => setFiltros({ ...filtros, unidadeId: e.target.value })}>
              <option value="">Todas as unidades</option>
              {unidadesSelecionaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </Select>
            <Select aria-label="Filtrar por tipo" value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>
              <option value="">Todos os tipos</option>
              {Object.entries(TIPO_SOLICITACAO_PAPELARIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select aria-label="Filtrar por status" value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
              <option value="">Todos os status</option>
              {SOLIC_PAPELARIA_STATUSES.map((s) => <option key={s} value={s}>{STATUS_SOLICITACAO_PAPELARIA_LABEL[s]}</option>)}
            </Select>
            <Select aria-label="Filtrar por prioridade" value={filtros.prioridade} onChange={(e) => setFiltros({ ...filtros, prioridade: e.target.value })}>
              <option value="">Todas as prioridades</option>
              <option value="ALTA">Alta</option>
              <option value="MEDIA">Média</option>
              <option value="BAIXA">Baixa</option>
            </Select>
            {/* Achado de investigação (22/07/2026, revisa o achado S3 do
                mesmo dia): S3 relabelou este filtro pra "Solicitante" em
                cima de responsavelId, partindo de "responsavelId sempre é
                quem pediu" — verdade só no autoatendimento. No caminho "em
                nome de" (Administrador/Gestor Coordenador delegando a quem
                vai CUIDAR da compra, ex: alguém do Financeiro), responsavelId
                deixa de ser o solicitante. Filtro agora usa criadoPorId —
                sempre o autor real, nunca delegável (ver types.ts/
                schema.prisma). */}
            <Select aria-label="Filtrar por solicitante" value={filtros.criadoPorId} onChange={(e) => setFiltros({ ...filtros, criadoPorId: e.target.value })}>
              <option value="">Todos os solicitantes</option>
              {solicitantesDisponiveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </Select>
            <TextInput aria-label="Filtrar por número" placeholder="Nº" value={filtros.numero} onChange={(e) => setFiltros({ ...filtros, numero: e.target.value })} className="!w-20" />
            <TextInput aria-label="Data inicial" type="date" value={filtros.dataInicio} onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value })} className="!w-36" />
            <TextInput aria-label="Data final" type="date" value={filtros.dataFim} onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value })} className="!w-36" />
            {filtrosAtivos && <Button variant="ghost" onClick={() => setFiltros(filtrosVazios)}>Limpar filtros</Button>}
          </div>

          <KanbanBoard
            items={filtradas}
            columns={SOLIC_PAPELARIA_STATUSES}
            columnLabels={COLUNAS_LABEL}
            statusField="status"
            onStatusChange={mudarStatus}
            // A5 (22/07/2026) — menu "Mover para..." (teclado) restrito às
            // mesmas transições válidas que o arrastar-soltar já respeita
            // (mudarStatus acima recusa qualquer outra com um erro).
            transicoesValidas={(s) => TRANSICOES_SOLIC_PAPELARIA[s.status]}
            renderCard={(s) => (
              <div
                onClick={() => setSelectedId(s.id)}
                {...cardClicavelProps(() => setSelectedId(s.id))}
                className={`bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-2.5 text-xs hover:border-brand-600/50 cursor-pointer ${FOCUS_RING_CLASS}`}
              >
                <div className="flex items-center justify-between mb-1 gap-1">
                  <TipoBadge tipo={s.tipo} />
                  <span className="text-gray-400 dark:text-slate-500 flex-shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>#{s.numero}</span>
                </div>
                <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{s.unidade?.nome || "—"}</p>
                <p className="text-gray-500 dark:text-slate-400 truncate">{s.criadoPor?.nome || "—"}</p>
                {/* Achado de investigação (22/07/2026) — só mostra
                    "Responsável" no cartão quando é diferente de quem pediu
                    (caso "em nome de"): evita repetir o mesmo nome duas
                    vezes no caso comum de autoatendimento. */}
                {s.responsavel && s.responsavelId !== s.criadoPorId && (
                  <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">Resp.: {s.responsavel.nome}</p>
                )}
                <div className="flex items-center justify-between mt-1.5">
                  <Stamp tone={PRIORIDADE_TONE[s.prioridade]}>{PRIORIDADE_LABEL[s.prioridade]}</Stamp>
                  <span className="text-gray-400 dark:text-slate-500">{s._count?.itens ?? 0} item(ns)</span>
                </div>
              </div>
            )}
          />
        </>
      )}

      {selectedId && (
        <SolicitacaoPapelariaDetalhe
          solicitacaoId={selectedId}
          papel={papel}
          podeGerenciar={podeGerenciar}
          data={data}
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
        />
      )}

      {criando && (
        <NovaSolicitacaoPapelariaForm
          data={data}
          usuarioId={user!.id}
          podeEscolherResponsavel={podeEscolherResponsavel}
          gestores={gestores}
          onSave={salvar}
          onClose={() => { setCriando(false); setErro(null); }}
          salvando={salvando}
          erro={erro}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicadores (dashboard do módulo) — consome GET /solicitacoes-papelaria/
// dashboard, mesmo racional das rotas de KPI já usadas em Home.tsx.
// ---------------------------------------------------------------------------
function IndicadoresPapelaria() {
  const [dash, setDash] = useState<DashboardSolicitacoesPapelaria | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setCarregando(true);
    solicitacoesPapelariaApi
      .dashboard()
      .then(setDash)
      .catch((e) => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os indicadores."))
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) return <LoadingState />;
  if (erro || !dash) return <p className="text-sm text-brand-600">{erro || "Sem dados disponíveis."}</p>;

  const porPeriodoFormatado = dash.porPeriodo.map((p) => ({ mesLabel: formatarMes(p.mes), total: p.total }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPICard label="Abertas" value={dash.abertas} icon={ShoppingCart} accent={COLORS.ink} />
        <KPICard label="Concluídas" value={dash.concluidas} icon={CheckCircle2} accent={COLORS.sage} />
        <KPICard label="Urgentes (avulsas em aberto)" value={dash.urgentes} icon={AlertTriangle} accent={COLORS.brass} />
        <KPICard label="Remessas mensais (30 dias)" value={dash.remessasMensaisRealizadas} icon={Repeat} accent={COLORS.amber} />
        <KPICard label="Tempo médio de atendimento" value={fmtDuracao(dash.tempoMedioAtendimentoMs)} icon={ClipboardList} accent={COLORS.ink} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-[var(--radius-card)] border border-gray-100 dark:border-slate-700 p-4 shadow-[var(--elevation-1)]">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3.5">Solicitações por unidade</h4>
          <SimpleBarChart data={dash.porUnidade} labelKey="nome" valueKey="total" color={COLORS.ink} />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-[var(--radius-card)] border border-gray-100 dark:border-slate-700 p-4 shadow-[var(--elevation-1)]">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3.5">Solicitações por período (últimos 6 meses)</h4>
          <SimpleBarChart data={porPeriodoFormatado} labelKey="mesLabel" valueKey="total" color={COLORS.sage} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalhe/timeline — mirror de ChamadoDetalhe.tsx: carrega o registro
// completo (a listagem paginada não traz itens/eventos), mostra dados,
// itens, linha do tempo, comentário e controles de status/edição/exclusão
// gateados por permissão.
// ---------------------------------------------------------------------------
function SolicitacaoPapelariaDetalhe({
  solicitacaoId, papel, podeGerenciar, data, onClose, onChanged,
}: {
  solicitacaoId: string;
  papel: Papel;
  podeGerenciar: boolean;
  data: AppData;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [solic, setSolic] = useState<SolicitacaoPapelaria | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState<"idle" | "confirmando" | "processando">("idle");
  // Reprovar com motivo (achado de auditoria S2, 22/07/2026) — mesmo padrão
  // de "recusando"/"motivo" já usado em DetalheServico (SolicitacoesServico.tsx).
  const [reprovando, setReprovando] = useState(false);
  const [motivoReprovacao, setMotivoReprovacao] = useState("");
  const { sucesso } = useFeedback();

  async function carregar() {
    setCarregando(true);
    try {
      const s = await solicitacoesPapelariaApi.getOne(solicitacaoId);
      setSolic(s);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a solicitação.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitacaoId]);

  async function mudarStatus(status: StatusSolicitacaoPapelaria, motivo?: string) {
    setErro(null);
    try {
      await solicitacoesPapelariaApi.mudarStatus(solicitacaoId, status, motivo);
      await carregar();
      onChanged();
      sucesso(`Status alterado para "${STATUS_SOLICITACAO_PAPELARIA_LABEL[status]}".`);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível mudar o status.");
    }
  }

  // Onda 2.3 (21/07/2026) — caixa de texto/botão de enviar/estado "enviando"
  // agora são internos ao <TimelineEventos> (ver componente, extraído nesta
  // mesma onda a partir do que era quase idêntico aqui e em
  // ChamadoDetalhe.tsx); esta função só cuida do que é específico de
  // Papelaria. Precisa RELANÇAR o erro (`throw`) — é assim que o componente
  // genérico sabe que deu errado e preserva o texto digitado.
  async function enviarComentario(texto: string) {
    setErro(null);
    try {
      await solicitacoesPapelariaApi.comentar(solicitacaoId, texto);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar o comentário.");
      throw e;
    }
  }

  async function salvarEdicao(campos: SolicitacaoPapelariaUpdateInput) {
    setErro(null);
    try {
      await solicitacoesPapelariaApi.update(solicitacaoId, campos);
      await carregar();
      onChanged();
      setEditando(false);
      sucesso("Solicitação atualizada.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar — a solicitação pode já ter avançado de status.");
    }
  }

  async function excluirSolicitacao() {
    setExcluindo("processando");
    setErro(null);
    try {
      await solicitacoesPapelariaApi.remove(solicitacaoId);
      onChanged();
      sucesso("Solicitação excluída.");
      onClose();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
      setExcluindo("idle");
    }
  }

  async function excluirEvento(eventoId: string) {
    setErro(null);
    try {
      await solicitacoesPapelariaApi.removerEvento(solicitacaoId, eventoId);
      await carregar();
      sucesso("Registro removido.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir o evento.");
    }
  }

  if (carregando || !solic) {
    return (
      <Modal title="Solicitação" onClose={onClose}>
        <LoadingState />
      </Modal>
    );
  }

  // Só é permitido editar em Rascunho/Enviada (o backend recusa com 409 fora
  // disso — ver comentário em SolicitacaoPapelariaUpdateInput/update()).
  const podeEditar = podeGerenciar && (solic.status === "RASCUNHO" || solic.status === "ENVIADA");
  const transicoes = TRANSICOES_SOLIC_PAPELARIA[solic.status];
  const transicoesDecisao = transicoes.filter((t) => STATUS_PAPELARIA_DECISAO.includes(t));
  const transicoesGerais = transicoes.filter((t) => !STATUS_PAPELARIA_DECISAO.includes(t));

  return (
    <Modal title={`Solicitação #${solic.numero}`} onClose={onClose} wide>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          {editando ? (
            <EdicaoSolicitacaoForm solic={solic} data={data} onSave={salvarEdicao} onCancel={() => setEditando(false)} />
          ) : (
            <>
              <div className="space-y-2 text-sm mb-3">
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Tipo</span><br /><TipoBadge tipo={solic.tipo} /></div>
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Unidade</span><br />{solic.unidade?.nome || "—"}</div>
                {/* Achado de investigação (22/07/2026, revisa o S3 do mesmo
                    dia) — "Solicitante" agora é criadoPor (quem de fato
                    abriu o pedido), sempre presente. "Responsável" só
                    aparece quando é outra pessoa (caso "em nome de" —
                    Administrador/Gestor Coordenador delegando a quem vai
                    cuidar da compra, ex: alguém do Financeiro). Ver
                    comentário completo em types.ts/schema.prisma. */}
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Solicitante</span><br />{solic.criadoPor?.nome || "—"}</div>
                {solic.responsavel && solic.responsavelId !== solic.criadoPorId && (
                  <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Responsável pela compra</span><br />{solic.responsavel.nome}</div>
                )}
                {solic.aprovador && (
                  <div>
                    <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">{solic.status === "REPROVADA" ? "Reprovado por" : "Aprovado por"}</span><br />
                    {solic.aprovador.nome}
                  </div>
                )}
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Prioridade</span><br /><Stamp tone={PRIORIDADE_TONE[solic.prioridade]}>{PRIORIDADE_LABEL[solic.prioridade]}</Stamp></div>
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Status</span><br /><Stamp tone={STATUS_SOLICITACAO_PAPELARIA_TONE[solic.status]}>{STATUS_SOLICITACAO_PAPELARIA_LABEL[solic.status]}</Stamp></div>
                {solic.justificativa && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Justificativa</span><br />{solic.justificativa}</div>}
                {solic.observacoes && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Observações</span><br />{solic.observacoes}</div>}
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Aberta em</span><br />{fmtDataHora(solic.dataSolicitacao)}</div>
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Tempo de atendimento</span><br />{fmtDuracao(solic.tempoAtendimentoMs)}</div>
              </div>

              <div className="mb-3">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Itens ({(solic.itens || []).length})</span>
                <div className="mt-1.5 space-y-1.5 max-h-48 overflow-y-auto">
                  {(solic.itens || []).map((it) => (
                    <div key={it.id} className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800 truncate">{it.nomeProduto}</span>
                        <span className="text-gray-500 dark:text-slate-400 flex-shrink-0">{it.quantidade} {UNIDADE_MEDIDA_PRODUTO_LABEL[it.unidadeMedida]}</span>
                      </div>
                      <p className="text-gray-400 dark:text-slate-500">{it.categoria?.nome || "—"}</p>
                      {it.observacoes && <p className="text-gray-500 dark:text-slate-400 italic mt-0.5">{it.observacoes}</p>}
                    </div>
                  ))}
                  {(solic.itens || []).length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum item.</p>}
                </div>
              </div>
            </>
          )}

          {podeGerenciar && !editando && (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              {transicoesDecisao.length > 0 && !reprovando && (
                <div className="flex flex-wrap gap-2">
                  {transicoesDecisao.includes("APROVADA") && (
                    <Button variant="accent" onClick={() => mudarStatus("APROVADA")}><CheckCircle2 size={14} /> Aprovar</Button>
                  )}
                  {transicoesDecisao.includes("REPROVADA") && (
                    <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => setReprovando(true)}>Reprovar</Button>
                  )}
                </div>
              )}
              {/* Motivo da reprovação (achado de auditoria S2, 22/07/2026) —
                  mesmo padrão de "recusando" em DetalheServico
                  (SolicitacoesServico.tsx): campo obrigatório antes de
                  confirmar, botão só habilita com pelo menos 3 caracteres. */}
              {reprovando && (
                <div className="bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3">
                  <Field label="Motivo da reprovação">
                    <TextArea value={motivoReprovacao} onChange={(e) => setMotivoReprovacao(e.target.value)} />
                  </Field>
                  <div className="flex justify-end gap-2 mt-2">
                    <Button variant="ghost" onClick={() => { setReprovando(false); setMotivoReprovacao(""); }}>Cancelar</Button>
                    <Button
                      variant="danger"
                      disabled={motivoReprovacao.trim().length < 3}
                      onClick={() => {
                        mudarStatus("REPROVADA", motivoReprovacao.trim());
                        setReprovando(false);
                        setMotivoReprovacao("");
                      }}
                    >
                      Confirmar reprovação
                    </Button>
                  </div>
                </div>
              )}
              {transicoesGerais.length > 0 && !reprovando && (
                <Field label="Mudar status">
                  <Select value="" onChange={(e) => { if (e.target.value) mudarStatus(e.target.value as StatusSolicitacaoPapelaria); }}>
                    <option value="">Selecione...</option>
                    {transicoesGerais.map((s) => <option key={s} value={s}>{STATUS_SOLICITACAO_PAPELARIA_LABEL[s]}</option>)}
                  </Select>
                </Field>
              )}
              {transicoes.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Status final — não há mais transições possíveis.</p>}
              {podeEditar ? (
                <Button variant="ghost" onClick={() => setEditando(true)}>Editar dados da solicitação</Button>
              ) : (
                <p className="text-xs text-gray-400 dark:text-slate-500">Edição bloqueada — só é possível em Rascunho ou logo após Enviada (antes de entrar em análise).</p>
              )}
            </div>
          )}

          {papel === "ADMINISTRADOR" && !editando && (
            <div className="border-t border-gray-100 pt-3 mt-2">
              {excluindo === "confirmando" ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-brand-700 dark:text-brand-400">Excluir a solicitação inteira, sem desfazer?</span>
                  <Button variant="ghost" onClick={() => setExcluindo("idle")}>Cancelar</Button>
                  <Button variant="danger" onClick={excluirSolicitacao} disabled={excluindo !== "confirmando"}>Confirmar exclusão</Button>
                </div>
              ) : (
                <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => setExcluindo("confirmando")}>
                  Excluir solicitação
                </Button>
              )}
            </div>
          )}
        </div>

        <TimelineEventos
          titulo="Histórico e comentários"
          eventos={solic.eventos || []}
          containerClassName="flex flex-col border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] overflow-hidden"
          variante={(ev) => (ev.tipo === "COMENTARIO" ? "mensagem" : "sistema")}
          descricaoEvento={DESCRICAO_EVENTO_PAPELARIA}
          autorLabel={(autor) => nomeAutor(autor as EventoSolicitacaoPapelaria["autor"])}
          autorNaLinhaSistema
          podeExcluirEvento={() => papel === "ADMINISTRADOR"}
          onExcluirEvento={excluirEvento}
          tituloExcluir="Excluir (correção de engano)"
          podeComentar={podeGerenciar}
          placeholderComentario="Escrever comentário..."
          onEnviarComentario={enviarComentario}
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Editor de itens — linha reutilizável tanto na criação quanto na edição.
// Fluxo: escolhe a categoria (sempre obrigatória) → escolhe um produto já
// cadastrado naquela categoria OU "Outro/não cadastrado" (revela um campo de
// texto livre pro nome do item). Combo catálogo+fallback extraído (achado de
// checkup S7, 22/07/2026) em <SeletorComOpcaoOutro>, reaproveitado também
// pelo equivalente de Equipamento (Solicitacoes.tsx) — ver comentário no
// componente.
// ---------------------------------------------------------------------------

interface ItemRow {
  key: string;
  produtoId: string; // "" = nada escolhido; SENTINELA_OUTRO = item avulso
  categoriaId: string;
  nomeProduto: string;
  quantidade: number;
  unidadeMedida: UnidadeMedidaProduto;
  observacoes: string;
}

function novoItemRow(): ItemRow {
  return { key: uid("item"), produtoId: "", categoriaId: "", nomeProduto: "", quantidade: 1, unidadeMedida: "UNIDADE", observacoes: "" };
}

function itemValido(item: ItemRow): boolean {
  if (!item.categoriaId || !item.quantidade || item.quantidade < 1) return false;
  if (item.produtoId && item.produtoId !== SENTINELA_OUTRO) return true;
  return item.nomeProduto.trim().length > 0;
}

function itemRowParaInput(item: ItemRow): ItemSolicitacaoPapelariaInput {
  const usaCatalogo = !!item.produtoId && item.produtoId !== SENTINELA_OUTRO;
  return {
    produtoId: usaCatalogo ? item.produtoId : null,
    nomeProduto: usaCatalogo ? undefined : item.nomeProduto.trim(),
    categoriaId: item.categoriaId,
    quantidade: item.quantidade,
    unidadeMedida: item.unidadeMedida,
    observacoes: item.observacoes.trim() || null,
  };
}

function itemDaApiParaRow(it: ItemSolicitacaoPapelaria): ItemRow {
  return {
    key: uid("item"),
    produtoId: it.produtoId || "",
    categoriaId: it.categoriaId,
    nomeProduto: it.produtoId ? "" : it.nomeProduto,
    quantidade: it.quantidade,
    unidadeMedida: it.unidadeMedida,
    observacoes: it.observacoes || "",
  };
}

function ItemRowEditor({
  item, categorias, produtos, onChange, onRemove, podeRemover,
}: {
  item: ItemRow;
  categorias: CategoriaProdutoPapelaria[];
  produtos: ProdutoPapelaria[];
  onChange: (item: ItemRow) => void;
  onRemove: () => void;
  podeRemover: boolean;
}) {
  const produtosDaCategoria = produtos.filter((p) => p.categoriaId === item.categoriaId && p.status === "ATIVO");

  return (
    <div className="bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-3 mb-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Categoria">
          <Select
            value={item.categoriaId}
            onChange={(e) => onChange({ ...item, categoriaId: e.target.value, produtoId: "", nomeProduto: "" })}
          >
            <option value="">—</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </Field>
        <SeletorComOpcaoOutro
          label="Produto"
          value={item.produtoId}
          disabled={!item.categoriaId}
          opcoes={produtosDaCategoria.map((p) => ({ id: p.id, nome: p.nome }))}
          onChange={(val) => {
            if (val === SENTINELA_OUTRO) {
              onChange({ ...item, produtoId: SENTINELA_OUTRO, nomeProduto: "" });
              return;
            }
            const produto = produtos.find((p) => p.id === val);
            onChange({ ...item, produtoId: val, nomeProduto: "", unidadeMedida: produto?.unidadeMedidaPadrao || item.unidadeMedida });
          }}
          valorLivre={item.nomeProduto}
          onChangeValorLivre={(v) => onChange({ ...item, nomeProduto: v })}
          placeholderCampoLivre="Ex: Grampeador médio"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantidade">
          <TextInput type="number" min="1" value={item.quantidade} onChange={(e) => onChange({ ...item, quantidade: Number(e.target.value) })} />
        </Field>
        <Field label="Unidade de medida">
          <Select value={item.unidadeMedida} onChange={(e) => onChange({ ...item, unidadeMedida: e.target.value as UnidadeMedidaProduto })}>
            {Object.entries(UNIDADE_MEDIDA_PRODUTO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Observações do item (opcional)">
        <TextInput value={item.observacoes} onChange={(e) => onChange({ ...item, observacoes: e.target.value })} />
      </Field>
      {podeRemover && (
        <button className="text-xs text-brand-600 hover:underline flex items-center gap-1" onClick={onRemove}>
          <Trash2 size={12} /> Remover item
        </button>
      )}
    </div>
  );
}

// Cartão de seleção grande pra MENSAL/AVULSA — pedido explícito de
// distinção visual, uma seleção simples de <select> não bastaria.
function TipoToggleCard({ tipo, ativo, onClick }: { tipo: TipoSolicitacaoPapelaria; ativo: boolean; onClick: () => void }) {
  const avulsa = tipo === "AVULSA";
  const cor = avulsa ? COLORS.brass : COLORS.sage;
  const Icon = avulsa ? AlertTriangle : Repeat;
  const descricao = avulsa
    ? "Pedido urgente, fora do ciclo normal — exige justificativa."
    : "Remessa programada, dentro do ciclo normal de reposição.";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-[var(--radius-card)] border-2 p-3 transition-colors ${FOCUS_RING_CLASS}`}
      style={{ borderColor: ativo ? cor : COLORS.border, background: ativo ? cor + "0d" : "white" }}
    >
      <div className="flex items-center gap-1.5 font-bold text-sm mb-1" style={{ color: ativo ? cor : COLORS.ink }}>
        <Icon size={15} /> {TIPO_SOLICITACAO_PAPELARIA_LABEL[tipo]}
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400">{descricao}</p>
    </button>
  );
}

function NovaSolicitacaoPapelariaForm({
  data, usuarioId, podeEscolherResponsavel, gestores, onSave, onClose, salvando, erro,
}: {
  data: AppData;
  usuarioId: string;
  podeEscolherResponsavel: boolean;
  gestores: Gestor[];
  onSave: (form: SolicitacaoPapelariaInput) => void;
  onClose: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const unidadesSelecionaveis = data.dominios.unidades.filter((u) => u.nome !== "Não identificado");
  const categoriasAtivas = data.dominios.categoriasProdutoPapelaria.filter((c) => c.status === "ATIVO");

  const [unidadeId, setUnidadeId] = useState("");
  const [tipo, setTipo] = useState<TipoSolicitacaoPapelaria>("MENSAL");
  const [responsavelId, setResponsavelId] = useState(usuarioId);
  const [prioridade, setPrioridade] = useState<Prioridade>("MEDIA");
  const [justificativa, setJustificativa] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [itens, setItens] = useState<ItemRow[]>([novoItemRow()]);

  const justificativaObrigatoria = tipo === "AVULSA";
  const faltaObrigatorio =
    !unidadeId || !responsavelId || itens.length === 0 || itens.some((i) => !itemValido(i)) ||
    (justificativaObrigatoria && !justificativa.trim());

  function submeter(enviarAgora: boolean) {
    onSave({
      unidadeId,
      responsavelId: responsavelId !== usuarioId ? responsavelId : undefined,
      tipo,
      prioridade,
      justificativa: justificativa.trim() || null,
      observacoes: observacoes.trim() || null,
      itens: itens.map(itemRowParaInput),
      enviarAgora,
    });
  }

  return (
    <Modal title="Nova Solicitação de Papelaria" onClose={onClose} wide>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}

      <Field label="Tipo de remessa">
        <div className="grid grid-cols-2 gap-2">
          <TipoToggleCard tipo="MENSAL" ativo={tipo === "MENSAL"} onClick={() => setTipo("MENSAL")} />
          <TipoToggleCard tipo="AVULSA" ativo={tipo === "AVULSA"} onClick={() => setTipo("AVULSA")} />
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Unidade">
          <Select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">—</option>
            {unidadesSelecionaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Field>
        <Field label="Prioridade">
          <Select value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade)}>
            <option value="ALTA">Alta</option>
            <option value="MEDIA">Média</option>
            <option value="BAIXA">Baixa</option>
          </Select>
        </Field>
      </div>

      {/* Achado de investigação (22/07/2026, revisa o achado S3 do mesmo
          dia) — S3 tinha relabelado este campo pra "Solicitante", mas
          escolher outra pessoa aqui nunca mudou quem está pedindo (isso é
          sempre quem está logado preenchendo este formulário, agora
          gravado automaticamente em criadoPorId, sem precisar de campo
          nenhum) — muda quem vai CUIDAR da solicitação/compra a partir
          daqui. Rótulo corrigido de volta, com o sentido certo desta vez:
          "Responsável pela compra", nunca "Solicitante". */}
      <Field label="Responsável pela compra">
        {podeEscolherResponsavel ? (
          <>
            <Select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
              {!gestores.some((g) => g.id === usuarioId) && <option value={usuarioId}>Você</option>}
              {gestores.map((g) => <option key={g.id} value={g.id}>{g.id === usuarioId ? `${g.nome} (você)` : g.nome}</option>)}
            </Select>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">Quem vai cuidar desta solicitação — você continua registrado(a) como quem pediu.</p>
          </>
        ) : (
          // RH sempre abre em nome próprio (regra confirmada com o Vini) —
          // campo visível, mas travado, pra não sugerir que dá pra escolher.
          <TextInput value="Você" disabled />
        )}
      </Field>

      <div className={justificativaObrigatoria ? "bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-800 rounded-[var(--radius-control)] p-2.5 mb-3.5" : ""}>
        <Field label={justificativaObrigatoria ? "Justificativa (obrigatória para remessa avulsa)" : "Justificativa (opcional)"}>
          <TextArea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
        </Field>
      </div>

      <Field label="Observações (opcional)">
        <TextArea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </Field>

      <div className="mb-2 flex items-center justify-between">
        <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Itens da remessa</span>
        <Button variant="ghost" onClick={() => setItens((a) => [...a, novoItemRow()])}><Plus size={14} /> Adicionar item</Button>
      </div>
      {itens.map((item) => (
        <ItemRowEditor
          key={item.key}
          item={item}
          categorias={categoriasAtivas}
          produtos={data.dominios.produtosPapelaria}
          onChange={(novo) => setItens((a) => a.map((i) => (i.key === item.key ? novo : i)))}
          onRemove={() => setItens((a) => a.filter((i) => i.key !== item.key))}
          podeRemover={itens.length > 1}
        />
      ))}

      <div className="flex flex-wrap justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="ghost" disabled={faltaObrigatorio || salvando} onClick={() => submeter(false)}>
          {salvando ? "Salvando..." : "Salvar rascunho"}
        </Button>
        <Button variant="primary" disabled={faltaObrigatorio || salvando} onClick={() => submeter(true)}>
          {salvando ? "Enviando..." : "Enviar"}
        </Button>
      </div>
    </Modal>
  );
}

function EdicaoSolicitacaoForm({
  solic, data, onSave, onCancel,
}: {
  solic: SolicitacaoPapelaria;
  data: AppData;
  onSave: (campos: SolicitacaoPapelariaUpdateInput) => void;
  onCancel: () => void;
}) {
  const unidadesSelecionaveis = data.dominios.unidades.filter((u) => u.nome !== "Não identificado");
  const categoriasAtivas = data.dominios.categoriasProdutoPapelaria.filter((c) => c.status === "ATIVO");

  const [unidadeId, setUnidadeId] = useState(solic.unidadeId);
  const [tipo, setTipo] = useState<TipoSolicitacaoPapelaria>(solic.tipo);
  const [prioridade, setPrioridade] = useState<Prioridade>(solic.prioridade);
  const [justificativa, setJustificativa] = useState(solic.justificativa || "");
  const [observacoes, setObservacoes] = useState(solic.observacoes || "");
  const [itens, setItens] = useState<ItemRow[]>(() => (solic.itens || []).map(itemDaApiParaRow));

  const justificativaObrigatoria = tipo === "AVULSA";
  const faltaObrigatorio =
    !unidadeId || itens.length === 0 || itens.some((i) => !itemValido(i)) || (justificativaObrigatoria && !justificativa.trim());

  return (
    <div>
      <Field label="Tipo de remessa">
        <div className="grid grid-cols-2 gap-2">
          <TipoToggleCard tipo="MENSAL" ativo={tipo === "MENSAL"} onClick={() => setTipo("MENSAL")} />
          <TipoToggleCard tipo="AVULSA" ativo={tipo === "AVULSA"} onClick={() => setTipo("AVULSA")} />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unidade">
          <Select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            {unidadesSelecionaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Field>
        <Field label="Prioridade">
          <Select value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade)}>
            <option value="ALTA">Alta</option>
            <option value="MEDIA">Média</option>
            <option value="BAIXA">Baixa</option>
          </Select>
        </Field>
      </div>
      <div className={justificativaObrigatoria ? "bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-800 rounded-[var(--radius-control)] p-2.5 mb-3.5" : ""}>
        <Field label={justificativaObrigatoria ? "Justificativa (obrigatória para remessa avulsa)" : "Justificativa (opcional)"}>
          <TextArea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
        </Field>
      </div>
      <Field label="Observações (opcional)">
        <TextArea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </Field>
      <div className="mb-2 flex items-center justify-between">
        <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Itens da remessa</span>
        <Button variant="ghost" onClick={() => setItens((a) => [...a, novoItemRow()])}><Plus size={14} /> Adicionar item</Button>
      </div>
      {itens.map((item) => (
        <ItemRowEditor
          key={item.key}
          item={item}
          categorias={categoriasAtivas}
          produtos={data.dominios.produtosPapelaria}
          onChange={(novo) => setItens((a) => a.map((i) => (i.key === item.key ? novo : i)))}
          onRemove={() => setItens((a) => a.filter((i) => i.key !== item.key))}
          podeRemover={itens.length > 1}
        />
      ))}
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button
          variant="primary"
          disabled={faltaObrigatorio}
          onClick={() => onSave({
            unidadeId, tipo, prioridade,
            justificativa: justificativa.trim() || null,
            observacoes: observacoes.trim() || null,
            itens: itens.map(itemRowParaInput),
          })}
        >
          Salvar
        </Button>
      </div>
    </div>
  );
}
