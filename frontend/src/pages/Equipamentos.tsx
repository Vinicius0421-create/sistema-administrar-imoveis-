import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { AppData } from "../hooks/useAppData";
import { equipamentosApi, EquipamentoInput } from "../api/equipamentos";
import { ApiError } from "../lib/apiClient";
import { BotaoExportarCsv, Button, cardClicavelProps, COLORS, EmptyState, Field, fmtDate, fmtMoney, FOCUS_RING_CLASS, FONT_MONO, MenuAcoes, Modal, PageHeader, Paginacao, Select, SearchBox, Spinner, Stamp, TextArea, TextInput, usePaginacaoCliente } from "../components/ui";
import { ArrowLeftRight, Camera, CheckCircle2, ChevronDown, ChevronUp, Download, FileText, Laptop, Pencil, Plus, X } from "../components/icons";
import {
  CATEGORIA_CHAMADO_LABEL, colaboradorOperacionalmenteAtivo, ESTADO_CONSERVACAO_LABEL, Equipamento, EquipamentoAnexo,
  STATUS_CHAMADO_LABEL, STATUS_CHAMADO_TONE, STATUS_EQUIPAMENTO_LABEL, STATUS_EQUIPAMENTO_TONE, StatusEquipamento,
} from "../types";
import { exportarListaCsv } from "../utils/exportarCsv";
import { useFeedback } from "../contexts/FeedbackContext";

interface Props {
  data: AppData;
  readOnly: boolean;
  onChanged: () => void;
  // Semente vinda do dashboard (Fase 4 — Dashboard interativo, 06/07/2026) —
  // clicar num status no gráfico "Equipamentos por status" ou nos KPIs "Em
  // uso"/"Disponíveis" da Home já chega aqui com o filtro certo pronto.
  filtroStatusInicial?: string;
  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — categoria
  // PATRIMONIO (ex: "equipamento atribuído a você") já abre direto o modal
  // de detalhe do equipamento, mesmo padrão de `abrirSolicitacaoId` em
  // Solicitacoes.tsx.
  abrirEquipamentoId?: string;
  // Onda 1.6 (21/07/2026) — a ficha do equipamento passou a listar os
  // chamados de manutenção relacionados (ver seção "Chamados relacionados"
  // no Modal abaixo); quem sabe navegar pro módulo Chamados é o App.tsx
  // (mesmo padrão de `navegarPara` usado a partir de notificações), então
  // aqui só expomos o callback — se não vier (ex: tela ainda sem essa
  // integração), o item simplesmente não fica clicável.
  onAbrirChamado?: (chamadoId: string) => void;
}

// Mesma lista de Historico.tsx (TIPO_EVENTO_LABEL) — duplicada aqui em vez de
// extraída pra types.ts porque essa é a segunda ocorrência, não a terceira;
// mesmo critério já usado em `classePilula` acima.
const TIPO_EVENTO_LABEL: Record<string, string> = {
  ENTREGA: "Entrega",
  TROCA: "Troca",
  DEVOLUCAO: "Devolução",
  MANUTENCAO: "Manutenção",
  BAIXA: "Baixa",
};

// EMPRESTADO/PERDIDO/DESCARTADO adicionados na Evolução Completa (07/2026).
const STATUS_OPCOES: StatusEquipamento[] = [
  "EM_USO", "DISPONIVEL", "EM_MANUTENCAO", "EMPRESTADO", "BAIXADO", "PERDIDO", "DESCARTADO",
];

// Mesmo padrão de pílula do alternador de abas do Hub de Solicitações
// (ver classePilula em SolicitacoesHub.tsx) — reaproveitado aqui em vez de
// extrair pra ui.tsx porque é a segunda ocorrência, não a terceira; se um
// terceiro lugar precisar do mesmo controle, aí sim vale a pena compartilhar.
function classePilula(ativa: boolean): string {
  return `px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors duration-[var(--motion-fast)] ${ativa ? "bg-slate-900 text-white" : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`;
}

// Achado do Vini (28/07/2026, revisão da categoria "Produção de Conteúdo"):
// ao trocar a Categoria no formulário, `tipo` é pré-preenchido com o NOME da
// categoria (ver `mudarCategoria` no formulário mais abaixo) — então pra um
// equipamento comum (ex: categoria "Notebook") é normal `tipo === categoria.
// nome`. Mas quando alguém edita `tipo` pra ser mais específico do que a
// categoria (ex: categoria "Produção de Conteúdo" + tipo "Câmera"/
// "Microfone"/"Gimbal"), card, ficha de detalhe e exportação CSV mostravam
// só `categoria?.nome` — os 3 equipamentos de Produção de Conteúdo apareciam
// TODOS com o mesmo título "Produção de Conteúdo", sem nenhuma forma de
// distinguir qual é qual sem abrir um por um pra ler o campo Tipo. `tipo` é
// sempre a informação mais específica (obrigatório, nunca vazio) — vira o
// título principal em todo lugar; a categoria só aparece como informação
// secundária, e só quando de fato acrescenta algo (é diferente do tipo).
function categoriaSecundaria(e: { tipo: string; categoria?: { nome: string } | null }): string | null {
  if (!e.categoria) return null;
  return e.categoria.nome.trim().toLowerCase() === e.tipo.trim().toLowerCase() ? null : e.categoria.nome;
}

