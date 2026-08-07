import React, { useMemo, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { acessosApi } from "../api/acessos";
import { ApiError } from "../lib/apiClient";
import { BotaoExportarCsv, Button, COLORS, EmptyState, Field, Modal, PageHeader, Paginacao, Select, SearchBox, Stamp, TextArea, usePaginacaoCliente } from "../components/ui";
import { Key, Pencil, Plus, X } from "../components/icons";
import { AcessoSistema, STATUS_ACESSO_LABEL, STATUS_ACESSO_TONE, StatusAcesso } from "../types";
import { exportarListaCsv } from "../utils/exportarCsv";
import { useFeedback } from "../contexts/FeedbackContext";

interface Props {
  data: AppData;
  readOnly: boolean;
  onChanged: () => void;
}

export function AcessosPage({ data, readOnly, onChanged }: Props) {
  const { sucesso } = useFeedback();
  const [busca, setBusca] = useState("");
  // Achado de auditoria (06/07/2026): não dava pra filtrar por sistema — numa
  // empresa com vários sistemas de acesso, achar "quem tem acesso ao ERP"
  // exigia rolar a lista inteira lendo cada card.
  const [filtroSistemaId, setFiltroSistemaId] = useState("");
  // Achado de auditoria (C8, 22/07/2026): mesma dor do filtro de sistema
  // acima, mas por status — não dava pra isolar só os acessos "Bloqueado"
  // ou "Pendente de criação" sem ler card por card.
  const [filtroStatus, setFiltroStatus] = useState<"" | StatusAcesso>("");
  const [pendente, setPendente] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<AcessoSistema | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Achado de auditoria (Etapa 4 — Frontend, 08/07/2026): criar()/editar()
  // não tinham estado de "salvando" nenhum — diferente de toggleStatus()/
  // excluir() logo abaixo, e diferente de toda outra página de
  // criação/edição do sistema. Sem isso, um duplo toque no celular (o mesmo
  // cenário já citado nos comentários desta página) disparava duas
  // requisições antes da primeira resposta voltar — acesso concedido em
  // duplicidade, ou dois PUT concorrentes na mesma edição.
  const [salvando, setSalvando] = useState(false);

  const filtrosAtivos = !!(busca || filtroSistemaId || filtroStatus);
  function limparFiltros() {
    setBusca("");
    setFiltroSistemaId("");
    setFiltroStatus("");
  }

  const porColaborador = useMemo(() => {
    const filtrados = data.acessos
      .filter((a) => !filtroSistemaId || a.sistemaId === filtroSistemaId)
      .filter((a) => !filtroStatus || a.status === filtroStatus);
    const map: Record<string, typeof data.acessos> = {};
    filtrados.forEach((a) => {
      const key = a.colaborador?.nomeCompleto || "(sem colaborador)";
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return Object.entries(map).filter(([nome]) => nome.toLowerCase().includes(busca.toLowerCase()));
  }, [data.acessos, busca, filtroSistemaId, filtroStatus]);
  // Paginação no cliente (Fase 2, 14/07/2026, tarefa #153) — uma "página" é
  // um grupo de colaboradores, não de acessos individuais (o card de cada
  // colaborador já pode ter vários selos de sistema dentro).
  const { itensPagina: porColaboradorPagina, pagina, totalPaginas, setPagina, total, inicioExibicao, fimExibicao } =
    usePaginacaoCliente(porColaborador, 20);

  // "Consulta Rápida" (10/07/2026) — exporta uma linha por acesso (não por
  // colaborador), já achatando o agrupamento `porColaborador` usado na tela,
  // respeitando os mesmos filtros de busca/sistema.
  const acessosExportacao = useMemo(
    () => porColaborador.flatMap(([nome, acessos]) => acessos.map((a) => ({ nome, a }))),
    [porColaborador]
  );
  function exportarAcessos() {
    exportarListaCsv(
      acessosExportacao,
      [
        { cabecalho: "Colaborador", valor: ({ nome }) => nome },
        { cabecalho: "Sistema", valor: ({ a }) => a.sistema?.nome },
        { cabecalho: "Status", valor: ({ a }) => STATUS_ACESSO_LABEL[a.status] },
        { cabecalho: "Observações", valor: ({ a }) => a.observacoes },
      ],
      "acessos_sistemas"
    );
  }

  // Achado de auditoria (06/07/2026): sem try/catch aqui, um erro de rede ou
  // de permissão (403, por exemplo, se o papel mudou entre a listagem e o
  // clique) desaparecia silenciosamente — o toggle simplesmente não fazia
  // nada e ninguém via mensagem nenhuma, parecendo bug intermitente.
  async function toggleStatus(id: string) {
    if (readOnly) return;
    setPendente(id);
    setErro(null);
    try {
      await acessosApi.alternarStatus(id);
      await onChanged();
      sucesso("Status do acesso atualizado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível alternar o status deste acesso.");
    } finally {
      setPendente(null);
    }
  }

  // Achado de auditoria C4 (22/07/2026): editar() só repassava sistemaId e
  // observacoes — o backend já aceita colaboradorId opcional no PATCH (ver
  // acessos.routes.ts), faltava o 3º parâmetro aqui e o campo no formulário.
  async function editar(id: string, sistemaId: string, observacoes: string, colaboradorId: string) {
    setSalvando(true);
    setErro(null);
    try {
      await acessosApi.update(id, { sistemaId, colaboradorId, observacoes: observacoes || null });
      await onChanged();
      setEditando(null);
      sucesso("Acesso atualizado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar as alterações.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: string) {
    setPendente(id);
    setErro(null);
    try {
      await acessosApi.remove(id);
      await onChanged();
      sucesso("Acesso excluído.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
    } finally {
      setPendente(null);
      setExcluindo(null);
    }
  }

  // Achado de auditoria C3 (22/07/2026): a concessão só permitia UM sistema
  // por vez — pra um colaborador novo que precisa de 5 sistemas, isso
  // significava abrir o modal 5 vezes. O backend não ganhou rota de lote
  // (POST /acessos-sistema continua criando um por vez), então disparamos
  // uma chamada por sistema selecionado com Promise.allSettled — mesmo
  // padrão de tratamento parcial de falha já usado em revogarGrupo() acima
  // (nem tudo-ou-nada silencioso: se 3 de 5 derem certo, a pessoa sabe
  // exatamente quais 3 e quais 2 falharam).
  async function criar(colaboradorId: string, sistemaIds: string[], observacoes: string) {
    setSalvando(true);
    setErro(null);
    try {
      const resultados = await Promise.allSettled(
        sistemaIds.map((sistemaId) => acessosApi.create({ colaboradorId, sistemaId, observacoes: observacoes || null }))
      );
      await onChanged();
      const sucessos = resultados.filter((r) => r.status === "fulfilled");
      const falhas = resultados
        .map((r, i) => ({ r, sistemaId: sistemaIds[i] }))
        .filter(({ r }) => r.status === "rejected");
      if (falhas.length === 0) {
        setCriando(false);
        sucesso(
          sucessos.length === 1
            ? "Acesso concedido."
            : `${sucessos.length} acessos concedidos com sucesso.`
        );
      } else if (sucessos.length === 0) {
        setErro(`Não foi possível conceder nenhum dos ${sistemaIds.length} acesso(s) selecionado(s). Tente novamente.`);
      } else {
        const nomesFalha = falhas
          .map(({ sistemaId }) => data.dominios.sistemas.find((s) => s.id === sistemaId)?.nome || sistemaId)
          .join(", ");
        setCriando(false);
        sucesso(`${sucessos.length} de ${sistemaIds.length} acesso(s) concedido(s) com sucesso.`);
        setErro(`Falha ao conceder acesso a: ${nomesFalha}. Tente novamente só para estes.`);
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível conceder o acesso.");
    } finally {
      setSalvando(false);
    }
  }

  // Ação em lote "Revogar todos" (Fase 3 — Componentes Inteligentes,
  // 14/07/2026) — o caso de uso mais real do sistema pra ação em lote aqui:
  // colaborador desligado precisa perder acesso a TODOS os sistemas de uma
  // vez, não um por um (mesmo racional já documentado no "Checklist de
  // devolução" de Movimentacoes.tsx, que hoje só avisa a contagem sem
  // oferecer a ação). Um grupo já É "os acessos de um colaborador" — não
  // precisa de checkbox de seleção como em Equipamentos.tsx, o próprio
  // agrupamento existente já é a unidade da ação.
  const [revogandoGrupo, setRevogandoGrupo] = useState<string | null>(null);
  const [grupoProcessando, setGrupoProcessando] = useState<string | null>(null);

  // Achado (17/07/2026, ao investigar o fluxo de desligamento — #177): esta
  // ação chamava `acessosApi.remove` (DELETE definitivo) pra "revogar" —
  // mesmo o texto de sucesso dizendo "revogado(s)". Revogar de verdade
  // significa BLOQUEADO (preserva o histórico da concessão, ver comentário
  // de `alternar-status` em acessos.routes.ts); DELETE apaga o registro
  // inteiro, perdendo pra sempre quando o acesso foi concedido e por quem.
  // Corrigido pra usar `alternarStatus` (o mesmo endpoint que o botão
  // individual de revogar já usa, ver linha ~85 acima) — e, como
  // `alternar-status` é um TOGGLE (ATIVO↔BLOQUEADO, não um "setar
  // BLOQUEADO"), filtra pra só os já ATIVOS antes de mandar: chamar num
  // acesso já BLOQUEADO reativaria ele por engano, o oposto do que o botão
  // promete.
  async function revogarGrupo(nome: string, acessosDoGrupo: typeof data.acessos) {
    setGrupoProcessando(nome);
    setErro(null);
    const acessosAtivos = acessosDoGrupo.filter((a) => a.status === "ATIVO");
    const resultados = await Promise.allSettled(acessosAtivos.map((a) => acessosApi.alternarStatus(a.id)));
    const falhas = resultados.filter((r) => r.status === "rejected").length;
    await onChanged();
    setGrupoProcessando(null);
    setRevogandoGrupo(null);
    if (falhas === 0) {
      sucesso(`${acessosAtivos.length} acesso(s) de ${nome} revogado(s) com sucesso.`);
    } else {
      setErro(`${acessosAtivos.length - falhas} de ${acessosAtivos.length} acesso(s) de ${nome} revogado(s) — ${falhas} falharam. Tente novamente nos que restaram.`);
    }
  }

  return (
    <div>
      <PageHeader
        title="Acessos a Sistemas"
        subtitle={`${data.acessos.length} registros · ${data.dominios.sistemas.map((s) => s.nome).join(", ")}`}
        actions={
          <>
            <BotaoExportarCsv onClick={exportarAcessos} quantidade={acessosExportacao.length} />
            {!readOnly && (
              <Button variant="accent" onClick={() => setCriando(true)}>
                <Plus size={16} /> Novo Acesso
              </Button>
            )}
          </>
        }
      />
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}
      <div className="flex flex-wrap gap-3 mb-4">
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar colaborador..." />
        <Select aria-label="Filtrar por sistema" value={filtroSistemaId} onChange={(e) => setFiltroSistemaId(e.target.value)}>
          <option value="">Todos os sistemas</option>
          {data.dominios.sistemas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </Select>
        {/* Achado de auditoria (C8, 22/07/2026): filtro de status ao lado do
            filtro de sistema já existente, mesmo padrão de estado/Select. */}
        <Select aria-label="Filtrar por status" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as "" | StatusAcesso)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_ACESSO_LABEL).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </Select>
        {filtrosAtivos && <Button variant="ghost" onClick={limparFiltros}>Limpar filtros</Button>}
      </div>
      {/* Achado de auditoria (Etapa 4 — Frontend, 08/07/2026): única página de
          listagem do sistema sem EmptyState — busca/filtro sem resultado
          virava área em branco, indistinguível de tela travada. */}
      {porColaborador.length === 0 ? (
        <EmptyState icon={Key} text="Nenhum acesso encontrado com os filtros atuais." />
      ) : (
      <>
      <div className="space-y-3">
        {porColaboradorPagina.map(([nome, acessos]) => (
          <div key={nome} className="card-entrada bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{nome}</p>
              {!readOnly && acessos.filter((a) => a.status === "ATIVO").length > 1 && (
                revogandoGrupo === nome ? (
                  <span className="flex items-center gap-1.5 text-xs flex-shrink-0">
                    <span className="text-brand-700 dark:text-brand-400">Revogar {acessos.filter((a) => a.status === "ATIVO").length} acesso(s) ativo(s)?</span>
                    <button
                      className="text-brand-700 dark:text-brand-400 font-semibold disabled:opacity-50"
                      disabled={grupoProcessando === nome}
                      onClick={() => revogarGrupo(nome, acessos)}
                    >
                      {grupoProcessando === nome ? "Revogando..." : "Confirmar"}
                    </button>
                    <button className="text-gray-500 dark:text-slate-400" onClick={() => setRevogandoGrupo(null)}>cancelar</button>
                  </span>
                ) : (
                  <button
                    className="text-xs text-gray-500 dark:text-slate-400 hover:text-brand-600 flex-shrink-0"
                    onClick={() => setRevogandoGrupo(nome)}
                  >
                    Revogar todos
                  </button>
                )
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {acessos.map((a) => (
                <span
                  key={a.id}
                  className="text-xs bg-gray-50 dark:bg-slate-800 px-2 py-1.5 rounded-[var(--radius-control)] flex items-center gap-1.5"
                >
                  <button
                    onClick={() => toggleStatus(a.id)}
                    disabled={readOnly || pendente === a.id}
                    className="flex items-center gap-1.5 hover:opacity-70 disabled:opacity-50"
                    title={readOnly ? "" : "Clique para alternar Ativo/Bloqueado"}
                  >
                    {a.sistema?.nome}: <Stamp tone={STATUS_ACESSO_TONE[a.status]}>{STATUS_ACESSO_LABEL[a.status]}</Stamp>
                  </button>
                  {/* Achado de auditoria (06/07/2026): mesma correção de área
                      de toque aplicada em Historico.tsx/Movimentacoes.tsx —
                      p-1.5 -m-1.5 aumenta a área clicável sem deslocar o layout. */}
                  {!readOnly && (
                    <button
                      className="text-gray-500 dark:text-slate-400 hover:text-brand-600 p-1.5 -m-1.5"
                      title="Editar sistema/observação deste acesso"
                      aria-label="Editar sistema/observação deste acesso"
                      onClick={() => setEditando(a)}
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                  {!readOnly && (
                    excluindo === a.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          className="text-brand-700 dark:text-brand-400 font-semibold"
                          disabled={pendente === a.id}
                          onClick={() => excluir(a.id)}
                        >
                          confirmar
                        </button>
                        <button className="text-gray-500 dark:text-slate-400" onClick={() => setExcluindo(null)}>cancelar</button>
                      </span>
                    ) : (
                      <button
                        className="text-gray-500 dark:text-slate-400 hover:text-brand-600 p-1.5 -m-1.5"
                        title="Excluir este acesso"
                        aria-label="Excluir este acesso"
                        onClick={() => setExcluindo(a.id)}
                      >
                        <X size={12} />
                      </button>
                    )
                  )}
                </span>
              ))}
            </div>
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
        itemLabel="colaboradores"
      />
      </>
      )}

      {criando && (
        <Modal title="Novo Acesso" onClose={() => setCriando(false)}>
          <NovoAcessoForm
            colaboradores={data.colaboradores}
            sistemas={data.dominios.sistemas}
            onSave={criar}
            onClose={() => setCriando(false)}
            erro={erro}
            salvando={salvando}
          />
        </Modal>
      )}

      {/* Achado de auditoria (08/07/2026, Etapa 8 — Consistência): os
          outros modais de edição do sistema usam Title Case ("Editar
          Equipamento", "Editar Colaborador"); este era o único em
          minúsculas ("Editar acesso"). */}
      {editando && (
        <Modal title={`Editar Acesso — ${editando.colaborador?.nomeCompleto || ""}`} onClose={() => setEditando(null)}>
          <EditarAcessoForm
            acesso={editando}
            colaboradores={data.colaboradores}
            sistemas={data.dominios.sistemas}
            onSave={(sistemaId, observacoes, colaboradorId) => editar(editando.id, sistemaId, observacoes, colaboradorId)}
            onClose={() => setEditando(null)}
            erro={erro}
            salvando={salvando}
          />
        </Modal>
      )}
    </div>
  );
}

function EditarAcessoForm({
  acesso, colaboradores, sistemas, onSave, onClose, erro, salvando,
}: {
  acesso: AcessoSistema;
  colaboradores: AppData["colaboradores"];
  sistemas: AppData["dominios"]["sistemas"];
  onSave: (sistemaId: string, observacoes: string, colaboradorId: string) => void;
  onClose: () => void;
  erro: string | null;
  salvando: boolean;
}) {
  const [colaboradorId, setColaboradorId] = useState(acesso.colaboradorId);
  const [sistemaId, setSistemaId] = useState(acesso.sistemaId);
  const [observacoes, setObservacoes] = useState(acesso.observacoes || "");
  return (
    <div>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}
      {/* Achado de auditoria C4 (22/07/2026): editar só permitia trocar
          sistema/observações, não o colaborador dono do acesso — mesmo
          Select usado no form de CRIAÇÃO logo abaixo (NovoAcessoForm). */}
      <Field label="Colaborador">
        <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
        </Select>
      </Field>
      <Field label="Sistema">
        <Select value={sistemaId} onChange={(e) => setSistemaId(e.target.value)}>
          {sistemas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </Select>
      </Field>
      <Field label="Observações">
        <TextArea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
        <Button variant="primary" onClick={() => onSave(sistemaId, observacoes, colaboradorId)} disabled={salvando || !colaboradorId}>
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

function NovoAcessoForm({
  colaboradores, sistemas, onSave, onClose, erro, salvando,
}: {
  colaboradores: AppData["colaboradores"];
  sistemas: AppData["dominios"]["sistemas"];
  onSave: (colaboradorId: string, sistemaIds: string[], observacoes: string) => void;
  onClose: () => void;
  erro: string | null;
  salvando: boolean;
}) {
  const [colaboradorId, setColaboradorId] = useState("");
  // Achado de auditoria C3 (22/07/2026): antes só dava pra conceder UM
  // sistema por vez — pra um colaborador novo que precisa de acesso a vários
  // sistemas de uma vez, isso significava reabrir o modal pra cada um.
  // Checkboxes em vez de <Select multiple> (que exige Ctrl/Cmd+clique, pouco
  // descobrível) — mesmo padrão de lista com checkbox já usado no modal de
  // lançamento em lote de Pagamentos.tsx.
  const [sistemaIds, setSistemaIds] = useState<string[]>([]);
  const [observacoes, setObservacoes] = useState("");

  function alternarSistema(id: string) {
    setSistemaIds((atual) => (atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id]));
  }

  return (
    <div>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}
      <Field label="Colaborador">
        <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
          <option value="">—</option>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
        </Select>
      </Field>
      {/* Sem <Field> aqui de propósito: Field envolve o conteúdo num <label>,
          e cada linha abaixo já é o seu próprio <label> (checkbox + nome) —
          aninhar <label> dentro de <label> é HTML inválido. Título replicando
          o mesmo estilo visual de Field (ver componente em ui.tsx) só sem o
          wrapper. */}
      <div className="block mb-3.5">
        <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5">
          {`Sistemas${sistemaIds.length > 0 ? ` (${sistemaIds.length} selecionado${sistemaIds.length > 1 ? "s" : ""})` : ""}`}
        </span>
        {sistemas.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum sistema cadastrado — cadastre em Configurações.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1.5 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] p-2">
            {sistemas.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" checked={sistemaIds.includes(s.id)} onChange={() => alternarSistema(s.id)} />
                {s.nome}
              </label>
            ))}
          </div>
        )}
      </div>
      <Field label="Observações">
        <TextArea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
        <Button
          variant="primary"
          disabled={!colaboradorId || sistemaIds.length === 0 || salvando}
          onClick={() => onSave(colaboradorId, sistemaIds, observacoes)}
        >
          {salvando ? "Concedendo..." : sistemaIds.length > 1 ? `Conceder ${sistemaIds.length} acessos` : "Conceder acesso"}
        </Button>
      </div>
    </div>
  );
}
