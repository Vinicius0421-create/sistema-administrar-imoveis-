import React, { useMemo } from "react";
import { AppData } from "../hooks/useAppData";
import {
  Accordion, CARD_SHADOW, CARD_SHADOW_HOVER, cardClicavelProps, COLORS, fmtDate, FOCUS_RING_CLASS, KPICard, PageHeader,
  SimpleBarChart, SimplePieLegend, useAccordions,
} from "../components/ui";
import { Users, Phone, Laptop, Package, Wrench, ShoppingCart, ChevronRight, Repeat, HistoryIcon, Plus, Cake } from "../components/icons";
import {
  colaboradorOperacionalmenteAtivo, Papel, STATUS_EQUIPAMENTO_LABEL, STATUS_SOLICITACAO_LABEL,
  STATUS_SOLICITACAO_PAPELARIA_LABEL, StatusChamado, TIPO_MOVIMENTACAO_LABEL,
} from "../types";
import { aniversariantesDoMes, MESES_PT_COMPLETO } from "../lib/aniversarios";

// Mesmo conjunto de status "encerrados" já usado em PortalSuporte.tsx.
// Achado de auditoria (08/07/2026, reportado pelo Vini): o KPI "Chamados em
// aberto" e a lista de urgentes desta página ainda comparavam com
// "CONCLUIDO"/"CANCELADO" — nomes de status que existiam ANTES da Fase 2
// (ver comentário do enum StatusChamado no schema.prisma: CONCLUIDO virou
// RESOLVIDO, e não existe mais CANCELADO). Como esses valores nunca batem
// com o status real de um chamado, o filtro nunca excluía nada — todo
// chamado RESOLVIDO ou ENCERRADO continuava contando como "em aberto" no
// painel geral, mesmo tendo sido finalizado há muito tempo.
const STATUS_CHAMADO_ENCERRADOS: StatusChamado[] = ["RESOLVIDO", "ENCERRADO"];

interface HomePageProps {
  data: AppData;
  // Só navega para módulos presentes no menu do papel atual — o dashboard
  // não deve virar um atalho para áreas que o menu lateral deliberadamente
  // esconde de Gestor/Coordenador (equipamentos, linhas, acessos etc.).
  // `payload` (Fase 4 — Dashboard interativo, 06/07/2026) carrega o alvo
  // específico do clique — setorId, status, chamadoId, solicitacaoId — pra
  // App.tsx repassar como filtro/foco inicial da página de destino, em vez
  // de só abrir a lista genérica e deixar a pessoa procurar de novo.
  onNavigate?: (moduloKey: string, payload?: Record<string, any>) => void;
  podeNavegarPara?: (moduloKey: string) => boolean;
  // Dashboard por perfil (Onda 2.2 do redesign, 21/07/2026, pedido do Vini:
  // "Financeiro deveria abrir direto nos KPIs de Pagamentos/Solicitações
  // pendentes de aprovação de custo, não repetir a mesma ordem de blocos
  // que o Administrador vê" — ver seção 2.5 da auditoria). Até aqui a
  // personalização por papel era só OCULTAÇÃO (`podeVer`, abaixo) — a
  // ORDEM dos blocos era sempre a mesma pra todo mundo que enxergava mais
  // de um. `papel` é o que falta pra decidir prioridade, não só visibilidade.
  // Opcional só pra não quebrar nenhum outro call-site que porventura exista
  // sem ele — cai no `default:` de PRIORIDADE_POR_PAPEL (ordem atual,
  // inalterada) se vier ausente.
  papel?: Papel;
}

