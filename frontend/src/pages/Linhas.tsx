import React, { useEffect, useRef, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { linhasApi, LinhaInput } from "../api/linhas";
import { ApiError } from "../lib/apiClient";
import { BotaoExportarCsv, Button, COLORS, EmptyState, Field, FONT_MONO, Modal, PageHeader, Paginacao, SearchBox, Select, Stamp, TextArea, TextInput, usePaginacaoCliente } from "../components/ui";
import { AlertTriangle, CheckCircle2, ChevronRight, Phone, Plus, Users } from "../components/icons";
import {
  Colaborador, colaboradorOperacionalmenteAtivo, LinhaTelefonica, SITUACAO_CONFERENCIA_LABEL, SituacaoConferenciaLinha,
  STATUS_LINHA_LABEL, STATUS_LINHA_TONE, StatusLinha, TIPO_PLANO_LABEL, TipoPlano,
} from "../types";
import { maskTelefone } from "../lib/mascaras";
import { telefonePrincipal } from "../lib/telefones";
import { exportarListaCsv } from "../utils/exportarCsv";
import { useFeedback } from "../contexts/FeedbackContext";

interface Props {
  data: AppData;
  readOnly: boolean;
  onChanged: () => void;
  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — categoria
  // LINHA_TELEFONICA (ex: "linha vinculada ao seu cadastro") abre direto o
  // formulário de edição da linha, mesmo comportamento de clicar na linha na
  // lista (este módulo nunca teve uma visão "só ver" separada de editar).
  abrirLinhaId?: string;
}

export function LinhasPage({ data, readOnly, onChanged, abrirLinhaId }: Props) {
  const { sucesso } = useFeedback();
  const [editing, setEditing] = useState<Partial<LinhaTelefonica> | null>(
    () => (abrirLinhaId ? data.linhas.find((l) => l.id === abrirLinhaId) || null : null)
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroTipoPlano, setFiltroTipoPlano] = useState<"" | TipoPlano>("");
  const [filtroConferencia, setFiltroConferencia] = useState<"" | SituacaoConferenciaLinha>("");
  // Modernização de filtros (07/08/2026, pedido do Vini) — faltava filtrar
  // por status da linha (Ativa/Disponível/Cancelada/Bloqueada): pra revisar
  // só as canceladas, por exemplo, era preciso ler o Stamp de cada card.
  const [filtroStatus, setFiltroStatus] = useState<"" | StatusLinha>("");
  // Aba "Pessoal" (08/07/2026, pedido do Vini): muitos colaboradores usam o
  // telefone pessoal no dia a dia — por preferência ou porque ainda não
  // receberam linha corporativa. Antes disso não existia visão nenhuma
  // desse grupo aqui, só das linhas corporativas em si.
  const [aba, setAba] = useState<"corporativas" | "pessoal">("corporativas");
  // Achado de auditoria (06/07/2026): não havia como buscar uma linha por
  // número ou nome do colaborador — numa lista de dezenas de linhas, achar
  // uma específica exigia rolar tudo lendo um por um.
  const [busca, setBusca] = useState("");
  const buscaNorm = busca.toLowerCase();
  const filtrosAtivos = !!(busca || filtroTipoPlano || filtroConferencia || filtroStatus);
  function limparFiltros() {
    setBusca("");
    setFiltroTipoPlano("");
    setFiltroConferencia("");
    setFiltroStatus("");
  }

  const linhasFiltradas = data.linhas
    .filter((l) => !filtroTipoPlano || l.tipoPlano === filtroTipoPlano)
    .filter((l) => !filtroConferencia || l.situacaoConferencia === filtroConferencia)
    .filter((l) => !filtroStatus || l.status === filtroStatus)
    .filter(
      (l) =>
        !busca ||
        l.numero.toLowerCase().includes(buscaNorm) ||
        (l.colaborador?.nomeCompleto || "").toLowerCase().includes(buscaNorm) ||
        (l.colaboradorInformado || "").toLowerCase().includes(buscaNorm)
    );
  const pendentes = linhasFiltradas.filter((l) => !l.colaboradorId);
  const reconciliadas = linhasFiltradas.filter((l) => l.colaboradorId);
  // Paginação no cliente (Fase 2, 14/07/2026, tarefa #153) — só na lista
  // "Vinculadas", que tende a crescer com o quadro de colaboradores.
  // "Pendentes de reconciliação" fica de fora de propósito: é uma fila de
  // prioridade (idealmente vazia ou pequena), não uma lista de consulta —
  // paginar esconderia justamente os itens que mais precisam de atenção.
  const {
    itensPagina: reconciliadasPagina, pagina: paginaReconciliadas, totalPaginas: totalPaginasReconciliadas,
    setPagina: setPaginaReconciliadas, total: totalReconciliadas, inicioExibicao: inicioReconciliadas, fimExibicao: fimReconciliadas,
  } = usePaginacaoCliente(reconciliadas, 24);
  const totalPosPago = data.linhas.filter((l) => l.tipoPlano === "POS_PAGO").length;
  const totalPrePago = data.linhas.filter((l) => l.tipoPlano === "PRE_PAGO").length;
  // Etapa 1 (08/07/2026): quantas linhas a auditoria automática encontrou
  // com número diferente do telefone de contato do próprio colaborador
  // vinculado, sem dar pra saber sozinho qual dos dois está certo.
  const necessitamConferencia = data.linhas.filter((l) => l.situacaoConferencia === "NECESSITA_CONFERENCIA").length;

  // Aba "Pessoal": colaboradores ativos (ou em aviso) sem nenhuma linha
  // corporativa vinculada — usam só o telefone de contato do cadastro. Não
  // distingue "por escolha" de "corporativo ainda não disponibilizado";
  // isso normalmente só quem conhece o caso sabe dizer, por isso aparece
  // aqui como lista pra revisão, não como classificação automática.
  const colaboradoresSemLinha = data.colaboradores
    .filter((c) => colaboradorOperacionalmenteAtivo(c.status) && !c.linhaCorporativa)
    .filter(
      (c) =>
        !busca ||
        c.nomeCompleto.toLowerCase().includes(buscaNorm) ||
        (telefonePrincipal(c) || "").toLowerCase().includes(buscaNorm)
    )
    .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto));

  // "Consulta Rápida" (10/07/2026) — exporta a aba "Corporativas" com os
  // mesmos filtros já aplicados na tela (tipo de plano, conferência, busca).
  // A aba "Pessoal" é uma visão derivada de Colaboradores (não tem CRUD
  // próprio aqui), então continua fora do CSV de linhas — quem quiser essa
  // lista já consegue via exportação de Colaboradores.
  function exportarLinhas() {
    exportarListaCsv(
      linhasFiltradas,
      [
        { cabecalho: "Número", valor: (l) => l.numero },
        { cabecalho: "Colaborador", valor: (l) => l.colaborador?.nomeCompleto || l.colaboradorInformado },
        { cabecalho: "Unidade", valor: (l) => l.unidade?.nome },
        { cabecalho: "Empresa", valor: (l) => l.empresa?.razaoSocial },
        { cabecalho: "Tipo de plano", valor: (l) => TIPO_PLANO_LABEL[l.tipoPlano] },
        { cabecalho: "Status", valor: (l) => STATUS_LINHA_LABEL[l.status] },
        { cabecalho: "Situação de conferência", valor: (l) => SITUACAO_CONFERENCIA_LABEL[l.situacaoConferencia] },
      ],
      "linhas_telefonicas"
    );
  }

  async function salvar(form: LinhaInput & { id?: string }) {
    setSalvando(true);
    setErro(null);
    try {
      if (form.id) {
        const { id, ...resto } = form;
        await linhasApi.update(id, resto);
      } else {
        await linhasApi.create(form);
      }
      await onChanged();
      setEditing(null);
      sucesso(form.id ? "Linha telefônica atualizada com sucesso." : "Linha telefônica cadastrada com sucesso.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  // Confirma o vínculo sugerido pelo sistema (número da linha bate com o
  // telefone de contato de um colaborador cadastrado) — nunca aplicado
  // sozinho, sempre por um clique explícito de quem administra.
  async function vincularSugestao(l: LinhaTelefonica) {
    if (!l.sugestaoColaborador) return;
    setSalvando(true);
    setErro(null);
    try {
      await linhasApi.update(l.id, { colaboradorId: l.sugestaoColaborador.id, principal: true, colaboradorInformado: null });
      await onChanged();
      sucesso("Linha vinculada ao colaborador.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível vincular.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: string) {
    setSalvando(true);
    try {
      await linhasApi.remove(id);
      await onChanged();
      setEditing(null);
      sucesso("Linha telefônica excluída com sucesso.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
    } finally {
      setSalvando(false);
    }
  }

  function Card({ l }: { l: LinhaTelefonica }) {
    return (
      <div className="card-entrada bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-3 hover:border-brand-600/50 transition-colors">
        {/* Achado de auditoria (08/07/2026, print do Vini no celular): número,
            empresa e nome de colaborador comprido (ex: "Thiago Henrique
            Monteiro") disputavam espaço com os 3 selos (Pós-pago/Ativa/
            Necessita conferência) numa única linha sem quebra — em telas
            estreitas isso espremia o texto a quase 0px de largura, e
            `break-words` respondeu quebrando LETRA POR LETRA, empurrando a
            tela inteira pra baixo. Mesma causa-raiz já corrigida antes em
            Colaboradores.tsx (ver comentário lá "Mesmo bug do e-mail
            comprido..."): mesmo remédio — empilha em telas estreitas
            (`flex-col`), volta a ficar lado a lado a partir de `sm`, e os
            selos podem quebrar linha entre si (`flex-wrap`) em vez de forçar
            o texto a ceder. */}
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
          onClick={() => !readOnly && setEditing(l)}
        >
          <div className="min-w-0">
            <p className="font-semibold text-sm" style={{ fontFamily: FONT_MONO, color: COLORS.ink }}>{maskTelefone(l.numero)}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">{l.empresa?.razaoSocial}</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 break-words">
              {/* "De quem era" (17/07/2026, pedido do Vini) — linha sem dono
                  atual mostra o dono anterior, pro chip devolvido no
                  desligamento não virar um número anônimo. Prioridade:
                  dono atual > dono anterior > nome informado na planilha. */}
              {l.colaborador?.nomeCompleto ||
                (l.ultimoColaborador ? (
                  <span className="text-amber-700 dark:text-amber-400">Sem dono · era de {l.ultimoColaborador.nomeCompleto}</span>
                ) : l.colaboradorInformado ? (
                  <span className="italic">"{l.colaboradorInformado}"</span>
                ) : (
                  "— sem vínculo —"
                ))} · {l.unidade?.nome}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Stamp>{TIPO_PLANO_LABEL[l.tipoPlano]}</Stamp>
            <Stamp tone={STATUS_LINHA_TONE[l.status]}>{STATUS_LINHA_LABEL[l.status]}</Stamp>
            {l.situacaoConferencia === "NECESSITA_CONFERENCIA" && (
              <Stamp tone="pend">Necessita conferência</Stamp>
            )}
            {!readOnly && <ChevronRight size={18} className="text-brand-600 flex-shrink-0" />}
          </div>
        </div>
        {/* Sugestão automática (Etapa 1, 08/07/2026): número desta linha
            pendente bate com o telefone de contato de um colaborador já
            cadastrado — nunca vincula sozinho, só sugere. Mesmo ajuste de
            empilhamento em tela estreita do bloco acima. */}
        {!readOnly && !l.colaboradorId && l.sugestaoColaborador && (
          <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 min-w-0">
              <CheckCircle2 size={13} className="flex-shrink-0" />
              <span className="break-words">Número bate com <strong>{l.sugestaoColaborador.nomeCompleto}</strong></span>
            </p>
            <Button
              variant="ghost"
              className="!text-emerald-700 dark:!text-emerald-400 self-start sm:self-auto flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); vincularSugestao(l); }}
              disabled={salvando}
            >
              Vincular
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Linhas Telefônicas"
        subtitle={
          <>
            {data.linhas.length} linhas no total · {totalPosPago} pós-pagas · {totalPrePago} pré-pagas
            {necessitamConferencia > 0 && (
              <span className="text-amber-700 dark:text-amber-400"> · {necessitamConferencia} precisam de conferência</span>
            )}
          </>
        }
        actions={
          <>
            {aba === "corporativas" && <BotaoExportarCsv onClick={exportarLinhas} quantidade={linhasFiltradas.length} />}
            {!readOnly && (
              <Button variant="accent" onClick={() => setEditing({})}>
                <Plus size={16} /> Nova Linha
              </Button>
            )}
          </>
        }
      />

      {/* Abas (08/07/2026, pedido do Vini): "Corporativas" é a tela de
          sempre (linhas de verdade, com custo pra empresa). "Pessoal" é
          nova — mostra quem está sem nenhuma linha corporativa vinculada e
          por isso usa só o telefone de contato do próprio cadastro, seja
          por preferência, seja porque o corporativo ainda não foi
          disponibilizado. Nenhuma linha é criada nem apagada só de olhar
          essa aba — é só visibilidade, a ação (se fizer sentido) é
          cadastrar uma linha corporativa de verdade a partir daqui. */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-slate-700">
        <button
          onClick={() => setAba("corporativas")}
          className={`px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
            aba === "corporativas" ? "border-brand-600 text-brand-700" : "border-transparent text-gray-400 dark:text-slate-500 hover:text-gray-600"
          }`}
        >
          Corporativas ({data.linhas.length})
        </button>
        <button
          onClick={() => setAba("pessoal")}
          className={`px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
            aba === "pessoal" ? "border-brand-600 text-brand-700" : "border-transparent text-gray-400 dark:text-slate-500 hover:text-gray-600"
          }`}
        >
          Pessoal ({data.colaboradores.filter((c) => colaboradorOperacionalmenteAtivo(c.status) && !c.linhaCorporativa).length})
        </button>
      </div>

      {/* Padronização de Animações (10/07/2026): troca de aba era um corte
          instantâneo — o `key={aba}` força o React a tratar cada aba como um
          novo elemento ao trocar, disparando o mesmo `pageIn` já usado na
          troca de módulo inteiro (App.tsx), só que mais rápido
          (--motion-fast em vez de --motion-page) por ser uma transição bem
          mais local/contida do que trocar de tela inteira. */}
      <div key={aba} className="animate-[pageIn_var(--motion-fast)_var(--motion-ease)]">
      {aba === "corporativas" ? (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por número ou colaborador..." />
            <Select aria-label="Filtrar por tipo de plano" value={filtroTipoPlano} onChange={(e) => setFiltroTipoPlano(e.target.value as "" | TipoPlano)}>
              <option value="">Pós-pago e Pré-pago</option>
              <option value="POS_PAGO">Só Pós-pago</option>
              <option value="PRE_PAGO">Só Pré-pago</option>
            </Select>
            <Select aria-label="Filtrar por situação de conferência" value={filtroConferencia} onChange={(e) => setFiltroConferencia(e.target.value as "" | SituacaoConferenciaLinha)}>
              <option value="">Qualquer situação de conferência</option>
              {Object.entries(SITUACAO_CONFERENCIA_LABEL).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </Select>
            <Select aria-label="Filtrar por status" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as "" | StatusLinha)}>
              <option value="">Todos os status</option>
              {Object.entries(STATUS_LINHA_LABEL).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </Select>
            {filtrosAtivos && <Button variant="ghost" onClick={limparFiltros}>Limpar filtros</Button>}
          </div>

          {data.linhas.length === 0 ? (
            <EmptyState icon={Phone} text="Nenhuma linha telefônica cadastrada ainda." />
          ) : linhasFiltradas.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">Nenhuma linha encontrada com os filtros atuais.</p>
          ) : (
            <>
              {pendentes.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-bold text-amber-800 dark:text-amber-400 mb-2 flex items-center gap-2">
                    <AlertTriangle size={15} /> Pendentes de reconciliação ({pendentes.length})
                  </h3>
                  <div className="space-y-2">
                    {pendentes.map((l) => <Card key={l.id} l={l} />)}
                  </div>
                </div>
              )}

              {reconciliadas.length > 0 && (
                <>
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Vinculadas ({reconciliadas.length})</h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {reconciliadasPagina.map((l) => <Card key={l.id} l={l} />)}
                  </div>
                  <Paginacao
                    pagina={paginaReconciliadas}
                    totalPaginas={totalPaginasReconciliadas}
                    onChange={setPaginaReconciliadas}
                    total={totalReconciliadas}
                    inicioExibicao={inicioReconciliadas}
                    fimExibicao={fimReconciliadas}
                    itemLabel="linhas vinculadas"
                  />
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por nome ou telefone..." />
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">
            Colaboradores ativos sem linha corporativa vinculada — usam o telefone de contato do próprio cadastro.
          </p>
          {colaboradoresSemLinha.length === 0 ? (
            <EmptyState icon={Users} text="Todo mundo ativo já tem linha corporativa vinculada." />
          ) : (
            <div className="space-y-2">
              {colaboradoresSemLinha.map((c) => (
                <div key={c.id} className="card-entrada bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{c.nomeCompleto}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 break-words">
                      {telefonePrincipal(c) ? maskTelefone(telefonePrincipal(c)!) : <span className="italic">sem telefone cadastrado</span>} · {c.setor?.nome || "Setor não definido"} · {c.unidade?.nome || "—"}
                    </p>
                  </div>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      className="!text-brand-700 dark:!text-brand-400 self-start sm:self-auto flex-shrink-0"
                      onClick={() => setEditing({ colaboradorId: c.id, numero: "", status: "ATIVA" })}
                    >
                      <Plus size={14} /> Cadastrar linha corporativa
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      </div>

      {editing && (
        <Modal title={"id" in editing ? `Linha ${editing.numero}` : "Nova Linha"} onClose={() => { setEditing(null); setErro(null); }}>
          <LinhaFormBody
            linha={editing}
            colaboradores={data.colaboradores}
            empresas={data.dominios.empresas}
            unidades={data.dominios.unidades}
            onSave={salvar}
            onDelete={"id" in editing ? () => excluir((editing as LinhaTelefonica).id) : undefined}
            onClose={() => setEditing(null)}
            salvando={salvando}
            erro={erro}
          />
        </Modal>
      )}
    </div>
  );
}

function LinhaFormBody({
  linha, colaboradores, empresas, unidades, onSave, onDelete, onClose, salvando, erro,
}: {
  linha: Partial<LinhaTelefonica>;
  colaboradores: AppData["colaboradores"];
  empresas: AppData["dominios"]["empresas"];
  unidades: AppData["dominios"]["unidades"];
  onSave: (form: LinhaInput & { id?: string }) => void;
  onDelete?: () => void;
  onClose: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const [numero, setNumero] = useState(linha.numero || "");
  const [operadora, setOperadora] = useState(linha.operadora || "");
  const [plano, setPlano] = useState(linha.plano || "");
  const [tipoPlano, setTipoPlano] = useState<TipoPlano>(linha.tipoPlano || "POS_PAGO");
  const [empresaId, setEmpresaId] = useState(linha.empresaId || "");
  const [unidadeId, setUnidadeId] = useState(linha.unidadeId || "");
  const [colaboradorId, setColaboradorId] = useState(linha.colaboradorId || "");
  const [colaboradorInformado, setColaboradorInformado] = useState(linha.colaboradorInformado || "");
  const [status, setStatus] = useState<StatusLinha>(linha.status || "DISPONIVEL");
  const [situacaoConferencia, setSituacaoConferencia] = useState<SituacaoConferenciaLinha>(
    linha.situacaoConferencia || "NAO_VERIFICADO"
  );
  const [observacoes, setObservacoes] = useState(linha.observacoes || "");
  const [confirmandoExcluir, setConfirmandoExcluir] = useState(false);
  const [tentouSalvar, setTentouSalvar] = useState(false);

  // Achado de auditoria (06/07/2026): "Número" aceitava qualquer texto — sem
  // validação de formato, um dígito faltando ou um texto digitado errado
  // (comum no celular) só seria percebido dias depois, quando alguém tentasse
  // ligar. Aceita os formatos comuns de celular/fixo BR, com ou sem
  // parênteses/traço/DDD, sem travar quem digitar com uma pontuação diferente.
  const numeroLimpo = numero.replace(/\D/g, "");
  const numeroValido = numeroLimpo.length >= 10 && numeroLimpo.length <= 11;

  // Etapa 1 (08/07/2026): compara ao vivo o número desta linha com o
  // telefone de CONTATO do colaborador escolhido — só um aviso visual, não
  // bloqueia salvar (os dois podem legitimamente ser diferentes, ver
  // relatório da Etapa 1). Ajuda quem está cadastrando a perceber na hora
  // se bateu ou não, em vez de descobrir só depois numa auditoria.
  const colaboradorSelecionado = colaboradores.find((c) => c.id === colaboradorId);
  const telefoneContatoLimpo = (colaboradorSelecionado ? telefonePrincipal(colaboradorSelecionado) || "" : "").replace(/\D/g, "");
  const bateComContato = colaboradorSelecionado && telefoneContatoLimpo && numeroLimpo
    ? telefoneContatoLimpo === numeroLimpo
    : null;

  // Achado de auditoria (C9, 22/07/2026): a divergência acima já era
  // detectada e avisada visualmente, mas "Necessita conferência" continuava
  // desmarcado até alguém lembrar de marcar manualmente. Agora, ao detectar
  // a divergência pela primeira vez, pré-seleciona automaticamente — o
  // usuário continua podendo reverter manualmente a qualquer momento (o
  // `useRef` garante que essa reversão não seja desfeita de novo por este
  // efeito, ele só age uma vez por abertura do formulário).
  const conferenciaAjustadaAuto = useRef(false);
  useEffect(() => {
    if (bateComContato === false && situacaoConferencia === "NAO_VERIFICADO" && !conferenciaAjustadaAuto.current) {
      conferenciaAjustadaAuto.current = true;
      setSituacaoConferencia("NECESSITA_CONFERENCIA");
    }
  }, [bateComContato, situacaoConferencia]);

  return (
    <div>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
      <Field label="Número">
        <TextInput
          value={numero}
          onChange={(e) => setNumero(maskTelefone(e.target.value))}
          placeholder="(37) 99999-9999"
          className={tentouSalvar && !numeroValido ? "border-red-400 focus:border-red-400" : undefined}
        />
        {tentouSalvar && !numeroValido && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">
            Número inválido — informe DDD + número (10 ou 11 dígitos), ex: (37) 99999-9999.
          </p>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Operadora">
          <TextInput value={operadora} onChange={(e) => setOperadora(e.target.value)} />
        </Field>
        <Field label="Plano">
          <TextInput value={plano} onChange={(e) => setPlano(e.target.value)} />
        </Field>
      </div>
      <Field label="Pós-pago ou Pré-pago">
        <Select value={tipoPlano} onChange={(e) => setTipoPlano(e.target.value as TipoPlano)}>
          <option value="POS_PAGO">Pós-pago</option>
          <option value="PRE_PAGO">Pré-pago</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Empresa">
          <Select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
            <option value="">—</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.razaoSocial}</option>)}
          </Select>
        </Field>
        <Field label="Unidade">
          <Select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">—</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Vinculado a — colaborador cadastrado">
        <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
          <option value="">— Sem vínculo formal / disponível —</option>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
        </Select>
        {bateComContato === true && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">✓ Bate com o telefone de contato do cadastro.</p>
        )}
        {bateComContato === false && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            Telefone de contato do cadastro é diferente ({colaboradorSelecionado && telefonePrincipal(colaboradorSelecionado) ? maskTelefone(telefonePrincipal(colaboradorSelecionado)!) : "—"}) — pode ser
            legítimo (contato pessoal ≠ linha corporativa) ou um dos dois estar errado. Considere marcar
            "Necessita conferência" abaixo se não tiver certeza.
          </p>
        )}
      </Field>
      <Field label="Ou informar outro nome manualmente (quando não há colaborador cadastrado à mão)">
        <TextInput
          value={colaboradorInformado}
          onChange={(e) => setColaboradorInformado(e.target.value)}
          placeholder="Ex: nome de terceiro, prestador, etc."
          disabled={!!colaboradorId}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusLinha)}>
            <option value="ATIVA">Ativa</option>
            <option value="DISPONIVEL">Disponível</option>
            <option value="CANCELADA">Cancelada</option>
            <option value="BLOQUEADA">Bloqueada</option>
          </Select>
        </Field>
        <Field label="Situação de conferência">
          <Select value={situacaoConferencia} onChange={(e) => setSituacaoConferencia(e.target.value as SituacaoConferenciaLinha)}>
            <option value="NAO_VERIFICADO">Não verificado</option>
            <option value="CONFERIDO">Conferido</option>
            <option value="NECESSITA_CONFERENCIA">Necessita conferência</option>
          </Select>
        </Field>
      </div>
      <Field label="Observações">
        <TextArea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </Field>
      <div className="flex items-center justify-between gap-2 mt-4">
        <div>
          {onDelete && (
            confirmandoExcluir ? (
              <div className="flex items-center gap-2">
                {/* Achado de auditoria (06/07/2026): "Não" ficava clicável
                    mesmo com a exclusão já em andamento (salvando=true) — dava
                    a falsa impressão de que dava pra cancelar um pedido que já
                    tinha sido enviado ao servidor. Agora trava junto com "Sim". */}
                {/* Achado de auditoria (08/07/2026, Etapa 8 — Consistência):
                    este era o único modal de exclusão do sistema com texto
                    "Excluir de vez?" + botões "Não"/"Sim, excluir" — os outros
                    4 modais equivalentes (Equipamentos, Solicitações,
                    Colaboradores, ChamadoDetalhe) usam "Excluir de vez, sem
                    desfazer?" + "Cancelar"/"Confirmar exclusão". Alinhado ao
                    padrão do resto do sistema. */}
                <span className="text-xs text-brand-700 dark:text-brand-400">Excluir de vez, sem desfazer?</span>
                <Button variant="ghost" onClick={() => setConfirmandoExcluir(false)} disabled={salvando}>Cancelar</Button>
                <Button variant="danger" onClick={onDelete} disabled={salvando}>Confirmar exclusão</Button>
              </div>
            ) : (
              <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => setConfirmandoExcluir(true)} disabled={salvando}>
                Excluir
              </Button>
            )
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={salvando}
            onClick={() => {
              if (!numeroValido) {
                setTentouSalvar(true);
                return;
              }
              onSave({
                id: linha.id,
                numero,
                operadora: operadora || null,
                plano: plano || null,
                tipoPlano,
                empresaId: empresaId || null,
                unidadeId: unidadeId || null,
                colaboradorId: colaboradorId || null,
                colaboradorInformado: colaboradorId ? null : (colaboradorInformado || null),
                principal: true,
                situacaoConferencia,
                status,
                observacoes: observacoes || null,
              });
            }}
          >
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
