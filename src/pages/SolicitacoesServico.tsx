import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { solicitacoesServicoApi } from "../api/solicitacoesServico";
import { ApiError } from "../lib/apiClient";
import { Button, EmptyState, Field, fmtMoney, Modal, PageHeader, Select, Spinner, Stamp, TextArea, TextInput } from "../components/ui";
import { TimelineEventos } from "../components/TimelineEventos";
import { Plus, Wrench } from "../components/icons";
import { colaboradorOperacionalmenteAtivo, Papel, SolicitacaoServico, STATUS_SERVICO_LABEL, STATUS_SERVICO_TONE } from "../types";
import { useFeedback } from "../contexts/FeedbackContext";

// Solicitações de Serviço (20/07/2026, pedido do Vini) — "hierarquia de
// processos": colaborador pede (ex: Dropbox pro marketing) → Suporte TI
// atende/resolve acesso → se precisar de plano PAGO, TI encaminha ao
// Financeiro com fornecedor/valor → Financeiro contrata e conclui. Cada
// transição vira uma linha na timeline (nunca mudança silenciosa).

interface Props {
  data: AppData;
  papel: Papel;
  // Busca Global (Onda 2.1 do redesign, 21/07/2026) — esta página busca a
  // própria lista de forma assíncrona (não vem pronta em `data`, como as
  // outras 2 abas do hub), então o id só pode ser aplicado DEPOIS que a
  // primeira carga responder — ver `abrirAutoAplicadoRef` abaixo.
  abrirSolicitacaoId?: string;
}

