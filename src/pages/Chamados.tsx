import React, { useEffect, useMemo, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { chamadosApi, ChamadoInput, Tecnico } from "../api/chamados";
import { ApiError } from "../lib/apiClient";
import { abrirChamadoComSuporteOffline } from "../offline/abrirChamado";
import { useChamadosPendentes } from "../offline/useConexao";
import { Button, cardClicavelProps, COLORS, Field, FOCUS_RING_CLASS, KanbanBoard, Modal, PageHeader, Select, Stamp, TextArea, TextInput } from "../components/ui";
import { SeletorAnexos } from "../components/SeletorAnexos";
import { Plus } from "../components/icons";
import { ChamadoDetalhe, fmtDuracao } from "../components/ChamadoDetalhe";
import {
  CATEGORIA_CHAMADO_LABEL, CATEGORIAS_CHAMADO_CRIAVEIS, CategoriaChamado, ChamadoStats,
  CHAM_STATUSES, colaboradorOperacionalmenteAtivo, Papel, PRIORIDADE_LABEL, PRIORIDADE_TONE, Prioridade, rotuloEquipamento, STATUS_CHAMADO_LABEL, StatusChamado,
  TIPO_SOLICITACAO_IMOVIEW_LABEL, TIPOS_SOLICITACAO_IMOVIEW, TipoSolicitacaoImoview,
} from "../types";
import { useFeedback } from "../contexts/FeedbackContext";

interface Props {
  data: AppData;
  papel: Papel;
  readOnly: boolean;
  onChanged: () => void;
  // Semente vinda do dashboard (Fase 4 — Dashboard interativo, 06/07/2026) —
  // clicar num chamado urgente específico na Home já abre o painel dele
  // direto aqui, em vez de só cair no Kanban geral e a pessoa procurar de novo.
  abrirChamadoId?: string;
  // Atalho rápido do Dashboard (Fase 3, 14/07/2026) — mesmo mecanismo de
  // abrirChamadoId acima, abrindo direto o formulário de novo chamado.
  abrirNovo?: boolean;
}

const COLUNAS_LABEL = Object.fromEntries(CHAM_STATUSES.map((s) => [s, STATUS_CHAMADO_LABEL[s]]));

// Achado A2 do checkup de sistema (22/07/2026, "escalabilidade mais urgente
// do check-up") — o Kanban carregava TODO o histórico de chamados da
// empresa sempre, sem limite. A versão "certa" (paginação de servidor) exige
// trocar `chamadosApi.listAll()` (hoje via `fetchAllPages`, cache global em
// useAppData.ts, compartilhado com Home/Dashboard/Portal do Colaborador) por
// busca sob demanda só desta tela — mudança de arquitetura de dados maior
// que o resto deste ciclo. Implementada aqui a versão SIMPLIFICADA aceita
// pelo checkup: filtro de período client-side, com "últimos 60 dias" como
// padrão (chamados ainda ATIVOS continuam visíveis mesmo mais antigos — só
// RESOLVIDO/ENCERRADO somem do padrão depois da janela), e um botão "Ver
// histórico completo" que remove o filtro. Documentado no relatório final
// desta rodada.
const STATUS_TERMINAIS_CHAMADO: StatusChamado[] = ["RESOLVIDO", "ENCERRADO"];
const JANELA_PADRAO_DIAS = 60;

// Dashboard de indicadores de suporte (Fase 2 — Melhorias Estruturais,
// 09/07/2026) — só pra quem gerencia Chamados (ADMINISTRADOR/SUPORTE_TI,
// mesma dupla de sempre neste módulo). Recolhido por padrão pra não
// empurrar o Kanban pra baixo em quem só quer ver os cartões; expande sob
// demanda. Refaz a busca sempre que `chamados` muda de referência — o
// AppData troca o array inteiro a cada refetch (ver useAppData.ts), então
// isto cobre qualquer ação que altera um chamado (status, reabertura,
// avaliação) sem precisar de um contador manual.
function ChamadosDashboard({ chamados }: { chamados: AppData["chamados"] }) {
  const [aberto, setAberto] = useState(false);
  const [stats, setStats] = useState<ChamadoStats | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setCarregando(true);
    chamadosApi.stats().then(setStats).catch(() => setStats(null)).finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, chamados]);

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] mb-4 overflow-hidden">
      <button
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800"
      >
        <span>Indicadores de Suporte</span>
        <span className="text-gray-400 dark:text-slate-500 text-xs">{aberto ? "Recolher ▲" : "Expandir ▼"}</span>
      </button>
      {aberto && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          {carregando && <p className="text-xs text-gray-400 dark:text-slate-500">Carregando indicadores...</p>}
          {!carregando && stats && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="Total de chamados" valor={String(stats.totalChamados)} />
                <KpiCard
                  label="Atrasados (SLA)"
                  valor={String(stats.chamadosAtrasados)}
                  destaque={stats.chamadosAtrasados > 0}
                />
                <KpiCard label="Tempo médio de resolução" valor={fmtDuracao(stats.tempoMedioResolucaoMs)} />
                <KpiCard label="Taxa de reabertura" valor={`${stats.taxaReaberturaPct}%`} destaque={stats.taxaReaberturaPct > 15} />
                <KpiCard
                  label="Nota média (avaliação)"
                  valor={stats.avaliacao.media !== null ? `${stats.avaliacao.media.toFixed(1)} / 5` : "—"}
                />
                <KpiCard label="Avaliações recebidas" valor={String(stats.avaliacao.totalAvaliados)} />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs uppercase text-gray-500 dark:text-slate-400 font-semibold mb-1.5">Por categoria</p>
                  <div className="space-y-1">
                    {Object.entries(stats.porCategoria)
                      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                      .map(([categoria, total]) => (
                        <div key={categoria} className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">{CATEGORIA_CHAMADO_LABEL[categoria as CategoriaChamado]}</span>
                          <span className="font-semibold text-slate-800">{total}</span>
                        </div>
                      ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase text-gray-500 dark:text-slate-400 font-semibold mb-1.5">Por técnico</p>
                  <div className="space-y-1">
                    {stats.porTecnico.map((t) => (
                      <div key={t.responsavelId} className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">{t.nome}</span>
                        <span className="text-gray-500 dark:text-slate-400">
                          {t.total} chamado{t.total !== 1 ? "s" : ""}
                          {t.tempoMedioResolucaoMs !== null && ` · ${fmtDuracao(t.tempoMedioResolucaoMs)} em média`}
                        </span>
                      </div>
                    ))}
                    {stats.porTecnico.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Sem dados ainda.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}
          {!carregando && !stats && <p className="text-xs text-gray-400 dark:text-slate-500">Não foi possível carregar os indicadores.</p>}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${destaque ? "border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-500/15" : "border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800"}`}>
      <p className={`text-lg font-bold ${destaque ? "text-brand-700 dark:text-brand-400" : "text-slate-900 dark:text-slate-100"}`}>{valor}</p>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight mt-0.5">{label}</p>
    </div>
  );
}

export function ChamadosPage({ data, papel, readOnly, onChanged, abrirChamadoId, abrirNovo }: Props) {
  const { sucesso } = useFeedback();
  const [editing, setEditing] = useState(() => !!abrirNovo && !readOnly);
  const [selectedId, setSelectedId] = useState<string | null>(abrirChamadoId || null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Local (unidade) e técnico responsável obrigatórios desde 07/07/2026 —
  // mesma mudança feita no formulário de autoatendimento (PortalColaborador).
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  useEffect(() => {
    chamadosApi.tecnicos().then(setTecnicos).catch(() => setTecnicos([]));
  }, []);
  // Filtros (achado S8 do checkup, 22/07/2026 — "Filtros muito desiguais
  // entre os 4 Kanbans de Solicitações": esta tela tinha só 1, unidade).
  // Conjunto mínimo comum com os outros 3 Kanbans: busca livre, status,
  // unidade, período — mesmo padrão de UI de SolicitacoesPapelaria.tsx,
  // tudo client-side sobre `data.chamados` já carregado.
  const [filtros, setFiltros] = useState({ busca: "", status: "", unidadeId: "", dataInicio: "", dataFim: "" });
  const filtrosVazios = { busca: "", status: "", unidadeId: "", dataInicio: "", dataFim: "" };
  const filtrosAtivos = Object.values(filtros).some((v) => v !== "");
  // A2 — "Ver histórico completo" desliga o recorte padrão de ativos+60
  // dias (ver STATUS_TERMINAIS_CHAMADO/JANELA_PADRAO_DIAS acima).
  const [verHistoricoCompleto, setVerHistoricoCompleto] = useState(false);

  const podeGerenciar = papel === "ADMINISTRADOR" || papel === "SUPORTE_TI";

  // A2 — escopo padrão: chamados ainda ATIVOS (qualquer idade) + chamados
  // terminais (RESOLVIDO/ENCERRADO) abertos nos últimos 60 dias. Recalcula
  // só quando a lista ou o toggle mudam, não a cada render.
  const escopoPadrao = useMemo(() => {
    if (verHistoricoCompleto) return data.chamados;
    const limite = Date.now() - JANELA_PADRAO_DIAS * 24 * 60 * 60 * 1000;
    return data.chamados.filter(
      (c) => !STATUS_TERMINAIS_CHAMADO.includes(c.status) || new Date(c.dataAbertura).getTime() >= limite
    );
  }, [data.chamados, verHistoricoCompleto]);
  const ocultosPelaJanela = data.chamados.length - escopoPadrao.length;

  const chamadosFiltrados = escopoPadrao.filter((c) => {
    const buscaAlvo = `${c.descricao} ${c.solicitante?.nomeCompleto || ""} ${CATEGORIA_CHAMADO_LABEL[c.categoria]}`.toLowerCase();
    return (
      (!filtros.busca || buscaAlvo.includes(filtros.busca.toLowerCase())) &&
      (!filtros.status || c.status === filtros.status) &&
      (!filtros.unidadeId || c.unidadeId === filtros.unidadeId) &&
      (!filtros.dataInicio || c.dataAbertura.slice(0, 10) >= filtros.dataInicio) &&
      (!filtros.dataFim || c.dataAbertura.slice(0, 10) <= filtros.dataFim)
    );
  });
  // Achado do Vini (07/07/2026): "Não identificado" é um valor técnico usado
  // só pelo backfill da migration (colaborador sem unidade cadastrada) —
  // ninguém deveria escolher isso de propósito ao abrir um chamado. Fica de
  // fora do seletor; as cidades reais + Remoto + Outra continuam.
  const unidadesSelecionaveis = data.dominios.unidades.filter((u) => u.nome !== "Não identificado");

  // S6 (achado do checkup, 22/07/2026) — mudar status pelo Kanban é 1 ação
  // sem confirmação nem desfazer, inconsistente com outras ações de risco do
  // sistema. Solução escolhida: NÃO bloquear com confirmação (pioraria
  // mudanças corriqueiras) — toast de sucesso ganha um botão "Desfazer"
  // temporário (~7s, ver FeedbackContext.tsx) que reaplica o status
  // anterior. Undo é só "chamar a mesma rota de novo com o valor de antes"
  // — não existe endpoint de desfazer dedicado.
  async function mudarStatus(id: string, novoStatus: string) {
    if (!podeGerenciar) return;
    const statusAnterior = data.chamados.find((c) => c.id === id)?.status;
    try {
      await chamadosApi.mudarStatus(id, novoStatus as StatusChamado);
      await onChanged();
      sucesso(
        `Status alterado para "${STATUS_CHAMADO_LABEL[novoStatus as StatusChamado]}".`,
        statusAnterior && statusAnterior !== novoStatus
          ? {
              label: "Desfazer",
              onClick: async () => {
                try {
                  await chamadosApi.mudarStatus(id, statusAnterior);
                  await onChanged();
                } catch {
                  setErro("Não foi possível desfazer a mudança de status.");
                }
              },
            }
          : undefined
      );
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível mudar o status.");
    }
  }

  const chamadosPendentes = useChamadosPendentes();

  async function salvar(form: ChamadoInput, arquivos: File[]) {
    setSalvando(true);
    setErro(null);
    try {
      const resultado = await abrirChamadoComSuporteOffline(form, arquivos);
      if (resultado.modo === "enviado") {
        await onChanged();
        sucesso("Chamado aberto com sucesso.");
      } else {
        sucesso("Chamado salvo — será enviado quando a conexão voltar.");
      }
      setEditing(false);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Chamados de Manutenção"
        subtitle={
          // Achado de auditoria (06/07/2026): a dica só mencionava arrastar
          // — no celular, onde arrastar entre colunas é difícil de acertar,
          // não havia menção de que dá pra abrir o cartão e usar o campo
          // "Mudar status" no modal como alternativa.
          podeGerenciar
            ? 'Arraste os cartões entre as colunas para mudar o status (ou toque em um cartão e use "Mudar status")'
            : `${chamadosFiltrados.length} chamados`
        }
        actions={
          !readOnly && (
            <Button variant="accent" onClick={() => setEditing(true)}>
              <Plus size={16} /> Novo Chamado
            </Button>
          )
        }
      />

      {/* Padronização de layout (Fase 2 — Estrutura e Navegação, 14/07/2026,
          tarefa #152): filtro morava dentro de `actions` do PageHeader, ao
          lado do botão de ação primária — único lugar do sistema com esse
          arranjo (as outras 6 telas de listagem com filtro colocam o Select
          numa faixa própria abaixo do cabeçalho). Movido pra cá por
          consistência; Solicitacoes.tsx tinha o mesmo padrão, corrigido
          junto.
          S8 (22/07/2026) — só tinha unidade; ganhou busca/status/período pra
          alcançar o mínimo comum dos 4 Kanbans de Solicitações. */}
      <div className="flex flex-wrap gap-3 mb-4">
        <TextInput
          aria-label="Buscar por descrição, solicitante ou categoria"
          placeholder="Buscar por descrição, solicitante ou categoria..."
          value={filtros.busca}
          onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
          className="!w-64"
        />
        <Select aria-label="Filtrar por status" value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
          <option value="">Todos os status</option>
          {CHAM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_CHAMADO_LABEL[s]}</option>)}
        </Select>
        <Select aria-label="Filtrar por unidade" value={filtros.unidadeId} onChange={(e) => setFiltros({ ...filtros, unidadeId: e.target.value })}>
          <option value="">Todas as unidades</option>
          {unidadesSelecionaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
        <TextInput aria-label="Data inicial" type="date" value={filtros.dataInicio} onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value })} className="!w-36" />
        <TextInput aria-label="Data final" type="date" value={filtros.dataFim} onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value })} className="!w-36" />
        {filtrosAtivos && <Button variant="ghost" onClick={() => setFiltros(filtrosVazios)}>Limpar filtros</Button>}
      </div>

      {/* A2 (22/07/2026) — o Kanban não mostra mais o histórico inteiro por
          padrão (ver STATUS_TERMINAIS_CHAMADO/JANELA_PADRAO_DIAS acima):
          chamados resolvidos/encerrados há mais de 60 dias ficam ocultos até
          alguém pedir explicitamente. Aviso só aparece quando há algo
          escondido, com o botão de escape sempre visível ao lado. */}
      {(ocultosPelaJanela > 0 || verHistoricoCompleto) && (
        <div className="mb-4 flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
          {verHistoricoCompleto ? (
            <>
              <span>Mostrando o histórico completo de chamados.</span>
              <Button variant="ghost" onClick={() => setVerHistoricoCompleto(false)}>Voltar para os últimos {JANELA_PADRAO_DIAS} dias</Button>
            </>
          ) : (
            <>
              <span>{ocultosPelaJanela} chamado{ocultosPelaJanela !== 1 ? "s" : ""} resolvido{ocultosPelaJanela !== 1 ? "s" : ""}/encerrado{ocultosPelaJanela !== 1 ? "s" : ""} há mais de {JANELA_PADRAO_DIAS} dias {ocultosPelaJanela !== 1 ? "estão" : "está"} oculto{ocultosPelaJanela !== 1 ? "s" : ""}.</span>
              <Button variant="ghost" onClick={() => setVerHistoricoCompleto(true)}>Ver histórico completo</Button>
            </>
          )}
        </div>
      )}

      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}

      {podeGerenciar && <ChamadosDashboard chamados={data.chamados} />}

      {/* Abertura de Chamados Offline (08/07/2026, item 1): fica fora do
          Kanban de propósito — não tem status real nem arrastar entre
          colunas até sincronizar de verdade, então misturar dentro das
          colunas do KanbanBoard exigiria fingir um status que ele não tem.
          Uma faixa simples acima, visível mas sem interferir no fluxo de
          arrastar/soltar de quem administra. */}
      {chamadosPendentes.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {chamadosPendentes.map((p) => (
            <span key={p.localId} className="text-xs bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300 rounded-lg px-3 py-1.5 flex items-center gap-2">
              {CATEGORIA_CHAMADO_LABEL[p.payload.categoria]}
              <Stamp tone={p.status === "erro" ? "neg" : "pend"}>{p.status === "erro" ? "Erro ao sincronizar" : "Pendente de Sincronização"}</Stamp>
            </span>
          ))}
        </div>
      )}

      <KanbanBoard
        items={chamadosFiltrados}
        columns={CHAM_STATUSES}
        columnLabels={COLUNAS_LABEL}
        statusField="status"
        onStatusChange={mudarStatus}
        renderCard={(c) => (
          <div
            onClick={() => setSelectedId(c.id)}
            {...cardClicavelProps(() => setSelectedId(c.id))}
            className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-[var(--radius-control)] p-2.5 text-xs hover:border-brand-600/50 cursor-pointer ${FOCUS_RING_CLASS}`}
          >
            <div className="flex items-center justify-between mb-0.5">
              <p className="font-semibold text-slate-900 dark:text-slate-100">{c.solicitante?.nomeCompleto}</p>
              <span className="text-gray-400 dark:text-slate-500" style={{ fontVariantNumeric: "tabular-nums" }}>#{c.numero}</span>
            </div>
            <p className="text-gray-500 dark:text-slate-400">{CATEGORIA_CHAMADO_LABEL[c.categoria]}</p>
            <p className="text-gray-400 dark:text-slate-500 italic truncate">{c.descricao}</p>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <Stamp tone={PRIORIDADE_TONE[c.prioridade]}>{PRIORIDADE_LABEL[c.prioridade]}</Stamp>
              {/* Fase 2 (09/07/2026) — só destaca quando atrasado; dentro do
                  prazo não precisa de selo extra (evita poluir o card). */}
              {c.slaPrazo && c.status !== "RESOLVIDO" && c.status !== "ENCERRADO" && new Date(c.slaPrazo).getTime() < Date.now() && (
                <span className="text-[10px] font-semibold text-brand-700 dark:text-brand-400 bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-800 rounded px-1.5 py-0.5">
                  SLA atrasado
                </span>
              )}
              {c.reaberturas > 0 && (
                <span className="text-[10px] text-gray-500 dark:text-slate-400">↺ {c.reaberturas}x</span>
              )}
            </div>
          </div>
        )}
      />

      {selectedId && (
        <ChamadoDetalhe
          chamadoId={selectedId}
          papel={papel}
          podeGerenciar={podeGerenciar}
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
          colaboradores={data.colaboradores}
          equipamentos={data.equipamentos}
          unidades={unidadesSelecionaveis}
        />
      )}

      {editing && (
        <ChamadoForm
          colaboradores={data.colaboradores}
          equipamentos={data.equipamentos}
          unidades={unidadesSelecionaveis}
          tecnicos={tecnicos}
          onSave={salvar}
          onClose={() => { setEditing(false); setErro(null); }}
          salvando={salvando}
          erro={erro}
        />
      )}
    </div>
  );
}