// Ordem "clássica" (a mesma de sempre) — segue sendo a do ADMINISTRADOR, que
// é quem realmente usa e se beneficia de ver tudo em visão panorâmica antes
// do detalhe. Os outros papéis têm o operacional deles (o que efetivamente
// atendem no dia a dia) antes do resumo de Pessoas — mesma ordem de
// prioridade que o próprio menu lateral (NAV em App.tsx) já revela pra cada
// um (ex: GESTOR_COORDENADOR e RH têm "Solicitações" listado ANTES de
// "Colaboradores" no próprio menu).
const ORDEM_PADRAO = ["kpis-pessoas", "kpis-equipamentos", "kpis-operacao", "graficos", "listas-atencao", "aniversariantes", "atividades"];
const PRIORIDADE_POR_PAPEL: Partial<Record<Papel, string[]>> = {
  GESTOR_COORDENADOR: ["kpis-operacao", "listas-atencao", "kpis-pessoas", "graficos", "aniversariantes", "atividades"],
  SUPORTE_TI: ["kpis-operacao", "listas-atencao", "kpis-equipamentos", "kpis-pessoas", "graficos", "aniversariantes", "atividades"],
  RH: ["kpis-operacao", "listas-atencao", "kpis-pessoas", "graficos", "aniversariantes", "atividades"],
  FINANCEIRO: ["kpis-operacao", "listas-atencao", "kpis-pessoas", "graficos", "aniversariantes", "atividades"],
};