export function SolicitacoesServicoPage({ data, papel, abrirSolicitacaoId }: Props) {
  const { sucesso } = useFeedback();
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoServico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionada, setSelecionada] = useState<SolicitacaoServico | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const ehTI = papel === "ADMINISTRADOR" || papel === "SUPORTE_TI";
  const ehFinanceiro = papel === "ADMINISTRADOR" || papel === "FINANCEIRO";

  // Filtros (achado S8 do checkup, 22/07/2026 — "Filtros muito desiguais
  // entre os 4 Kanbans de Solicitações": esta tela não tinha NENHUM filtro,
  // a mais atrasada dos 4). Conjunto mínimo comum: busca livre, status,
  // unidade, período — mesmo padrão de UI já usado em
  // SolicitacoesPapelaria.tsx (que tem o conjunto mais rico), tudo
  // client-side sobre a lista já carregada (o campo que falta pra cada
  // filtro já vem na resposta de GET /solicitacoes-servico, sem precisar
  // mudar o backend).
  const [filtros, setFiltros] = useState({ busca: "", status: "", unidadeId: "", dataInicio: "", dataFim: "" });
  const filtrosVazios = { busca: "", status: "", unidadeId: "", dataInicio: "", dataFim: "" };
  const filtrosAtivos = Object.values(filtros).some((v) => v !== "");
  // Mesmo filtro já aplicado em Chamados.tsx/Solicitacoes.tsx/
  // SolicitacoesPapelaria.tsx: "Não identificado" é valor técnico de
  // backfill, não uma opção real pra escolher.
  const unidadesSelecionaveis = data.dominios.unidades.filter((u) => u.nome !== "Não identificado");

  const solicitacoesFiltradas = solicitacoes.filter((s) => {
    const buscaAlvo = `${s.servico} ${s.descricao || ""} ${s.solicitante?.nomeCompleto || ""}`.toLowerCase();
    return (
      (!filtros.busca || buscaAlvo.includes(filtros.busca.toLowerCase())) &&
      (!filtros.status || s.status === filtros.status) &&
      (!filtros.unidadeId || s.unidadeId === filtros.unidadeId) &&
      (!filtros.dataInicio || s.criadoEm.slice(0, 10) >= filtros.dataInicio) &&
      (!filtros.dataFim || s.criadoEm.slice(0, 10) <= filtros.dataFim)
    );
  });

  const recarregar = useCallback(async () => {
    try {
      const lista = await solicitacoesServicoApi.list();
      setSolicitacoes(lista);
      setSelecionada((atual) => (atual ? lista.find((s) => s.id === atual.id) || null : null));
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar.");
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);

  // Abre automaticamente só na primeira vez que o id pedido aparece na
  // lista já carregada — o ref evita reabrir sozinho depois que a pessoa já
  // fechou o modal (a lista recarrega de novo a cada ação dentro dele).
  const abrirAutoAplicadoRef = useRef(false);
  useEffect(() => {
    if (abrirAutoAplicadoRef.current || !abrirSolicitacaoId) return;
    const alvo = solicitacoes.find((s) => s.id === abrirSolicitacaoId);
    if (alvo) {
      setSelecionada(alvo);
      abrirAutoAplicadoRef.current = true;
    }
  }, [abrirSolicitacaoId, solicitacoes]);

  async function agir(fn: () => Promise<unknown>, mensagem: string) {
    setSalvando(true);
    setErro(null);
    try {
      await fn();
      await recarregar();
      sucesso(mensagem);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível executar a ação.");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <div className="flex items-center justify-center py-16"><Spinner size={26} /></div>;

  return (
    <div>
      <PageHeader
        title="Solicitações de Serviço"
        subtitle="Serviços e ferramentas (ex: Dropbox) — TI resolve o acesso; contratação paga vai pro Financeiro"
        actions={<Button variant="primary" onClick={() => setNovaAberta(true)}><Plus size={15} /> Nova Solicitação</Button>}
      />

      {erro && <div className="mb-3 text-xs bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2.5">{erro}</div>}

      {/* Filtros (achado S8, 22/07/2026) — mesmo padrão visual de
          SolicitacoesPapelaria.tsx: faixa própria abaixo do cabeçalho,
          nunca dentro de `actions`. */}
      <div className="flex flex-wrap gap-3 mb-4">
        <TextInput
          aria-label="Buscar por serviço, descrição ou solicitante"
          placeholder="Buscar por serviço, descrição ou solicitante..."
          value={filtros.busca}
          onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
          className="!w-64"
        />
        <Select aria-label="Filtrar por status" value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_SERVICO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Filtrar por unidade" value={filtros.unidadeId} onChange={(e) => setFiltros({ ...filtros, unidadeId: e.target.value })}>
          <option value="">Todas as unidades</option>
          {unidadesSelecionaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
        <TextInput aria-label="Data inicial" type="date" value={filtros.dataInicio} onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value })} className="!w-36" />
        <TextInput aria-label="Data final" type="date" value={filtros.dataFim} onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value })} className="!w-36" />
        {filtrosAtivos && <Button variant="ghost" onClick={() => setFiltros(filtrosVazios)}>Limpar filtros</Button>}
      </div>

      {solicitacoesFiltradas.length === 0 ? (
        <EmptyState
          icon={Wrench}
          text={
            solicitacoes.length === 0
              ? "Nenhuma solicitação de serviço ainda."
              : "Nenhuma solicitação encontrada com os filtros atuais."
          }
        />
      ) : (
        <div className="space-y-2">
          {solicitacoesFiltradas.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelecionada(s)}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-3.5 cursor-pointer hover:border-brand-600/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">#{s.numero} — {s.servico}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                  {s.solicitante?.nomeCompleto}{s.unidade ? ` · ${s.unidade.nome}` : ""}
                  {s.precisaContratacao && s.valorEstimado ? ` · estimado ${fmtMoney(Number(s.valorEstimado))}` : ""}
                </p>
              </div>
              <Stamp tone={STATUS_SERVICO_TONE[s.status]}>{STATUS_SERVICO_LABEL[s.status]}</Stamp>
            </div>
          ))}
        </div>
      )}

      {selecionada && (
        <DetalheServico
          solicitacao={selecionada}
          ehTI={ehTI}
          ehFinanceiro={ehFinanceiro}
          salvando={salvando}
          onFechar={() => setSelecionada(null)}
          onAgir={agir}
          onComentado={recarregar}
        />
      )}

      {novaAberta && (
        <NovaServicoModal
          data={data}
          onFechar={() => setNovaAberta(false)}
          salvando={salvando}
          onSalvar={(form) =>
            agir(() => solicitacoesServicoApi.create(form), "Solicitação de serviço aberta.").then(() => setNovaAberta(false))
          }
        />
      )}
    </div>
  );
}