function ChamadoForm({
  colaboradores, equipamentos, unidades, tecnicos, onSave, onClose, salvando, erro,
}: {
  colaboradores: AppData["colaboradores"];
  equipamentos: AppData["equipamentos"];
  unidades: AppData["dominios"]["unidades"];
  tecnicos: Tecnico[];
  onSave: (form: ChamadoInput, arquivos: File[]) => void;
  onClose: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [form, setForm] = useState({
    solicitanteId: "",
    categoria: CATEGORIAS_CHAMADO_CRIAVEIS[0] as CategoriaChamado,
    // Imoview CRM (09/07/2026) — ver comentário em types.ts.
    tipoSolicitacaoImoview: "" as TipoSolicitacaoImoview | "",
    codigoImovel: "",
    descricao: "",
    unidadeId: "",
    local: "",
    // Único técnico hoje (Vinícius) — pré-selecionado quando é o único da
    // lista, mas o campo continua obrigatório e visível (ver comentário
    // equivalente em PortalColaborador.tsx).
    responsavelId: tecnicos.length === 1 ? tecnicos[0].id : "",
    equipamentoId: "",
    prioridade: "MEDIA" as Prioridade,
    fornecedorExterno: "",
  });

  const ehImoview = form.categoria === "IMOVIEW_CRM";
  const precisaCodigoImovel = ehImoview && form.tipoSolicitacaoImoview === "PROBLEMA_IMOVEL";

  const faltaObrigatorio =
    !form.descricao || !form.solicitanteId || !form.unidadeId || !form.responsavelId ||
    (ehImoview && !form.tipoSolicitacaoImoview) ||
    (precisaCodigoImovel && !form.codigoImovel.trim());

  return (
    <Modal title="Novo Chamado" onClose={onClose}>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
      <Field label="Solicitante">
        <Select value={form.solicitanteId} onChange={(e) => setForm({ ...form, solicitanteId: e.target.value })}>
          <option value="">—</option>
          {colaboradores.filter((c) => colaboradorOperacionalmenteAtivo(c.status)).map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
        </Select>
      </Field>
      <Field label="Categoria">
        <Select
          value={form.categoria}
          onChange={(e) => {
            const categoria = e.target.value as CategoriaChamado;
            setForm({ ...form, categoria, tipoSolicitacaoImoview: "", codigoImovel: "" });
          }}
        >
          {CATEGORIAS_CHAMADO_CRIAVEIS.map((c) => <option key={c} value={c}>{CATEGORIA_CHAMADO_LABEL[c]}</option>)}
        </Select>
      </Field>
      {ehImoview && (
        <Field label="Tipo da solicitação">
          <Select
            value={form.tipoSolicitacaoImoview}
            onChange={(e) => setForm({ ...form, tipoSolicitacaoImoview: e.target.value as TipoSolicitacaoImoview, codigoImovel: "" })}
          >
            <option value="">—</option>
            {TIPOS_SOLICITACAO_IMOVIEW.map((t) => <option key={t} value={t}>{TIPO_SOLICITACAO_IMOVIEW_LABEL[t]}</option>)}
          </Select>
        </Field>
      )}
      {precisaCodigoImovel && (
        <Field label="Código do imóvel">
          <TextInput
            value={form.codigoImovel}
            onChange={(e) => setForm({ ...form, codigoImovel: e.target.value })}
            placeholder="Ex: IT-0123"
          />
        </Field>
      )}
      <Field label="Descrição do problema">
        <TextArea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unidade">
          <Select value={form.unidadeId} onChange={(e) => setForm({ ...form, unidadeId: e.target.value })}>
            <option value="">—</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Field>
        <Field label="Detalhe do local (opcional)">
          <TextInput value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} placeholder="Ex: Sala TI, Recepção" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Técnico responsável">
          <Select value={form.responsavelId} onChange={(e) => setForm({ ...form, responsavelId: e.target.value })}>
            <option value="">—</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        </Field>
        <Field label="Equipamento relacionado">
          {/* Escopado ao solicitante (07/08/2026, pedido do Vini) — os
              equipamentos DELE aparecem primeiro, separados por <optgroup>,
              pra não escolher por engano o equipamento de outra pessoa (o
              caso mais comum). "Outros equipamentos" continua disponível
              logo abaixo — quem administra o sistema às vezes abre chamado
              sobre um equipamento sem dono (estoque) ou de outro setor, e
              isso não deve ficar impossível, só menos em evidência. */}
          <Select value={form.equipamentoId} onChange={(e) => setForm({ ...form, equipamentoId: e.target.value })}>
            <option value="">—</option>
            {form.solicitanteId && (
              <optgroup label={`Equipamentos de ${colaboradores.find((c) => c.id === form.solicitanteId)?.nomeCompleto ?? "solicitante"}`}>
                {equipamentos.filter((eq) => eq.colaboradorId === form.solicitanteId).map((eq) => (
                  <option key={eq.id} value={eq.id}>{rotuloEquipamento(eq)}</option>
                ))}
              </optgroup>
            )}
            <optgroup label={form.solicitanteId ? "Outros equipamentos" : "Todos os equipamentos"}>
              {equipamentos.filter((eq) => eq.colaboradorId !== form.solicitanteId).map((eq) => (
                <option key={eq.id} value={eq.id}>{rotuloEquipamento(eq)}</option>
              ))}
            </optgroup>
          </Select>
          {form.solicitanteId && equipamentos.every((eq) => eq.colaboradorId !== form.solicitanteId) && (
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Este colaborador não tem nenhum equipamento vinculado.</p>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prioridade">
          <Select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Prioridade })}>
            <option value="ALTA">Alta</option>
            <option value="MEDIA">Média</option>
            <option value="BAIXA">Baixa</option>
          </Select>
        </Field>
        <Field label="Fornecedor Externo (se houver)">
          <TextInput value={form.fornecedorExterno} onChange={(e) => setForm({ ...form, fornecedorExterno: e.target.value })} />
        </Field>
      </div>
      <SeletorAnexos arquivos={arquivos} onChange={setArquivos} />
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          disabled={faltaObrigatorio || salvando}
          onClick={() =>
            onSave(
              {
                ...form,
                tipoSolicitacaoImoview: ehImoview && form.tipoSolicitacaoImoview ? form.tipoSolicitacaoImoview : null,
                codigoImovel: precisaCodigoImovel && form.codigoImovel ? form.codigoImovel : null,
                local: form.local || null,
                equipamentoId: form.equipamentoId || null,
                fornecedorExterno: form.fornecedorExterno || null,
              },
              arquivos
            )
          }
        >
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </Modal>
  );
}