export function HomePage({ data, onNavigate, podeNavegarPara, papel }: HomePageProps) {
  function irPara(moduloKey: string, payload?: Record<string, any>): (() => void) | undefined {
    if (!onNavigate) return undefined;
    if (podeNavegarPara && !podeNavegarPara(moduloKey)) return undefined;
    return () => onNavigate(moduloKey, payload);
  }

  // Conta ATIVO + EM_AVISO — colaborador em aviso prévio continua
  // trabalhando normalmente até o desligamento (ver colaboradorOperacionalmenteAtivo em types.ts).
  const colabAtivos = data.colaboradores.filter((c) => colaboradorOperacionalmenteAtivo(c.status)).length;
  const equipEmUso = data.equipamentos.filter((e) => e.status === "EM_USO").length;
  const equipDisponivel = data.equipamentos.filter((e) => e.status === "DISPONIVEL").length;
  const chamadosAbertos = data.chamados.filter((c) => !STATUS_CHAMADO_ENCERRADOS.includes(c.status)).length;
  const linhasSemVinculo = data.linhas.filter((l) => !l.colaboradorId && l.colaboradorInformado !== "Disponível").length;

  // Achado (Onda 2.2 do redesign, 21/07/2026, durante a auditoria de
  // "priorização real por papel"): este KPI e a lista "Solicitações que
  // precisam de atenção" abaixo sempre contaram só `data.solicitacoes`
  // (SolicitacaoEquipamento) — nunca somaram Papelaria e Compras
  // (`data.solicitacoesPapelaria`), mesmo já vindo carregada pra quase todo
  // papel (ver useAppData.ts). Pra RH isso é mais que impreciso, é ENGANOSO:
  // RH nunca gerencia solicitação de equipamento (a aba nem aparece pra ele
  // em SolicitacoesHub.tsx, `somentePapelaria` lá), mas o painel geral dele
  // mostrava um número sobre equipamento mesmo assim — clicar caía direto
  // na aba de Papelaria (only aba que RH tem) sem nenhuma relação com o
  // número que acabou de ver. Cada papel agora soma só as fontes que ele de
  // fato gerencia, espelhando exatamente `somentePapelaria`/
  // `somenteEquipamento` de SolicitacoesHub.tsx — mesma regra, um só lugar
  // de origem conceitual, duas telas aplicando.
  const somentePapelariaHub = papel === "RH";
  const somenteEquipamentoHub = papel === "SUPORTE_TI";
  const equipPendentes = data.solicitacoes.filter((s) => ["PENDENTE", "EM_ANALISE"].includes(s.status)).length;
  const papelariaPendentes = data.solicitacoesPapelaria.filter((s) => ["ENVIADA", "EM_ANALISE"].includes(s.status)).length;
  const solicPendentes = somentePapelariaHub
    ? papelariaPendentes
    : somenteEquipamentoHub
      ? equipPendentes
      : equipPendentes + papelariaPendentes;

  // Guarda o setorId junto com o nome — precisa dele pra levar o clique na
  // barra direto pro filtro de Colaboradores (Fase 4), não só pro nome exibido.
  const porSetor = useMemo(() => {
    const map: Record<string, { setorId: string; total: number }> = {};
    data.colaboradores.forEach((c) => {
      const nome = c.setor?.nome;
      if (!nome || !c.setorId) return;
      if (!map[nome]) map[nome] = { setorId: c.setorId, total: 0 };
      map[nome].total += 1;
    });
    return Object.entries(map)
      .map(([setor, v]) => ({ setor, total: v.total, setorId: v.setorId }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [data.colaboradores]);

  // Idem: guarda a chave bruta do status (`EM_USO` etc.) junto do rótulo
  // traduzido — o filtro de Equipamentos trabalha com a chave, não o label.
  const porStatusEquip = useMemo(() => {
    const map: Record<string, { label: string; total: number }> = {};
    data.equipamentos.forEach((e) => {
      if (!map[e.status]) map[e.status] = { label: STATUS_EQUIPAMENTO_LABEL[e.status], total: 0 };
      map[e.status].total += 1;
    });
    return Object.entries(map).map(([statusKey, v]) => ({ name: v.label, value: v.total, statusKey }));
  }, [data.equipamentos]);

  // Achado de auditoria (Etapa 4 — Frontend, 08/07/2026): 3 dos 5 tons já
  // existiam como token nomeado em COLORS (ink/amber/sage) mas estavam
  // redigitados soltos em vez de referenciados — se a paleta em ui.tsx
  // mudar, este array não acompanha. Só "#9CA3AF" (gray-400, cinza Tailwind
  // padrão) genuinamente não tem token próprio.
  const pieColors = [COLORS.ink, COLORS.brass, COLORS.amber, "#9CA3AF", COLORS.sage];

  const urgentes = data.chamados.filter((c) => c.prioridade === "ALTA" && !STATUS_CHAMADO_ENCERRADOS.includes(c.status)).slice(0, 5);

  // Mesma correção do KPI acima (ver comentário em `solicPendentes`) — a
  // lista agora combina as duas fontes que o papel de fato gerencia, em vez
  // de sempre mostrar só Equipamento. `irPara` já filtra por
  // `podeNavegarPara` sozinho (ver definição no topo do componente), então
  // um item sem navegação possível (raro, mas por segurança) some do
  // `.filter(a => !!a.navegar)` — mesmo padrão já usado em
  // `atividadesRecentes` logo abaixo.
  const solicAtencaoItens = useMemo(() => {
    type ItemAtencao = { id: string; data: string; label: string; sub: string; navegar?: () => void };
    const itensEquip: ItemAtencao[] = somentePapelariaHub
      ? []
      : data.solicitacoes
          .filter((s) => ["PENDENTE", "EM_ANALISE"].includes(s.status))
          .map((s) => ({
            id: `eq-${s.id}`,
            data: s.dataSolicitacao,
            label: `${s.solicitante?.nomeCompleto || "—"} — ${s.item}`,
            sub: STATUS_SOLICITACAO_LABEL[s.status],
            navegar: irPara("solicitacoes", { solicitacaoId: s.id }),
          }));
    const itensPapelaria: ItemAtencao[] = somenteEquipamentoHub
      ? []
      : data.solicitacoesPapelaria
          .filter((s) => ["ENVIADA", "EM_ANALISE"].includes(s.status))
          .map((s) => ({
            id: `pap-${s.id}`,
            data: s.dataSolicitacao,
            label: `${s.responsavel?.nome || "—"} — Remessa #${s.numero}`,
            sub: STATUS_SOLICITACAO_PAPELARIA_LABEL[s.status],
            navegar: irPara("solicitacoes", { solicitacaoPapelariaId: s.id }),
          }));
    return [...itensEquip, ...itensPapelaria]
      .filter((a) => !!a.navegar)
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.solicitacoes, data.solicitacoesPapelaria, somentePapelariaHub, somenteEquipamentoHub]);

  // Aniversariantes do mês (17/07/2026, pedido do Vini: levar o calendário de
  // aniversários que o RH mantém hoje num pôster pra dentro do sistema, "de
  // forma interativo e conectada a tudo do sistema" — ver lib/aniversarios.ts
  // pra decisão completa de design). Lê direto de `data.colaboradores`, sem
  // endpoint novo: mesma fonte que já alimenta todo o resto deste painel, o
  // que é o que torna isto "conectado" — editar a data de nascimento no
  // cadastro ou desligar alguém já reflete aqui automaticamente.
  const mesAtual = new Date().getMonth();
  const aniversariantesMes = useMemo(() => aniversariantesDoMes(data.colaboradores, mesAtual), [data.colaboradores, mesAtual]);

  // Atalhos Rápidos (Fase 3 — Componentes Inteligentes, 14/07/2026, item
  // "Dashboard": atalhos rápidos + cards inteligentes) — cada atalho manda
  // { novo: true } no payload de navegação, o mesmo mecanismo já usado pra
  // deep-link de detalhe (abrirColaboradorId etc., ver App.tsx), só que
  // abrindo direto o formulário de CRIAÇÃO em vez de um registro existente.
  // `podeNavegarPara` (já calculado a partir do NAV do papel atual) decide
  // quais atalhos aparecem — nunca oferece um atalho pra um módulo que o
  // menu lateral já esconde desse papel.
  const atalhos = [
    { key: "colaboradores", label: "Novo Colaborador", icon: Users },
    { key: "chamados", label: "Novo Chamado", icon: Wrench },
    { key: "solicitacoes", label: "Nova Solicitação", icon: ShoppingCart },
    { key: "movimentacoes", label: "Nova Movimentação", icon: Repeat },
  ].filter((a) => podeNavegarPara?.(a.key));

  // Painel geral por papel (14/07/2026, pedido do Vini: "o painel geral
  // tem que estar disponível para todos os papéis, porém com o que ele
  // precisa ver" — ex: técnico só precisa ver a parte de equipamento,
  // chamados, solicitações). Até aqui os 3 blocos de KPI, os 2 gráficos e
  // os 2 painéis de lista abaixo apareciam INTEIROS pra qualquer papel com
  // acesso a "Visão Geral" — inclusive números de módulos que aquele papel
  // nem consegue abrir (ex: RH via "Linhas sem vínculo", Gestor via
  // "Equipamentos em uso"). Mesmo mecanismo que já existia pros Atalhos
  // Rápidos acima (`podeNavegarPara`, derivado do NAV do papel em
  // App.tsx) — só que agora aplicado em CADA KPI/painel individualmente,
  // não só nos atalhos. `podeVer` cai pra "mostra tudo" se `podeNavegarPara`
  // não for passado (só acontece no fallback sem navegação do `default:`
  // do switch em App.tsx) — preserva o comportamento anterior nesse caso
  // em vez de esconder tudo por engano.
  const podeVer = (moduloKey: string) => (podeNavegarPara ? !!podeNavegarPara(moduloKey) : true);
  const veColaboradores = podeVer("colaboradores");
  const veLinhas = podeVer("linhas");
  const veEquipamentos = podeVer("equipamentos");
  const veChamados = podeVer("chamados");
  const veSolicitacoes = podeVer("solicitacoes");
  // Usados só pra filtrar o feed "Atividades Recentes" abaixo — os 3 blocos
  // de KPI acima nunca precisaram desses dois porque nem "movimentacoes"
  // nem "historico" têm painel de indicador na Visão Geral, só o item de
  // menu (Movimentações fica escondido pra quem não é ADMINISTRADOR/
  // GESTOR_COORDENADOR; Histórico de Trocas hoje é exclusivo ADMINISTRADOR).
  const veMovimentacoes = podeVer("movimentacoes");
  const veHistorico = podeVer("historico");
  const vePessoas = veColaboradores || veLinhas;
  const veOperacao = veChamados || veSolicitacoes;

  // Atividades Recentes (Fase 3, 14/07/2026) — feed unificado a partir dos
  // dados já carregados em AppData (sem endpoint novo): junta os 4 tipos de
  // evento com data própria (chamado aberto, solicitação de equipamento
  // criada, movimentação registrada, troca de equipamento no histórico),
  // ordena por data decrescente e mostra os mais recentes. 100% client-side
  // — o custo é só reordenar arrays que já estão em memória.
  //
  // Achado (17/07/2026, reorganização de hierarquia — papel novo
  // FINANCEIRO): este feed juntava os 4 tipos sem checar `podeVer` nenhum,
  // ao contrário de todo o resto do painel (KPIs/gráficos/listas acima, já
  // gateados desde 14/07). Antes disso o vazamento já existia em silêncio
  // pra RH/SUPORTE_TI (viam Chamados/Histórico de Trocas aqui mesmo sem
  // acesso ao módulo) — ficou mais evidente agora com Financeiro, cujo
  // escopo é deliberadamente estreito (só Solicitações). Cada fonte agora
  // só entra no feed se o papel realmente tem o módulo correspondente no
  // menu — mesmo mecanismo `podeVer` já usado nos blocos acima.
  const atividadesRecentes = useMemo(() => {
    type Atividade = { id: string; data: string; label: string; sub: string; navegar?: () => void };
    const itens: Atividade[] = [
      ...(veChamados ? data.chamados : []).map((c) => ({
        id: `chamado-${c.id}`,
        data: c.dataAbertura,
        label: `Chamado: ${c.descricao}`,
        sub: c.solicitante?.nomeCompleto || "—",
        navegar: irPara("chamados", { chamadoId: c.id }),
      })),
      ...(veSolicitacoes ? data.solicitacoes : []).map((s) => ({
        id: `solicitacao-${s.id}`,
        data: s.dataSolicitacao,
        label: `Solicitação: ${s.item}`,
        sub: s.solicitante?.nomeCompleto || "—",
        navegar: irPara("solicitacoes", { solicitacaoId: s.id }),
      })),
      ...(veMovimentacoes ? data.movimentacoes : []).map((m) => ({
        id: `movimentacao-${m.id}`,
        data: m.data,
        label: `${TIPO_MOVIMENTACAO_LABEL[m.tipo]}`,
        sub: m.colaborador?.nomeCompleto || "—",
        navegar: irPara("movimentacoes"),
      })),
      ...(veHistorico ? data.historico : []).map((h) => ({
        id: `historico-${h.id}`,
        data: h.data,
        label: `Troca de equipamento: ${h.equipamento?.tipo || ""}`,
        sub: h.colaboradorDestino?.nomeCompleto || h.colaboradorOrigem?.nomeCompleto || "Estoque",
        navegar: irPara("historico"),
      })),
    ];
    return itens
      .filter((a) => !!a.navegar)
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.chamados, data.solicitacoes, data.movimentacoes, data.historico, veChamados, veSolicitacoes, veMovimentacoes, veHistorico]);

  // Onda 1 do redesenho (21/07/2026, pedido do Vini: "reduzir carga
  // cognitiva... informações abertas devem virar cards retráteis"). A
  // auditoria contou até 14 blocos visuais simultâneos nesta tela pra quem
  // vê tudo (ADMINISTRADOR) — os 3 grupos de KPI acima continuam sempre
  // visíveis (são o resumo que se decide em 1 olhada), mas os painéis de
  // CONTEÚDO abaixo (gráficos, listas) agora são Accordion — só os dois
  // mais acionáveis (chamados urgentes, solicitações pendentes) já vêm
  // abertos por padrão; o resto é 1 clique.
  const acc = useAccordions(["chamados-urgentes", "solicitacoes-atencao"]);

  return (
    <div className="space-y-6">
      <PageHeader title="Visão Geral" subtitle="Painel administrativo — Administrar Imóveis" semMargem />

      {/* Atalhos Rápidos (Fase 3, 14/07/2026) — cada atalho reduz um fluxo de
          "abrir o módulo → achar o botão de criar → clicar" pra um clique só
          direto do dashboard. Some sozinho (array vazio) se o papel não tem
          nenhum dos 4 módulos-alvo — nunca some parcialmente com botões
          desabilitados, que confundiria mais do que ajudaria. */}
      {atalhos.length > 0 && (
        <div className="flex flex-wrap gap-2 animate-[staggerIn_var(--motion-page)_var(--motion-ease)_both]">
          {atalhos.map((a) => (
            <button
              key={a.key}
              onClick={irPara(a.key, { novo: true })}
              className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 transition-all duration-[var(--motion-fast)] hover:border-brand-600/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] active:duration-[var(--motion-instant)]"
              style={{ boxShadow: CARD_SHADOW }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = CARD_SHADOW_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = CARD_SHADOW)}
            >
              <Plus size={15} className="text-brand-600" />
              <a.icon size={15} className="text-gray-400 dark:text-slate-500" />
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Achado de auditoria (08/07/2026, Etapa 7 — Responsividade): cada uma
          das 3 seções abaixo (Pessoas/Equipamentos/Operação) sempre teve
          exatamente 2 KPICards, mas a grade era `grid-cols-2 sm:grid-cols-4`
          — a partir de `sm` (640px), o grid virava 4 colunas com só 2
          preenchidas, deixando cada card preso a 25% da largura (metade do
          espaço desperdiçado) em vez dos 50% que os únicos 2 cards do grupo
          poderiam ocupar. Isso apertava o rótulo do card até truncar
          ("C..") em telas de 768-1024px. `grid-cols-2` fixo corrige as duas
          coisas: aproveita o espaço todo e dá largura consistente ao rótulo
          em qualquer tamanho de tela. */}
      {/* Achado (10/07/2026, Padronização de Animações — seção "Dashboard"):
          as 3 seções de indicadores e os 2 pares de painéis abaixo apareciam
          todos no mesmo instante, de uma vez — pedido explícito era uma
          entrada "progressiva e suave". `staggerIn` + `animationDelay`
          incremental (60ms entre cada bloco) dá esse efeito em cascata sem
          precisar de nenhuma biblioteca de orquestração: cada bloco é o
          mesmo `@keyframes` de index.css, só começando um pouco mais tarde
          que o anterior. `both` no fill-mode mantém o bloco invisível até a
          própria vez dele começar, em vez de piscar visível-depois-some. */}
      {/* Dashboard por perfil (Onda 2.2, 21/07/2026) — os 7 blocos abaixo
          eram sempre renderizados nesta MESMA ordem fixa pra qualquer papel
          (só a visibilidade individual variava, via `podeVer`). Agora viram
          uma lista de blocos com id próprio, filtrada (só os visíveis pro
          papel) e reordenada por `PRIORIDADE_POR_PAPEL` — o operacional que
          cada papel realmente atende no dia a dia (Solicitações pra Gestor/
          RH/Financeiro, Chamados+Solicitações pra Suporte TI) vem ANTES do
          resumo de Pessoas, em vez de depois. ADMINISTRADOR mantém a ordem
          clássica (visão panorâmica primeiro) por não estar na tabela —
          cai no `|| ORDEM_PADRAO`. O `animationDelay` em cascata (60ms por
          posição) continua existindo, só que calculado pela posição FINAL
          de cada bloco, não mais fixo por bloco — senão a reordenação faria
          blocos tardios "pularem a fila" da animação também. */}
      {(() => {
        const blocos: { id: string; visivel: boolean; render: () => React.ReactNode }[] = [
          {
            id: "kpis-pessoas",
            visivel: vePessoas,
            render: () => (
              <>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-2">Pessoas</h3>
                <div className="grid grid-cols-2 gap-3">
                  {veColaboradores && (
                    <KPICard label="Colaboradores ativos" value={colabAtivos} icon={Users} accent={COLORS.sage} onClick={irPara("colaboradores")} />
                  )}
                  {veLinhas && (
                    <KPICard label="Linhas sem vínculo" value={linhasSemVinculo} icon={Phone} accent={COLORS.amber} onClick={irPara("linhas")} />
                  )}
                </div>
              </>
            ),
          },
          {
            id: "kpis-equipamentos",
            visivel: veEquipamentos,
            render: () => (
              <>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-2">Equipamentos</h3>
                <div className="grid grid-cols-2 gap-3">
                  <KPICard label="Em uso" value={equipEmUso} icon={Laptop} accent={COLORS.ink} onClick={irPara("equipamentos", { status: "EM_USO" })} />
                  <KPICard label="Disponíveis" value={equipDisponivel} icon={Package} accent={COLORS.sage} onClick={irPara("equipamentos", { status: "DISPONIVEL" })} />
                </div>
              </>
            ),
          },
          {
            id: "kpis-operacao",
            visivel: veOperacao,
            render: () => (
              <>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-2">Operação</h3>
                <div className="grid grid-cols-2 gap-3">
                  {veChamados && (
                    <KPICard label="Chamados em aberto" value={chamadosAbertos} icon={Wrench} accent={COLORS.brass} onClick={irPara("chamados")} />
                  )}
                  {veSolicitacoes && (
                    <KPICard label="Solicitações pendentes" value={solicPendentes} icon={ShoppingCart} accent={COLORS.amber} onClick={irPara("solicitacoes")} />
                  )}
                </div>
              </>
            ),
          },
          {
            id: "graficos",
            visivel: veColaboradores || veEquipamentos,
            render: () => (
              <div className="grid lg:grid-cols-2 gap-4">
                {veColaboradores && (
                  <Accordion titulo="Colaboradores por setor" aberto={acc.estaAberto("colab-setor")} onToggle={() => acc.alternar("colab-setor")}>
                    <SimpleBarChart
                      data={porSetor}
                      labelKey="setor"
                      valueKey="total"
                      color={COLORS.ink}
                      onItemClick={(item) => irPara("colaboradores", { setorId: item.setorId })?.()}
                    />
                  </Accordion>
                )}
                {veEquipamentos && (
                  <Accordion titulo="Equipamentos por status" aberto={acc.estaAberto("equip-status")} onToggle={() => acc.alternar("equip-status")}>
                    <SimplePieLegend
                      data={porStatusEquip}
                      colors={pieColors}
                      onItemClick={(item) => irPara("equipamentos", { status: item.statusKey })?.()}
                    />
                  </Accordion>
                )}
              </div>
            ),
          },
          {
            id: "listas-atencao",
            visivel: veChamados || veSolicitacoes,
            render: () => (
              <div className="grid lg:grid-cols-2 gap-4">
                {veChamados && (
                  <Accordion
                    titulo="Chamados de alta prioridade"
                    contador={urgentes.length || undefined}
                    aberto={acc.estaAberto("chamados-urgentes")}
                    onToggle={() => acc.alternar("chamados-urgentes")}
                  >
                    {urgentes.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum chamado urgente em aberto.</p>
                    ) : (
                      <ul className="space-y-2">
                        {urgentes.map((c) => {
                          const abrir = irPara("chamados", { chamadoId: c.id });
                          return (
                            <li
                              key={c.id}
                              onClick={abrir}
                              {...(abrir ? cardClicavelProps(abrir) : {})}
                              className={`text-xs flex items-center justify-between border-b border-gray-100 dark:border-slate-700 pb-2 -mx-1 px-1 rounded ${abrir ? `cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 ${FOCUS_RING_CLASS}` : ""}`}
                            >
                              <span>{c.solicitante?.nomeCompleto} — {c.descricao}</span>
                              <ChevronRight size={14} className="text-gray-300 dark:text-slate-600" aria-hidden="true" />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Accordion>
                )}
                {veSolicitacoes && (
                  <Accordion
                    titulo="Solicitações que precisam de atenção"
                    contador={solicAtencaoItens.length || undefined}
                    aberto={acc.estaAberto("solicitacoes-atencao")}
                    onToggle={() => acc.alternar("solicitacoes-atencao")}
                  >
                    {solicAtencaoItens.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-slate-500">Nenhuma solicitação pendente.</p>
                    ) : (
                      <ul className="space-y-2">
                        {solicAtencaoItens.map((s) => (
                          <li
                            key={s.id}
                            onClick={s.navegar}
                            {...(s.navegar ? cardClicavelProps(s.navegar) : {})}
                            className={`text-xs flex items-center justify-between border-b border-gray-100 dark:border-slate-700 pb-2 -mx-1 px-1 rounded ${s.navegar ? `cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 ${FOCUS_RING_CLASS}` : ""}`}
                          >
                            <span>{s.label}</span>
                            <span className="text-gray-400 dark:text-slate-500">{s.sub}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Accordion>
                )}
              </div>
            ),
          },
          {
            id: "aniversariantes",
            // Gateado por `veColaboradores`: mesma regra da API já restringe
            // quem recebe `dataNascimento` real (ADMINISTRADOR/
            // GESTOR_COORDENADOR/RH), então quem não vê o módulo
            // Colaboradores também não veria dado nenhum aqui — melhor
            // esconder o painel inteiro do que mostrar uma lista sempre vazia.
            visivel: veColaboradores,
            render: () => (
              <Accordion
                titulo={`Aniversariantes de ${MESES_PT_COMPLETO[mesAtual]}`}
                icon={Cake}
                contador={aniversariantesMes.length || undefined}
                aberto={acc.estaAberto("aniversariantes")}
                onToggle={() => acc.alternar("aniversariantes")}
              >
                {aniversariantesMes.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum aniversariante este mês.</p>
                ) : (
                  <ul className="space-y-2">
                    {aniversariantesMes.map(({ colaborador: c, dia }) => {
                      const abrir = irPara("colaboradores", { colaboradorId: c.id });
                      return (
                        <li
                          key={c.id}
                          onClick={abrir}
                          {...(abrir ? cardClicavelProps(abrir) : {})}
                          className={`text-xs flex items-center justify-between border-b border-gray-100 dark:border-slate-700 pb-2 -mx-1 px-1 rounded ${abrir ? `cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 ${FOCUS_RING_CLASS}` : ""}`}
                        >
                          <span>{c.nomeCompleto}</span>
                          <span className="text-gray-400 dark:text-slate-500 flex-shrink-0">
                            {String(dia).padStart(2, "0")}/{String(mesAtual + 1).padStart(2, "0")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Accordion>
            ),
          },
          {
            id: "atividades",
            // Só aparece se houver pelo menos um evento recente nos 4 tipos
            // combinados (empresa nova/dia parado não ganha um painel vazio
            // à toa) — ver useMemo de `atividadesRecentes` acima.
            visivel: atividadesRecentes.length > 0,
            render: () => (
              <Accordion titulo="Atividades Recentes" aberto={acc.estaAberto("atividades")} onToggle={() => acc.alternar("atividades")}>
                <ul className="space-y-2">
                  {atividadesRecentes.map((a) => (
                    <li
                      key={a.id}
                      onClick={a.navegar}
                      {...(a.navegar ? cardClicavelProps(a.navegar) : {})}
                      className={`text-xs flex items-center justify-between gap-3 border-b border-gray-100 dark:border-slate-700 pb-2 -mx-1 px-1 rounded ${a.navegar ? `cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 ${FOCUS_RING_CLASS}` : ""}`}
                    >
                      <span className="min-w-0 truncate">
                        {a.label} <span className="text-gray-400 dark:text-slate-500">— {a.sub}</span>
                      </span>
                      <span className="text-gray-400 dark:text-slate-500 flex-shrink-0">{fmtDate(a.data)}</span>
                    </li>
                  ))}
                </ul>
              </Accordion>
            ),
          },
        ];

        const ordem = (papel && PRIORIDADE_POR_PAPEL[papel]) || ORDEM_PADRAO;
        const blocosVisiveis = blocos.filter((b) => b.visivel).sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id));

        return blocosVisiveis.map((b, i) => (
          <div key={b.id} className="animate-[staggerIn_var(--motion-page)_var(--motion-ease)_both]" style={{ animationDelay: `${i * 60}ms` }}>
            {b.render()}
          </div>
        ));
      })()}
    </div>
  );
}

// PainelClicavel foi substituído por <Accordion> (Onda 1 do redesenho,
// 21/07/2026 — ver comentário acima de `useAccordions`). Removido daqui
// (não é mais usado em nenhum painel desta tela nem importado em outro
// arquivo).