// Exportado (Onda 2.4 do redesign, 21/07/2026) — o Portal do Colaborador
// reaproveita este mesmo componente pra deixar a própria solicitação de
// serviço abrível (ver item 9 da auditoria: listagem unificada dos 4
// tipos). Funciona sem nenhuma mudança aqui: com `ehTI=false` e
// `ehFinanceiro=false`, o bloco de "Ações por etapa/papel" abaixo não
// renderiza nenhum botão sozinho (todos os `&&` dependem de um dos dois) —
// vira automaticamente uma visão só-leitura (ficha + linha do tempo), sem
// precisar de uma prop `readOnly` nova nem de um componente separado.
export function DetalheServico({
  solicitacao: s, ehTI, ehFinanceiro, salvando, onFechar, onAgir, onComentado,
}: {
  solicitacao: SolicitacaoServico;
  ehTI: boolean;
  ehFinanceiro: boolean;
  salvando: boolean;
  onFechar: () => void;
  onAgir: (fn: () => Promise<unknown>, mensagem: string) => Promise<void>;
  // Timeline de comentário (S14, 22/07/2026) — opcional porque o Portal do
  // Colaborador (PortalColaborador.tsx) reaproveita este mesmo componente
  // com ehTI=false/ehFinanceiro=false (ver comentário lá), então
  // `podeComentar` abaixo já fica falso e a caixa de comentário nem chega a
  // renderizar — não precisa quebrar aquele chamador com uma prop nova
  // obrigatória. Separado de `onAgir` (que já teria que engolir um
  // `mensagem` de sucesso fixo e não relança erro) porque a caixa de
  // comentário do <TimelineEventos> exige RELANÇAR o erro pra preservar o
  // texto digitado — mesmo contrato de enviarMensagem/enviarComentario em
  // ChamadoDetalhe.tsx/SolicitacoesPapelaria.tsx.
  onComentado?: () => Promise<void>;
}) {
  const { sucesso } = useFeedback();
  const [encaminhando, setEncaminhando] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [fornecedor, setFornecedor] = useState(s.fornecedor || "");
  const [valorEstimado, setValorEstimado] = useState(s.valorEstimado ? String(s.valorEstimado) : "");
  const [motivo, setMotivo] = useState("");
  const [erroComentario, setErroComentario] = useState<string | null>(null);

  // A caixa de comentário só aparece pra quem gerencia o fluxo (TI/
  // Financeiro) — mesmo critério já usado em SolicitacaoPapelariaDetalhe
  // (`podeComentar={podeGerenciar}`), não pro colaborador que só acompanha a
  // própria solicitação pelo Portal (lá `onComentado` nem é passado).
  const podeComentar = (ehTI || ehFinanceiro) && !!onComentado;

  async function enviarComentario(texto: string) {
    setErroComentario(null);
    try {
      await solicitacoesServicoApi.comentar(s.id, texto);
      await onComentado?.();
      sucesso("Comentário adicionado.");
    } catch (e) {
      setErroComentario(e instanceof ApiError ? e.message : "Não foi possível enviar o comentário.");
      throw e; // relança — é assim que <TimelineEventos> sabe preservar o texto digitado.
    }
  }

  const emAndamento = s.status === "ABERTA" || s.status === "EM_ATENDIMENTO";
  const aguardandoFin = s.status === "AGUARDANDO_CONTRATACAO";

  return (
    <Modal title={`#${s.numero} — ${s.servico}`} onClose={onFechar}>
      <div className="space-y-2 text-sm mb-4">
        <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Solicitante</span><br />{s.solicitante?.nomeCompleto}</div>
        {s.descricao && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Descrição</span><br />{s.descricao}</div>}
        <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Situação</span><br /><Stamp tone={STATUS_SERVICO_TONE[s.status]}>{STATUS_SERVICO_LABEL[s.status]}</Stamp></div>
        {s.precisaContratacao && (
          <div>
            <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Contratação</span><br />
            {s.fornecedor || "Fornecedor a definir"}{s.valorEstimado ? ` · estimado ${fmtMoney(Number(s.valorEstimado))}` : ""}
          </div>
        )}
      </div>

      {erroComentario && (
        <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">
          {erroComentario}
        </div>
      )}

      {/* Timeline (S14, 22/07/2026) — migrado pro componente compartilhado
          <TimelineEventos> (mesmo usado em ChamadoDetalhe.tsx/
          SolicitacoesPapelaria.tsx), no lugar da lista manual que só lia
          `ev.mensagem`. SolicitacaoServicoEvento não tem coluna `tipo` (ver
          schema.prisma) — todo evento, automático ou comentário livre, é só
          uma mensagem de texto com autor, então `variante` é sempre
          "mensagem" (nunca cai no ramo "sistema"/descricaoEvento). `tipo`
          precisa existir só porque é campo obrigatório de EventoTimeline —
          preenchido com um valor fixo, nunca lido de verdade. */}
      <div className="mb-4">
        <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-1.5">Linha do tempo</h5>
        <TimelineEventos
          titulo="Histórico"
          eventos={s.eventos.map((ev) => ({ ...ev, tipo: "MENSAGEM" }))}
          containerClassName="flex flex-col border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] overflow-hidden"
          variante={() => "mensagem"}
          descricaoEvento={{}}
          autorLabel={(autor) => {
            const a = autor as SolicitacaoServico["eventos"][number]["autor"];
            return a?.colaborador?.nomeCompleto || a?.email || "Sistema";
          }}
          autorTitle={(autor) => (autor as SolicitacaoServico["eventos"][number]["autor"])?.email}
          podeExcluirEvento={() => false}
          onExcluirEvento={() => {}}
          podeComentar={podeComentar}
          placeholderComentario="Escrever comentário..."
          onEnviarComentario={enviarComentario}
        />
      </div>

      {/* Ações por etapa/papel */}
      <div className="flex flex-wrap gap-2">
        {ehTI && s.status === "ABERTA" && (
          <Button variant="ghost" disabled={salvando} onClick={() => onAgir(() => solicitacoesServicoApi.atender(s.id), "Atendimento assumido.")}>
            Assumir atendimento
          </Button>
        )}
        {ehTI && emAndamento && !encaminhando && (
          <>
            <Button variant="accent" disabled={salvando} onClick={() => onAgir(() => solicitacoesServicoApi.concluir(s.id), "Solicitação concluída.")}>
              Concluir (sem custo)
            </Button>
            <Button variant="ghost" disabled={salvando} onClick={() => setEncaminhando(true)}>
              Precisa de plano pago → Financeiro
            </Button>
          </>
        )}
        {ehFinanceiro && aguardandoFin && (
          <Button variant="accent" disabled={salvando} onClick={() => onAgir(() => solicitacoesServicoApi.concluir(s.id), "Contratação concluída.")}>
            Contratação resolvida — concluir
          </Button>
        )}
        {((ehTI && emAndamento) || (ehFinanceiro && aguardandoFin)) && !recusando && (
          <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" disabled={salvando} onClick={() => setRecusando(true)}>
            Recusar
          </Button>
        )}
      </div>

      {encaminhando && (
        <div className="mt-3 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fornecedor / serviço pago">
              <TextInput value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Ex: Dropbox Business" />
            </Field>
            <Field label="Valor estimado (R$, opcional)">
              <TextInput type="number" step="0.01" value={valorEstimado} onChange={(e) => setValorEstimado(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setEncaminhando(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={salvando}
              onClick={() =>
                onAgir(
                  () => solicitacoesServicoApi.encaminharFinanceiro(s.id, {
                    fornecedor: fornecedor || null,
                    valorEstimado: valorEstimado ? Number(valorEstimado) : null,
                  }),
                  "Encaminhado ao Financeiro."
                ).then(() => setEncaminhando(false))
              }
            >
              Encaminhar
            </Button>
          </div>
        </div>
      )}

      {recusando && (
        <div className="mt-3 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3">
          <Field label="Motivo da recusa">
            <TextArea value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setRecusando(false)}>Cancelar</Button>
            <Button
              variant="danger"
              disabled={salvando || motivo.trim().length < 3}
              onClick={() => onAgir(() => solicitacoesServicoApi.recusar(s.id, motivo), "Solicitação recusada.").then(() => setRecusando(false))}
            >
              Confirmar recusa
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function NovaServicoModal({
  data, onFechar, onSalvar, salvando,
}: {
  data: AppData;
  onFechar: () => void;
  onSalvar: (form: { solicitanteId: string; servico: string; descricao?: string | null; unidadeId?: string | null }) => void;
  salvando: boolean;
}) {
  const [form, setForm] = useState({ solicitanteId: "", servico: "", descricao: "", unidadeId: "" });
  return (
    <Modal title="Nova Solicitação de Serviço" onClose={onFechar}>
      <Field label="Solicitante">
        <Select value={form.solicitanteId} onChange={(e) => setForm({ ...form, solicitanteId: e.target.value })}>
          <option value="">—</option>
          {data.colaboradores.filter((c) => colaboradorOperacionalmenteAtivo(c.status)).map((c) => (
            <option key={c.id} value={c.id}>{c.nomeCompleto}</option>
          ))}
        </Select>
      </Field>
      <Field label="Qual serviço você precisa?">
        <TextInput value={form.servico} onChange={(e) => setForm({ ...form, servico: e.target.value })} placeholder="Ex: Dropbox para o setor de marketing" />
      </Field>
      <Field label="Descreva a necessidade (opcional)">
        <TextArea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Pra que o serviço vai ser usado, quantas pessoas, etc." />
      </Field>
      <Field label="Unidade (opcional)">
        <Select value={form.unidadeId} onChange={(e) => setForm({ ...form, unidadeId: e.target.value })}>
          <option value="">—</option>
          {data.dominios.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
        <Button
          variant="primary"
          disabled={salvando || !form.solicitanteId || form.servico.trim().length < 2}
          onClick={() => onSalvar({
            solicitanteId: form.solicitanteId,
            servico: form.servico.trim(),
            descricao: form.descricao || null,
            unidadeId: form.unidadeId || null,
          })}
        >
          {salvando ? "Abrindo..." : "Abrir solicitação"}
        </Button>
      </div>
    </Modal>
  );
}
