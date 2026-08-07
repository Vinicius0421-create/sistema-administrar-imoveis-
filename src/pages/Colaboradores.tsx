import React, { useEffect, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { colaboradoresApi, ColaboradorInput, TelefoneColaboradorInput } from "../api/colaboradores";
import { ApiError } from "../lib/apiClient";
import { useAuth } from "../auth/AuthContext";
import {
  BotaoExportarCsv, Button, CARD_SHADOW, CARD_SHADOW_HOVER, cardClicavelProps, COLORS, EmptyState, Field, fmtDate, fmtMoney, FOCUS_RING_CLASS, FONT_MONO, Modal, PageHeader, Paginacao, Select, SearchBox, Spinner, Stamp, TextArea, TextInput, usePaginacaoCliente,
} from "../components/ui";
import { Cake, Download, FileText, Key, Paperclip, Plus, Users, X } from "../components/icons";
import { Cargo, Colaborador, DadosBancariosColaborador, PagamentoColaborador, Papel, PAPEL_LABEL, STATUS_COLABORADOR_LABEL, STATUS_COLABORADOR_TONE, STATUS_PAGAMENTO_LABEL, TIPO_PAGAMENTO_LABEL, TIPO_PLANO_LABEL, TIPO_TELEFONE_LABEL, TipoTelefoneColaborador } from "../types";
import { pagamentosApi, DadosBancariosInput } from "../api/pagamentos";
import { ImportarImoviewModal } from "./ImportarImoview";
import { DesligamentoModal } from "../components/DesligamentoModal";
import { CalendarioAniversarios } from "../components/CalendarioAniversarios";
import { maskCpf, maskTelefone, parseValorMonetario } from "../lib/mascaras";
import { telefonePrincipal } from "../lib/telefones";
import { nomeBancoPorCodigo } from "../lib/bancos";
import { exportarListaCsv } from "../utils/exportarCsv";
import { useFeedback } from "../contexts/FeedbackContext";

// Mesmo padrão de pílula do alternador de abas já usado em SolicitacoesHub.tsx
// e (17/07/2026) em Equipamentos.tsx — terceira ocorrência, mas ainda local
// em cada arquivo em vez de extraído pra ui.tsx: são 3 usos pequenos e
// autocontidos, não vale a complexidade de generalizar ainda.
function classePilula(ativa: boolean): string {
  return `px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors duration-[var(--motion-fast)] ${ativa ? "bg-slate-900 text-white" : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`;
}


// Achado de auditoria (08/07/2026, Etapa 8 — Consistência): esta página
// reimplementava seu próprio `fmtDataCurta` fazendo exatamente o que
// `fmtDate` (ui.tsx) já faz — mesmo resultado (DD/MM/AAAA, sem deslocar o
// dia por fuso horário), duas fontes de verdade. Removido em favor do
// utilitário compartilhado, já usado pelo resto do sistema.

// Mesmos papéis liberados no backend para PUT de colaboradores e para
// o reset de senha (app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR")
// em src/routes/colaboradores.routes.ts) — mantido em espelho aqui só pra
// decidir o que mostrar na tela; a permissão de verdade é sempre no servidor.
const PAPEIS_QUE_PODEM_RESETAR_SENHA = ["ADMINISTRADOR", "GESTOR_COORDENADOR"];

// CRIAR colaborador é mais permissivo que EDITAR/DESLIGAR (07/08/2026,
// pedido do Vini: liberar o Financeiro pra cadastrar colaborador novo) —
// espelha app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR", "FINANCEIRO")
// em POST /colaboradores e /colaboradores/importar-imoview/preview.
// Deliberadamente um conjunto SEPARADO de `readOnly` (que continua só
// ADMINISTRADOR/GESTOR_COORDENADOR): Financeiro pode abrir a ficha em modo
// leitura e criar um colaborador novo, mas não edita/desliga um já existente
// — mesmo padrão já usado por DadosBancariosSecao, que ignora `readOnly`
// pra abrir edição só da sua própria seção.
const PAPEIS_QUE_PODEM_CRIAR_COLABORADOR = ["ADMINISTRADOR", "GESTOR_COORDENADOR", "FINANCEIRO"];

interface Props {
  data: AppData;
  readOnly: boolean;
  onChanged: () => void;
  // Desligamento unificado (17/07/2026, ver DesligamentoModal.tsx) — ao
  // contrário de `onChanged` (só recarrega "colaboradores"), o desligamento
  // pode ter mexido em equipamentos/linhas/acessos/movimentações também
  // (transferência/devolução/revogação como parte do mesmo fluxo). Prop
  // separada em vez de simplesmente ampliar `onChanged` pra tudo isso de
  // propósito: qualquer outra edição de colaborador (nome, cargo, setor...)
  // não precisa pagar o custo de recarregar 4 listas a mais que nem mudaram.
  onDesligado: () => Promise<void>;
  // Semente vinda do dashboard (Fase 4 — Dashboard interativo, 06/07/2026):
  // clicar num setor no gráfico "Colaboradores por setor" da Home já chega
  // aqui com o setor certo pré-selecionado. Só lida no primeiro render —
  // depois disso o filtro volta a ser mandado inteiramente pela pessoa.
  filtroSetorInicial?: string;
  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — categoria
  // USUARIO aponta ou pro cadastro (entidade "Colaborador") ou pra conta de
  // login (entidade "Usuario", resolvida pro colaborador dono dela antes de
  // chegar aqui — ver lib/notificacaoDestino.ts) — nos dois casos o destino
  // é o mesmo modal de detalhe.
  abrirColaboradorId?: string;
  // Atalho rápido do Dashboard (Fase 3 — Componentes Inteligentes,
  // 14/07/2026): mesmo mecanismo de módulo+payload já usado por
  // abrirColaboradorId acima, só que abrindo direto o formulário de
  // CRIAÇÃO em vez do de detalhe — só lido na montagem (useState
  // inicializador), igual o padrão já estabelecido nesta tela.
  abrirNovo?: boolean;
  // Calendário de Aniversários (17/07/2026) — clique na notificação "Aniversariantes
  // de [mês] chegando" (ver notificacaoDestino.ts) já chega aqui com a aba
  // Calendário ativa, em vez de cair na lista padrão e obrigar o RH a achar
  // o botão. Mesmo padrão de "só lido na montagem" de `abrirNovo` acima.
  abrirCalendario?: boolean;
}

export function ColaboradoresPage({ data, readOnly, onChanged, onDesligado, filtroSetorInicial, abrirColaboradorId, abrirNovo, abrirCalendario }: Props) {
  const { user } = useAuth();
  const podeCriar = !!user && PAPEIS_QUE_PODEM_CRIAR_COLABORADOR.includes(user.papel);
  const { sucesso } = useFeedback();
  // Lista (padrão) ou Calendário anual (17/07/2026, pedido do Vini: "uma aba
  // interativa com os aniversariantes de todo o ano"). Mesmo padrão de
  // alternador em pílula já usado em Equipamentos.tsx/SolicitacoesHub.tsx.
  const [vista, setVista] = useState<"lista" | "calendario">(abrirCalendario ? "calendario" : "lista");
  const [busca, setBusca] = useState("");
  const [filtroSetor, setFiltroSetor] = useState(filtroSetorInicial || "");
  // "Consulta Rápida" (10/07/2026, pedido do Vini: "corretores das unidade,
  // ou, atendentes só de Itaúna...") — filtros de Unidade e Cargo, no mesmo
  // padrão 100% client-side do filtro de Setor acima (o dado já vem completo
  // em cada colaborador via `include` do backend, ver GET /colaboradores).
  const [filtroUnidade, setFiltroUnidade] = useState("");
  const [filtroCargo, setFiltroCargo] = useState("");
  // Modernização de filtros (07/08/2026, pedido do Vini) — faltava um jeito
  // de ver só quem está Inativo/Afastado/Em aviso: a lista sempre misturava
  // todo mundo, obrigando a rolar (ou usar a busca de nome, que não ajuda
  // quando não se sabe o nome) pra achar quem já saiu ou está fora
  // temporariamente. Mesmo padrão dos outros filtros desta tela.
  const [filtroStatus, setFiltroStatus] = useState<Colaborador["status"] | "">("");
  const [editing, setEditing] = useState<Colaborador | Record<string, never> | null>(() => (abrirNovo && podeCriar ? {} : null));
  const [selected, setSelected] = useState<Colaborador | null>(
    () => (abrirColaboradorId ? data.colaboradores.find((c) => c.id === abrirColaboradorId) || null : null)
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Importação do Imoview (08/07/2026, pedido do Vini) — ver ImportarImoview.tsx.
  const [importando, setImportando] = useState(false);

  // Fluxo de reset de senha — em três passos (pedir confirmação, executar,
  // mostrar a senha temporária uma única vez) sempre dentro do próprio
  // modal, sem depender de window.confirm/alert do navegador.
  const [resetEtapa, setResetEtapa] = useState<"idle" | "confirmando" | "processando">("idle");
  const [resetErro, setResetErro] = useState<string | null>(null);
  const [resetResultado, setResetResultado] = useState<{ email: string; senhaTemporaria: string } | null>(null);

  const podeResetarSenha = !!user && PAPEIS_QUE_PODEM_RESETAR_SENHA.includes(user.papel);

  // Exclusão definitiva é mais arriscada que o resto (não tem "desfazer"),
  // então fica restrita a ADMINISTRADOR — mesma trava do backend
  // (app.requireRole("ADMINISTRADOR") na rota DELETE /colaboradores/:id).
  const podeExcluir = user?.papel === "ADMINISTRADOR";
  const [excluirEtapa, setExcluirEtapa] = useState<"idle" | "confirmando" | "processando">("idle");
  const [excluirErro, setExcluirErro] = useState<string | null>(null);

  // Desligamento unificado (17/07/2026) — mesmos papéis que já editam
  // colaborador (`!readOnly`, ADMINISTRADOR/GESTOR_COORDENADOR). Ver
  // DesligamentoModal.tsx para o porquê de não ser simplesmente mais um
  // valor de Status no formulário de edição.
  const [desligando, setDesligando] = useState<Colaborador | null>(null);

  // Conceder acesso / alterar papel — restrito a ADMINISTRADOR, mesma trava
  // do backend (app.requireRole("ADMINISTRADOR") em
  // POST/PATCH /colaboradores/:id/criar-acesso e /usuario). Fase 3 da
  // Evolução Completa: antes não existia nenhum jeito de dar login pra um
  // colaborador sem mexer direto no banco.
  const podeGerenciarAcesso = user?.papel === "ADMINISTRADOR";
  const [acessoEtapa, setAcessoEtapa] = useState<"idle" | "formulario" | "processando">("idle");
  const [acessoErro, setAcessoErro] = useState<string | null>(null);
  const [acessoResultado, setAcessoResultado] = useState<{ email: string; senhaTemporaria: string } | null>(null);
  const [acessoPapel, setAcessoPapel] = useState<Papel>("COLABORADOR");
  const [acessoEmail, setAcessoEmail] = useState("");
  const [alterandoPapel, setAlterandoPapel] = useState(false);
  const [novoPapel, setNovoPapel] = useState<Papel>("COLABORADOR");
  const [alterarPapelSalvando, setAlterarPapelSalvando] = useState(false);

  // Decluttering do modal de detalhe (21/07/2026, pedido do Vini: "esta aba
  // está muito cheia") — Resetar senha / Acesso ao Sistema / Excluir
  // cadastro são as 3 ações menos usadas no dia a dia (comparado a
  // Editar/Desligar, que ficam sempre visíveis) e cada uma já carregava sua
  // própria seção cheia (border-t + título), empilhadas incondicionalmente
  // pra quem tem permissão — 3 blocos de largura total só de ações
  // administrativas antes mesmo de chegar no fim do modal. Agrupadas agora
  // atrás de um único acordeão fechado por padrão; o estado interno de cada
  // fluxo (resetEtapa/acessoEtapa/excluirEtapa etc.) continua exatamente
  // igual, só a apresentação externa mudou.
  const [adminAberto, setAdminAberto] = useState(false);
  const [alterarPapelErro, setAlterarPapelErro] = useState<string | null>(null);

  // Sempre que o colaborador selecionado mudar, os fluxos de reset/exclusão/
  // acesso voltam pro início — evita mostrar o estado de um colaborador na
  // tela de outro se o gestor navegar entre registros sem fechar o modal.
  useEffect(() => {
    setResetEtapa("idle");
    setResetErro(null);
    setResetResultado(null);
    setExcluirEtapa("idle");
    setExcluirErro(null);
    setAcessoEtapa("idle");
    setAcessoErro(null);
    setAcessoResultado(null);
    setAcessoPapel("COLABORADOR");
    setAcessoEmail(selected?.email || "");
    setAlterandoPapel(false);
    setAlterarPapelErro(null);
  }, [selected?.id]);

  function fecharDetalhe() {
    setSelected(null);
    setResetEtapa("idle");
    setResetErro(null);
    setResetResultado(null);
    setExcluirEtapa("idle");
    setExcluirErro(null);
    setAcessoEtapa("idle");
    setAcessoErro(null);
    setAcessoResultado(null);
    setAlterandoPapel(false);
    setAlterarPapelErro(null);
  }

  async function concederAcesso(colaboradorId: string) {
    setAcessoEtapa("processando");
    setAcessoErro(null);
    try {
      const resposta = await colaboradoresApi.criarAcesso(colaboradorId, {
        papel: acessoPapel,
        email: acessoEmail || undefined,
      });
      setAcessoResultado({ email: resposta.usuario.email, senhaTemporaria: resposta.senhaTemporaria });
      setSelected((prev) =>
        prev
          ? { ...prev, usuario: { id: resposta.usuario.id, email: resposta.usuario.email, papel: resposta.usuario.papel, ativo: true, precisaTrocarSenha: true } }
          : prev
      );
      await onChanged();
      sucesso("Acesso concedido ao colaborador.");
    } catch (e) {
      setAcessoErro(e instanceof ApiError ? e.message : "Não foi possível conceder o acesso.");
      setAcessoEtapa("formulario");
    }
  }

  async function salvarNovoPapel(colaboradorId: string, papel: Papel) {
    setAlterarPapelSalvando(true);
    setAlterarPapelErro(null);
    try {
      const atualizado = await colaboradoresApi.alterarPapelUsuario(colaboradorId, papel);
      setSelected((prev) => (prev && prev.usuario ? { ...prev, usuario: { ...prev.usuario, papel: atualizado.papel } } : prev));
      await onChanged();
      setAlterandoPapel(false);
      sucesso("Papel de acesso alterado com sucesso.");
    } catch (e) {
      setAlterarPapelErro(e instanceof ApiError ? e.message : "Não foi possível alterar o papel.");
    } finally {
      setAlterarPapelSalvando(false);
    }
  }

  async function confirmarResetSenha(colaboradorId: string) {
    setResetEtapa("processando");
    setResetErro(null);
    try {
      const resposta = await colaboradoresApi.resetarSenha(colaboradorId);
      setResetResultado({ email: resposta.usuario.email, senhaTemporaria: resposta.senhaTemporaria });
      setSelected((prev) => (prev && prev.usuario ? { ...prev, usuario: { ...prev.usuario, precisaTrocarSenha: true } } : prev));
      sucesso("Senha resetada com sucesso.");
    } catch (e) {
      setResetErro(e instanceof ApiError ? e.message : "Não foi possível resetar a senha.");
      setResetEtapa("idle");
    }
  }

  async function confirmarExcluir(colaboradorId: string) {
    setExcluirEtapa("processando");
    setExcluirErro(null);
    try {
      await colaboradoresApi.remove(colaboradorId);
      await onChanged();
      fecharDetalhe();
      sucesso("Colaborador excluído com sucesso.");
    } catch (e) {
      setExcluirErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
      setExcluirEtapa("idle");
    }
  }

  // Ordenação clicável (Fase 3, 14/07/2026) — client-side.
  const [ordenacao, setOrdenacao] = useState<"nome_asc" | "nome_desc" | "admissao_recente" | "admissao_antiga">("nome_asc");

  const filtrosAtivos = !!(busca || filtroSetor || filtroUnidade || filtroCargo || filtroStatus);
  function limparFiltros() {
    setBusca("");
    setFiltroSetor("");
    setFiltroUnidade("");
    setFiltroCargo("");
    setFiltroStatus("");
  }

  const filtrados = data.colaboradores
    .filter((c) => {
      if (filtroSetor && c.setorId !== filtroSetor) return false;
      if (filtroUnidade && c.unidadeId !== filtroUnidade) return false;
      if (filtroCargo && c.cargoId !== filtroCargo) return false;
      if (filtroStatus && c.status !== filtroStatus) return false;
      if (busca && !c.nomeCompleto.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (ordenacao === "nome_asc") return a.nomeCompleto.localeCompare(b.nomeCompleto);
      if (ordenacao === "nome_desc") return b.nomeCompleto.localeCompare(a.nomeCompleto);
      // Sem data de admissão fica por último nos dois sentidos (mesmo
      // critério usado em Equipamentos.tsx pra dataAquisicao).
      const semData = ordenacao === "admissao_recente" ? -Infinity : Infinity;
      const da = a.dataAdmissao ? new Date(a.dataAdmissao).getTime() : semData;
      const db = b.dataAdmissao ? new Date(b.dataAdmissao).getTime() : semData;
      return ordenacao === "admissao_recente" ? db - da : da - db;
    });
  // Paginação no cliente (Fase 2, 14/07/2026, tarefa #153) — Colaboradores é
  // a página "canônica" citada na auditoria de layout (relatório em claude/)
  // como referência de grid bem feito, mas também era a única das 6 páginas
  // sem nenhum controle mesmo sendo grid — corrigido aqui.
  const { itensPagina: filtradosPagina, pagina, totalPaginas, setPagina, total, inicioExibicao, fimExibicao } =
    usePaginacaoCliente(filtrados, 24);

  // "Consulta Rápida" — exporta exatamente a lista filtrada acima (mesmos
  // critérios que estão na tela), com os campos essenciais que o Vini pediu
  // explicitamente (nome completo, e-mail, telefone, unidade) mais setor,
  // cargo e status pra dar contexto completo sem exigir abrir cada cartão.
  function exportarColaboradores() {
    exportarListaCsv(
      filtrados,
      [
        { cabecalho: "Nome completo", valor: (c) => c.nomeCompleto },
        { cabecalho: "E-mail", valor: (c) => c.email },
        { cabecalho: "Telefone", valor: (c) => c.linhaCorporativa?.numero || telefonePrincipal(c) },
        { cabecalho: "Unidade", valor: (c) => c.unidade?.nome },
        { cabecalho: "Setor", valor: (c) => c.setor?.nome },
        { cabecalho: "Cargo", valor: (c) => c.cargo && rotuloCargo(c.cargo) },
        { cabecalho: "Status", valor: (c) => STATUS_COLABORADOR_LABEL[c.status] },
      ],
      "colaboradores"
    );
  }

  // Correção (10/07/2026, achado do Vini: "o filtro de todos os cargos, está
  // tudo duplicado") — Cargo é único por (nome, setorId), não por nome
  // sozinho (ver schema.prisma e CargosBlock em Configuracoes.tsx, que já
  // agrupa cargos por setor por causa disso). Um cargo "Corretor" cadastrado
  // tanto em Locação quanto em Vendas são DOIS registros de verdade, cada um
  // com colaboradores diferentes vinculados — não é bug de dado nem duplicata
  // de verdade. O bug estava aqui: o dropdown listava só `c.nome`, sem
  // distinguir os dois, então "Corretor" aparecia duas vezes de forma
  // idêntica e sem explicação nenhuma. Agora só nomes que colidem entre
  // setores ganham o sufixo do setor — nomes únicos continuam limpos.
  const nomesCargoRepetidos = new Set(
    Object.entries(
      data.dominios.cargos.reduce<Record<string, number>>((acc, c) => {
        acc[c.nome] = (acc[c.nome] || 0) + 1;
        return acc;
      }, {})
    )
      .filter(([, qtd]) => qtd > 1)
      .map(([nome]) => nome)
  );
  const rotuloCargo = (c: Cargo) =>
    nomesCargoRepetidos.has(c.nome) ? `${c.nome} (${c.setor?.nome || "sem setor"})` : c.nome;

  const equipamentosDe = (id: string) => data.equipamentos.filter((e) => e.colaboradorId === id);
  const linhasDe = (id: string) => data.linhas.filter((l) => l.colaboradorId === id);
  const acessosDe = (id: string) => data.acessos.filter((a) => a.colaboradorId === id);

  async function salvar(form: ColaboradorInput & { id?: string }) {
    setSalvando(true);
    setErro(null);
    try {
      if (form.id) {
        const { id, ...resto } = form;
        await colaboradoresApi.update(id, resto);
      } else {
        await colaboradoresApi.create(form);
      }
      await onChanged();
      setEditing(null);
      sucesso(form.id ? "Colaborador atualizado com sucesso." : "Colaborador cadastrado com sucesso.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Colaboradores"
        subtitle={`${filtrados.length} de ${data.colaboradores.length} registros`}
        actions={
          <>
            <BotaoExportarCsv onClick={exportarColaboradores} quantidade={filtrados.length} />
            {podeCriar && (
              <>
                <Button variant="ghost" onClick={() => setImportando(true)}>
                  <Paperclip size={16} /> Importar do Imoview
                </Button>
                <Button variant="accent" onClick={() => setEditing({})}>
                  <Plus size={16} /> Novo Colaborador
                </Button>
              </>
            )}
          </>
        }
      />

      {importando && (
        <ImportarImoviewModal
          data={data}
          onClose={() => setImportando(false)}
          onImportado={onChanged}
        />
      )}

      {/* Alternador Lista/Calendário (17/07/2026) — mesmo padrão de pílula da
          aba "Em estoque" de Equipamentos.tsx. Fica visível pra qualquer
          papel que chega nesta página (ADMINISTRADOR/GESTOR_COORDENADOR/RH —
          os únicos com "Colaboradores" no menu, mesma trava de sempre) já
          que os 3 têm `dataNascimento` liberado pela API. */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-full p-1 mb-4 w-fit">
        <button onClick={() => setVista("lista")} className={classePilula(vista === "lista")}>
          Lista
        </button>
        <button onClick={() => setVista("calendario")} className={classePilula(vista === "calendario")}>
          <span className="inline-flex items-center gap-1.5">
            <Cake size={13} /> Calendário de Aniversários
          </span>
        </button>
      </div>

      {vista === "calendario" ? (
        <CalendarioAniversarios colaboradores={data.colaboradores} onSelecionar={setSelected} />
      ) : (
        <>
      <div className="flex flex-wrap gap-3 mb-4">
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por nome..." />
        <Select aria-label="Filtrar por setor" value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)}>
          <option value="">Todos os setores</option>
          {data.dominios.setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </Select>
        {/* "Consulta Rápida" (10/07/2026) — filtros de Unidade e Cargo, pra
            responder direto perguntas como "corretores de Itaúna" (Unidade =
            Itaúna + Cargo = Corretor) sem precisar abrir cada cartão. Cargo
            é gerenciado em Configurações; se ainda não existir nenhum cargo
            cadastrado (ex.: "Corretor", "Atendente"), o dropdown some
            sozinho — não faz sentido oferecer um filtro vazio. */}
        <Select aria-label="Filtrar por unidade" value={filtroUnidade} onChange={(e) => setFiltroUnidade(e.target.value)}>
          <option value="">Todas as unidades</option>
          {data.dominios.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
        {data.dominios.cargos.length > 0 && (
          <Select aria-label="Filtrar por cargo" value={filtroCargo} onChange={(e) => setFiltroCargo(e.target.value)}>
            <option value="">Todos os cargos</option>
            {data.dominios.cargos.map((c) => <option key={c.id} value={c.id}>{rotuloCargo(c)}</option>)}
          </Select>
        )}
        <Select aria-label="Filtrar por status" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as Colaborador["status"] | "")}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_COLABORADOR_LABEL).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </Select>
        <Select aria-label="Ordenar por" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as typeof ordenacao)}>
          <option value="nome_asc">Nome (A-Z)</option>
          <option value="nome_desc">Nome (Z-A)</option>
          <option value="admissao_recente">Admissão mais recente</option>
          <option value="admissao_antiga">Admissão mais antiga</option>
        </Select>
        {filtrosAtivos && <Button variant="ghost" onClick={limparFiltros}>Limpar filtros</Button>}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtradosPagina.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelected(c)}
            {...cardClicavelProps(() => setSelected(c))}
            style={{ boxShadow: CARD_SHADOW }}
            className={`card-entrada bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-4 cursor-pointer hover:-translate-y-0.5 hover:border-brand-600/30 active:translate-y-0 active:scale-[0.99] active:duration-[var(--motion-instant)] transition-all duration-[var(--motion-fast)] ${FOCUS_RING_CLASS}`}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = CARD_SHADOW_HOVER)}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = CARD_SHADOW)}
          >
            <div className="flex items-start justify-between mb-1">
              <h4 className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">{c.nomeCompleto}</h4>
              <Stamp tone={STATUS_COLABORADOR_TONE[c.status]}>{STATUS_COLABORADOR_LABEL[c.status]}</Stamp>
            </div>
            {c.contaFuncao && (
              <span className="inline-block text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-800 rounded-full px-2 py-0.5 mb-1">
                Conta de função
              </span>
            )}
            <p className="text-xs text-gray-500 dark:text-slate-400">{c.setor?.nome || "Setor não definido"} · {c.unidade?.nome || "—"}</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{telefonePrincipal(c) ? maskTelefone(telefonePrincipal(c)!) : "—"}</p>
          </div>
        ))}
        {filtrados.length === 0 && <EmptyState icon={Users} text="Nenhum colaborador encontrado." />}
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

      {selected && (
        <Modal title={selected.nomeCompleto} onClose={fecharDetalhe} wide>
          <div className="space-y-4 text-sm">
            {selected.contaFuncao && (
              <div className="bg-amber-600/10 dark:bg-amber-500/15 border border-amber-600/30 dark:border-amber-800 rounded-lg p-2 text-xs text-amber-800 dark:text-amber-300">
                ⚠ Conta de função — não é uma pessoa fixa. Edite o nome sempre que trocar quem ocupa o posto.
              </div>
            )}
            {selected.observacoes && (
              <div className="bg-amber-600/10 dark:bg-amber-500/15 border border-amber-600/30 dark:border-amber-800 rounded-lg p-2 text-xs text-amber-800 dark:text-amber-300">
                ⚠ {selected.observacoes}
              </div>
            )}
            {/* Ficha do colaborador (08/07/2026, pedido do Vini) — antes era um
                grid apertado de 2 colunas sem `min-w-0`/quebra de linha: um
                e-mail comprido (ex: "captadorlocacaoigarape@administrarimoveis.com.br")
                estourava a largura da própria célula e ficava sobreposto ao
                valor do campo Telefone ao lado. `min-w-0` deixa a célula do
                grid encolher de verdade e `break-words` quebra a palavra
                comprida em vez de vazar. Aproveitado pra também: agrupar tudo
                num cartão visualmente separado da lista de
                equipamentos/linhas/acessos abaixo, e mostrar o Cargo — que
                existe no cadastro mas não aparecia aqui. */}
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 p-4">
              <div className="min-w-0">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">CPF</span><br />
                {/* Padronização Global (Fase 3) tinha ficado de fora desta
                    ficha — quem via aqui (ADMINISTRADOR/GESTOR_COORDENADOR/
                    RH, os únicos papéis que recebem o CPF completo, ver
                    ocultarDadosSensiveis no backend) via os 11 dígitos
                    crus, sem pontuação. O teste "só dígitos" distingue esse
                    caso do valor já mascarado que os demais papéis recebem
                    (ex: "***.123.***-45", com caracteres não-numéricos) —
                    só formata quando é o CPF completo de verdade. */}
                <span className="break-words">
                  {selected.cpf
                    ? /^\d+$/.test(selected.cpf)
                      ? maskCpf(selected.cpf)
                      : selected.cpf
                    : selected.contaFuncao
                      ? "— (conta de função)"
                      : "—"}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">Status</span><br />
                <Stamp tone={STATUS_COLABORADOR_TONE[selected.status]}>{STATUS_COLABORADOR_LABEL[selected.status]}</Stamp>
              </div>
              <div className="min-w-0">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">E-mail</span><br />
                <span className="break-words">{selected.email || "—"}</span>
              </div>
              {/* Telefone corporativo (linha vinculada — gerenciada na tela de
                  Linhas Telefônicas, não aqui, mesmo racional de sempre) e
                  telefone(s) de contato pessoal, agora em campos separados
                  desde que o contato virou lista (07/08/2026): "só um número"
                  deixou de fazer sentido quando a pessoa pode ter celular +
                  WhatsApp de trabalho + fixo residencial ao mesmo tempo. */}
              <div className="min-w-0">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">Telefone corporativo</span><br />
                {selected.linhaCorporativa ? (
                  <>
                    <span className="break-words" style={{ fontFamily: FONT_MONO }}>{maskTelefone(selected.linhaCorporativa.numero)}</span>
                    {" "}
                    <Stamp>{TIPO_PLANO_LABEL[selected.linhaCorporativa.tipoPlano]}</Stamp>
                    {selected.linhaCorporativa.situacaoConferencia === "NECESSITA_CONFERENCIA" && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        ⚠ Necessita conferência — diverge do contato pessoal ({telefonePrincipal(selected) ? maskTelefone(telefonePrincipal(selected)!) : "sem telefone pessoal cadastrado"}).
                      </p>
                    )}
                  </>
                ) : (
                  <span className="break-words text-gray-400 dark:text-slate-500">Sem linha corporativa vinculada.</span>
                )}
              </div>
              <div className="min-w-0">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">Telefone(s) de contato</span><br />
                {(selected.telefones ?? []).length === 0 ? (
                  <span className="break-words">—</span>
                ) : (
                  <ul className="space-y-1">
                    {(selected.telefones ?? []).map((t) => (
                      <li key={t.id} className="break-words">
                        <span style={{ fontFamily: FONT_MONO }}>{maskTelefone(t.numero)}</span>{" "}
                        <Stamp tone="pend">{TIPO_TELEFONE_LABEL[t.tipo]}</Stamp>
                        {t.principal && <Stamp tone="pos">Principal</Stamp>}
                        {t.observacao && <span className="text-xs text-gray-400 dark:text-slate-500"> — {t.observacao}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="min-w-0">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">Cargo</span><br />
                <span className="break-words">{selected.cargo?.nome || "—"}</span>
              </div>
              <div className="min-w-0">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">Setor</span><br />
                <span className="break-words">{selected.setor?.nome || "—"}</span>
              </div>
              <div className="min-w-0">
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">Unidade</span><br />
                <span className="break-words">{selected.unidade?.nome || "—"}</span>
              </div>
              {!selected.contaFuncao && (
                <div className="min-w-0">
                  <span className="text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">Data de nascimento</span><br />
                  <span className="break-words">{fmtDate(selected.dataNascimento)}</span>
                </div>
              )}
            </div>

            {(podeResetarSenha) && !selected.contaFuncao && (
              <TermoResponsabilidade colaborador={selected} onAtualizado={onChanged} />
            )}

            {/* Dados bancários + histórico de pagamentos CNAB (20/07/2026,
                pedido do Vini) — a seção decide sozinha se aparece (papéis
                Admin/RH/Financeiro), independente do readOnly geral da tela:
                o Financeiro entra em Colaboradores somente-leitura, mas
                edita ESTA seção, que é dele. */}
            {!selected.contaFuncao && <DadosBancariosSecao colaborador={selected} />}

            {/* Resumo de vínculos, agrupado no mesmo estilo de cartão da ficha
                acima (08/07/2026) — antes eram 3 blocos soltos, um embaixo do
                outro, sem nenhuma separação visual do resto do modal. */}
            <div className="grid sm:grid-cols-3 gap-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 p-4">
              <div className="min-w-0">
                <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2">Equipamentos ({equipamentosDe(selected.id).length})</h5>
                <ul className="space-y-1">
                  {equipamentosDe(selected.id).map((e) => (
                    <li key={e.id} className="text-xs border-b border-gray-200 dark:border-slate-700 pb-1 break-words">
                      {e.tipo} {e.modelo && `· ${e.modelo}`}
                    </li>
                  ))}
                  {equipamentosDe(selected.id).length === 0 && <li className="text-xs text-gray-500 dark:text-slate-400">Nenhum.</li>}
                </ul>
              </div>
              <div className="min-w-0">
                <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2">Linhas Telefônicas ({linhasDe(selected.id).length})</h5>
                <ul className="space-y-1">
                  {linhasDe(selected.id).map((l) => (
                    <li key={l.id} className="text-xs border-b border-gray-200 dark:border-slate-700 pb-1" style={{ fontFamily: "monospace" }}>
                      {maskTelefone(l.numero)}
                    </li>
                  ))}
                  {linhasDe(selected.id).length === 0 && <li className="text-xs text-gray-500 dark:text-slate-400">Nenhuma.</li>}
                </ul>
              </div>
              <div className="min-w-0">
                <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2">Acessos a Sistemas ({acessosDe(selected.id).length})</h5>
                <div className="flex flex-wrap gap-1.5">
                  {acessosDe(selected.id).map((a) => (
                    <span key={a.id} className="text-xs bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 px-2 py-1 rounded-[var(--radius-control)]">{a.sistema?.nome}</span>
                  ))}
                  {acessosDe(selected.id).length === 0 && <span className="text-xs text-gray-500 dark:text-slate-400">Nenhum.</span>}
                </div>
              </div>
            </div>

            {!readOnly && (
              <div className="flex gap-2 pt-2">
                <Button variant="ghost" onClick={() => { setEditing(selected); setSelected(null); }}>Editar</Button>
                {/* Desligamento unificado (17/07/2026, pedido do Vini: "muito
                    chato quando um colaborador sai... quero uma forma mais
                    rápida e prática") — só faz sentido pra quem ainda está
                    ativo/em aviso; desligar de novo quem já está Inativo não
                    tem efeito adicional (ver DesligamentoModal.tsx). Contas
                    de função (sem CPF, sem pessoa fixa) ficam de fora — o
                    posto continua existindo, "desligar" não se aplica. */}
                {selected.status !== "INATIVO" && !selected.contaFuncao && (
                  <Button variant="danger" onClick={() => setDesligando(selected)}>Desligar</Button>
                )}
              </div>
            )}

            {(podeResetarSenha || podeGerenciarAcesso || podeExcluir) && (
              <div className="border-t border-gray-100 dark:border-slate-700 pt-3">
                <button
                  onClick={() => setAdminAberto(!adminAberto)}
                  className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1.5"
                >
                  Administração da conta {adminAberto ? "▾" : "▸"}
                </button>

                {adminAberto && (
                  <div className="mt-3 space-y-3">
                    {podeResetarSenha && (
              <div>
                {resetResultado ? (
                  <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-xs space-y-2">
                    <p className="text-emerald-800 dark:text-emerald-300 font-semibold">
                      Senha resetada. Repasse esta senha temporária ao colaborador agora — ela só aparece esta vez:
                    </p>
                    <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-[var(--radius-control)] px-3 py-2">
                      <span style={{ fontFamily: "monospace" }} className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {resetResultado.senhaTemporaria}
                      </span>
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1 text-xs"
                        onClick={() => navigator.clipboard?.writeText(resetResultado.senhaTemporaria)}
                      >
                        Copiar
                      </Button>
                    </div>
                    <p className="text-emerald-700 dark:text-emerald-400">
                      Login: <strong>{resetResultado.email}</strong> · vai precisar trocar a senha no primeiro acesso,
                      e as sessões abertas em outros dispositivos foram encerradas.
                    </p>
                  </div>
                ) : resetEtapa === "confirmando" ? (
                  <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs space-y-2">
                    <p className="text-amber-800 dark:text-amber-300">
                      Isso gera uma senha temporária nova, obriga <strong>{selected.nomeCompleto}</strong> a trocá-la
                      no próximo login e derruba qualquer sessão já aberta dessa conta em outro dispositivo. Confirma?
                    </p>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setResetEtapa("idle")}>Cancelar</Button>
                      <Button variant="danger" onClick={() => confirmarResetSenha(selected.id)}>
                        Confirmar reset
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => { setResetErro(null); setResetEtapa("confirmando"); }}
                    disabled={resetEtapa === "processando"}
                  >
                    <Key size={16} />
                    {resetEtapa === "processando" ? "Resetando..." : "Resetar senha"}
                  </Button>
                )}
                {resetErro && (
                  <p className="mt-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">
                    {resetErro}
                  </p>
                )}
              </div>
            )}

                    {podeGerenciarAcesso && (
              <div className={podeResetarSenha ? "border-t border-gray-100 dark:border-slate-700 pt-3" : ""}>
                <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2">Acesso ao Sistema</h5>
                {selected.usuario ? (
                  alterandoPapel ? (
                    <div className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-xs space-y-2">
                      <p className="text-slate-600 dark:text-slate-400">Login: <strong>{selected.usuario.email}</strong></p>
                      <Select aria-label="Novo papel de acesso" value={novoPapel} onChange={(e) => setNovoPapel(e.target.value as Papel)}>
                        <option value="ADMINISTRADOR">Administrador Geral</option>
                        <option value="GESTOR_COORDENADOR">Gestor / Coordenador</option>
                        <option value="SUPORTE_TI">Suporte / TI</option>
                        <option value="RH">RH</option>
                        <option value="FINANCEIRO">Financeiro</option>
                        <option value="COLABORADOR">Colaborador</option>
                      </Select>
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setAlterandoPapel(false)} disabled={alterarPapelSalvando}>Cancelar</Button>
                        <Button variant="primary" onClick={() => salvarNovoPapel(selected.id, novoPapel)} disabled={alterarPapelSalvando}>
                          {alterarPapelSalvando ? "Salvando..." : "Salvar papel"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // Mesmo bug do e-mail comprido do card de cima (08/07/2026):
                    // `items-center justify-between` numa única linha, sem
                    // `min-w-0`/quebra, deixava o e-mail e o botão "Alterar
                    // papel" disputando espaço e se sobrepondo em telas
                    // estreitas (relatado pelo Vini com print). Em telas
                    // estreitas agora empilha (`flex-col`); a partir de `sm`
                    // volta a ficar lado a lado, com o texto podendo encolher
                    // (`min-w-0`) e quebrar (`break-words`) em vez de
                    // atropelar o botão.
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 p-3">
                      <span className="min-w-0 break-words">
                        Login: <strong>{selected.usuario.email}</strong> · <Stamp>{PAPEL_LABEL[selected.usuario.papel]}</Stamp>
                        {!selected.usuario.ativo && <span className="text-brand-600 ml-1">(inativo)</span>}
                        {/* Achado do Vini (28/07/2026) — não existe "senha
                            universal": cada conta recebe uma senha temporária
                            aleatória só na criação/reset (ver comentário
                            completo em types.ts, campo precisaTrocarSenha).
                            Sem isso, não havia NENHUMA forma de saber, pela
                            tela, quem ainda estava usando a senha temporária
                            vs. quem já tinha trocado — daí a confusão de "a
                            senha universal não funcionou" quando na
                            verdade cada pessoa tem a sua própria. */}
                        {selected.usuario.precisaTrocarSenha && (
                          <span className="text-amber-600 dark:text-amber-400 ml-1">(primeiro acesso pendente)</span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1 self-start sm:self-auto flex-shrink-0"
                        onClick={() => { setNovoPapel(selected.usuario!.papel); setAlterandoPapel(true); setAlterarPapelErro(null); }}
                      >
                        Alterar papel
                      </Button>
                    </div>
                  )
                ) : acessoResultado ? (
                  <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-xs space-y-2">
                    <p className="text-emerald-800 dark:text-emerald-300 font-semibold">
                      Acesso concedido. Repasse esta senha temporária ao colaborador agora — ela só aparece esta vez:
                    </p>
                    <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 rounded-[var(--radius-control)] px-3 py-2">
                      <span style={{ fontFamily: "monospace" }} className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {acessoResultado.senhaTemporaria}
                      </span>
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1 text-xs"
                        onClick={() => navigator.clipboard?.writeText(acessoResultado.senhaTemporaria)}
                      >
                        Copiar
                      </Button>
                    </div>
                    <p className="text-emerald-700 dark:text-emerald-400">
                      Login: <strong>{acessoResultado.email}</strong> · vai precisar trocar a senha no primeiro acesso.
                    </p>
                  </div>
                ) : acessoEtapa === "formulario" || acessoEtapa === "processando" ? (
                  <div className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-xs space-y-2">
                    <Field label="Papel de acesso">
                      <Select value={acessoPapel} onChange={(e) => setAcessoPapel(e.target.value as Papel)} disabled={acessoEtapa === "processando"}>
                        <option value="ADMINISTRADOR">Administrador Geral</option>
                        <option value="GESTOR_COORDENADOR">Gestor / Coordenador</option>
                        <option value="SUPORTE_TI">Suporte / TI</option>
                        <option value="RH">RH</option>
                        <option value="FINANCEIRO">Financeiro</option>
                        <option value="COLABORADOR">Colaborador</option>
                      </Select>
                    </Field>
                    <Field label="E-mail de login">
                      <TextInput
                        value={acessoEmail}
                        onChange={(e) => setAcessoEmail(e.target.value)}
                        placeholder={selected.email || "email@administrarimoveis.com.br"}
                        disabled={acessoEtapa === "processando"}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setAcessoEtapa("idle")} disabled={acessoEtapa === "processando"}>Cancelar</Button>
                      <Button variant="primary" onClick={() => concederAcesso(selected.id)} disabled={acessoEtapa === "processando"}>
                        {acessoEtapa === "processando" ? "Concedendo..." : "Conceder acesso"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="ghost" onClick={() => { setAcessoErro(null); setAcessoEtapa("formulario"); }}>
                    <Key size={16} /> Conceder acesso ao sistema
                  </Button>
                )}
                {acessoErro && (
                  <p className="mt-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{acessoErro}</p>
                )}
                {alterarPapelErro && (
                  <p className="mt-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{alterarPapelErro}</p>
                )}
              </div>
            )}

                    {podeExcluir && (
              <div className={(podeResetarSenha || podeGerenciarAcesso) ? "border-t border-gray-100 dark:border-slate-700 pt-3" : ""}>
                {excluirEtapa === "confirmando" ? (
                  <div className="bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-800 rounded-lg p-3 text-xs space-y-2">
                    <p className="text-brand-800 dark:text-brand-300">
                      Isso apaga <strong>{selected.nomeCompleto}</strong> definitivamente — sem desfazer. Só funciona
                      se este cadastro não tiver nenhum equipamento, linha, acesso, login, solicitação, chamado ou
                      movimentação vinculado (nesse caso, use "Desligar" em vez disso, que preserva o histórico).
                    </p>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setExcluirEtapa("idle")}>Cancelar</Button>
                      <Button variant="danger" onClick={() => confirmarExcluir(selected.id)}>
                        Confirmar exclusão
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    className="!text-brand-700 dark:!text-brand-400"
                    onClick={() => { setExcluirErro(null); setExcluirEtapa("confirmando"); }}
                    disabled={excluirEtapa === "processando"}
                  >
                    {excluirEtapa === "processando" ? "Excluindo..." : "Excluir cadastro"}
                  </Button>
                )}
                {excluirErro && (
                  <p className="mt-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">
                    {excluirErro}
                  </p>
                )}
              </div>
            )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {editing && (
        <ColaboradorForm
          initial={editing}
          dominios={data.dominios}
          onSave={salvar}
          onClose={() => { setEditing(null); setErro(null); }}
          salvando={salvando}
          erro={erro}
        />
      )}

      {desligando && user && (
        <DesligamentoModal
          colaborador={desligando}
          equipamentosVinculados={equipamentosDe(desligando.id)}
          linhasVinculadas={linhasDe(desligando.id)}
          acessosVinculados={acessosDe(desligando.id)}
          colaboradoresParaTransferencia={data.colaboradores}
          papel={user.papel}
          onClose={() => { setDesligando(null); setSelected(null); }}
          onConcluido={async () => {
            // Não fecha o modal aqui — ele mostra a própria tela de
            // "Concluído" com um botão "Fechar" (que chama `onClose` acima).
            // Fechar de imediato faria a mensagem de sucesso nem aparecer.
            await onDesligado();
            sucesso(`${desligando.nomeCompleto} foi desligado.`);
          }}
        />
      )}
    </div>
  );
}

// Anexo único do termo de responsabilidade de equipamentos (07/07/2026,
// pedido do Vini — ver PAPEIS_COM_CPF_COMPLETO no backend, mesma trava de
// quem pode ver). Upload substitui o anterior; preview inline pra imagem,
// cartão com ícone pra PDF — mesmo padrão do anexo de chamado
// (ver AnexoEvento em ChamadoDetalhe.tsx), só que com um slot único em vez
// de linha do tempo.
function TermoResponsabilidade({ colaborador, onAtualizado }: { colaborador: Colaborador; onAtualizado: () => void }) {
  const { sucesso } = useFeedback();
  const [enviando, setEnviando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const temTermo = !!colaborador.termoResponsabilidadeUrl;
  const ehImagem = !temTermo
    ? false
    : /\.(jpe?g|png|webp|gif)$/i.test(colaborador.termoResponsabilidadeNomeOriginal || "");
  const [urlImagem, setUrlImagem] = useState<string | null>(null);

  // Decluttering do modal de detalhe (21/07/2026, pedido do Vini) — igual à
  // seção "Dados bancários e pagamentos" logo abaixo, esta seção também vira
  // um acordeão fechado por padrão em vez de sempre ocupar espaço cheio
  // (preview de imagem/dropzone) mesmo pra quem só queria ver o telefone do
  // colaborador. A imagem do termo (quando existe) só é buscada quando a
  // seção é aberta pela primeira vez, pra não gastar uma chamada de rede à
  // toa pra cada colaborador que aparece na lista.
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto || !temTermo || !ehImagem) {
      setUrlImagem(null);
      return;
    }
    let ativo = true;
    let urlCriada: string | null = null;
    colaboradoresApi.baixarTermoResponsabilidade(colaborador.id).then(({ blob }) => {
      if (!ativo) return;
      urlCriada = URL.createObjectURL(blob);
      setUrlImagem(urlCriada);
    }).catch(() => {});
    return () => {
      ativo = false;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colaborador.id, temTermo, ehImagem, aberto]);

  async function enviarArquivo(file: File) {
    setEnviando(true);
    setErro(null);
    try {
      await colaboradoresApi.anexarTermoResponsabilidade(colaborador.id, file);
      onAtualizado();
      sucesso("Termo de responsabilidade anexado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar o arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  async function baixar() {
    const { blob, nomeArquivo } = await colaboradoresApi.baixarTermoResponsabilidade(colaborador.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo || colaborador.termoResponsabilidadeNomeOriginal || "termo-responsabilidade";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function remover() {
    setRemovendo(true);
    setErro(null);
    try {
      await colaboradoresApi.removerTermoResponsabilidade(colaborador.id);
      onAtualizado();
      sucesso("Termo de responsabilidade removido.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível remover o arquivo.");
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <div className="border-t border-gray-100 dark:border-slate-700 pt-3">
      <button
        onClick={() => setAberto(!aberto)}
        className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1.5"
      >
        Termo de responsabilidade de equipamento {temTermo ? "✓" : ""} {aberto ? "▾" : "▸"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) enviarArquivo(file);
        }}
      />
      {aberto && (
        <div className="mt-2">
          {temTermo ? (
            <div className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-xs space-y-2">
              {ehImagem && urlImagem && (
                <a href={urlImagem} target="_blank" rel="noreferrer">
                  <img src={urlImagem} alt="Termo de responsabilidade" className="max-h-40 rounded-md border border-gray-200 dark:border-slate-700" />
                </a>
              )}
              {!ehImagem && (
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                  <FileText size={16} /> {colaborador.termoResponsabilidadeNomeOriginal || "Documento"}
                </div>
              )}
              <p className="text-gray-400 dark:text-slate-500">Enviado em {fmtDate(colaborador.termoResponsabilidadeEnviadoEm)}</p>
              <div className="flex gap-2">
                <Button variant="ghost" className="!px-2 !py-1" onClick={baixar}>
                  <Download size={14} /> Baixar
                </Button>
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => inputRef.current?.click()} disabled={enviando}>
                  <Paperclip size={14} /> {enviando ? "Enviando..." : "Substituir"}
                </Button>
                <Button variant="ghost" className="!px-2 !py-1 !text-brand-700 dark:!text-brand-400" onClick={remover} disabled={removendo}>
                  <X size={14} /> {removendo ? "Removendo..." : "Remover"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={enviando}>
              {enviando ? <><Spinner size={14} /> Enviando...</> : <><Paperclip size={16} /> Anexar termo assinado</>}
            </Button>
          )}
          {erro && <p className="mt-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</p>}
        </div>
      )}
    </div>
  );
}

function ColaboradorForm({
  initial, dominios, onSave, onClose, salvando, erro,
}: {
  initial: Partial<Colaborador>;
  dominios: AppData["dominios"];
  onSave: (form: ColaboradorInput & { id?: string }) => void;
  onClose: () => void;
  salvando: boolean;
  erro: string | null;
}) {
  const cpfMascarado = !!initial.cpf && initial.cpf.includes("*");
  const [form, setForm] = useState({
    id: initial.id,
    nomeCompleto: initial.nomeCompleto || "",
    cpf: initial.cpf || "",
    contaFuncao: initial.contaFuncao || false,
    email: initial.email || "",
    // Múltiplos telefones (07/08/2026) — cada item mantido como string pra
    // edição livre no input (mesma máscara de digitação de sempre), convertido
    // pro shape da API só em submeter().
    telefones: (initial.telefones ?? []).map((t) => ({
      numero: maskTelefone(t.numero),
      tipo: t.tipo,
      principal: t.principal,
      observacao: t.observacao || "",
    })),
    unidadeId: initial.unidadeId || "",
    setorId: initial.setorId || "",
    cargoId: initial.cargoId || "",
    status: initial.status || "ATIVO",
    // yyyy-mm-dd — formato exigido pelo <input type="date">. dataNascimento
    // vem da API em ISO completo (ou null se a pessoa logada não tem
    // permissão de ver — ver ocultarDadosSensiveis no backend); nesse caso o
    // campo só fica em branco, não sobrescreve um valor que já existe.
    dataNascimento: initial.dataNascimento ? initial.dataNascimento.slice(0, 10) : "",
    observacoes: initial.observacoes || "",
  });
  const cargosDoSetor = dominios.cargos.filter((c) => c.setorId === form.setorId);

  function adicionarTelefone() {
    setForm((f) => ({
      ...f,
      telefones: [...f.telefones, { numero: "", tipo: "CELULAR" as TipoTelefoneColaborador, principal: f.telefones.length === 0, observacao: "" }],
    }));
  }

  function removerTelefone(indice: number) {
    setForm((f) => {
      const restantes = f.telefones.filter((_, i) => i !== indice);
      // Se removeu o principal e ainda sobrou algum, promove o primeiro —
      // evita ficar sem nenhum marcado (o backend também tem essa rede de
      // segurança, mas melhor já sair certo da tela).
      if (restantes.length > 0 && !restantes.some((t) => t.principal)) {
        restantes[0] = { ...restantes[0], principal: true };
      }
      return { ...f, telefones: restantes };
    });
  }

  function atualizarTelefone(indice: number, patch: Partial<(typeof form)["telefones"][number]>) {
    setForm((f) => ({
      ...f,
      telefones: f.telefones.map((t, i) => (i === indice ? { ...t, ...patch } : t)),
    }));
  }

  function marcarPrincipal(indice: number) {
    setForm((f) => ({
      ...f,
      telefones: f.telefones.map((t, i) => ({ ...t, principal: i === indice })),
    }));
  }

  function submeter() {
    const telefonesPreenchidos: TelefoneColaboradorInput[] = form.telefones
      .filter((t) => t.numero.trim())
      .map((t) => ({ numero: t.numero, tipo: t.tipo, principal: t.principal, observacao: t.observacao || null }));
    const payload: ColaboradorInput & { id?: string } = {
      id: form.id,
      nomeCompleto: form.nomeCompleto,
      cpf: form.contaFuncao ? null : form.cpf,
      contaFuncao: form.contaFuncao,
      email: form.email || null,
      telefones: telefonesPreenchidos,
      unidadeId: form.unidadeId || null,
      setorId: form.setorId || null,
      cargoId: form.cargoId || null,
      status: form.status as Colaborador["status"],
      dataNascimento: form.contaFuncao ? null : form.dataNascimento || null,
      observacoes: form.observacoes || null,
    };
    // CPF veio mascarado da API (ex: "***.***.**9-99") e o usuário não
    // trocou — não reenviar, senão a validação de CPF no backend rejeita.
    if (form.id && !form.contaFuncao && cpfMascarado && form.cpf === initial.cpf) {
      delete (payload as any).cpf;
    }
    onSave(payload);
  }

  return (
    <Modal title={form.id ? "Editar Colaborador" : "Novo Colaborador"} onClose={onClose}>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
      <Field label="Nome completo">
        <TextInput value={form.nomeCompleto} onChange={(e) => setForm({ ...form, nomeCompleto: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 mb-3 text-xs bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.contaFuncao}
          onChange={(e) => setForm({ ...form, contaFuncao: e.target.checked })}
        />
        <span className="text-amber-800 dark:text-amber-300">
          <strong>Conta de função</strong> (ex: recepção de uma unidade) — sem CPF fixo, roda entre
          pessoas diferentes. Basta atualizar o nome sempre que trocar quem está no posto.
        </span>
      </label>
      {!form.contaFuncao && (
        <Field label={cpfMascarado ? "CPF (mascarado — clique e digite pra substituir)" : "CPF"}>
          <TextInput
            value={form.cpf}
            // O valor que chega mascarado pra privacidade (***.XXX.***-XX,
            // ver maskCpf em utils/cpf.ts no backend) não é dado válido pra
            // reformatar como CPF de verdade — ao focar o campo pela
            // primeira vez sem ter mexido nele ainda, limpa e deixa a
            // pessoa digitar o valor novo do zero, já com a máscara de
            // digitação (000.000.000-00) se aplicando normalmente a partir
            // daí. Sem isso, a primeira tecla digitada tentaria formatar
            // "***" junto com dígitos reais, gerando lixo.
            onFocus={() => {
              if (cpfMascarado && form.cpf === initial.cpf) setForm((f) => ({ ...f, cpf: "" }));
            }}
            onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })}
            placeholder="000.000.000-00"
          />
        </Field>
      )}
      <Field label="E-mail corporativo">
        <TextInput
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value.toLowerCase() })}
        />
      </Field>
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Telefone(s) de contato (pessoal/WhatsApp — não é a linha corporativa)
          </span>
          <Button variant="ghost" onClick={adicionarTelefone} className="text-xs px-2 py-1">
            + Adicionar
          </Button>
        </div>
        {form.telefones.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">Nenhum telefone cadastrado.</p>
        )}
        <div className="space-y-2">
          {form.telefones.map((t, i) => (
            <div key={i} className="border border-gray-100 dark:border-slate-700 rounded-[var(--radius-control)] p-2.5 space-y-2">
              <div className="flex gap-2 items-start">
                <TextInput
                  value={t.numero}
                  onChange={(e) => atualizarTelefone(i, { numero: maskTelefone(e.target.value) })}
                  placeholder="(37) 99876-5432"
                  className="flex-1"
                />
                <Select value={t.tipo} onChange={(e) => atualizarTelefone(i, { tipo: e.target.value as TipoTelefoneColaborador })} className="w-36">
                  {Object.entries(TIPO_TELEFONE_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </Select>
                <Button variant="ghost" onClick={() => removerTelefone(i)} className="px-2 py-1.5" title="Remover">
                  <X size={14} />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input type="radio" name="telefonePrincipal" checked={t.principal} onChange={() => marcarPrincipal(i)} />
                  Principal
                </label>
                <TextInput
                  value={t.observacao}
                  onChange={(e) => atualizarTelefone(i, { observacao: e.target.value })}
                  placeholder="Observação (opcional)"
                  className="flex-1"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      {!form.contaFuncao && (
        <Field label="Data de nascimento">
          <TextInput type="date" value={form.dataNascimento} onChange={(e) => setForm({ ...form, dataNascimento: e.target.value })} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unidade">
          <Select value={form.unidadeId} onChange={(e) => setForm({ ...form, unidadeId: e.target.value })}>
            <option value="">—</option>
            {dominios.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Field>
        <Field label="Setor">
          <Select value={form.setorId} onChange={(e) => setForm({ ...form, setorId: e.target.value, cargoId: "" })}>
            <option value="">—</option>
            {dominios.setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Cargo">
        <Select value={form.cargoId} onChange={(e) => setForm({ ...form, cargoId: e.target.value })} disabled={!form.setorId}>
          <option value="">—</option>
          {cargosDoSetor.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </Select>
      </Field>
      <Field label="Status">
        <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Colaborador["status"] })}>
          <option value="ATIVO">Ativo</option>
          <option value="EM_AVISO">Em aviso</option>
          <option value="INATIVO">Inativo</option>
          <option value="AFASTADO">Afastado</option>
        </Select>
      </Field>
      <Field label="Observações">
        <TextArea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={submeter} disabled={!form.nomeCompleto || (!form.contaFuncao && !form.cpf) || salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Dados Bancários + histórico de pagamentos CNAB (20/07/2026, pedido do
// Vini: "Cadastro dos dados bancários" dentro do cadastro do colaborador +
// "Histórico Individual do Colaborador"). Editável por Admin/RH/Financeiro
// (mesma regra do backend — PAPEIS_DADOS_BANCARIOS em pagamentos.routes.ts);
// pra qualquer outro papel a seção nem aparece. Endereço mora aqui porque o
// CNAB exige endereço do favorecido no Segmento B.
// ---------------------------------------------------------------------------
function DadosBancariosSecao({ colaborador }: { colaborador: Colaborador }) {
  const { user } = useAuth();
  const { sucesso } = useFeedback();
  const papel = user?.papel;
  const podeVer = papel === "ADMINISTRADOR" || papel === "RH" || papel === "FINANCEIRO";

  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<DadosBancariosColaborador | null>(null);
  const [historico, setHistorico] = useState<PagamentoColaborador[] | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<
    Omit<DadosBancariosInput, "salarioPadrao" | "valorAdiantamentoPadrao"> & { salarioPadrao: string; valorAdiantamentoPadrao: string }
  >({
    bancoCodigo: "", bancoNome: "", agencia: "", agenciaDv: "", conta: "", contaDv: "",
    tipoConta: "corrente", favorecidoNome: "", favorecidoCpf: "", endereco: "", numero: "",
    complemento: "", bairro: "", cidade: "Itaúna".toUpperCase(), cep: "", uf: "MG",
    salarioPadrao: "", valorAdiantamentoPadrao: "",
  });

  useEffect(() => {
    setAberto(false);
    setCarregado(false);
    setDados(null);
    setHistorico(null);
    setEditando(false);
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colaborador.id]);

  if (!podeVer) return null;

  async function carregar() {
    try {
      const [d, h] = await Promise.all([
        pagamentosApi.dadosBancarios(colaborador.id),
        pagamentosApi.historicoColaborador(colaborador.id),
      ]);
      setDados(d);
      setHistorico(h);
      if (d) {
        setForm({
          bancoCodigo: d.bancoCodigo, bancoNome: d.bancoNome, agencia: d.agencia, agenciaDv: d.agenciaDv || "",
          conta: d.conta, contaDv: d.contaDv || "", tipoConta: d.tipoConta,
          favorecidoNome: d.favorecidoNome || "", favorecidoCpf: d.favorecidoCpf || "",
          endereco: d.endereco, numero: d.numero, complemento: d.complemento || "",
          bairro: d.bairro, cidade: d.cidade, cep: d.cep, uf: d.uf,
          salarioPadrao: d.salarioPadrao != null ? String(d.salarioPadrao) : "",
          valorAdiantamentoPadrao: d.valorAdiantamentoPadrao != null ? String(d.valorAdiantamentoPadrao) : "",
        });
      }
      setCarregado(true);
    } catch {
      setErro("Não foi possível carregar os dados bancários.");
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const salvos = await pagamentosApi.salvarDadosBancarios(colaborador.id, {
        ...form,
        agenciaDv: form.agenciaDv || null,
        contaDv: form.contaDv || null,
        favorecidoNome: form.favorecidoNome || null,
        favorecidoCpf: form.favorecidoCpf || null,
        complemento: form.complemento || null,
        // Achado de auditoria F6 (Fase 2, 22/07/2026) — mesma função de parse
        // de moeda usada nos modais de pagamento (Pagamentos.tsx), pra tratar
        // vírgula/ponto de forma idêntica em todo o sistema.
        salarioPadrao: form.salarioPadrao.trim() ? parseValorMonetario(form.salarioPadrao) : null,
        valorAdiantamentoPadrao: form.valorAdiantamentoPadrao.trim() ? parseValorMonetario(form.valorAdiantamentoPadrao) : null,
      });
      setDados(salvos);
      setEditando(false);
      sucesso("Dados bancários salvos.");
    } catch (e) {
      const det = e instanceof ApiError && Array.isArray((e as ApiError).detalhes) ? "" : "";
      setErro((e instanceof ApiError ? e.message : "Não foi possível salvar.") + det);
    } finally {
      setSalvando(false);
    }
  }

  const campoTexto = (rotulo: string, chave: keyof typeof form, placeholder = "") => (
    <Field label={rotulo}>
      <TextInput
        value={String(form[chave] ?? "")}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [chave]: e.target.value })}
      />
    </Field>
  );

  return (
    <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mb-4">
      <button
        onClick={() => {
          const proximo = !aberto;
          setAberto(proximo);
          if (proximo && !carregado) carregar();
        }}
        className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1.5"
      >
        {/* Achado de auditoria F5 (Fase 2, 22/07/2026): o rótulo original
            ("Dados bancários e pagamentos") não dava nenhuma pista de que o
            salário/adiantamento padrão do colaborador também mora aqui —
            quem faz reajuste salarial em massa não ia adivinhar que precisa
            entrar em "Dados bancários" pra isso. "Remuneração" nomeada
            explicitamente no rótulo do acordeão resolve a descoberta sem
            precisar tirar o campo do lugar (que já é editado junto do resto
            dos dados financeiros do colaborador). */}
        Dados bancários, Remuneração e Pagamentos {aberto ? "▾" : "▸"}
      </button>

      {aberto && !carregado && !erro && <p className="text-xs text-gray-400 mt-2">Carregando...</p>}
      {aberto && erro && <p className="text-xs text-brand-700 dark:text-brand-400 mt-2">{erro}</p>}

      {aberto && carregado && (
        <div className="mt-2 space-y-3">
          {editando ? (
            <div className="bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Autofill do nome do banco (21/07/2026, pedido do Vini: "ao
                    selecionar o código do banco, o sistema deverá preencher
                    automaticamente o nome do banco") — só sobrescreve quando
                    o código bate com um banco conhecido (ver
                    src/lib/bancos.ts); código fora da lista continua aceito
                    normalmente, só sem o preenchimento automático — o campo
                    de nome nunca fica travado, sempre editável por cima. */}
                <Field label="Código do banco">
                  <TextInput
                    value={form.bancoCodigo}
                    placeholder="Ex: 756"
                    onChange={(e) => {
                      const bancoCodigo = e.target.value;
                      const nomeConhecido = nomeBancoPorCodigo(bancoCodigo);
                      setForm({ ...form, bancoCodigo, ...(nomeConhecido ? { bancoNome: nomeConhecido } : {}) });
                    }}
                  />
                </Field>
                {campoTexto("Nome do banco", "bancoNome", "Ex: Sicoob")}
                {campoTexto("Agência", "agencia")}
                {campoTexto("DV agência", "agenciaDv")}
                {campoTexto("Conta", "conta")}
                {campoTexto("DV conta", "contaDv")}
                <Field label="Tipo da conta">
                  <Select value={form.tipoConta} onChange={(e) => setForm({ ...form, tipoConta: e.target.value })}>
                    <option value="corrente">Corrente</option>
                    <option value="poupanca">Poupança</option>
                    <option value="pagamento">Conta de pagamento</option>
                  </Select>
                </Field>
                {campoTexto("Nome do favorecido (se difere)", "favorecidoNome", colaborador.nomeCompleto)}
                {campoTexto("CPF do favorecido (se difere)", "favorecidoCpf", colaborador.cpf || "")}
                {campoTexto("Endereço", "endereco")}
                {campoTexto("Número", "numero")}
                {campoTexto("Complemento", "complemento")}
                {campoTexto("Bairro", "bairro")}
                {campoTexto("Cidade", "cidade")}
                {campoTexto("CEP (8 dígitos)", "cep")}
                {campoTexto("UF", "uf")}
              </div>
              {/* Dados financeiros padrão (21/07/2026, pedido do Vini) — só
                  sugestão pro lançamento em lote de uma folha nova; nunca
                  obrigatório, sempre ajustável na hora de lançar.
                  Seção própria "Remuneração" (achado F5, 22/07/2026) — título
                  explícito pra não ficar parecendo "mais um campo bancário"
                  perdido no meio do formulário. */}
              <h6 className="text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500 mt-3 pt-3 border-t border-gray-200 dark:border-slate-700">Remuneração</h6>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Field label="Salário padrão (R$)">
                  <TextInput
                    type="number"
                    step="0.01"
                    value={form.salarioPadrao}
                    placeholder="Ex: 2500.00"
                    onChange={(e) => setForm({ ...form, salarioPadrao: e.target.value })}
                  />
                </Field>
                <Field label="Valor padrão de adiantamento (R$)">
                  <TextInput
                    type="number"
                    step="0.01"
                    value={form.valorAdiantamentoPadrao}
                    placeholder="Ex: 500.00"
                    onChange={(e) => setForm({ ...form, valorAdiantamentoPadrao: e.target.value })}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <Button variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
                <Button variant="primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar dados bancários"}</Button>
              </div>
            </div>
          ) : dados ? (
            <div className="bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-xs space-y-1">
              <p><span className="text-gray-500 dark:text-slate-400">Banco:</span> {dados.bancoCodigo} — {dados.bancoNome}</p>
              <p>
                <span className="text-gray-500 dark:text-slate-400">Agência:</span> <span style={{ fontFamily: FONT_MONO }}>{dados.agencia}{dados.agenciaDv ? `-${dados.agenciaDv}` : ""}</span>
                {"  ·  "}
                <span className="text-gray-500 dark:text-slate-400">Conta:</span> <span style={{ fontFamily: FONT_MONO }}>{dados.conta}{dados.contaDv ? `-${dados.contaDv}` : ""}</span>
                {"  ·  "}{dados.tipoConta}
              </p>
              <p><span className="text-gray-500 dark:text-slate-400">Favorecido:</span> {dados.favorecidoNome || colaborador.nomeCompleto} — CPF {(() => {
                const cpfExibido = dados.favorecidoCpf || colaborador.cpf;
                return cpfExibido ? (/^\d+$/.test(cpfExibido) ? maskCpf(cpfExibido) : cpfExibido) : "—";
              })()}</p>
              <p><span className="text-gray-500 dark:text-slate-400">Endereço:</span> {dados.endereco}, {dados.numero}{dados.complemento ? ` ${dados.complemento}` : ""} — {dados.bairro}, {dados.cidade}/{dados.uf} · CEP {dados.cep}</p>
              <div className="pt-1">
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => setEditando(true)}>Editar</Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400 dark:text-slate-500">
              Sem dados bancários cadastrados.
              <Button variant="ghost" className="!px-2 !py-1 ml-2" onClick={() => setEditando(true)}>Cadastrar</Button>
            </div>
          )}

          {/* Remuneração (achado F5, Fase 2, 22/07/2026) — bloco próprio, com
              título explícito, separado do card de "Dados bancários" acima:
              antes o salário/adiantamento padrão só aparecia como mais uma
              linha dentro do card bancário (e só quando algum dos dois
              estava preenchido), reforçando a percepção de "isso é sobre
              banco" pra quem só queria reajustar salário. Mostrado sempre
              que os dados já foram carregados (mesmo com "—" quando ainda
              não cadastrado), pra ficar óbvio que existe e onde editar. */}
          {!editando && (
            <div className="bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-xs space-y-1">
              <h6 className="text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500 mb-1">Remuneração</h6>
              <p>
                <span className="text-gray-500 dark:text-slate-400">Salário padrão:</span> {dados?.salarioPadrao != null ? fmtMoney(Number(dados.salarioPadrao)) : "—"}
                {"  ·  "}
                <span className="text-gray-500 dark:text-slate-400">Adiantamento padrão:</span> {dados?.valorAdiantamentoPadrao != null ? fmtMoney(Number(dados.valorAdiantamentoPadrao)) : "—"}
              </p>
              <div className="pt-1">
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => setEditando(true)}>{dados ? "Editar" : "Cadastrar"}</Button>
              </div>
            </div>
          )}

          {historico && historico.length > 0 && (
            <div>
              <h6 className="text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500 mb-1">Histórico de pagamentos</h6>
              <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                {historico.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 border-b border-gray-100 dark:border-slate-800 pb-1">
                    <span>
                      {(p as PagamentoColaborador & { folha?: { competencia: string } }).folha?.competencia
                        ? `${(p as PagamentoColaborador & { folha?: { competencia: string } }).folha!.competencia} · `
                        : ""}
                      {TIPO_PAGAMENTO_LABEL[p.tipo]}
                      {p.remessa ? ` · remessa ${p.remessa.numero}` : ""}
                    </span>
                    <span className="flex items-center gap-2" style={{ fontFamily: FONT_MONO }}>
                      {fmtMoney(Number(p.valor))} · {STATUS_PAGAMENTO_LABEL[p.status]}
                      {p.dataConfirmacao ? ` (${fmtDate(p.dataConfirmacao)})` : ""}
                      {/* Recibo individual (21/07/2026, pedido do Vini) —
                          documento de apoio, disponível pra download direto
                          daqui quando existe (nem todo pagamento tem um). */}
                      {p.reciboUrl && (
                        <button
                          type="button"
                          className="text-brand-700 dark:text-brand-400 underline"
                          style={{ fontFamily: "inherit" }}
                          onClick={async () => {
                            const { blob, nomeArquivo } = await pagamentosApi.baixarRecibo(p.id);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = nomeArquivo || p.reciboNomeOriginal || "recibo.pdf";
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          Recibo
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