// QR Code do ativo (Onda 3.1 do redesenho, 21/07/2026 — item 11 da
// auditoria). Gerado 100% no navegador (biblioteca `qrcode`, só canvas/data
// URL, sem chamada ao backend) — ver decisão de não criar coluna nova no
// banco no comentário do model Equipamento em schema.prisma. Recalcula só
// quando o `equipamentoId` muda (troca de equipamento selecionado), não a
// cada render.
//
// Correção (22/07/2026, achado do Vini: "Os Qr code não levam a lugar
// nenhum, são só um texto") — até aqui o QR codificava só o patrimônio/id
// como TEXTO PURO: escanear com a câmera do celular mostrava aquele texto
// solto, sem nenhuma ação, porque não é uma URL. Agora codifica um link de
// verdade (`{origem}/ativo/:id`) — o app não tem router de páginas de
// verdade (é uma SPA de tela única, ver comentário sobre `/redefinir-senha`
// em App.tsx), então esse caminho é tratado como um "deep link" especial: ao
// abrir, pede login se precisar e cai direto na Ficha de Ativo deste
// equipamento (ver `extrairIdAtivoDaUrl`/uso em App.tsx). O texto abaixo do
// QR continua mostrando o patrimônio (ou id, sem patrimônio) — é o rótulo
// PRA PESSOA ler, o link é só o que a câmera decodifica.
function QRCodeAtivo({ equipamentoId, patrimonio }: { equipamentoId: string; patrimonio: string | null }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const url = `${window.location.origin}/ativo/${equipamentoId}`;
  useEffect(() => {
    let cancelado = false;
    QRCode.toDataURL(url, { width: 120, margin: 1 })
      .then((u) => { if (!cancelado) setDataUrl(u); })
      .catch(() => { if (!cancelado) setDataUrl(null); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipamentoId]);

  const rotulo = patrimonio || equipamentoId;

  return (
    <div className="flex items-center gap-3 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700 p-3">
      {dataUrl ? (
        <img src={dataUrl} alt={`QR Code do ativo ${rotulo}`} width={72} height={72} className="rounded bg-white p-1" />
      ) : (
        <div className="w-[72px] h-[72px] rounded bg-gray-200 dark:bg-slate-700 animate-pulse" />
      )}
      <div className="min-w-0">
        <span className="text-gray-500 dark:text-slate-400 text-xs uppercase block">QR Code do ativo</span>
        <span className="text-slate-700 dark:text-slate-300 text-xs break-all" style={{ fontFamily: FONT_MONO }}>{rotulo}</span>
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">Cole no equipamento — escaneando, abre a ficha dele direto no sistema.</p>
      </div>
    </div>
  );
}

export function EquipamentosPage({ data, readOnly, onChanged, filtroStatusInicial, abrirEquipamentoId, onAbrirChamado }: Props) {
  const { sucesso } = useFeedback();
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState(filtroStatusInicial || "");
  // Modernização de filtros (07/08/2026, pedido do Vini) — a busca livre já
  // pega o nome da categoria dentro do texto (ver `alvo` abaixo), mas exige
  // digitar; um Select de Categoria deixa achar "todos os notebooks", por
  // exemplo, com um clique só — mesmo padrão do filtro de Cargo em
  // Colaboradores.tsx (só aparece se já existir alguma categoria cadastrada).
  const [filtroCategoriaId, setFiltroCategoriaId] = useState("");
  const [editing, setEditing] = useState<Partial<Equipamento> | null>(null);
  const [selected, setSelected] = useState<Equipamento | null>(
    () => (abrirEquipamentoId ? data.equipamentos.find((e) => e.id === abrirEquipamentoId) || null : null)
  );
  const [transferindo, setTransferindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<"idle" | "confirmando" | "processando">("idle");
  // Ficha de Ativo com abas (Onda 3.1 do redesenho, 21/07/2026 — item 11 da
  // auditoria, seção 1.5: "modal de detalhe vira uma 'ficha de ativo' com
  // abas (Visão geral / Histórico / Manutenções / Documentos), não um
  // formulário único longo"). Antes disso a Onda 1.6 já tinha exposto
  // Histórico e Chamados relacionados, mas tudo num scroll único; aqui é só
  // reorganizar em abas — nenhum dado novo nessas duas, só os campos de
  // CMDB (garantia/fornecedor/nota fiscal/valor/depreciação) são
  // efetivamente novos, na aba Visão geral. Reseta pra "visao-geral" toda
  // vez que um equipamento DIFERENTE é aberto (não a cada re-render com o
  // mesmo `selected`, ver o `useEffect` logo abaixo) — ver `selected?.id`
  // na lista de dependências.
  const [abaDetalhe, setAbaDetalhe] = useState<"visao-geral" | "historico" | "manutencoes" | "documentos">("visao-geral");
  useEffect(() => {
    if (selected) setAbaDetalhe("visao-geral");
  }, [selected?.id]);
  // Ordenação clicável (Fase 3 — Componentes Inteligentes, 14/07/2026) —
  // client-side, o array já está inteiro em memória. "Tipo" é o campo mais
  // próximo de um "nome" que Equipamento tem; "Aquisição" usa dataAquisicao
  // (pode ser null em equipamentos antigos — ficam por último em ambos os
  // sentidos, não somem nem quebram a ordenação do resto).
  const [ordenacao, setOrdenacao] = useState<"tipo_asc" | "tipo_desc" | "aquisicao_recente" | "aquisicao_antiga">("tipo_asc");

  // Seleção múltipla + ações em lote (Fase 3 — Componentes Inteligentes,
  // 14/07/2026) — Equipamentos é o caso de uso mais real do sistema pra
  // isso: onboarding/desligamento em bloco (ex: notebook + monitor + mouse
  // do mesmo colaborador, tudo de uma vez, em vez de abrir cada item e
  // transferir/devolver um por um). Não existe endpoint de lote no backend
  // — cada ação dispara N chamadas ao endpoint já existente via
  // Promise.allSettled (não Promise.all: uma falha isolada não deve
  // cancelar as demais nem deixar o resultado ambíguo sobre o que passou).
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [acaoLote, setAcaoLote] = useState<null | "transferir" | "excluir">(null);
  const [loteSalvando, setLoteSalvando] = useState(false);
  const [loteErro, setLoteErro] = useState<string | null>(null);

  function alternarSelecao(id: string) {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  function sairDoModoSelecao() {
    setModoSelecao(false);
    setSelecionados(new Set());
    setAcaoLote(null);
    setLoteErro(null);
  }

  async function executarEmLote(fn: (id: string) => Promise<any>, sucessoMsg: (n: number) => string) {
    setLoteSalvando(true);
    setLoteErro(null);
    const ids = Array.from(selecionados);
    const resultados = await Promise.allSettled(ids.map((id) => fn(id)));
    const falhas = resultados.filter((r) => r.status === "rejected").length;
    await onChanged();
    setLoteSalvando(false);
    if (falhas === 0) {
      sucesso(sucessoMsg(ids.length));
      sairDoModoSelecao();
    } else {
      setLoteErro(`${ids.length - falhas} de ${ids.length} concluído(s) com sucesso — ${falhas} falharam. Os itens que falharam continuam selecionados.`);
      // Mantém selecionados só os que falharam, pra facilitar tentar de novo.
      const falharam = ids.filter((_, i) => resultados[i].status === "rejected");
      setSelecionados(new Set(falharam));
      setAcaoLote(null);
    }
  }

  function transferirEmLote(novoColaboradorId: string) {
    executarEmLote(
      (id) => equipamentosApi.update(id, { colaboradorId: novoColaboradorId || null }),
      (n) => `${n} equipamento(s) transferido(s) com sucesso.`
    );
  }

  function excluirEmLote() {
    executarEmLote(
      (id) => equipamentosApi.remove(id),
      (n) => `${n} equipamento(s) excluído(s) com sucesso.`
    );
  }

  const filtrosAtivos = !!(busca || filtroStatus || filtroCategoriaId);
  function limparFiltros() {
    setBusca("");
    setFiltroStatus("");
    setFiltroCategoriaId("");
  }

  const filtrados = data.equipamentos
    .filter((e) => {
      if (filtroStatus && e.status !== filtroStatus) return false;
      if (filtroCategoriaId && e.categoriaId !== filtroCategoriaId) return false;
      if (busca) {
        const alvo = `${e.tipo} ${e.modelo || ""} ${e.numeroSerie || ""} ${e.patrimonio || ""} ${e.localizacao || ""} ${e.colaborador?.nomeCompleto || ""} ${e.categoria?.nome || ""} ${e.marcaEquipamento?.nome || ""}`.toLowerCase();
        if (!alvo.includes(busca.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (ordenacao === "tipo_asc") return a.tipo.localeCompare(b.tipo);
      if (ordenacao === "tipo_desc") return b.tipo.localeCompare(a.tipo);
      // Sem data cadastrada sempre fica por último, independente do
      // sentido — o fallback (+/-Infinity) muda de sinal conforme a
      // direção pra garantir isso nos dois casos.
      const semData = ordenacao === "aquisicao_recente" ? -Infinity : Infinity;
      const da = a.dataAquisicao ? new Date(a.dataAquisicao).getTime() : semData;
      const db = b.dataAquisicao ? new Date(b.dataAquisicao).getTime() : semData;
      return ordenacao === "aquisicao_recente" ? db - da : da - db;
    });

  // Paginação no cliente (achado A4 do check-up, 22/07/2026) — Equipamentos
  // era a única entre 6 telas de listagem principais sem isso (Colaboradores,
  // Linhas, Acessos, Movimentações e Histórico já usavam `usePaginacaoCliente`
  // desde a Fase 2, 14/07/2026). Mesmo padrão exato de Colaboradores.tsx: a
  // busca/filtro/ordenação continuam operando sobre `filtrados` (lista
  // inteira, pros KPIs e pra exportação CSV abaixo baterem com o que a busca
  // encontrou), só a RENDERIZAÇÃO do grid é cortada em páginas.
  const { itensPagina: filtradosPagina, pagina, totalPaginas, setPagina, total, inicioExibicao, fimExibicao } =
    usePaginacaoCliente(filtrados, 24);

  // "Consulta Rápida" (10/07/2026) — mesma lógica de Colaboradores.tsx:
  // exporta exatamente a lista filtrada acima, com as colunas mais úteis
  // pra quem administra o patrimônio (tipo/categoria, marca/modelo,
  // identificação, status, dono atual e localização).
  function exportarEquipamentos() {
    exportarListaCsv(
      filtrados,
      [
        { cabecalho: "Categoria/Tipo", valor: (e) => (categoriaSecundaria(e) ? `${e.categoria!.nome} — ${e.tipo}` : e.categoria?.nome || e.tipo) },
        { cabecalho: "Marca", valor: (e) => e.marcaEquipamento?.nome || e.marca },
        { cabecalho: "Modelo", valor: (e) => e.modelo },
        { cabecalho: "Nº de série", valor: (e) => e.numeroSerie },
        { cabecalho: "Patrimônio", valor: (e) => e.patrimonio },
        { cabecalho: "Status", valor: (e) => STATUS_EQUIPAMENTO_LABEL[e.status] },
        { cabecalho: "Colaborador", valor: (e) => e.colaborador?.nomeCompleto },
        { cabecalho: "Localização", valor: (e) => e.localizacao },
      ],
      "equipamentos"
    );
  }

  async function salvar(form: EquipamentoInput & { id?: string }) {
    setSalvando(true);
    setErro(null);
    try {
      if (form.id) {
        const { id, ...resto } = form;
        await equipamentosApi.update(id, resto);
      } else {
        await equipamentosApi.create(form);
      }
      await onChanged();
      setEditing(null);
      sucesso(form.id ? "Equipamento atualizado com sucesso." : "Equipamento cadastrado com sucesso.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  // Baixa o termo de responsabilidade preenchido (17/07/2026, pedido do
  // Vini) — usado tanto pelo botão no detalhe quanto automaticamente após
  // uma transferência pra colaborador.
  async function baixarTermo(equipId: string, nomeColaborador?: string) {
    const { blob, nomeArquivo } = await equipamentosApi.gerarTermoPreenchido(equipId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo || `termo-responsabilidade${nomeColaborador ? `-${nomeColaborador}` : ""}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function transferir(equip: Equipamento, novoColaboradorId: string) {
    setSalvando(true);
    setErro(null);
    try {
      await equipamentosApi.update(equip.id, { colaboradorId: novoColaboradorId || null });
      await onChanged();
      setSelected(null);
      setTransferindo(false);
      // Termo preenchido sai sozinho a cada entrega a um colaborador
      // (17/07/2026, pedido do Vini: "toda vez que eu passar o equipamento
      // para outro colaborador, gere um termo para ele assinar"). Falha na
      // geração não desfaz a transferência (que já foi salva) — o botão
      // "Termo de responsabilidade" no detalhe cobre a re-tentativa.
      if (novoColaboradorId) {
        try {
          await baixarTermo(equip.id);
          sucesso("Equipamento transferido — termo de responsabilidade gerado para assinatura.");
        } catch {
          sucesso("Equipamento transferido. (Não foi possível gerar o termo agora — use o botão no detalhe.)");
        }
      } else {
        sucesso("Equipamento transferido com sucesso.");
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível transferir.");
    } finally {
      setSalvando(false);
    }
  }

  async function devolverAoEstoque(equip: Equipamento) {
    setSalvando(true);
    try {
      await equipamentosApi.devolver(equip.id);
      await onChanged();
      setSelected(null);
      sucesso("Equipamento devolvido ao estoque.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível devolver ao estoque.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: string) {
    setExcluindo("processando");
    try {
      await equipamentosApi.remove(id);
      await onChanged();
      setSelected(null);
      setExcluindo("idle");
      sucesso("Equipamento excluído com sucesso.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
      setExcluindo("idle");
    }
  }

  return (
    <div>
      <PageHeader
        title="Equipamentos"
        subtitle={`${filtrados.length} de ${data.equipamentos.length} registros`}
        actions={
          <>
            <BotaoExportarCsv onClick={exportarEquipamentos} quantidade={filtrados.length} />
            {!readOnly && (
              <Button variant="ghost" onClick={() => (modoSelecao ? sairDoModoSelecao() : setModoSelecao(true))}>
                {modoSelecao ? "Cancelar seleção" : "Selecionar"}
              </Button>
            )}
            {!readOnly && !modoSelecao && (
              <Button variant="accent" onClick={() => setEditing({})}>
                <Plus size={16} /> Novo Equipamento
              </Button>
            )}
          </>
        }
      />

      {/* Barra de ações em lote (Fase 3, 14/07/2026) — só aparece com pelo
          menos 1 item selecionado; fica presa entre o cabeçalho e os
          filtros, no mesmo lugar em qualquer volume de seleção. */}
      {modoSelecao && selecionados.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4 bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] px-3.5 py-2.5">
          <span className="text-sm font-semibold text-brand-800 dark:text-brand-300">
            {selecionados.size} selecionado(s)
          </span>
          <div className="flex flex-wrap gap-2 ml-auto">
            <Button variant="ghost" onClick={() => setAcaoLote("transferir")} disabled={loteSalvando}>
              <ArrowLeftRight size={14} /> Transferir
            </Button>
            <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => setAcaoLote("excluir")} disabled={loteSalvando}>
              <X size={14} /> Excluir
            </Button>
          </div>
        </div>
      )}
      {loteErro && (
        <div className="mb-4 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">
          {loteErro}
        </div>
      )}

      {/* Aba "Em estoque" (17/07/2026, pedido do Vini: "na parte de
          equipamentos ter uma aba só para aquele que está em estoque") — já
          existia um jeito de chegar nesse mesmo recorte (dropdown "Filtrar
          por status" → "Disponível", ou clicar no KPI "Disponíveis" da Home),
          mas exigia abrir um select ou vir de outra tela. O pedido aqui é
          claramente por um atalho de 1 clique direto na própria página —
          mesmo padrão visual do alternador Equipamentos/Papelaria em
          SolicitacoesHub.tsx. Reaproveita o MESMO estado `filtroStatus` do
          dropdown logo abaixo em vez de criar um estado paralelo: clicar na
          pílula atualiza o dropdown (e vice-versa), sem risco dos dois
          discordarem entre si. "Em estoque" = `status === "DISPONIVEL"`,
          exatamente o status que `devolverAoEstoque` (endpoint
          POST /equipamentos/:id/devolver) já grava ao devolver um
          equipamento — não é um conceito novo, só um rótulo mais direto que
          "Disponível" pra bater com a forma como o Vini chama isso no dia a
          dia. */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-full p-1 mb-3 w-fit">
        <button onClick={() => setFiltroStatus("")} className={classePilula(filtroStatus === "")}>
          Todos
        </button>
        <button onClick={() => setFiltroStatus("DISPONIVEL")} className={classePilula(filtroStatus === "DISPONIVEL")}>
          Em estoque
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        {/* Achado de auditoria (08/07/2026, Etapa 7 — Responsividade): o
            placeholder antigo enumerava os 6 campos pesquisáveis
            ("tipo, modelo, série, patrimônio, local ou pessoa") — 63
            caracteres que estouravam a largura fixa do SearchBox (max-w-xs,
            320px) em qualquer breakpoint, cortando o texto no meio da
            palavra. A busca continua cobrindo os mesmos campos (ver `alvo`
            acima); só o texto de exemplo ficou mais curto, no mesmo padrão
            enxuto usado pelo SearchBox de outras páginas (ex: "Buscar por
            nome..." em Colaboradores). */}
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar equipamento..." />
        <Select aria-label="Filtrar por status" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_OPCOES.map((s) => <option key={s} value={s}>{STATUS_EQUIPAMENTO_LABEL[s]}</option>)}
        </Select>
        {data.dominios.categoriasEquipamento.length > 0 && (
          <Select aria-label="Filtrar por categoria" value={filtroCategoriaId} onChange={(e) => setFiltroCategoriaId(e.target.value)}>
            <option value="">Todas as categorias</option>
            {data.dominios.categoriasEquipamento.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        )}
        <Select aria-label="Ordenar por" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as typeof ordenacao)}>
          <option value="tipo_asc">Tipo (A-Z)</option>
          <option value="tipo_desc">Tipo (Z-A)</option>
          <option value="aquisicao_recente">Aquisição mais recente</option>
          <option value="aquisicao_antiga">Aquisição mais antiga</option>
        </Select>
        {filtrosAtivos && <Button variant="ghost" onClick={limparFiltros}>Limpar filtros</Button>}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtradosPagina.map((e) => {
          const marcado = selecionados.has(e.id);
          const aoClicar = modoSelecao ? () => alternarSelecao(e.id) : () => setSelected(e);
          return (
            <div
              key={e.id}
              onClick={aoClicar}
              {...cardClicavelProps(aoClicar)}
              className={`card-entrada bg-white dark:bg-slate-900 border rounded-[var(--radius-card)] p-4 cursor-pointer shadow-[var(--elevation-1)] hover:shadow-[var(--elevation-2)] transition-all ${FOCUS_RING_CLASS} ${
                marcado ? "border-brand-600 ring-2 ring-brand-600/20" : "border-gray-100 dark:border-slate-700 hover:border-brand-600/50"
              }`}
            >
              <div className="flex items-start justify-between mb-1 gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {modoSelecao && (
                    <span
                      className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${
                        marcado ? "bg-brand-600 border-brand-600" : "border-gray-300 dark:border-slate-600"
                      }`}
                      aria-hidden="true"
                    >
                      {marcado && <CheckCircle2 size={12} className="text-white" />}
                    </span>
                  )}
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug min-w-0">
                    {e.tipo}{e.modelo && ` — ${e.modelo}`}
                    {categoriaSecundaria(e) && (
                      <span className="block text-[11px] font-normal text-gray-400 dark:text-slate-500">{categoriaSecundaria(e)}</span>
                    )}
                  </h4>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Stamp tone={STATUS_EQUIPAMENTO_TONE[e.status]}>{STATUS_EQUIPAMENTO_LABEL[e.status]}</Stamp>
                  {/* Menu de contexto (Fase 3, 14/07/2026, tarefa #164) —
                      Equipamentos era a única listagem de cards do sistema
                      sem NENHUMA ação inline: as 3 ações mais usadas (editar,
                      transferir, devolver ao estoque) exigiam abrir o
                      detalhe completo primeiro. Some durante o modo de
                      seleção em lote — as duas coisas juntas confundiriam
                      mais do que ajudariam. */}
                  {!readOnly && !modoSelecao && (
                    <MenuAcoes
                      itens={[
                        { label: "Editar", icon: Pencil, onClick: () => setEditing(e) },
                        { label: "Transferir", icon: ArrowLeftRight, onClick: () => { setSelected(e); setTransferindo(true); } },
                        ...(e.status !== "BAIXADO" && e.colaboradorId
                          ? [{ label: "Devolver ao estoque", onClick: () => devolverAoEstoque(e) }]
                          : []),
                        { label: "Excluir", destrutivo: true, onClick: () => { setSelected(e); setExcluindo("confirmando"); } },
                      ]}
                    />
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400" style={{ fontFamily: FONT_MONO }}>
                {e.patrimonio ? `Patrimônio ${e.patrimonio}` : (e.numeroSerie || "sem nº de série")}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                {/* "De quem era" (17/07/2026, pedido do Vini) — item no
                    estoque mostra o dono anterior em vez de só "sem dono",
                    pra identificar de quem era o celular/notebook devolvido
                    no desligamento. */}
                {e.colaborador?.nomeCompleto ||
                  (e.ultimoColaborador ? `Estoque · era de ${e.ultimoColaborador.nomeCompleto}` : "— sem dono —")}
                {e.localizacao && ` · ${e.localizacao}`}
              </p>
            </div>
          );
        })}
        {filtrados.length === 0 && <EmptyState icon={Laptop} text="Nenhum equipamento encontrado." />}
      </div>
      <Paginacao
        pagina={pagina}
        totalPaginas={totalPaginas}
        onChange={setPagina}
        total={total}
        inicioExibicao={inicioExibicao}
        fimExibicao={fimExibicao}
        itemLabel="equipamentos"
      />

      {/* Modal de confirmação das ações em lote (Fase 3, 14/07/2026) — fora
          do modal de detalhe de um item específico (`selected`), porque
          aqui a ação vale pra N itens selecionados ao mesmo tempo. */}
      {acaoLote === "transferir" && (
        <Modal title={`Transferir ${selecionados.size} equipamento(s)`} onClose={() => setAcaoLote(null)}>
          <TransferirForm
            colaboradores={data.colaboradores}
            colaboradorAtualId={null}
            salvando={loteSalvando}
            onCancelar={() => setAcaoLote(null)}
            onConfirmar={(novoId) => transferirEmLote(novoId)}
          />
        </Modal>
      )}
      {acaoLote === "excluir" && (
        <Modal title={`Excluir ${selecionados.size} equipamento(s)`} onClose={() => setAcaoLote(null)}>
          <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
            Isso apaga {selecionados.size} equipamento(s) definitivamente — sem desfazer. Confirma?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAcaoLote(null)} disabled={loteSalvando}>Cancelar</Button>
            <Button variant="danger" onClick={excluirEmLote} disabled={loteSalvando}>
              {loteSalvando ? "Excluindo..." : "Confirmar exclusão"}
            </Button>
          </div>
        </Modal>
      )}

      {selected && (
        <Modal title={selected.tipo} onClose={() => { setSelected(null); setExcluindo("idle"); setTransferindo(false); }}>
          {/* Ficha de Ativo com abas (Onda 3.1 do redesenho, 21/07/2026 —
              item 11 da auditoria). Mesma pílula de aba já usada no alternador
              de Solicitações (`classePilula`, ver comentário no topo deste
              arquivo) — 2ª ocorrência dentro deste MESMO arquivo, não
              justifica virar componente compartilhado ainda. */}
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-full p-1 mb-4 w-fit flex-wrap">
            <button onClick={() => setAbaDetalhe("visao-geral")} className={classePilula(abaDetalhe === "visao-geral")}>Visão geral</button>
            <button onClick={() => setAbaDetalhe("historico")} className={classePilula(abaDetalhe === "historico")}>
              Histórico ({data.historico.filter((h) => h.equipamentoId === selected.id).length})
            </button>
            <button onClick={() => setAbaDetalhe("manutencoes")} className={classePilula(abaDetalhe === "manutencoes")}>
              Manutenções ({data.chamados.filter((c) => c.equipamentoId === selected.id).length})
            </button>
            <button onClick={() => setAbaDetalhe("documentos")} className={classePilula(abaDetalhe === "documentos")}>
              Documentos ({selected.anexos?.length ?? 0})
            </button>
          </div>

          {abaDetalhe === "visao-geral" && (
            <div className="space-y-2 text-sm mb-4">
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Categoria</span><br />{selected.categoria?.nome || selected.tipo}</div>
              {categoriaSecundaria(selected) && (
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Tipo</span><br />{selected.tipo}</div>
              )}
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Marca / Modelo</span><br />{selected.marcaEquipamento?.nome || selected.marca || "—"}{selected.modelo && ` — ${selected.modelo}`}</div>
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Número de série</span><br /><span style={{ fontFamily: FONT_MONO }}>{selected.numeroSerie || "—"}</span></div>
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Patrimônio</span><br /><span style={{ fontFamily: FONT_MONO }}>{selected.patrimonio || "—"}</span></div>
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Status</span><br /><Stamp tone={STATUS_EQUIPAMENTO_TONE[selected.status]}>{STATUS_EQUIPAMENTO_LABEL[selected.status]}</Stamp></div>
              <div>
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Colaborador responsável</span><br />
                {selected.colaborador?.nomeCompleto || "— sem dono —"}
                {/* "De quem era" (17/07/2026) — só quando está no estoque. */}
                {!selected.colaborador && selected.ultimoColaborador && (
                  <span className="block text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    Era de {selected.ultimoColaborador.nomeCompleto}
                  </span>
                )}
              </div>
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Localização</span><br />{selected.localizacao || "—"}</div>
              {/* Achado de auditoria (08/07/2026, Etapa 8 — Consistência): esta
                  era a única data-only do sistema formatada com
                  `new Date(iso).toLocaleDateString("pt-BR")` sem `timeZone:
                  "UTC"` — `new Date("2024-03-15")` vale meia-noite UTC, e sem
                  fixar o fuso o navegador converte pro horário local (UTC-3 no
                  Brasil) antes de formatar, exibindo 14/03 em vez de 15/03. O
                  resto do sistema já resolve isso com `fmtDate` (ui.tsx), que
                  lê a data como string sem nunca instanciar `Date`. */}
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Data de aquisição</span><br />{fmtDate(selected.dataAquisicao)}</div>

              {/* CMDB completo (Onda 3.1 do redesenho, 21/07/2026 — item 11 da
                  auditoria, seção 1.5): os 6 campos que a auditoria encontrou
                  faltando no banco. Cada um só aparece se preenchido (mesmo
                  critério já usado acima pra Acessórios/Observações) — a
                  maioria dos equipamentos já cadastrados não vai ter nenhum
                  deles retroativamente, e não faz sentido mostrar 5 "—"
                  seguidos pra todo equipamento antigo. */}
              {selected.fornecedor && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Fornecedor</span><br />{selected.fornecedor}</div>}
              {selected.notaFiscal && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Nota fiscal</span><br /><span style={{ fontFamily: FONT_MONO }}>{selected.notaFiscal}</span></div>}
              {selected.garantiaAte && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Garantia até</span><br />{fmtDate(selected.garantiaAte)}</div>}
              {(selected.valorAquisicao != null || selected.vidaUtilMeses != null) && (
                <div className="bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700 p-3 grid grid-cols-2 gap-2">
                  {selected.valorAquisicao != null && (
                    <div><span className="text-gray-500 dark:text-slate-400 text-[11px] uppercase">Valor de aquisição</span><br />{fmtMoney(selected.valorAquisicao)}</div>
                  )}
                  {selected.vidaUtilMeses != null && (
                    <div><span className="text-gray-500 dark:text-slate-400 text-[11px] uppercase">Vida útil</span><br />{selected.vidaUtilMeses} meses</div>
                  )}
                  {/* Depreciação/valor atual — CALCULADOS pelo backend a cada
                      leitura (ver `comDepreciacao` em equipamentos.routes.ts),
                      nunca guardados; só aparecem quando os 3 campos-base
                      (valor + data de aquisição + vida útil) existem juntos. */}
                  {selected.valorAtual != null && (
                    <div><span className="text-gray-500 dark:text-slate-400 text-[11px] uppercase">Valor atual (depreciado)</span><br /><span className="font-semibold">{fmtMoney(selected.valorAtual)}</span></div>
                  )}
                  {selected.depreciacaoAcumulada != null && (
                    <div><span className="text-gray-500 dark:text-slate-400 text-[11px] uppercase">Depreciação acumulada</span><br />{fmtMoney(selected.depreciacaoAcumulada)}</div>
                  )}
                </div>
              )}

              {/* QR Code (item 11 da auditoria) — gerado no momento, no
                  navegador, a partir do patrimônio (ou do id quando não há
                  patrimônio cadastrado) — decisão de não guardar imagem/código
                  no banco, ver comentário no model Equipamento em
                  schema.prisma. Serve pra colar uma etiqueta física no
                  equipamento e escanear depois pra identificar rápido. */}
              <QRCodeAtivo equipamentoId={selected.id} patrimonio={selected.patrimonio} />

              {/* Acessórios inclusos (17/07/2026, pedido do Vini: "colocar se
                  vem com acessório ou não, por exemplo, se o notebook vem com
                  teclado, mouse ou mesmo carregador") — só aparece a linha se
                  o equipamento tiver ao menos 1 acessório vinculado, pra não
                  poluir o detalhe dos que não têm nenhum. */}
              {!!selected.acessorios?.length && (
                <div>
                  <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Acessórios inclusos</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {selected.acessorios.map((a) => <Stamp key={a.id}>{a.acessorio.nome}</Stamp>)}
                  </div>
                </div>
              )}
              {selected.observacoes && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Observações</span><br />{selected.observacoes}</div>}
            </div>
          )}

          {/* Histórico de movimentações (Onda 1.6, 21/07/2026 — Problema 5 do
              redesign: CMDB simplificado; reorganizado em aba própria na
              Onda 3.1). Já vem inteiro em `data` (mesmo AppData usado no
              resto da tela), então é só filtrar por equipamentoId — sem
              chamada nova à API. */}
          {abaDetalhe === "historico" && (
            <div className="mb-4">
              <ul className="space-y-1.5">
                {data.historico
                  .filter((h) => h.equipamentoId === selected.id)
                  .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
                  .map((h) => (
                    <li key={h.id} className="text-xs border-b border-gray-200 dark:border-slate-700 pb-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          <Stamp>{TIPO_EVENTO_LABEL[h.tipoEvento] || h.tipoEvento}</Stamp>
                        </span>
                        <span className="text-gray-500 dark:text-slate-400 shrink-0">{fmtDate(h.data)}</span>
                      </div>
                      {(h.colaboradorOrigem || h.colaboradorDestino) && (
                        <p className="text-gray-600 dark:text-slate-300 mt-1 break-words">
                          {h.colaboradorOrigem?.nomeCompleto || "Estoque"} → {h.colaboradorDestino?.nomeCompleto || "Estoque"}
                        </p>
                      )}
                    </li>
                  ))}
                {data.historico.filter((h) => h.equipamentoId === selected.id).length === 0 && (
                  <li className="text-xs text-gray-500 dark:text-slate-400">Nenhum registro.</li>
                )}
              </ul>
            </div>
          )}

          {/* Manutenções (chamados relacionados, mesma origem da Onda 1.6 —
              renomeada de "Chamados relacionados" pra "Manutenções" nesta
              aba, seguindo o rótulo que a própria auditoria usou na seção
              1.5; o conteúdo é o mesmo, sem mudança de dado). */}
          {abaDetalhe === "manutencoes" && (
            <div className="mb-4">
              <ul className="space-y-1.5">
                {data.chamados
                  .filter((c) => c.equipamentoId === selected.id)
                  .sort((a, b) => new Date(b.dataAbertura).getTime() - new Date(a.dataAbertura).getTime())
                  .map((c) => (
                    <li key={c.id} className="text-xs border-b border-gray-200 dark:border-slate-700 pb-1.5">
                      {onAbrirChamado ? (
                        <button
                          className={`text-left w-full hover:text-brand-600 dark:hover:text-brand-400 ${FOCUS_RING_CLASS}`}
                          onClick={() => onAbrirChamado(c.id)}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-medium">#{c.numero} · {CATEGORIA_CHAMADO_LABEL[c.categoria]}</span>
                            <Stamp tone={STATUS_CHAMADO_TONE[c.status]}>{STATUS_CHAMADO_LABEL[c.status]}</Stamp>
                          </span>
                          <span className="block text-gray-500 dark:text-slate-400 mt-0.5">{fmtDate(c.dataAbertura)}</span>
                        </button>
                      ) : (
                        <>
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-medium">#{c.numero} · {CATEGORIA_CHAMADO_LABEL[c.categoria]}</span>
                            <Stamp tone={STATUS_CHAMADO_TONE[c.status]}>{STATUS_CHAMADO_LABEL[c.status]}</Stamp>
                          </span>
                          <span className="block text-gray-500 dark:text-slate-400 mt-0.5">{fmtDate(c.dataAbertura)}</span>
                        </>
                      )}
                    </li>
                  ))}
                {data.chamados.filter((c) => c.equipamentoId === selected.id).length === 0 && (
                  <li className="text-xs text-gray-500 dark:text-slate-400">Nenhum chamado.</li>
                )}
              </ul>
            </div>
          )}

          {abaDetalhe === "documentos" && (
            <AnexosEquipamento equipamento={selected} onAtualizado={onChanged} readOnly={readOnly} />
          )}

          {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}
          {!readOnly && (
            transferindo ? (
              <TransferirForm
                colaboradores={data.colaboradores}
                colaboradorAtualId={selected.colaboradorId}
                salvando={salvando}
                onCancelar={() => setTransferindo(false)}
                onConfirmar={(novoId) => transferir(selected, novoId)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => { setEditing(selected); setSelected(null); }}>Editar</Button>
                <Button variant="ghost" onClick={() => setTransferindo(true)}>
                  <ArrowLeftRight size={14} /> Transferir
                </Button>
                {/* Termo preenchido (17/07/2026, pedido do Vini) — só faz
                    sentido com colaborador atual; o termo sai completo
                    (nome/CPF/número + dados do equipamento), só assinar.
                    Ele também baixa sozinho após cada transferência. */}
                {selected.colaboradorId && (
                  <Button
                    variant="ghost"
                    onClick={() => baixarTermo(selected.id, selected.colaborador?.nomeCompleto).then(
                      () => sucesso("Termo de responsabilidade gerado."),
                      () => setErro("Não foi possível gerar o termo.")
                    )}
                  >
                    <FileText size={14} /> Termo de responsabilidade
                  </Button>
                )}
                {selected.colaboradorId && (
                  <Button variant="danger" onClick={() => devolverAoEstoque(selected)} disabled={salvando}>
                    Devolver ao Estoque
                  </Button>
                )}
                {excluindo === "confirmando" ? (
                  <>
                    <span className="text-xs text-brand-700 dark:text-brand-400 self-center">Excluir de vez, sem desfazer?</span>
                    <Button variant="ghost" onClick={() => setExcluindo("idle")}>Cancelar</Button>
                    <Button variant="danger" onClick={() => excluir(selected.id)} disabled={excluindo !== "confirmando"}>
                      Confirmar exclusão
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => setExcluindo("confirmando")}>
                    Excluir
                  </Button>
                )}
              </div>
            )
          )}
        </Modal>
      )}

      {editing && (
        <EquipamentoForm
          initial={editing}
          colaboradores={data.colaboradores}
          categorias={data.dominios.categoriasEquipamento}
          marcas={data.dominios.marcasEquipamento}
          acessorios={data.dominios.acessoriosEquipamento}
          onSave={salvar}
          onClose={() => { setEditing(null); setErro(null); }}
          salvando={salvando}
          erro={erro}
        />
      )}
    </div>
  );
}

// Ação dedicada de transferência direta entre colaboradores — pedida
// explicitamente na Evolução Completa ("transferir patrimônio diretamente
// entre colaboradores"). Tecnicamente já era possível via PUT (mudando
// colaboradorId no formulário completo de edição), mas isso obrigava a
// pessoa a passar por todos os outros campos; aqui é uma ação de 1 clique
// que só toca no vínculo, gerando o mesmo histórico automático de sempre.
function TransferirForm({
  colaboradores, colaboradorAtualId, salvando, onCancelar, onConfirmar,
}: {
  colaboradores: AppData["colaboradores"];
  colaboradorAtualId: string | null;
  salvando: boolean;
  onCancelar: () => void;
  onConfirmar: (novoColaboradorId: string) => void;
}) {
  const [destino, setDestino] = useState("");
  return (
    <div>
      <Field label="Transferir para">
        <Select value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">— Estoque (sem dono) —</option>
          {colaboradores
            .filter((c) => colaboradorOperacionalmenteAtivo(c.status) && c.id !== colaboradorAtualId)
            .map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
        <Button variant="primary" onClick={() => onConfirmar(destino)} disabled={salvando}>
          {salvando ? "Transferindo..." : "Confirmar transferência"}
        </Button>
      </div>
    </div>
  );
}

function EquipamentoForm({
  initial, colaboradores, categorias, marcas, acessorios, onSave, onClose, salvando, erro,
}: {
  initial: Partial<Equipamento>;
  colaboradores: AppData["colaboradores"];
  categorias: AppData["dominios"]["categoriasEquipamento"];
  marcas: AppData["dominios"]["marcasEquipamento"];
  acessorios: AppData["dominios"]["acessoriosEquipamento"];
  onSave: (form: EquipamentoInput & { id?: string }) => void;
  onClose: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const [form, setForm] = useState({
    id: initial.id,
    tipo: initial.tipo || "",
    categoriaId: initial.categoriaId || "",
    marca: initial.marca || "",
    marcaId: initial.marcaId || "",
    modelo: initial.modelo || "",
    numeroSerie: initial.numeroSerie || "",
    patrimonio: initial.patrimonio || "",
    estadoConservacao: (initial.estadoConservacao || "") as string,
    status: initial.status || "DISPONIVEL",
    colaboradorId: initial.colaboradorId || "",
    localizacao: initial.localizacao || "",
    dataAquisicao: initial.dataAquisicao ? initial.dataAquisicao.slice(0, 10) : "",
    // CMDB completo (Onda 3.1 do redesenho, 21/07/2026 — item 11 da
    // auditoria) — mesmo padrão de string-vazia-vira-null-no-submit já usado
    // em todos os outros campos opcionais deste formulário.
    fornecedor: initial.fornecedor || "",
    notaFiscal: initial.notaFiscal || "",
    garantiaAte: initial.garantiaAte ? initial.garantiaAte.slice(0, 10) : "",
    valorAquisicao: initial.valorAquisicao != null ? String(initial.valorAquisicao) : "",
    vidaUtilMeses: initial.vidaUtilMeses != null ? String(initial.vidaUtilMeses) : "",
    observacoes: initial.observacoes || "",
    // Acessórios inclusos (17/07/2026, pedido do Vini) — lista de IDs vindo
    // do relacionamento N:N já carregado no equipamento (ver INCLUDE_EQUIPAMENTO
    // no backend).
    acessorioIds: (initial.acessorios || []).map((a) => a.acessorioId),
  });
  // Lista de acessórios ativos da categoria escolhida, mesmo padrão de
  // filtro client-side de `cargosDoSetor` em Colaboradores.tsx. Ao trocar de
  // categoria, os acessórios já marcados que não pertencem à nova categoria
  // são descartados — evita salvar um vínculo "Capa" (Celular) num
  // equipamento que virou "Notebook" só porque o admin mudou a categoria sem
  // reabrir o formulário.
  const acessoriosDaCategoria = acessorios.filter((a) => a.categoriaId === form.categoriaId && a.status === "ATIVO");

  function alternarAcessorio(id: string) {
    setForm((f) => ({
      ...f,
      acessorioIds: f.acessorioIds.includes(id) ? f.acessorioIds.filter((x) => x !== id) : [...f.acessorioIds, id],
    }));
  }

  function mudarCategoria(categoriaId: string) {
    const nome = categorias.find((c) => c.id === categoriaId)?.nome || form.tipo;
    const idsValidos = new Set(acessorios.filter((a) => a.categoriaId === categoriaId).map((a) => a.id));
    setForm((f) => ({ ...f, categoriaId, tipo: nome, acessorioIds: f.acessorioIds.filter((id) => idsValidos.has(id)) }));
  }

  return (
    <Modal title={form.id ? "Editar Equipamento" : "Novo Equipamento"} onClose={onClose}>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria">
          <Select value={form.categoriaId} onChange={(e) => mudarCategoria(e.target.value)}>
            <option value="">— selecione —</option>
            {categorias.filter((c) => c.status === "ATIVO").map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </Field>
        <Field label="Tipo (texto livre, se não achar na lista)">
          <TextInput value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} placeholder="Ex: Notebook, Celular, Monitor" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Marca">
          <Select
            value={form.marcaId}
            onChange={(e) => {
              const marcaId = e.target.value;
              const nome = marcas.find((m) => m.id === marcaId)?.nome || form.marca;
              setForm({ ...form, marcaId, marca: nome });
            }}
          >
            <option value="">— selecione —</option>
            {marcas.filter((m) => m.status === "ATIVO").map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </Select>
        </Field>
        <Field label="Modelo">
          <TextInput value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Número de Série">
          <TextInput value={form.numeroSerie} onChange={(e) => setForm({ ...form, numeroSerie: e.target.value })} />
        </Field>
        <Field label="Patrimônio">
          <TextInput value={form.patrimonio} onChange={(e) => setForm({ ...form, patrimonio: e.target.value })} />
        </Field>
      </div>
      <Field label="Estado de Conservação">
        <Select value={form.estadoConservacao} onChange={(e) => setForm({ ...form, estadoConservacao: e.target.value })}>
          <option value="">—</option>
          {Object.entries(ESTADO_CONSERVACAO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      {/* Acessórios inclusos (17/07/2026, pedido do Vini) — lista depende da
          categoria escolhida acima (ex: só Celular tem "Capa" como opção; ver
          seed-data.json → acessoriosEquipamento no backend). Sem categoria
          selecionada, mostra um aviso em vez do checklist vazio, pra deixar
          claro que é preciso escolher a categoria primeiro. */}
      <Field label="Acessórios inclusos">
        {!form.categoriaId ? (
          <p className="text-xs text-gray-400 dark:text-slate-500">Selecione uma categoria para ver os acessórios disponíveis.</p>
        ) : acessoriosDaCategoria.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum acessório cadastrado para esta categoria ainda (cadastre em Configurações).</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {acessoriosDaCategoria.map((a) => {
              const marcado = form.acessorioIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => alternarAcessorio(a.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors duration-[var(--motion-fast)] ${
                    marcado
                      ? "bg-brand-600 border-brand-600 text-white"
                      : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-brand-400"
                  }`}
                >
                  {marcado && <CheckCircle2 size={12} className="inline mr-1 -mt-0.5" />}
                  {a.nome}
                </button>
              );
            })}
          </div>
        )}
      </Field>
      <Field label="Status">
        <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Equipamento["status"] })}>
          {(["EM_USO", "DISPONIVEL", "EM_MANUTENCAO", "EMPRESTADO", "BAIXADO", "PERDIDO", "DESCARTADO"] as const).map((s) => (
            <option key={s} value={s}>{STATUS_EQUIPAMENTO_LABEL[s]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Colaborador vinculado">
        <Select value={form.colaboradorId} onChange={(e) => setForm({ ...form, colaboradorId: e.target.value })}>
          <option value="">— Sem dono / estoque —</option>
          {colaboradores.filter((c) => colaboradorOperacionalmenteAtivo(c.status)).map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Localização">
          <TextInput value={form.localizacao} onChange={(e) => setForm({ ...form, localizacao: e.target.value })} placeholder="Ex: Sala TI, Unidade Itaúna" />
        </Field>
        <Field label="Data de aquisição">
          <TextInput type="date" value={form.dataAquisicao} onChange={(e) => setForm({ ...form, dataAquisicao: e.target.value })} />
        </Field>
      </div>
      {/* CMDB completo (Onda 3.1 do redesenho, 21/07/2026 — item 11 da
          auditoria, seção 1.5) — os 5 campos novos que viraram coluna no
          banco (QR Code não, ver comentário na Ficha de Ativo/QRCodeAtivo:
          é gerado sozinho a partir do patrimônio, não precisa de campo). */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fornecedor">
          <TextInput value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} placeholder="Ex: Loja XYZ Informática" />
        </Field>
        <Field label="Nota fiscal">
          <TextInput value={form.notaFiscal} onChange={(e) => setForm({ ...form, notaFiscal: e.target.value })} placeholder="Nº ou referência" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Garantia até">
          <TextInput type="date" value={form.garantiaAte} onChange={(e) => setForm({ ...form, garantiaAte: e.target.value })} />
        </Field>
        <Field label="Valor de aquisição (R$)">
          <TextInput type="number" step="0.01" min="0" value={form.valorAquisicao} onChange={(e) => setForm({ ...form, valorAquisicao: e.target.value })} />
        </Field>
      </div>
      <Field label="Vida útil (meses, para calcular depreciação)">
        <TextInput type="number" step="1" min="1" value={form.vidaUtilMeses} onChange={(e) => setForm({ ...form, vidaUtilMeses: e.target.value })} placeholder="Ex: 36" />
      </Field>
      <Field label="Observações">
        <TextArea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          disabled={!form.tipo || salvando}
          onClick={() =>
            onSave({
              id: form.id,
              tipo: form.tipo,
              marca: form.marca || null,
              modelo: form.modelo || null,
              numeroSerie: form.numeroSerie || null,
              patrimonio: form.patrimonio || null,
              estadoConservacao: (form.estadoConservacao || null) as Equipamento["estadoConservacao"],
              status: form.status as Equipamento["status"],
              colaboradorId: form.colaboradorId || null,
              observacoes: form.observacoes || null,
              categoriaId: form.categoriaId || null,
              marcaId: form.marcaId || null,
              localizacao: form.localizacao || null,
              dataAquisicao: form.dataAquisicao || null,
              fornecedor: form.fornecedor || null,
              notaFiscal: form.notaFiscal || null,
              garantiaAte: form.garantiaAte || null,
              valorAquisicao: form.valorAquisicao || null,
              vidaUtilMeses: form.vidaUtilMeses ? Number(form.vidaUtilMeses) : null,
              acessorioIds: form.acessorioIds,
            })
          }
        >
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </Modal>
  );
}

// Fotos e anexos do equipamento (17/07/2026, pedido do Vini: "preciso que dê
// para colocar várias fotos e anexos nos equipamentos") — substitui o antigo
// slot único (uma foto, substituível) por uma lista de qualquer tamanho:
// cada seleção de arquivo(s) ADICIONA à lista, sem apagar os anteriores. Só
// aparece no detalhe (precisa de um equipamento já salvo, mesmo racional de
// TermoResponsabilidade em Colaboradores.tsx). Cada item pode ser imagem OU
// PDF (mesma lista de tipos aceitos pelo backend, ver MIME_TYPES_PERMITIDOS
// em utils/anexos.ts). A lista local é atualizada direto na resposta de
// cada upload/remoção — não depende de esperar `data.equipamentos` recarregar
// e o `selected` do componente pai (que não é resincronizado automaticamente
// após onAtualizado()) apontar pro objeto novo, então o resultado aparece
// imediatamente no mesmo modal.
function formatarTamanhoArquivo(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Miniatura de um anexo de imagem — busca o blob sob demanda (a rota de
// download exige header Authorization, que uma <img src> comum não manda) e
// libera a object URL ao desmontar, mesmo cuidado que já existia no preview
// único da versão anterior deste componente.
function MiniaturaAnexoEquipamento({ equipamentoId, anexo }: { equipamentoId: string; anexo: EquipamentoAnexo }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    let criada: string | null = null;
    equipamentosApi.baixarAnexo(equipamentoId, anexo.id).then(({ blob }) => {
      if (!ativo) return;
      criada = URL.createObjectURL(blob);
      setUrl(criada);
    }).catch(() => {});
    return () => {
      ativo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipamentoId, anexo.id]);

  if (!url) {
    return (
      <div className="w-14 h-14 flex-shrink-0 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center">
        <Spinner size={14} />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex-shrink-0">
      <img src={url} alt={anexo.nomeOriginal} className="w-14 h-14 object-cover rounded-md border border-gray-200 dark:border-slate-700" />
    </a>
  );
}

// Exportado (21/07/2026, pedido do Vini: "o termo de responsabilidade e os
// demais documentos ficarem tudo no portal do colaborador") — reaproveitado
// em modo somente-leitura dentro de PortalColaborador.tsx, pra cada
// colaborador ver os anexos dos PRÓPRIOS equipamentos sem precisar acessar
// o módulo Patrimônio (que ele não tem permissão de abrir).
export function AnexosEquipamento({ equipamento, onAtualizado, readOnly }: { equipamento: Equipamento; onAtualizado: () => void; readOnly: boolean }) {
  const { sucesso } = useFeedback();
  const [anexos, setAnexos] = useState<EquipamentoAnexo[]>(equipamento.anexos ?? []);
  const [enviando, setEnviando] = useState(false);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Arrastar-e-soltar (17/07/2026, pedido do Vini) — índice do item sendo
  // arrastado e do alvo atual sob o cursor (pro destaque visual). API nativa
  // de drag do HTML5, sem biblioteca: a lista é pequena e vertical, não
  // precisa de animação de reordenação ao vivo.
  const [arrastandoIndice, setArrastandoIndice] = useState<number | null>(null);
  const [alvoIndice, setAlvoIndice] = useState<number | null>(null);

  // Reordenação de verdade, compartilhada entre o drag-and-drop (mouse) e os
  // botões "▲"/"▼" (teclado) abaixo — achado A3 do check-up (22/07/2026):
  // antes de existirem os botões, reordenar só era possível arrastando com
  // o mouse, sem NENHUMA alternativa por teclado. Em vez de duplicar a
  // lógica de mover-e-salvar, tanto `soltarEm` (drag) quanto os botões
  // chamam esta mesma função.
  function moverAnexo(origem: number, destino: number) {
    if (origem === destino || destino < 0 || destino >= anexos.length) return;
    const anterior = anexos;
    const nova = [...anexos];
    const [movido] = nova.splice(origem, 1);
    nova.splice(destino, 0, movido);
    setAnexos(nova);
    setErro(null);
    // Otimista: a lista já reordenou na tela; se o servidor recusar (ex:
    // outro admin removeu um anexo nesse meio tempo), volta como estava e
    // mostra o motivo.
    equipamentosApi
      .reordenarAnexos(equipamento.id, nova.map((a) => a.id))
      .then(() => onAtualizado())
      .catch((e) => {
        setAnexos(anterior);
        setErro(e instanceof ApiError ? e.message : "Não foi possível salvar a nova ordem.");
      });
  }

  function soltarEm(destino: number) {
    if (arrastandoIndice === null) {
      setArrastandoIndice(null);
      setAlvoIndice(null);
      return;
    }
    const origem = arrastandoIndice;
    setArrastandoIndice(null);
    setAlvoIndice(null);
    moverAnexo(origem, destino);
  }

  // Ressincroniza a lista local sempre que o modal passa a mostrar outro
  // equipamento — evita vazar anexo de um item pro outro se navegar entre
  // registros sem fechar o modal (mesmo cuidado do antigo FotoEquipamento).
  useEffect(() => {
    setAnexos(equipamento.anexos ?? []);
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipamento.id]);

  async function enviarArquivos(files: File[]) {
    setEnviando(true);
    setErro(null);
    let enviadosComSucesso = 0;
    try {
      // Sequencial de propósito (não Promise.all): o backend limita a
      // quantidade de anexos por equipamento contando o que já existe antes
      // de gravar — em paralelo, duas requisições poderiam ler a mesma
      // contagem "antiga" e passar do limite juntas.
      for (const file of files) {
        const novo = await equipamentosApi.anexarArquivo(equipamento.id, file);
        setAnexos((atual) => [...atual, novo]);
        enviadosComSucesso += 1;
      }
      sucesso(enviadosComSucesso > 1 ? `${enviadosComSucesso} arquivos anexados.` : "Arquivo anexado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar o arquivo.");
    } finally {
      setEnviando(false);
      onAtualizado();
    }
  }

  async function baixar(anexo: EquipamentoAnexo) {
    const { blob, nomeArquivo } = await equipamentosApi.baixarAnexo(equipamento.id, anexo.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo || anexo.nomeOriginal;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function remover(anexo: EquipamentoAnexo) {
    setRemovendoId(anexo.id);
    setErro(null);
    try {
      await equipamentosApi.removerAnexo(equipamento.id, anexo.id);
      setAnexos((atual) => atual.filter((a) => a.id !== anexo.id));
      onAtualizado();
      sucesso("Anexo removido.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível remover o arquivo.");
    } finally {
      setRemovendoId(null);
    }
  }

  return (
    <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mb-4">
      <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2">
        Fotos e anexos{anexos.length > 0 && ` (${anexos.length})`}
      </h5>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        className="hidden"
        onChange={(e) => {
          // Copia pra array ANTES de limpar `value`: `e.target.files` é uma
          // FileList "viva" que reflete o estado atual do input — zerar
          // `value` (pra permitir selecionar o mesmo arquivo de novo depois)
          // também zera essa FileList em memória, então guardar só a
          // referência (sem converter) faz `enviarArquivos` iterar sobre uma
          // lista já vazia. Mesmo cuidado que o antigo `file.[0]` de arquivo
          // único já tomava (extraía o File antes de limpar), só que aqui
          // precisa ser todos, não só o primeiro.
          const arquivos = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (arquivos.length > 0) enviarArquivos(arquivos);
        }}
      />
      {/* Texto atualizado (achado A3 do check-up, 22/07/2026) pra citar os
          botões "▲"/"▼" — sem isso, quem não usa mouse não teria como saber
          que existe um jeito de reordenar. */}
      {anexos.length > 1 && !readOnly && (
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-1.5">Arraste um item ou use as setas ▲▼ para reorganizar a ordem.</p>
      )}
      {anexos.length > 0 && (
        <ul className="space-y-2 mb-2">
          {anexos.map((anexo, indice) => (
            <li
              key={anexo.id}
              draggable={!readOnly}
              onDragStart={() => setArrastandoIndice(indice)}
              onDragEnd={() => {
                setArrastandoIndice(null);
                setAlvoIndice(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (alvoIndice !== indice) setAlvoIndice(indice);
              }}
              onDrop={(e) => {
                e.preventDefault();
                soltarEm(indice);
              }}
              className={`bg-gray-50 dark:bg-slate-800 border rounded-lg p-2 flex items-center gap-3 text-xs transition-colors ${
                !readOnly ? "cursor-grab active:cursor-grabbing" : ""
              } ${
                arrastandoIndice === indice
                  ? "opacity-50 border-gray-200 dark:border-slate-700"
                  : alvoIndice === indice && arrastandoIndice !== null
                    ? "border-brand-500 dark:border-brand-400"
                    : "border-gray-200 dark:border-slate-700"
              }`}
            >
              {/* Sem nome de arquivo aqui de propósito (pedido do Vini,
                  17/07/2026: "não pegue o nome original do arquivo, apenas o
                  tamanho e a data") — a miniatura/ícone identifica o item. */}
              {anexo.tipo.startsWith("image/") ? (
                <MiniaturaAnexoEquipamento equipamentoId={equipamento.id} anexo={anexo} />
              ) : (
                <div className="w-14 h-14 flex-shrink-0 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center">
                  <FileText size={20} className="text-slate-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  {anexo.tipo === "application/pdf" ? "Documento" : "Foto"}
                </p>
                <p className="text-gray-400 dark:text-slate-500">
                  {formatarTamanhoArquivo(anexo.tamanhoBytes)} · {fmtDate(anexo.criadoEm)}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {/* Botões "▲"/"▼" (achado A3 do check-up, 22/07/2026: "o
                    achado de acessibilidade mais sério desta rodada") —
                    reordenar fotos/anexos só era possível arrastando com o
                    mouse, sem NENHUM caminho alternativo por teclado. Chamam
                    a MESMA `moverAnexo` que o drag-and-drop usa, sem duplicar
                    lógica. Só aparecem com mais de 1 anexo (nada pra
                    reordenar com 1 só) e somem em modo somente-leitura, mesmo
                    critério do drag (`draggable={!readOnly}`) e do botão
                    remover logo abaixo. Primeiro item não tem "para cima",
                    último não tem "para baixo" — desabilitado em vez de
                    escondido, pra não fazer a lista "pular" de tamanho. */}
                {!readOnly && anexos.length > 1 && (
                  <div className="flex flex-col gap-0.5">
                    <Button
                      variant="ghost"
                      className="!px-1.5 !py-0.5"
                      onClick={() => moverAnexo(indice, indice - 1)}
                      disabled={indice === 0}
                      aria-label="Mover foto para cima"
                    >
                      <ChevronUp size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-1.5 !py-0.5"
                      onClick={() => moverAnexo(indice, indice + 1)}
                      disabled={indice === anexos.length - 1}
                      aria-label="Mover foto para baixo"
                    >
                      <ChevronDown size={14} />
                    </Button>
                  </div>
                )}
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => baixar(anexo)}>
                  <Download size={14} />
                </Button>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 !text-brand-700 dark:!text-brand-400"
                    onClick={() => remover(anexo)}
                    disabled={removendoId === anexo.id}
                  >
                    {removendoId === anexo.id ? <Spinner size={14} /> : <X size={14} />}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!readOnly ? (
        <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={enviando}>
          {enviando ? <><Spinner size={14} /> Enviando...</> : <><Camera size={16} /> Anexar foto ou arquivo</>}
        </Button>
      ) : (
        anexos.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum anexo.</p>
      )}
      {erro && <p className="mt-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</p>}
    </div>
  );
}
