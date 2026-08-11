import React, { useEffect, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { solicitacoesApi, SolicitacaoInput } from "../api/solicitacoes";
import { chamadosApi, Tecnico } from "../api/chamados";
import { ApiError } from "../lib/apiClient";
import { Button, cardClicavelProps, COLORS, Field, fmtDate, fmtMoney, FOCUS_RING_CLASS, KanbanBoard, Modal, PageHeader, Select, Stamp, TextArea, TextInput } from "../components/ui";
import { SENTINELA_OUTRO, SeletorComOpcaoOutro } from "../components/SeletorComOpcaoOutro";
import { CheckCircle2, Plus } from "../components/icons";
import {
  colaboradorOperacionalmenteAtivo, PRIORIDADE_LABEL, PRIORIDADE_TONE, Prioridade, SOLIC_STATUSES, SolicitacaoEquipamento,
  STATUS_SOLICITACAO_LABEL, STATUS_SOLICITACAO_TONE, StatusSolicitacao,
} from "../types";

// Reprovar com motivo mínimo (achado de auditoria S2, 22/07/2026 — "nivelar
// os 4 fluxos de Solicitação"): Serviço já exigia isso (ver DetalheServico
// em SolicitacoesServico.tsx); Equipamento reprovava com 1 clique, sem
// explicação nenhuma pro solicitante. Mesmo limite mínimo do backend.
const MOTIVO_MINIMO = 3;
import { useFeedback } from "../contexts/FeedbackContext";

// Sugestões de fornecedor (17/07/2026, pedido do Vini: "adicionar uma forma
// de colocar o fornecedor, abertamente ou lojas"). O campo é texto LIVRE —
// qualquer loja da web ou da região pode ser digitada — e estas sugestões
// só aceleram o preenchimento (datalist). Uma lista fechada com "todas as
// lojas da web e todas da região de Itaúna" seria impossível de completar e
// manter; em vez disso, além destas conhecidas, TODO fornecedor já usado em
// solicitações anteriores também vira sugestão automática (ver
// solicitacoesApi.listarFornecedores) — a lista local da região se constrói
// sozinha com o uso real.
const LOJAS_SUGERIDAS = [
  // — Lojas da web / redes nacionais —
  "Amazon",
  "Mercado Livre",
  "Magazine Luiza",
  "Kabum",
  "Americanas",
  "Casas Bahia",
  "Shopee",
  "AliExpress",
  "Pichau",
  "Terabyte Shop",
  "Fast Shop",
  "Ponto",
  "Carrefour",
  "Havan",
  "Samsung Shop",
  "Apple Store",
  "Dell",
  "Lenovo",
  // — Lojas de Itaúna e região (17/07/2026, pedido do Vini: "todas as lojas
  // da região de Itaúna"). Levantadas de diretórios locais e páginas das
  // próprias lojas (Diário Cidade, InfoisInfo, Instagram/Facebook/site de
  // cada uma) — curadas pra ficar só o comércio de equipamento/celular/
  // informática de verdade, não toda razão social do CNAE. O sufixo
  // "(Itaúna)" agrupa: digitar "ita" no campo filtra todas as locais.
  // Loja que faltar aqui é só digitar o nome — o campo é livre e o que for
  // usado vira sugestão automática pras próximas (ver fornecedoresUsados).
  "Rede 43 (Itaúna)",
  "Magazine Luiza (Itaúna)",
  "Casas Bahia (Itaúna)",
  "Eletrozema / Zema (Itaúna)",
  "Mundo Apple (Itaúna)",
  "Oficina do Celular (Itaúna)",
  "PH Celulares (Itaúna)",
  "Advanced Cell (Itaúna)",
  "Bruno Celulares (Itaúna)",
  "Central Celulares (Itaúna)",
  "André Celulares (Itaúna)",
  "TP Tech Informática (Itaúna)",
  "Digital Informática e Tecnologia (Itaúna)",
  "Tech Meta Informática (Itaúna)",
  "Unatec Informática (Itaúna)",
  "Alpha Informática (Itaúna)",
  "Canal Informática (Itaúna)",
  "Gtronic Informática (Itaúna)",
  "H & C Computadores (Itaúna)",
  "DSTI Informática (Itaúna)",
  "Zeus Informática (Itaúna)",
  "Inforhouse Informática (Itaúna)",
  "Infostore (Itaúna)",
  "Enter Informática (Itaúna)",
];

// Campo de fornecedor com sugestões — TextInput comum + <datalist> nativo
// (funciona sem biblioteca e continua sendo texto livre).
function CampoFornecedor({
  value, onChange, fornecedoresUsados,
}: { value: string; onChange: (v: string) => void; fornecedoresUsados: string[] }) {
  const sugestoes = [...new Set([...fornecedoresUsados, ...LOJAS_SUGERIDAS])];
  return (
    <>
      <TextInput
        list="sugestoes-fornecedor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ex: Kabum, Mercado Livre, loja local..."
      />
      <datalist id="sugestoes-fornecedor">
        {sugestoes.map((s) => <option key={s} value={s} />)}
      </datalist>
    </>
  );
}

interface Props {
  data: AppData;
  readOnly: boolean;
  // Aprovação em DUAS ETAPAS (17/07/2026, reorganização de hierarquia + papel
  // FINANCEIRO — ver comentário completo em solicitacoes.routes.ts e no topo
  // de SolicitacoesHub.tsx):
  //   `podeValidarTecnicamente` — 1ª etapa (PENDENTE → EM_ANALISE), veto do
  //   técnico. Controla a opção "Em análise" no seletor de status.
  //   `podeAprovarCusto` — 2ª etapa (→ APROVADO/REPROVADO), decisão de
  //   gasto. Controla os botões Aprovar/Reprovar, mas só ficam habilitados
  //   quando a solicitação já passou por EM_ANALISE — exceto pra quem tem
  //   `aprovadorTemOverride` (hoje só ADMINISTRADOR), que pode pular a
  //   etapa em caso excepcional, espelhando o override do backend.
  podeValidarTecnicamente: boolean;
  podeAprovarCusto: boolean;
  aprovadorTemOverride: boolean;
  // Exclusão definitiva (14/07/2026) — separado das duas etapas acima de
  // propósito: GESTOR_COORDENADOR continua podendo excluir uma solicitação
  // criada por engano (mesmo poder de sempre, inalterado no backend — ver
  // requireRole do DELETE em solicitacoes.routes.ts), mesmo sem mais poder
  // validar tecnicamente ou aprovar custo. Sem este prop separado, o botão
  // "Excluir" apareceria pra quem aprova mas não pra quem sempre pôde
  // excluir (ou o inverso) — um 403 silencioso esperando pra acontecer.
  podeExcluir: boolean;
  onChanged: () => void;
  // Semente vinda do dashboard (Fase 4 — Dashboard interativo, 06/07/2026) —
  // clicar numa solicitação específica na Home já abre o detalhe dela direto
  // aqui, em vez de só cair na lista geral e a pessoa procurar de novo.
  abrirSolicitacaoId?: string;
  // Atalho rápido do Dashboard (Fase 3, 14/07/2026) — mesmo mecanismo de
  // abrirSolicitacaoId acima, abrindo direto o formulário de nova solicitação.
  abrirNovo?: boolean;
}

const COLUNAS_LABEL = Object.fromEntries(SOLIC_STATUSES.map((s) => [s, STATUS_SOLICITACAO_LABEL[s]]));

export function SolicitacoesPage({
  data, readOnly, podeValidarTecnicamente, podeAprovarCusto, aprovadorTemOverride, podeExcluir, onChanged, abrirSolicitacaoId, abrirNovo,
}: Props) {
  const { sucesso } = useFeedback();
  const [editing, setEditing] = useState<Partial<SolicitacaoEquipamento> | null>(() => (abrirNovo && !readOnly ? {} : null));
  const [selected, setSelected] = useState<SolicitacaoEquipamento | null>(
    () => (abrirSolicitacaoId ? data.solicitacoes.find((s) => s.id === abrirSolicitacaoId) || null : null)
  );
  // Filtros (achado S8 do checkup, 22/07/2026 — "Filtros muito desiguais
  // entre os 4 Kanbans de Solicitações": esta tela tinha só 2, unidade e
  // lote). Ganha busca livre/status/período pra alcançar o mínimo comum dos
  // 4 Kanbans (mesmo padrão de UI de SolicitacoesPapelaria.tsx); lote
  // continua à parte — é específico deste domínio, sem equivalente nos
  // outros 3.
  const [filtros, setFiltros] = useState({ busca: "", status: "", loteId: "", unidadeId: "", dataInicio: "", dataFim: "" });
  const filtrosVazios = { busca: "", status: "", loteId: "", unidadeId: "", dataInicio: "", dataFim: "" };
  const filtrosAtivos = Object.values(filtros).some((v) => v !== "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<"idle" | "confirmando" | "processando">("idle");
  // Reprovar com motivo (achado de auditoria S2, 22/07/2026) — mesmo padrão
  // de "recusando"/"motivo" já usado em DetalheServico (SolicitacoesServico.tsx).
  const [reprovando, setReprovando] = useState(false);
  const [motivoReprovacao, setMotivoReprovacao] = useState("");
  // Local (unidade) e técnico responsável obrigatórios desde 07/07/2026 —
  // mesma mudança feita em Chamados.tsx/PortalColaborador.tsx.
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  // Valor e fornecedor da compra (17/07/2026) — quem valida tecnicamente ou
  // aprova custo também pode ajustar valor/fornecedor da compra (ex: o
  // colaborador não informa valor nenhum; ou informaram um valor alto
  // demais e o responsável corrige com o preço real do fornecedor).
  const podeEditarCompra = podeValidarTecnicamente || podeAprovarCusto;
  const [fornecedoresUsados, setFornecedoresUsados] = useState<string[]>([]);
  useEffect(() => {
    if (!podeEditarCompra) return;
    solicitacoesApi.listarFornecedores().then((r) => setFornecedoresUsados(r.fornecedores)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeEditarCompra]);
  useEffect(() => {
    chamadosApi.tecnicos().then(setTecnicos).catch(() => setTecnicos([]));
  }, []);
  // Achado do Vini (07/07/2026): mesmo filtro aplicado em Chamados.tsx —
  // "Não identificado" é um valor técnico do backfill da migration, não uma
  // opção pra escolher de propósito.
  const unidadesSelecionaveis = data.dominios.unidades.filter((u) => u.nome !== "Não identificado");

  const filtradas = data.solicitacoes.filter((s) => {
    const buscaAlvo = `${s.item} ${s.justificativa || ""} ${s.solicitante?.nomeCompleto || ""}`.toLowerCase();
    return (
      (!filtros.loteId || s.loteId === filtros.loteId) &&
      (!filtros.unidadeId || s.unidadeId === filtros.unidadeId) &&
      (!filtros.status || s.status === filtros.status) &&
      (!filtros.busca || buscaAlvo.includes(filtros.busca.toLowerCase())) &&
      (!filtros.dataInicio || s.dataSolicitacao.slice(0, 10) >= filtros.dataInicio) &&
      (!filtros.dataFim || s.dataSolicitacao.slice(0, 10) <= filtros.dataFim)
    );
  });

  async function excluir(id: string) {
    setExcluindo("processando");
    setErro(null);
    try {
      await solicitacoesApi.remove(id);
      await onChanged();
      setSelected(null);
      setExcluindo("idle");
      sucesso("Solicitação excluída.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
      setExcluindo("idle");
    }
  }

  async function mudarStatus(id: string, novoStatus: string, motivo?: string) {
    try {
      await solicitacoesApi.mudarStatus(id, novoStatus as StatusSolicitacao, motivo);
      await onChanged();
      sucesso(`Status alterado para "${STATUS_SOLICITACAO_LABEL[novoStatus as StatusSolicitacao]}".`);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível mudar o status.");
    }
  }

  async function salvar(form: SolicitacaoInput) {
    setSalvando(true);
    setErro(null);
    try {
      await solicitacoesApi.create(form);
      await onChanged();
      setEditing(null);
      sucesso("Solicitação criada.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Solicitações de Equipamento"
        subtitle="Arraste os cartões entre as colunas para mudar o status"
        actions={
          !readOnly && (
            <Button variant="accent" onClick={() => setEditing({})}>
              <Plus size={16} /> Nova
            </Button>
          )
        }
      />

      {/* Padronização de layout (Fase 2, 14/07/2026, tarefa #152) — ver
          mesmo comentário em Chamados.tsx.
          S8 (22/07/2026) — só tinha unidade/lote; ganhou busca/status/
          período pra alcançar o mínimo comum dos 4 Kanbans de Solicitações. */}
      <div className="flex flex-wrap gap-3 mb-4">
        <TextInput
          aria-label="Buscar por item, justificativa ou solicitante"
          placeholder="Buscar por item, justificativa ou solicitante..."
          value={filtros.busca}
          onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
          className="!w-64"
        />
        <Select aria-label="Filtrar por status" value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
          <option value="">Todos os status</option>
          {SOLIC_STATUSES.map((s) => <option key={s} value={s}>{STATUS_SOLICITACAO_LABEL[s]}</option>)}
        </Select>
        <Select aria-label="Filtrar por unidade" value={filtros.unidadeId} onChange={(e) => setFiltros({ ...filtros, unidadeId: e.target.value })}>
          <option value="">Todas as unidades</option>
          {unidadesSelecionaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
        <Select aria-label="Filtrar por lote" value={filtros.loteId} onChange={(e) => setFiltros({ ...filtros, loteId: e.target.value })}>
          <option value="">Todos os lotes</option>
          {data.lotes.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </Select>
        <TextInput aria-label="Data inicial" type="date" value={filtros.dataInicio} onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value })} className="!w-36" />
        <TextInput aria-label="Data final" type="date" value={filtros.dataFim} onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value })} className="!w-36" />
        {filtrosAtivos && <Button variant="ghost" onClick={() => setFiltros(filtrosVazios)}>Limpar filtros</Button>}
      </div>

      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}

      <KanbanBoard
        items={filtradas}
        columns={SOLIC_STATUSES}
        columnLabels={COLUNAS_LABEL}
        statusField="status"
        onStatusChange={mudarStatus}
        renderCard={(s) => (
          <div
            onClick={() => setSelected(s)}
            {...cardClicavelProps(() => setSelected(s))}
            className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-600 rounded-[var(--radius-control)] p-2.5 text-xs hover:border-brand-600/50 cursor-pointer ${FOCUS_RING_CLASS}`}
          >
            <p className="font-semibold text-slate-900 dark:text-slate-100 mb-0.5 truncate">{s.solicitante?.nomeCompleto}</p>
            {/* Achado de auditoria (Etapa 4 — Frontend, 08/07/2026): faltava
                `truncate` neste texto livre (item digitado pelo usuário) —
                o card irmão equivalente em Chamados.tsx já trata a descrição
                livre assim, mesma coluna de largura fixa no Kanban. */}
            <p className="text-gray-500 dark:text-slate-400 truncate">{s.item}</p>
            <div className="flex items-center justify-between mt-1.5">
              <Stamp tone={PRIORIDADE_TONE[s.prioridade]}>{PRIORIDADE_LABEL[s.prioridade]}</Stamp>
              <span className="font-mono text-gray-400 dark:text-slate-500">{fmtMoney(s.valorTotal ?? Number(s.valorUnitario) * s.quantidade)}</span>
            </div>
          </div>
        )}
      />

      {selected && (
        <Modal
          title={`#${selected.numero} — ${selected.item}`}
          onClose={() => { setSelected(null); setExcluindo("idle"); setReprovando(false); setMotivoReprovacao(""); }}
        >
          <div className="space-y-2 text-sm mb-4">
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Solicitante</span><br />{selected.solicitante?.nomeCompleto}</div>
            {selected.categoria?.nome && (
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Categoria</span><br />{selected.categoria.nome}</div>
            )}
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Justificativa</span><br />{selected.justificativa || "—"}</div>
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Unidade</span><br />{selected.unidade?.nome || "—"}</div>
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Técnico responsável</span><br />{selected.tecnicoResponsavel?.nome || "—"}</div>
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Lote</span><br />{selected.lote?.nome || "—"}</div>
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Valor</span><br />{fmtMoney(selected.valorUnitario)} × {selected.quantidade} = {fmtMoney(selected.valorTotal ?? Number(selected.valorUnitario) * selected.quantidade)}</div>
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Fornecedor / Loja</span><br />{selected.fornecedor || "—"}</div>
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Status</span><br /><Stamp tone={STATUS_SOLICITACAO_TONE[selected.status]}>{STATUS_SOLICITACAO_LABEL[selected.status]}</Stamp></div>
            {/* Achado de auditoria S2 (22/07/2026) — motivo da reprovação,
                gravado em `observacoes` (ver comentário no backend). */}
            {selected.status === "REPROVADO" && selected.observacoes && (
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Motivo da reprovação</span><br />{selected.observacoes}</div>
            )}
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Data da solicitação</span><br />{fmtDate(selected.dataSolicitacao)}</div>
          </div>
          {/*
            Achado em auditoria de 06/07/2026: antes disto, a única forma de
            mover uma solicitação por EM_ANALISE/EM_COMPRA/COMPRADO/ENTREGUE
            era arrastar o cartão no Kanban — e o drag-and-drop do
            KanbanBoard usa a API nativa de HTML5, que não funciona em toque
            no Safari iOS (e é inconsistente no Chrome Android). No celular,
            isso travava o fluxo inteiro pra quem só tinha os botões de
            Aprovar/Reprovar aqui embaixo. Excluído APROVADO/REPROVADO desta
            lista porque esses dois já têm botão dedicado logo abaixo.
          */}
          {!readOnly && (
            <div className="mb-4">
              <Field label="Mudar status">
                <Select
                  value={selected.status}
                  onChange={(e) => { mudarStatus(selected.id, e.target.value); setSelected(null); }}
                >
                  {SOLIC_STATUSES
                    // APROVADO/REPROVADO têm botão dedicado logo abaixo (ver
                    // comentário mais acima). EM_ANALISE (17/07/2026): some
                    // do seletor pra quem não valida tecnicamente — deixar
                    // visível só resultaria num 403 ao tentar escolher
                    // (ver PAPEIS_QUE_VALIDAM_TECNICAMENTE no backend).
                    .filter((s) => s !== "APROVADO" && s !== "REPROVADO")
                    .filter((s) => s !== "EM_ANALISE" || podeValidarTecnicamente)
                    .map((s) => (
                      <option key={s} value={s}>{STATUS_SOLICITACAO_LABEL[s]}</option>
                    ))}
                </Select>
              </Field>
            </div>
          )}
          {/* Valor e fornecedor da compra (17/07/2026, pedido do Vini) — o
              colaborador não informa valor nenhum ao solicitar; quem cuida
              da compra define/corrige aqui, com auditoria de antes/depois
              no backend. */}
          {!readOnly && podeEditarCompra && (
            <DetalhesCompraEditor
              key={selected.id}
              solicitacao={selected}
              fornecedoresUsados={fornecedoresUsados}
              onSalvo={(atualizada) => {
                setSelected(atualizada);
                onChanged();
                setFornecedoresUsados((atual) =>
                  atualizada.fornecedor && !atual.includes(atualizada.fornecedor)
                    ? [...atual, atualizada.fornecedor]
                    : atual
                );
              }}
            />
          )}
          {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
          {/* Duas etapas (17/07/2026): quem aprova custo mas não tem
              override (FINANCEIRO) só vê os botões depois da validação
              técnica — evita um 409 confuso ("ainda não passou por Em
              análise") por clicar num botão que parecia disponível. Quem
              tem override (ADMINISTRADOR) sempre vê, podendo pular a etapa
              em caso excepcional, espelhando a regra do backend. */}
          {podeAprovarCusto && !aprovadorTemOverride && selected.status !== "EM_ANALISE" &&
            selected.status !== "APROVADO" && selected.status !== "REPROVADO" && (
              <div className="mb-3 text-xs text-gray-500 dark:text-slate-400">
                Aguardando validação técnica (Suporte/TI) antes de poder aprovar ou reprovar.
              </div>
          )}
          <div className="flex flex-wrap gap-2">
            {podeAprovarCusto && (aprovadorTemOverride || selected.status === "EM_ANALISE") && selected.status !== "APROVADO" && !reprovando && (
              <Button variant="accent" onClick={() => { mudarStatus(selected.id, "APROVADO"); setSelected(null); }}>
                <CheckCircle2 size={14} /> Aprovar
              </Button>
            )}
            {podeAprovarCusto && (aprovadorTemOverride || selected.status === "EM_ANALISE") && selected.status !== "REPROVADO" && !reprovando && (
              <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => setReprovando(true)}>
                Reprovar
              </Button>
            )}
            {podeExcluir && (
              excluindo === "confirmando" ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-brand-700 dark:text-brand-400 self-center">Excluir de vez, sem desfazer?</span>
                  <Button variant="ghost" onClick={() => setExcluindo("idle")}>Cancelar</Button>
                  <Button variant="danger" onClick={() => excluir(selected.id)} disabled={excluindo !== "confirmando"}>Confirmar exclusão</Button>
                </span>
              ) : (
                <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => setExcluindo("confirmando")}>Excluir</Button>
              )
            )}
          </div>

          {/* Motivo da reprovação (achado de auditoria S2, 22/07/2026) —
              mesmo padrão de "recusando" em DetalheServico
              (SolicitacoesServico.tsx): campo obrigatório aparece antes de
              confirmar, botão de confirmar some até o texto ter pelo menos
              3 caracteres. */}
          {reprovando && (
            <div className="mt-3 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3">
              <Field label="Motivo da reprovação">
                <TextArea value={motivoReprovacao} onChange={(e) => setMotivoReprovacao(e.target.value)} />
              </Field>
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="ghost" onClick={() => { setReprovando(false); setMotivoReprovacao(""); }}>Cancelar</Button>
                <Button
                  variant="danger"
                  disabled={motivoReprovacao.trim().length < MOTIVO_MINIMO}
                  onClick={() => {
                    mudarStatus(selected.id, "REPROVADO", motivoReprovacao.trim());
                    setSelected(null);
                    setReprovando(false);
                    setMotivoReprovacao("");
                  }}
                >
                  Confirmar reprovação
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {editing && (
        <SolicitacaoForm
          colaboradores={data.colaboradores}
          unidades={unidadesSelecionaveis}
          tecnicos={tecnicos}
          categorias={data.dominios.categoriasProdutoEquipamento}
          produtos={data.dominios.produtosEquipamento}
          fornecedoresUsados={fornecedoresUsados}
          onSave={salvar}
          onClose={() => { setEditing(null); setErro(null); }}
          salvando={salvando}
          erro={erro}
        />
      )}
    </div>
  );
}

// Editor de valor + fornecedor no detalhe (17/07/2026, pedido do Vini: "o
// técnico ou quem for responsável... poder alterar o valor, caso coloquem um
// valor muito alto"). `key={selected.id}` no ponto de uso reseta o estado
// local ao navegar entre solicitações sem fechar o modal.
function DetalhesCompraEditor({
  solicitacao, fornecedoresUsados, onSalvo,
}: {
  solicitacao: SolicitacaoEquipamento;
  fornecedoresUsados: string[];
  onSalvo: (atualizada: SolicitacaoEquipamento) => void;
}) {
  const { sucesso } = useFeedback();
  const [valor, setValor] = useState<string>(String(Number(solicitacao.valorUnitario)));
  const [fornecedor, setFornecedor] = useState(solicitacao.fornecedor || "");
  const [salvando, setSalvando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const valorNumerico = Number(valor);
  const valorInvalido = valor.trim() === "" || Number.isNaN(valorNumerico) || valorNumerico < 0;
  const mudou =
    (!valorInvalido && valorNumerico !== Number(solicitacao.valorUnitario)) ||
    (fornecedor.trim() || null) !== (solicitacao.fornecedor || null);

  async function salvarCompra() {
    setSalvando(true);
    setErroLocal(null);
    try {
      const atualizada = await solicitacoesApi.atualizarDetalhesCompra(solicitacao.id, {
        valorUnitario: valorNumerico,
        fornecedor: fornecedor.trim() || null,
      });
      onSalvo(atualizada);
      sucesso("Valor e fornecedor atualizados.");
    } catch (e) {
      setErroLocal(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mb-4 border border-gray-200 dark:border-slate-700 rounded-lg p-3 bg-gray-50 dark:bg-slate-800/60">
      <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2">Valor e fornecedor da compra</h5>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor Unitário (R$)">
          <TextInput type="number" step="0.01" min="0" value={valor} onChange={(e) => setValor(e.target.value)} />
        </Field>
        <Field label="Fornecedor / Loja">
          <CampoFornecedor value={fornecedor} onChange={setFornecedor} fornecedoresUsados={fornecedoresUsados} />
        </Field>
      </div>
      {erroLocal && <p className="text-xs text-brand-700 dark:text-brand-400 mb-2">{erroLocal}</p>}
      <Button variant="ghost" onClick={salvarCompra} disabled={salvando || valorInvalido || !mudou}>
        {salvando ? "Salvando..." : "Salvar valor e fornecedor"}
      </Button>
    </div>
  );
}

function SolicitacaoForm({
  colaboradores, unidades, tecnicos, categorias, produtos, fornecedoresUsados, onSave, onClose, salvando, erro,
}: {
  colaboradores: AppData["colaboradores"];
  unidades: AppData["dominios"]["unidades"];
  tecnicos: Tecnico[];
  categorias: AppData["dominios"]["categoriasProdutoEquipamento"];
  produtos: AppData["dominios"]["produtosEquipamento"];
  fornecedoresUsados: string[];
  onSave: (form: SolicitacaoInput) => void;
  onClose: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const [form, setForm] = useState({
    solicitanteId: "",
    // categoriaId/produtoId (09/07/2026) — mesmo par sentinela usado em
    // SolicitacoesPapelaria.tsx: produtoId "" = nada escolhido ainda,
    // SENTINELA_OUTRO = item fora do catálogo (digitado livremente em
    // `item`). categoriaId sozinho (sem produtoId) também é válido nesse
    // caso — mantém o item avulso categorizado pros indicadores/relatórios.
    categoriaId: "",
    produtoId: "",
    item: "",
    justificativa: "",
    prioridade: "MEDIA" as Prioridade,
    quantidade: 1,
    valorUnitario: 0,
    fornecedor: "",
    unidadeId: "",
    // Único técnico hoje (Vinícius) — pré-selecionado quando é o único da
    // lista, mas o campo continua obrigatório e visível.
    tecnicoResponsavelId: tecnicos.length === 1 ? tecnicos[0].id : "",
  });

  const categoriasAtivas = categorias.filter((c) => c.status === "ATIVO");
  const produtosDaCategoria = produtos.filter((p) => p.categoriaId === form.categoriaId && p.status === "ATIVO");

  const faltaObrigatorio =
    !form.item || !form.solicitanteId || !form.unidadeId || !form.tecnicoResponsavelId ||
    // Categoria escolhida mas produto ainda não (e não é "outro") — estado
    // intermediário, não deixa salvar até resolver pra um dos dois lados.
    (!!form.categoriaId && !form.produtoId);

  return (
    <Modal title="Nova Solicitação" onClose={onClose}>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
      <Field label="Solicitante">
        <Select value={form.solicitanteId} onChange={(e) => setForm({ ...form, solicitanteId: e.target.value })}>
          <option value="">—</option>
          {colaboradores.filter((c) => colaboradorOperacionalmenteAtivo(c.status)).map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria">
          <Select
            value={form.categoriaId}
            onChange={(e) => setForm({ ...form, categoriaId: e.target.value, produtoId: "", item: "" })}
          >
            <option value="">—</option>
            {categoriasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </Field>
        <SeletorComOpcaoOutro
          label="Item"
          value={form.produtoId}
          disabled={!form.categoriaId}
          opcoes={produtosDaCategoria.map((p) => ({ id: p.id, nome: p.nome }))}
          onChange={(val) => {
            if (val === SENTINELA_OUTRO) {
              setForm({ ...form, produtoId: SENTINELA_OUTRO, item: "" });
              return;
            }
            const produto = produtos.find((p) => p.id === val);
            setForm({ ...form, produtoId: val, item: produto?.nome || "" });
          }}
          valorLivre={form.item}
          onChangeValorLivre={(v) => setForm({ ...form, item: v })}
          placeholderCampoLivre="Ex: Estabilizador de energia"
        />
      </div>
      <Field label="Justificativa">
        <TextArea value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unidade">
          <Select value={form.unidadeId} onChange={(e) => setForm({ ...form, unidadeId: e.target.value })}>
            <option value="">—</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Field>
        <Field label="Técnico responsável">
          <Select value={form.tecnicoResponsavelId} onChange={(e) => setForm({ ...form, tecnicoResponsavelId: e.target.value })}>
            <option value="">—</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Prioridade">
          <Select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Prioridade })}>
            <option value="ALTA">Alta</option>
            <option value="MEDIA">Média</option>
            <option value="BAIXA">Baixa</option>
          </Select>
        </Field>
        <Field label="Quantidade">
          <TextInput type="number" min="1" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: Number(e.target.value) })} />
        </Field>
        <Field label="Valor Unitário (R$)">
          <TextInput type="number" step="0.01" value={form.valorUnitario} onChange={(e) => setForm({ ...form, valorUnitario: Number(e.target.value) })} />
        </Field>
      </div>
      {/* Fornecedor (17/07/2026, pedido do Vini) — texto livre com sugestões
          (lojas conhecidas + fornecedores já usados). Este formulário é o da
          equipe (staff); o colaborador do Portal não vê valor nem fornecedor
          — quem define é o responsável pela compra. */}
      <Field label="Fornecedor / Loja (opcional)">
        <CampoFornecedor
          value={form.fornecedor}
          onChange={(v) => setForm({ ...form, fornecedor: v })}
          fornecedoresUsados={fornecedoresUsados}
        />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          disabled={faltaObrigatorio || salvando}
          onClick={() =>
            onSave({
              ...form,
              fornecedor: form.fornecedor.trim() || null,
              // Lote (09/07/2026, pedido do Vini) — nunca mais escolhido
              // aqui: o backend resolve sozinho (usa o lote ABERTO se
              // existir, cria o do mês corrente se não existir nenhum),
              // ver POST /solicitacoes-equipamento. `loteId` simplesmente
              // não é mais enviado.
              // produtoId "" (nada escolhido) e SENTINELA_OUTRO (item avulso)
              // não são ids de catálogo de verdade — só o id de um produto
              // real cadastrado deve ir pro backend, mesmo tratamento que
              // SolicitacoesPapelaria.tsx já dá ao salvar.
              produtoId: form.produtoId && form.produtoId !== SENTINELA_OUTRO ? form.produtoId : undefined,
              categoriaId: form.categoriaId || undefined,
            })
          }
        >
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </Modal>
  );
}
