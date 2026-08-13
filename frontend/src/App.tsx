import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/AuthContext";
import { useAppData } from "./hooks/useAppData";
import { LoginPage } from "./pages/Login";
import { RedefinirSenhaPage } from "./pages/RedefinirSenha";
import { TrocarSenhaObrigatoriaPage } from "./pages/TrocarSenhaObrigatoria";
import { Button, COLORS, ErrorBoundary, FOCUS_RING_CLASS, FONT_DISPLAY, LoadingState, SkeletonKPIGrid, SkeletonListaCartoes } from "./components/ui";
import {
  Banknote, Home, Users, Laptop, Phone, Key, ShoppingCart, Wrench, Repeat, HistoryIcon, Menu, LogOut, Settings, ClipboardList, MessageCircle, UserCircle2, Search, FileText, Building2,
} from "./components/icons";
import { LOGO_DATA_URI } from "./assets/logo";
import { Papel } from "./types";
import { MenuUsuario } from "./components/MenuUsuario";
import { IndicadorConexao } from "./components/IndicadorConexao";
import { CentralNotificacoes } from "./components/CentralNotificacoes";
import { ComandoPaleta } from "./components/ComandoPaleta";
import { CentralAjuda, BotaoAjuda } from "./components/CentralAjuda";
import { AssistenteAjuda } from "./components/AssistenteAjuda";
import { TourGuiado, tourJaVisto } from "./components/TourGuiado";
import { tourParaPapel } from "./ajuda/tours";
import { DestinoNotificacao } from "./lib/notificacaoDestino";
import { PortalColaboradorHandle } from "./pages/PortalColaborador";
// M1 do check-up (Fase 2, 22/07/2026, decisão do Vini) — botão de chat
// próprio na barra superior, ver comentário completo em `BotaoMensagens`
// logo abaixo dos imports.
import { mensagensApi } from "./api/mensagens";
import { assinarMensagensAtualizadas, emitirMensagensAtualizadas } from "./lib/mensagensRealtime";

// Deep link do QR Code de ativo (22/07/2026, achado do Vini: "Os Qr code
// não levam a lugar nenhum, são só um texto" — o QR só codificava o
// patrimônio/id como texto puro, sem link nenhum pra abrir). Mesmo padrão já
// usado por `/redefinir-senha` (ver comentário completo dentro do `export
// default function App` abaixo): sem router de verdade, a única forma de
// "linkar" pra uma tela específica é ler a URL na mão. Só extrai o id aqui —
// quem decide o que fazer com ele é o AppShell (precisa saber o papel
// logado pra confirmar que o módulo "equipamentos" existe pra essa pessoa).
function extrairIdAtivoDaUrl(): string | null {
  const m = window.location.pathname.match(/^\/ativo\/([a-zA-Z0-9_-]+)\/?$/);
  return m ? m[1] : null;
}

// Etapa 5 (Performance, 08/07/2026): este app é uma SPA de tela única sem
// router (ver comentário mais abaixo) — antes desta mudança, as 13 páginas
// "módulo" (Home até Mensagens) eram importadas de forma estática no topo
// do arquivo, então TODAS entravam no mesmo bundle JS inicial mesmo que a
// pessoa nunca abrisse, por exemplo, Configurações ou Importar Imoview. Isso
// incluía inclusive PortalColaborador/PortalSuporte — que um usuário
// ADMINISTRADOR nunca renderiza, e vice-versa (COLABORADOR só vê
// PortalColaborador). `React.lazy` faz cada página virar seu próprio chunk,
// baixado sob demanda só na primeira vez que o módulo é aberto — o bundle
// inicial cai pra só o necessário pra tela de login + o AppShell em si.
// `.then(m => ({ default: m.XPage }))` é necessário porque todas as páginas
// usam export nomeado (`export function XPage`), não `export default` —
// manter assim evita ter que tocar em nenhuma das 13 páginas em si.
const HomePage = React.lazy(() => import("./pages/Home").then((m) => ({ default: m.HomePage })));
const ColaboradoresPage = React.lazy(() => import("./pages/Colaboradores").then((m) => ({ default: m.ColaboradoresPage })));
const PagamentosPage = React.lazy(() => import("./pages/Pagamentos").then((m) => ({ default: m.PagamentosPage })));
const EquipamentosPage = React.lazy(() => import("./pages/Equipamentos").then((m) => ({ default: m.EquipamentosPage })));
const LinhasPage = React.lazy(() => import("./pages/Linhas").then((m) => ({ default: m.LinhasPage })));
const AcessosPage = React.lazy(() => import("./pages/Acessos").then((m) => ({ default: m.AcessosPage })));
const SolicitacoesHub = React.lazy(() => import("./pages/SolicitacoesHub").then((m) => ({ default: m.SolicitacoesHub })));
const ChamadosPage = React.lazy(() => import("./pages/Chamados").then((m) => ({ default: m.ChamadosPage })));
const MovimentacoesPage = React.lazy(() => import("./pages/Movimentacoes").then((m) => ({ default: m.MovimentacoesPage })));
const HistoricoPage = React.lazy(() => import("./pages/Historico").then((m) => ({ default: m.HistoricoPage })));
const ConfiguracoesPage = React.lazy(() => import("./pages/Configuracoes").then((m) => ({ default: m.ConfiguracoesPage })));
const PortalColaborador = React.lazy(() => import("./pages/PortalColaborador").then((m) => ({ default: m.PortalColaborador })));
const PortalSuportePage = React.lazy(() => import("./pages/PortalSuporte").then((m) => ({ default: m.PortalSuportePage })));
const MensagensPage = React.lazy(() => import("./pages/Mensagens").then((m) => ({ default: m.MensagensPage })));
const DocumentosPage = React.lazy(() => import("./pages/Documentos").then((m) => ({ default: m.DocumentosPage })));
// Marketing Imobiliário (13/08/2026) — Banco de Imóveis + integração Imoview.
const MarketingPage = React.lazy(() => import("./pages/Marketing").then((m) => ({ default: m.MarketingPage })));

interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  // Agrupamento visual da sidebar (Onda 1 do redesenho, 21/07/2026, pedido
  // do Vini: "reorganizar completamente... agrupar funcionalidades
  // relacionadas, evitar menus gigantes"). Reorganização SÓ visual — os
  // `key` continuam os mesmos, `renderModule()`/`activeModule` nem sabem
  // que isso existe. Item sem `grupo` cai automaticamente sozinho (usado só
  // por "Meu Portal", injetado dinamicamente mais abaixo). A auditoria
  // (ver Auditoria_Redesign_Portal_Corporativo_21-07-2026.md) encontrou o
  // ADMINISTRADOR com 12 itens em coluna plana sem nenhuma pista visual de
  // que "Equipamentos/Linhas/Acessos/Movimentações/Histórico" são todos
  // sobre o mesmo assunto (patrimônio) — a auditoria não pediu para juntar
  // PÁGINAS, só para o menu comunicar isso visualmente. "Mensagens" some
  // como item de menu próprio (ver Onda 1.5 — vira aba dentro do sino de
  // notificações na barra superior, não item de sidebar).
  grupo?: string;
}

const NAV: Record<Papel, NavItem[]> = {
  ADMINISTRADOR: [
    { key: "home", label: "Visão Geral", icon: Home, grupo: "Início" },
    { key: "solicitacoes", label: "Solicitações", icon: ShoppingCart, grupo: "Atendimento" },
    { key: "chamados", label: "Chamados", icon: Wrench, grupo: "Atendimento" },
    { key: "equipamentos", label: "Equipamentos", icon: Laptop, grupo: "Patrimônio" },
    { key: "linhas", label: "Linhas Telefônicas", icon: Phone, grupo: "Patrimônio" },
    { key: "acessos", label: "Acessos a Sistemas", icon: Key, grupo: "Patrimônio" },
    { key: "movimentacoes", label: "Movimentações", icon: Repeat, grupo: "Patrimônio" },
    { key: "historico", label: "Histórico de Trocas", icon: HistoryIcon, grupo: "Patrimônio" },
    { key: "colaboradores", label: "Colaboradores", icon: Users, grupo: "Pessoas" },
    // Pagamentos CNAB (20/07/2026, pedido do Vini) — folhas + remessas Sicoob.
    { key: "pagamentos", label: "Pagamentos", icon: Banknote, grupo: "Pessoas" },
    // Documentos de RH (11/08/2026, Fase RH da Evolução Completa).
    { key: "documentos", label: "Documentos", icon: FileText, grupo: "Pessoas" },
    // Marketing Imobiliário (13/08/2026) — Banco de Imóveis + integração
    // Imoview. ADMINISTRADOR gerencia igual MARKETING (ver
    // PAPEIS_GERENCIAM_MARKETING em marketing.routes.ts).
    { key: "marketing-imoveis", label: "Imóveis", icon: Building2, grupo: "Marketing" },
    { key: "configuracoes", label: "Configurações", icon: Settings, grupo: "Sistema" },
  ],
  // Reorganização de hierarquia (17/07/2026, pedido do Vini: "o gestor/
  // coordenador e o administrador geral têm as mesmas funções... quero uma
  // hierarquia bem dividida"). Investigação: ADMINISTRADOR era um
  // superconjunto estrito de GESTOR_COORDENADOR — nenhuma função exclusiva
  // do Gestor existia. Identidade nova, coerente: ciclo de vida de PESSOAS
  // (Colaboradores + desligamento unificado, ver #177) e acompanhamento da
  // operação do time (Movimentações — trocado por "chamados" abaixo,
  // "solicitacoes" continua pra criar em nome do time e acompanhar, mas sem
  // poder de aprovar — ver SolicitacoesHub.tsx). "chamados" removido: tinha
  // item de menu mas nenhuma ação real lá (`podeGerenciar` em Chamados.tsx
  // já era só ADMINISTRADOR/SUPORTE_TI — item morto que só reforçava a
  // confusão "Gestor e Admin parecem iguais"; quem tem chamado próprio abre
  // pelo Meu Portal, igual RH). "movimentacoes" adicionado: já tinha
  // permissão de escrita no backend, só faltava o item de menu — mesmo tipo
  // de lacuna encontrada em SUPORTE_TI abaixo.
  GESTOR_COORDENADOR: [
    { key: "home", label: "Visão Geral", icon: Home, grupo: "Início" },
    { key: "solicitacoes", label: "Solicitações", icon: ShoppingCart, grupo: "Atendimento" },
    { key: "movimentacoes", label: "Movimentações", icon: Repeat, grupo: "Patrimônio" },
    { key: "colaboradores", label: "Colaboradores", icon: Users, grupo: "Pessoas" },
    // Marketing Imobiliário (13/08/2026) — só leitura: "gestor vê resumo,
    // não edita" (design do módulo). MarketingPage já esconde ações de
    // escrita sozinha para quem não é ADMINISTRADOR/MARKETING (ver
    // PAPEIS_EDITAM em Marketing.tsx), mesmo racional de colaboradoresReadOnly.
    { key: "marketing-imoveis", label: "Imóveis", icon: Building2, grupo: "Marketing" },
  ],
  // "solicitacoes" adicionado (14/07/2026, pedido do Vini: "solicitação de
  // equipamento tem que estar habilitado para o técnico") — só a aba
  // Equipamentos aparece pro SUPORTE_TI dentro do hub (ver
  // `somenteEquipamento` em SolicitacoesHub.tsx), nunca Papelaria e Compras.
  // Técnico já podia mover o Kanban antes disso (ver requireRole em
  // solicitacoes.routes.ts) — o que faltava era o próprio item de menu e o
  // botão "Nova".
  // "home" adicionado (14/07/2026, pedido do Vini: "o painel geral tem que
  // estar disponível para todos os papéis, porém com o que ele precisa
  // ver") — SUPORTE_TI era o único papel com tela nesse AppShell (não
  // COLABORADOR, que usa o Portal separado) sem Visão Geral. Primeiro item
  // da lista, igual ADMINISTRADOR/GESTOR_COORDENADOR/RH, pra virar a tela
  // de entrada padrão dele também (ver `useState(() => NAV[papel][0]?.key
  // ...)` logo abaixo). Home.tsx agora esconde por conta própria qualquer
  // KPI/painel de módulo que não esteja neste array (via `podeNavegarPara`
  // — mesmo mecanismo que já escondia os Atalhos Rápidos) — não precisa de
  // nenhuma lógica nova aqui além de listar os módulos que o técnico
  // realmente usa.
  // "linhas"/"acessos" adicionados (17/07/2026, achado durante a
  // reorganização de hierarquia): o backend já liberava SUPORTE_TI pra
  // editar Linhas Telefônicas e Acessos a Sistemas há tempos (ver
  // `readOnly={papel !== "ADMINISTRADOR" && papel !== "SUPORTE_TI"}` no
  // switch de módulos abaixo, inalterado) — só faltavam os itens de menu
  // pra ele realmente chegar lá. "Patrimônio" (Equipamentos/Linhas/Acessos)
  // agora é uma tríade coerente e exclusiva de SUPORTE_TI/ADMINISTRADOR.
  SUPORTE_TI: [
    { key: "home", label: "Visão Geral", icon: Home, grupo: "Início" },
    { key: "portal-suporte", label: "Fila de Atendimento", icon: Wrench, grupo: "Atendimento" },
    { key: "chamados", label: "Chamados (Kanban)", icon: ClipboardList, grupo: "Atendimento" },
    { key: "solicitacoes", label: "Solicitações", icon: ShoppingCart, grupo: "Atendimento" },
    { key: "equipamentos", label: "Equipamentos", icon: Laptop, grupo: "Patrimônio" },
    { key: "linhas", label: "Linhas Telefônicas", icon: Phone, grupo: "Patrimônio" },
    { key: "acessos", label: "Acessos a Sistemas", icon: Key, grupo: "Patrimônio" },
  ],
  // RH (08/07/2026, pedido do Vini) — Visão Geral + Colaboradores, e a
  // tela de Colaboradores abre em modo somente-leitura (ver
  // `colaboradoresReadOnly` abaixo, que já cobre RH por não estar na lista
  // de papéis com permissão de edição) — igual a FINANCEIRO, que também é
  // somente-leitura ali (só a seção de Dados Bancários é editável pros dois).
  //
  // ATUALIZAÇÃO (22/07/2026, pedido do Vini: "os papéis RH e financeiro
  // devem ter as mesmas abas nos papéis, pagamentos, colaboradores, painel
  // geral e etc" — confirmado que inclui igualar Solicitações também):
  //   - "Solicitações" agora mostra as MESMAS DUAS abas que FINANCEIRO já
  //     via (Equipamentos + Papelaria e Compras + Serviços), não só
  //     Papelaria — ver `somentePapelaria`/`podeAprovarCusto` em
  //     SolicitacoesHub.tsx, que deixou de tratar RH como caso especial.
  //   - Ganhou "Pagamentos" (módulo CNAB), que antes era exclusivo de
  //     FINANCEIRO — mesma tela, mesma permissão de escrita.
  RH: [
    { key: "home", label: "Visão Geral", icon: Home, grupo: "Início" },
    { key: "solicitacoes", label: "Solicitações", icon: ShoppingCart, grupo: "Atendimento" },
    { key: "colaboradores", label: "Colaboradores", icon: Users, grupo: "Pessoas" },
    { key: "pagamentos", label: "Pagamentos", icon: Banknote, grupo: "Pessoas" },
    // Documentos de RH (11/08/2026, Fase RH da Evolução Completa) — o
    // módulo é dele (mesmo racional de "pagamentos" ser do FINANCEIRO
    // abaixo); ADMINISTRADOR também gerencia (ver PAPEIS_GERENCIAM em
    // documentos.routes.ts).
    { key: "documentos", label: "Documentos", icon: FileText, grupo: "Pessoas" },
  ],
  // FINANCEIRO (17/07/2026, pedido do Vini: "falta um financeiro para
  // aprovar as solicitações de equipamentos, solicitações de papelaria e
  // compras") — papel novo, escopo deliberadamente estreito: só o que
  // precisa pra aprovar custo. Vê "Solicitações" com as DUAS abas (ao
  // contrário de SUPORTE_TI, que só vê uma — Financeiro precisa decidir nas
  // duas frentes, ver `podeGerenciarPapelaria`/`podeAprovarCusto` em
  // SolicitacoesHub.tsx; RH ganhou o mesmo acesso em 22/07/2026, ver
  // comentário do RH acima). Sem Equipamentos/Linhas/Acessos (não é
  // patrimônio), sem Chamados (não é suporte).
  FINANCEIRO: [
    { key: "home", label: "Visão Geral", icon: Home, grupo: "Início" },
    { key: "solicitacoes", label: "Solicitações", icon: ShoppingCart, grupo: "Atendimento" },
    // Colaboradores (20/07/2026, pedido do Vini: "Financeiro ter acesso aos
    // colaboradores pois futuramente irá usar o sistema para pagamentos") —
    // somente leitura (colaboradoresReadOnly já cobre), mas com a seção de
    // Dados Bancários editável (regra própria — ver Colaboradores.tsx).
    { key: "colaboradores", label: "Colaboradores", icon: Users, grupo: "Pessoas" },
    // Pagamentos CNAB (20/07/2026) — o módulo é dele.
    { key: "pagamentos", label: "Pagamentos", icon: Banknote, grupo: "Pessoas" },
  ],
  // MARKETING (13/08/2026, pedido do Vini) — papel novo, escopo estreito:
  // só o Banco de Imóveis (única tela real do módulo hoje, ver
  // Marketing.tsx). Sem Colaboradores/Patrimônio/Chamados — não é gestão de
  // pessoas nem suporte.
  MARKETING: [
    { key: "home", label: "Visão Geral", icon: Home, grupo: "Início" },
    { key: "marketing-imoveis", label: "Imóveis", icon: Building2, grupo: "Marketing" },
  ],
  COLABORADOR: [],
};

// M1 do check-up (🔴 Crítico, Fase 2, 22/07/2026, decisão já aprovada pelo
// Vini: "Devolver ícone próprio") — na Onda 1 do redesenho (21/07/2026),
// "Mensagens" perdeu a entrada própria no menu lateral e só ficou
// alcançável entrando primeiro na Central de Notificações (o sino). Um
// colaborador que só quer conversar com um colega não associa "sino de
// notificação" a "chat". Este botão fica ao lado do sino, com o mesmo
// visual/comportamento (badge de não lidas, mesmo estilo do badge do sino
// em CentralNotificacoes.tsx) — clicar abre Mensagens DIRETO, sem passar
// pela Central de Notificações (que continua existindo, inalterada, pra
// tudo mais).
//
// Sem checagem de papel/temModulo de propósito: "mensagens" não é um item
// de NAV (ver comentário em NavItem.grupo mais abaixo) nem é restrito por
// papel — é restrito só por CANAL, dentro da própria tela (ver comentário
// em `abrirDestinoNotificacao`, mais abaixo: "restrição é só de CANAL, não
// de papel"). Todo usuário autenticado que chega neste componente (COLABORADOR
// incluso, via o ramo próprio logo abaixo) tem acesso a pelo menos a aba
// Recentes/Nova conversa.
//
// Contagem: reaproveita GET /mensagens/contadores, o mesmo endpoint que já
// existia (usado hoje só indiretamente, nunca exposto na barra superior).
// Caminho rápido de atualização é o evento SSE "mensagens" (ver
// avisarMudanca("mensagens") em mensagens.routes.ts + assinarMensagens
// Atualizadas em lib/mensagensRealtime.ts); o polling de 60s aqui é só rede
// de segurança, mesmo racional do POLL_MS em Mensagens.tsx.
function BotaoMensagens({ ativo, onAbrir }: { ativo: boolean; onAbrir: () => void }) {
  const [naoLidas, setNaoLidas] = useState(0);

  const buscarContagem = React.useCallback(() => {
    if (!ativo) return;
    mensagensApi
      .contadores()
      .then((r) => setNaoLidas(r.total))
      .catch(() => {});
  }, [ativo]);

  useEffect(() => {
    buscarContagem();
    const t = window.setInterval(buscarContagem, 60000);
    return () => window.clearInterval(t);
  }, [buscarContagem]);

  useEffect(() => assinarMensagensAtualizadas(buscarContagem), [buscarContagem]);

  const naoLidasTexto = naoLidas > 99 ? "99+" : String(naoLidas);

  return (
    <button
      onClick={onAbrir}
      aria-label={naoLidas > 0 ? `Mensagens, ${naoLidas} não lidas` : "Mensagens"}
      title="Mensagens"
      className="relative p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-[var(--motion-fast)] active:scale-90 text-slate-500 dark:text-slate-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30"
    >
      <MessageCircle size={18} />
      {naoLidas > 0 && (
        // Mesmo truque de `key` do badge do sino em CentralNotificacoes.tsx
        // — remonta o nó a cada mudança de contagem pra reiniciar a
        // animação de entrada sozinho, sem lógica extra em JS.
        <span
          key={naoLidasTexto}
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center animate-[toastIn_var(--motion-fast)_var(--motion-ease)]"
          style={{ background: COLORS.brass }}
        >
          {naoLidasTexto}
        </span>
      )}
    </button>
  );
}

function AppShell() {
  const { user, logout } = useAuth();
  const papel = user!.papel;
  const { data, loading, erro, refetch, refetchDominios, recarregarTudo, aplicarEventoDados } = useAppData(papel);

  // Deep link do QR Code de ativo (22/07/2026) — ver comentário completo em
  // `extrairIdAtivoDaUrl` no topo do arquivo. Só aplica se este papel
  // realmente tem "equipamentos" no menu (ex: COLABORADOR não tem — quem
  // escaneia o QR de um ativo é sempre alguém que administra patrimônio);
  // calculado uma vez só, fora de estado, porque só importa no primeiro
  // mount desta sessão (a URL já é limpa logo abaixo, pelo useEffect).
  const idAtivoNaUrl = NAV[papel].some((item) => item.key === "equipamentos") ? extrairIdAtivoDaUrl() : null;

  const [activeModule, setActiveModule] = useState(idAtivoNaUrl ? "equipamentos" : NAV[papel][0]?.key || "home");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Item 4 (Tutorial + Central de Ajuda, 08/07/2026) — precisa ficar antes do
  // `return` antecipado do ramo COLABORADOR logo abaixo (regra dos Hooks: não
  // podem ser condicionais), já que tanto o AppShell "completo" quanto o
  // Portal do Colaborador usam a mesma Central de Ajuda e o mesmo motor de
  // tour, só com passos e chave de localStorage diferentes (ver tours.ts).
  const { chave: chaveTour, passos: passosTour } = tourParaPapel(papel);
  const [mostrarAjuda, setMostrarAjuda] = useState(false);
  const [mostrarTour, setMostrarTour] = useState(false);
  useEffect(() => {
    if (!tourJaVisto(chaveTour)) setMostrarTour(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveTour]);
  function reiniciarTour() {
    setMostrarAjuda(false);
    setMostrarTour(true);
  }
  // Semente de navegação vinda do dashboard (Fase 4 — Dashboard interativo,
  // 06/07/2026): quando um clique na Home carrega um alvo específico
  // (setorId, status, chamadoId, solicitacaoId), guarda aqui pra repassar
  // como filtro/foco inicial da página de destino — cada página só lê isso
  // uma vez, via `useState(() => valorInicial)`, no primeiro mount.
  //
  // Correção (09/07/2026, achado durante o teste do pop-up de notificação
  // clicável): a versão anterior limpava este valor sozinha via
  // `setTimeout(..., 0)` — um macrotask que roda ANTES da Promise de
  // `React.lazy()` resolver na primeira vez que um módulo é aberto na
  // sessão (o import do chunk ainda não tinha sido baixado). Resultado: ao
  // clicar num pop-up de notificação pra um módulo nunca visitado nesta
  // sessão (o caso mais comum — a notificação avisa de algo que a pessoa
  // ainda não tinha ido olhar), o `setTimeout` zerava `modulePayload` ANTES
  // da página de destino terminar de carregar e ler o valor, e o modal de
  // detalhe (chamado/solicitação) simplesmente não abria — sem erro nenhum,
  // só silenciosamente incompleto. Removido: não é mais necessário de
  // qualquer forma, porque o único outro lugar que muda de módulo (clique no
  // menu lateral, logo abaixo) já zera `modulePayload` explicitamente ANTES
  // de trocar de módulo — isso cobre exatamente o caso que o timer tentava
  // cobrir ("trocar de módulo de novo mais tarde reaplicaria um filtro
  // antigo"), sem depender de uma corrida contra o carregamento assíncrono
  // do chunk.
  const [modulePayload, setModulePayload] = useState<Record<string, any> | null>(
    idAtivoNaUrl ? { equipamentoId: idAtivoNaUrl } : null
  );

  // Limpa a URL depois de aplicar o deep link (uma vez só, no mount) — sem
  // isso, um F5 na tela (ou navegar de módulo e voltar) reaplicaria sempre o
  // mesmo `/ativo/:id`, prendendo a pessoa nessa tela. `replaceState` (não
  // `pushState`) porque não é uma navegação nova pro usuário, é só limpeza —
  // não deve virar uma entrada extra no botão "voltar" do navegador.
  useEffect(() => {
    if (idAtivoNaUrl) window.history.replaceState(null, "", "/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function navegarPara(moduloKey: string, payload?: Record<string, any>) {
    setModulePayload(payload ?? null);
    setActiveModule(moduloKey);
  }

  // Busca Global — Ctrl+K/Cmd+K (Onda 2.1 do redesign, 21/07/2026). Atalho
  // global (não preso a nenhum campo) — igual Notion/Linear/GitHub. COLABORADOR
  // nunca vê o botão/atalho (ver ramo `papel === "COLABORADOR"` logo abaixo,
  // que não renderiza <ComandoPaleta>): o backend também nega busca pra esse
  // papel (ver CATEGORIAS_POR_PAPEL em busca.routes.ts), então nem faria
  // sentido oferecer a UI aqui.
  const [buscaAberta, setBuscaAberta] = useState(false);
  useEffect(() => {
    if (papel === "COLABORADOR") return;
    function aoTeclar(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuscaAberta(true);
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [papel]);

  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — ver
  // PortalColaboradorHandle em PortalColaborador.tsx: quem renderiza
  // <CentralNotificacoes> pro papel COLABORADOR é este arquivo (mesma barra
  // de cabeçalho de sempre), mas quem sabe navegar dentro do Portal
  // (`tela`, chamadoSelecionadoId etc.) é o próprio PortalColaborador — a
  // ref é a ponte entre os dois sem duplicar a barra de cabeçalho lá dentro.
  const portalRef = useRef<PortalColaboradorHandle>(null);

  if (papel === "COLABORADOR") {
    return (
      <div className="min-h-screen p-4 sm:p-8" style={{ background: COLORS.bg }}>
        {/* Item 3 (Melhorias Adicionais, 08/07/2026): o Portal do Colaborador
            não tem a barra lateral do AppShell, então o "Sair" solto virava
            a única ação disponível aqui — agora é o mesmo Menu Centralizado
            usado no restante do sistema, coerente entre os papéis. */}
        <div className="max-w-lg mx-auto mb-4 flex items-center justify-end gap-1">
          <IndicadorConexao />
          <span data-tour="portal-botao-mensagens">
            <BotaoMensagens ativo={!!user} onAbrir={() => portalRef.current?.abrirMensagens()} />
          </span>
          <span data-tour="portal-central-notificacoes">
            <CentralNotificacoes
              ativo={!!user}
              colaboradores={data.colaboradores}
              onAbrirDestino={(destino) => portalRef.current?.abrirDestino(destino)}
              onDados={(evento) => {
                aplicarEventoDados(evento.entidades);
                // Ponte SSE → Mensagens.tsx (M4 do check-up) — ver comentário
                // completo em lib/mensagensRealtime.ts. "mensagens" não é
                // parte de AppData, então aplicarEventoDados sozinho não
                // alcança o chat.
                if (evento.entidades.includes("mensagens")) emitirMensagensAtualizadas();
              }}
              onAbrirMensagens={() => portalRef.current?.abrirMensagens()}
            />
          </span>
          <span data-tour="portal-botao-ajuda"><BotaoAjuda onClick={() => setMostrarAjuda(true)} /></span>
          <span data-tour="portal-menu-usuario"><MenuUsuario /></span>
        </div>
        <ErrorBoundary>
          {loading ? (
            <div className="max-w-lg mx-auto mt-4"><SkeletonListaCartoes count={3} /></div>
          ) : erro ? (
            // Achado em auditoria de 06/07/2026: antes disto, uma falha de
            // rede aqui (comum pra colaborador de campo com sinal ruim) caía
            // direto no branch de baixo com `data` vazio — e o
            // PortalColaborador concluía (errado) que o cadastro dele não
            // existia, mandando "fale com o RH". Falha de conexão precisa
            // parecer falha de conexão, não problema de cadastro.
            <div className="max-w-lg mx-auto text-center mt-16 space-y-3">
              <p className="text-sm text-gray-500">Não foi possível carregar seus dados. Verifique sua conexão e tente novamente.</p>
              <Button variant="ghost" onClick={() => recarregarTudo()}>Tentar novamente</Button>
            </div>
          ) : (
            <React.Suspense fallback={<div className="mt-16"><LoadingState /></div>}>
              <PortalColaborador
                ref={portalRef}
                data={data}
                colaboradorId={user!.colaboradorId}
                onChanged={() =>
                  Promise.all([refetch("solicitacoes"), refetch("chamados"), refetch("solicitacoesPapelaria")]).then(() => {})
                }
              />
            </React.Suspense>
          )}
        </ErrorBoundary>
        {mostrarAjuda && <CentralAjuda onClose={() => setMostrarAjuda(false)} onReiniciarTour={reiniciarTour} />}
        {mostrarTour && !loading && <TourGuiado chave={chaveTour} passos={passosTour} onFechar={() => setMostrarTour(false)} />}
        <AssistenteAjuda />
      </div>
    );
  }

  // "Meu Portal" (09/07/2026, pedido do Vini): todo papel que não seja
  // ADMINISTRADOR também "é um colaborador" — precisa conseguir abrir
  // chamado, solicitar equipamento/papelaria e ver os próprios itens, além
  // das telas de gestão que já tem (ex: RH enxergar Colaboradores). Em vez
  // de espalhar autoatendimento por cada tela de gestão, reaproveita 100%
  // do Portal do Colaborador já existente (PortalColaborador.tsx é
  // desacoplado de `papel` — só depende de `colaboradorId`, ver comentário
  // lá) como mais um item de menu — só aparece pra quem realmente tem um
  // cadastro de colaborador vinculado (sem isso, a tela só mostraria a
  // mensagem "fale com o RH", sem utilidade nenhuma). ADMINISTRADOR fica de
  // fora por decisão explícita do Vini — quem administra o sistema não abre
  // chamado pra si mesmo pelo Portal, já tem controle total nas telas de
  // gestão.
  const MEU_PORTAL_KEY = "meu-portal";
  const podeUsarMeuPortal = papel !== "ADMINISTRADOR" && !!user!.colaboradorId;
  const navItems: NavItem[] = podeUsarMeuPortal
    ? [...NAV[papel], { key: MEU_PORTAL_KEY, label: "Meu Portal", icon: UserCircle2 }]
    : NAV[papel];
  // Mesmos papéis liberados no backend pra criar/editar colaborador
  // (app.requireRole("ADMINISTRADOR", "GESTOR_COORDENADOR") em
  // colaboradores.routes.ts). Antes este flag também bloqueava
  // GESTOR_COORDENADOR aqui por engano — escondia "Novo Colaborador" e
  // "Editar" mesmo o servidor permitindo a ação (bug relatado pelo Vini
  // em 05/07/2026: "não consigo adicionar/editar colaborador").
  const colaboradoresReadOnly = !["ADMINISTRADOR", "GESTOR_COORDENADOR"].includes(papel);

  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — traduz um
  // `DestinoNotificacao` (ver lib/notificacaoDestino.ts) numa chamada de
  // `navegarPara`, reaproveitando o mesmo mecanismo de módulo+payload já
  // usado pelos cliques no dashboard (Home.tsx). Cada `case` confere se o
  // papel logado tem aquele módulo no menu antes de navegar — evita, por
  // exemplo, um GESTOR_COORDENADOR (sem acesso a "linhas") ser jogado pra um
  // módulo que nem aparece pra ele; nesse caso o clique só marca como lida,
  // sem navegar (ver abrirNotificacao em CentralNotificacoes.tsx).
  function abrirDestinoNotificacao(destino: DestinoNotificacao) {
    const temModulo = (key: string) => navItems.some((item) => item.key === key);
    // "Meu Portal" (09/07/2026): RH não tem "chamados" no menu (só
    // GESTOR_COORDENADOR/SUPORTE_TI/ADMINISTRADOR têm) — sem este fallback,
    // uma notificação sobre um chamado que o próprio RH abriu pelo Portal
    // simplesmente não navegava pra lugar nenhum. Usa o mesmo mecanismo
    // imperativo (`portalRef.abrirDestino`) já usado no ramo COLABORADOR —
    // só que aqui o componente pode estar sendo montado agora pela primeira
    // vez nesta sessão (chunk lazy, ver React.lazy no topo do arquivo), então
    // `portalRef.current` pode ainda não existir no instante em que
    // `navegarPara` retorna. Tenta de novo por até ~1.5s (10x 150ms) em vez
    // de um `setTimeout` único com prazo fixo — mesmo problema de fundo que
    // o antigo bug do `modulePayload` (ver comentário lá), só que resolvido
    // com espera curta e repetida em vez de confiar num tempo "que deve ser
    // suficiente".
    function chamarAbrirDestinoQuandoPronto(tentativasRestantes = 10) {
      if (portalRef.current) {
        portalRef.current.abrirDestino(destino);
      } else if (tentativasRestantes > 0) {
        setTimeout(() => chamarAbrirDestinoQuandoPronto(tentativasRestantes - 1), 150);
      }
    }
    function navegarParaChamadoOuSolicitacao(moduloGestao: string, payload: Record<string, any>) {
      if (temModulo(moduloGestao)) {
        navegarPara(moduloGestao, payload);
      } else if (temModulo(MEU_PORTAL_KEY)) {
        navegarPara(MEU_PORTAL_KEY);
        chamarAbrirDestinoQuandoPronto();
      }
    }
    switch (destino.tipo) {
      case "chamado":
        navegarParaChamadoOuSolicitacao("chamados", { chamadoId: destino.id });
        break;
      case "solicitacaoEquipamento":
        navegarParaChamadoOuSolicitacao("solicitacoes", { solicitacaoId: destino.id });
        break;
      case "solicitacaoPapelaria":
        navegarParaChamadoOuSolicitacao("solicitacoes", { solicitacaoPapelariaId: destino.id });
        break;
      case "equipamento":
        if (temModulo("equipamentos")) navegarPara("equipamentos", { equipamentoId: destino.id });
        break;
      case "linha":
        if (temModulo("linhas")) navegarPara("linhas", { linhaId: destino.id });
        break;
      case "colaborador":
        if (temModulo("colaboradores")) navegarPara("colaboradores", { colaboradorId: destino.id });
        break;
      case "calendarioAniversarios":
        if (temModulo("colaboradores")) navegarPara("colaboradores", { verCalendario: true });
        break;
      case "movimentacoes":
        if (temModulo("movimentacoes")) navegarPara("movimentacoes");
        break;
      case "pagamento":
        if (temModulo("pagamentos")) navegarPara("pagamentos");
        break;
      // Comunicação unificada (21/07/2026) — "mensagens" deixou de ser item
      // de NAV (ver comentário em NavItem.grupo), então não faz mais
      // sentido gatear a navegação por `temModulo("mensagens")` — todo
      // papel que chega no AppShell sempre teve acesso ao chat (ver
      // Mensagens.tsx/mensagens.routes.ts: restrição é só de CANAL, não de
      // papel), só o item de menu que sumiu.
      case "mensagemDireta":
        navegarPara("mensagens", { conversaComUsuarioId: destino.usuarioId });
        break;
      case "mensagemCanal":
        navegarPara("mensagens", { canalTipo: destino.canalTipo, canalId: destino.id });
        break;
      case "nenhum":
      default:
        break;
    }
  }
  // `podeAprovar`/`podeGerenciar` de cada sub-aba de Solicitações agora são
  // calculados dentro do próprio SolicitacoesHub.tsx (ele já recebe `papel`),
  // então não precisam mais de uma variável solta aqui.

  function renderModule() {
    // Achado (10/07/2026, Padronização de Animações — seção "Carregamento de
    // Dados"): o carregamento inicial (único ponto onde `loading` fica
    // verdadeiro — ver useAppData.ts, é um fetch só, não por módulo) mostrava
    // um spinner + texto genérico, sem nenhuma pista do formato do conteúdo
    // que está prestes a chegar. Como o módulo inicial (`activeModule`, já
    // definido antes desse fetch resolver) determina o formato esperado —
    // grade de indicadores pro Dashboard, grade de cartões pra qualquer outro
    // módulo —, o skeleton escolhido já imita a tela real, reduzindo o "pulo"
    // visual quando os dados chegam.
    if (loading) {
      return activeModule === "home" ? (
        <div className="space-y-4">
          <SkeletonKPIGrid />
          <SkeletonListaCartoes count={3} />
        </div>
      ) : (
        <SkeletonListaCartoes />
      );
    }
    if (erro) return <p className="text-sm text-brand-600">{erro}</p>;
    switch (activeModule) {
      case "home":
        return (
          <HomePage
            data={data}
            onNavigate={navegarPara}
            podeNavegarPara={(key) => navItems.some((item) => item.key === key)}
            papel={papel}
          />
        );
      case "portal-suporte":
        return (
          <PortalSuportePage
            data={data}
            usuarioId={user!.id}
            onChanged={() => refetch("chamados")}
          />
        );
      case "colaboradores":
        return (
          <ColaboradoresPage
            data={data}
            readOnly={colaboradoresReadOnly}
            onChanged={() => refetch("colaboradores")}
            // Desligamento unificado (17/07/2026) — pode ter transferido/
            // devolvido equipamento, desvinculado linha, revogado acesso e
            // concluído a movimentação, além do próprio colaborador — as 5
            // listas afetadas, atualizadas juntas (mesmo padrão já usado em
            // Linhas.tsx pro par linhas+colaboradores, só que com mais
            // recursos porque este fluxo mexe em mais coisa de uma vez).
            onDesligado={() =>
              Promise.all([
                refetch("colaboradores"), refetch("equipamentos"), refetch("linhas"),
                refetch("acessos"), refetch("movimentacoes"),
              ]).then(() => {})
            }
            filtroSetorInicial={modulePayload?.setorId}
            abrirColaboradorId={modulePayload?.colaboradorId}
            abrirNovo={modulePayload?.novo}
            abrirCalendario={modulePayload?.verCalendario}
          />
        );
      case "equipamentos":
        return (
          <EquipamentosPage
            data={data}
            readOnly={papel === "GESTOR_COORDENADOR"}
            onChanged={() => refetch("equipamentos")}
            filtroStatusInicial={modulePayload?.status}
            abrirEquipamentoId={modulePayload?.equipamentoId}
            // Onda 1.6 (21/07/2026) — ficha do equipamento agora lista os
            // chamados de manutenção relacionados; clicar em um navega pra
            // Chamados já com aquele item aberto, mesmo padrão de
            // `abrirChamadoId` usado a partir de notificações.
            onAbrirChamado={(chamadoId) => navegarPara("chamados", { chamadoId })}
          />
        );
      case "linhas":
        return (
          <LinhasPage
            data={data}
            readOnly={papel !== "ADMINISTRADOR" && papel !== "SUPORTE_TI"}
            // Bug relatado (09/07/2026, pedido do Vini): vincular uma linha a
            // um colaborador só recarregava "linhas" — a aba "Pessoal" (que
            // lê `colaborador.linhaCorporativa`, derivado no backend a
            // partir da própria linha) ficava com o dado velho até um F5
            // manual, mesmo pra quem tinha acabado de fazer a mudança na
            // própria tela. O evento SSE "dados" (ver useAppData.ts) já
            // cobre isto de forma geral agora, mas o refetch local
            // permanece — reação imediata sem depender da viagem de ida e
            // volta pela rede via SSE, mesmo padrão já usado abaixo em
            // Movimentações (que tem o mesmo tipo de acoplamento com
            // Colaboradores).
            onChanged={() => Promise.all([refetch("linhas"), refetch("colaboradores")]).then(() => {})}
            abrirLinhaId={modulePayload?.linhaId}
          />
        );
      case "acessos": return <AcessosPage data={data} readOnly={papel !== "ADMINISTRADOR" && papel !== "SUPORTE_TI"} onChanged={() => refetch("acessos")} />;
      case "solicitacoes":
        return (
          <SolicitacoesHub
            data={data}
            papel={papel}
            onChangedEquipamento={() => refetch("solicitacoes")}
            onChangedPapelaria={() => refetch("solicitacoesPapelaria")}
            abrirSolicitacaoId={modulePayload?.solicitacaoId}
            abrirSolicitacaoPapelariaId={modulePayload?.solicitacaoPapelariaId}
            abrirNovo={modulePayload?.novo}
            // Busca Global (Onda 2.1, 21/07/2026) — resultado de tipo
            // "sol_servico" chega com `{ aba: "servicos",
            // solicitacaoServicoId }` (ver busca.routes.ts); os outros dois
            // tipos de solicitação já se auto-selecionavam via
            // abrirSolicitacaoId/abrirSolicitacaoPapelariaId acima, só
            // Serviços não tinha essa aba nem esse deep-link ainda.
            abrirAba={modulePayload?.aba}
            abrirSolicitacaoServicoId={modulePayload?.solicitacaoServicoId}
          />
        );
      // Pagamentos CNAB 240 (20/07/2026, pedido do Vini) — ADMINISTRADOR e
      // FINANCEIRO; a página carrega os próprios dados (folhas/remessas não
      // entram no useAppData — módulo restrito, sem uso nas outras telas).
      case "pagamentos":
        return <PagamentosPage data={data} />;
      // Documentos de RH (11/08/2026) — só ADMINISTRADOR/RH têm este item no
      // próprio NAV (ver PAPEIS_GERENCIAM em documentos.routes.ts no
      // backend, que também barra a rota pra quem tentar chegar direto).
      case "documentos":
        return <DocumentosPage data={data} onChanged={() => refetch("documentos")} />;
      // Marketing Imobiliário (13/08/2026) — Banco de Imóveis + integração
      // Imoview. Não usa AppData/refetch (mesmo racional de "pagamentos"
      // acima): imóveis/sincronização são buscados pela própria página, já
      // paginados no servidor — só reaproveita data.dominios.unidades e
      // data.colaboradores, que já vêm no AppData padrão.
      case "marketing-imoveis":
        return <MarketingPage data={data} papel={papel} />;
      case "chamados":
        return (
          <ChamadosPage
            data={data}
            papel={papel}
            readOnly={false}
            onChanged={() => refetch("chamados")}
            abrirChamadoId={modulePayload?.chamadoId}
            abrirNovo={modulePayload?.novo}
          />
        );
      case "movimentacoes": return <MovimentacoesPage data={data} readOnly={false} onChanged={() => Promise.all([refetch("movimentacoes"), refetch("colaboradores")]).then(() => {})} abrirNovo={modulePayload?.novo} />;
      case "historico": return <HistoricoPage data={data} onChanged={() => refetch("historico")} />;
      case "mensagens":
        return (
          <MensagensPage
            data={data}
            abrirConversaComUsuarioId={modulePayload?.conversaComUsuarioId}
            abrirCanal={modulePayload?.canalId ? { tipo: modulePayload.canalTipo, id: modulePayload.canalId } : undefined}
            // Achado de auditoria C7 (22/07/2026) — só existe pra quem tem
            // "configuracoes" no próprio NAV (ADMINISTRADOR), mesmo gate que
            // o botão em si já aplica visualmente dentro de Mensagens.tsx;
            // passar sempre aqui não vaza nada pra outros papéis (a página
            // Mensagens já checa `user?.papel === "ADMINISTRADOR"` antes de
            // sequer mostrar o botão).
            onIrParaConfiguracoes={() => setActiveModule("configuracoes")}
          />
        );
      case "configuracoes": return <ConfiguracoesPage data={data} onChanged={refetchDominios} />;
      case MEU_PORTAL_KEY:
        // Autoatendimento (09/07/2026) — mesmo componente do Portal do
        // Colaborador "puro" (ver ramo `papel === "COLABORADOR"` acima),
        // aqui embutido dentro do AppShell de quem também gerencia o
        // sistema. Sem cabeçalho próprio duplicado: PortalColaborador não
        // renderiza CentralNotificacoes/MenuUsuario (isso já é feito pelo
        // <header> do AppShell logo abaixo), só o conteúdo de
        // autoatendimento em si.
        return (
          <PortalColaborador
            ref={portalRef}
            data={data}
            colaboradorId={user!.colaboradorId}
            onChanged={() =>
              Promise.all([refetch("solicitacoes"), refetch("chamados"), refetch("solicitacoesPapelaria")]).then(() => {})
            }
          />
        );
      default: return <HomePage data={data} papel={papel} />;
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: COLORS.bg }}>
      {/* Barra lateral fixa ao rolar (07/07/2026, pedido do Vini) — antes era
          `sm:static`, ou seja, rolava junto com o conteúdo da página (o
          scroll acontece no nível da página inteira, não dentro de um
          container próprio — por isso aqui usamos `sticky`, igual ao header
          logo abaixo, em vez de reestruturar o layout inteiro pra scroll
          interno). `sm:h-screen` garante que ela sempre ocupa a altura
          inteira da viewport, então o `sticky top-0` nunca "acaba" antes da
          página terminar de rolar. */}
      <aside
        // Padronização de Animações (10/07/2026): duration-200 hardcoded
        // trocado por --motion-base (mesmo valor, 200ms — não muda o
        // comportamento) e ease explícito ligado ao token, seguindo o
        // mesmo raciocínio já aplicado ao resto do sistema (uma única
        // fonte de verdade pra timing/curva de animação, não valores soltos
        // repetidos por componente).
        // NOTA (14/07/2026, correção pós-QA mobile): NÃO adicionar `relative`
        // aqui. `fixed`/`sticky` já criam contexto de posicionamento válido
        // pra o pseudo-elemento `before:absolute` funcionar — e como
        // `relative` é utilitário de `position` igual a `fixed`, no CSS
        // gerado pelo Tailwind a regra `.relative{position:relative}` vem
        // DEPOIS de `.fixed{position:fixed}` na folha de estilo, então
        // `relative` ganhava em TODAS as telas (mesma especificidade, ordem
        // de declaração decide) — isso silenciosamente tirava a sidebar do
        // modo "fixed" no mobile, virando bloco no fluxo normal (256px,
        // largura de `w-64`) e empurrando a página inteira pra fora da
        // viewport. Achado ao revisar os screenshots mobile desta fase.
        className={`fixed sm:sticky inset-y-0 sm:top-0 left-0 z-40 w-64 sm:h-screen flex-shrink-0 flex flex-col transition-transform duration-[var(--motion-base)] ease-[var(--motion-ease)] shadow-xl sm:shadow-none before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white/[0.06] ${sidebarOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0"}`}
        // Redesign visual "Stripe Dashboard rico" (14/07/2026): a barra
        // lateral era uma chapa sólida (`COLORS.chrome`, sem variação
        // nenhuma) — um dos pontos citados no feedback de "continua igual,
        // só com uns efeitos a mais". Gradiente sutil (mais claro no topo,
        // mais escuro embaixo) + glow radial suave da cor de marca no canto
        // superior — mesma linguagem visual do fundo do app (COLORS.bg, ver
        // index.css), só invertida pra combinar com o chrome escuro fixo.
        style={{
          background: `radial-gradient(ellipse 500px 300px at 0% 0%, color-mix(in srgb, var(--color-brass) 18%, transparent), transparent 60%), linear-gradient(180deg, #161d2e 0%, ${COLORS.chrome} 100%)`,
        }}
      >
        <div className="p-5 border-b border-white/[0.08] flex items-center gap-3" data-tour="logo">
          <img src={LOGO_DATA_URI} alt="Administrar Imóveis" className="h-8 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base leading-tight" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800 }}>
              <span className="text-white">ADMINISTRAR</span> <span className="text-brand-500">IMÓVEIS</span>
            </h1>
            <p className="text-[11px] text-white/40 mt-0.5 tracking-wide">Sistema Organizacional</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5" data-tour="sidebar-nav">
          {navItems.map((item, i) => {
            const Icon = item.icon;
            const active = activeModule === item.key;
            // Cabeçalho de grupo (Onda 1 do redesenho, 21/07/2026) — só
            // aparece na primeira vez que um `grupo` novo surge na lista,
            // igual ao agrupamento por competência já usado em
            // Pagamentos.tsx. Item sem `grupo` (hoje só "Meu Portal",
            // injetado dinamicamente) nunca ganha cabeçalho.
            const grupoAnterior = i > 0 ? navItems[i - 1].grupo : undefined;
            const mostrarCabecalhoGrupo = !!item.grupo && item.grupo !== grupoAnterior;
            return (
              <React.Fragment key={item.key}>
                {mostrarCabecalhoGrupo && (
                  <p className={`px-3.5 text-[10px] font-bold uppercase tracking-wider text-white/30 ${i === 0 ? "pt-0 pb-1.5" : "pt-4 pb-1.5"}`}>
                    {item.grupo}
                  </p>
                )}
              <button
                onClick={() => { setModulePayload(null); setActiveModule(item.key); setSidebarOpen(false); }}
                // Redesign visual "Stripe Dashboard rico" (14/07/2026): item
                // ativo deixou de ser uma caixa cinza translúcida uniforme
                // (`bg-white/[0.08]`, sem nenhuma cor de identidade) e virou
                // um "pill" com fundo gradiente na cor de marca + barra de
                // acento à esquerda (barra via `before:`) — mesmo padrão
                // usado em produtos como Linear/Vercel pra sinalizar "você
                // está aqui" com cor, não só um cinza mais claro.
                className={`relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-[var(--radius-control)] text-sm font-medium transition-all duration-[var(--motion-fast)] before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-full before:transition-opacity before:duration-[var(--motion-fast)] ${
                  active
                    ? "text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] before:bg-brand-500 before:opacity-100"
                    : "text-white/60 hover:bg-white/[0.05] hover:text-white before:opacity-0"
                }`}
                style={active ? { background: "linear-gradient(90deg, color-mix(in srgb, var(--color-brass) 22%, transparent), color-mix(in srgb, var(--color-brass) 6%, transparent))" } : undefined}
              >
                <Icon size={18} className={active ? "text-brand-500" : ""} /> {item.label}
              </button>
              </React.Fragment>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/[0.08]" data-tour="sair">
          <button onClick={logout} className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-[var(--radius-control)] text-xs font-medium text-white/50 hover:bg-white/[0.05] hover:text-white transition-colors">
            <LogOut size={14} /> Sair
          </button>
        </div>
      </aside>
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px] z-30 sm:hidden animate-[fadeIn_var(--motion-fast)_ease-out]"
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-slate-700 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 sticky top-0 z-20">
          {/* Achado de auditoria (10/07/2026, Ciclo de Evolução Contínua):
              único ícone-botão do sistema sem aria-label/title — todo o
              resto (MenuUsuario, CentralNotificacoes, ChamadoDetalhe etc.)
              já seguia esse padrão consistentemente. */}
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
            title="Abrir menu"
            className="sm:hidden text-slate-900 dark:text-slate-100"
          >
            <Menu size={22} />
          </button>
          {/* Busca Global (Onda 2.1, 21/07/2026) — botão-gatilho no formato
              "campo de busca falso" (padrão Notion/Linear/GitHub: parece um
              input, mas só abre a paleta de comando ao clicar, o campo de
              digitação de verdade fica dentro dela). Escondido em telas
              muito estreitas (o atalho de teclado continua funcionando) pra
              não disputar espaço com os outros ícones do cabeçalho no
              celular, onde Ctrl+K não existe de qualquer forma (teclado
              físico). */}
          <button
            onClick={() => setBuscaAberta(true)}
            className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-control)] border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600 text-xs transition-colors duration-[var(--motion-fast)] ${FOCUS_RING_CLASS}`}
            aria-label="Busca global"
            title="Busca global"
          >
            <Search size={14} />
            <span>Buscar...</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-[10px] font-mono">Ctrl K</span>
          </button>
          <button
            onClick={() => setBuscaAberta(true)}
            className={`sm:hidden text-gray-500 dark:text-slate-400 ${FOCUS_RING_CLASS} rounded`}
            aria-label="Busca global"
            title="Busca global"
          >
            <Search size={18} />
          </button>
          <div className="flex-1" />
          {/* Item 1 (Melhorias Adicionais, 08/07/2026) — indicador de
              conexão (🟢/🟡/🔴), só aparece quando há algo relevante a
              mostrar (offline ou com chamado pendente de sincronização).
              Item 3 — o antigo bloco estático (e-mail + selo de papel +
              iniciais, sem nenhuma ação) virou o Menu Centralizado do
              Usuário: mesma aparência de longe, mas agora clicável e com
              foto real, dados de contato, troca de senha, sessões ativas e
              logout num só lugar. */}
          <span data-tour="indicador-conexao"><IndicadorConexao /></span>
          <span data-tour="botao-mensagens">
            <BotaoMensagens ativo={!!user} onAbrir={() => { setModulePayload(null); setActiveModule("mensagens"); }} />
          </span>
          <span data-tour="central-notificacoes">
            <CentralNotificacoes
              ativo={!!user}
              colaboradores={data.colaboradores}
              onAbrirDestino={abrirDestinoNotificacao}
              onDados={(evento) => {
                aplicarEventoDados(evento.entidades);
                // Ponte SSE → Mensagens.tsx (M4 do check-up) — ver comentário
                // completo em lib/mensagensRealtime.ts.
                if (evento.entidades.includes("mensagens")) emitirMensagensAtualizadas();
              }}
              onAbrirMensagens={() => { setModulePayload(null); setActiveModule("mensagens"); }}
            />
          </span>
          <span data-tour="botao-ajuda"><BotaoAjuda onClick={() => setMostrarAjuda(true)} /></span>
          <span data-tour="menu-usuario"><MenuUsuario /></span>
        </header>
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
          {/* Suspense pega o instante de download do chunk de cada página
              lazy (ver comentário nos imports lazy no topo do arquivo) —
              instante diferente do `loading` de dados já tratado dentro de
              renderModule(). Fallback igual ao já usado em todo o resto do
              app, pra não introduzir um terceiro visual de "carregando". */}
          {/* Achado (10/07/2026, Padronização de Animações — exemplo dado pelo
              Vini: "Ao sair de Colaboradores e acessar Linhas Telefônicas, a
              mudança deve ocorrer com uma animação discreta"): antes a troca
              de módulo era um corte seco — o novo conteúdo aparecia no mesmo
              frame do clique no menu. Não existe router aqui (`activeModule`
              é só um state trocado em `renderModule()`), então não há
              transição de rota pra animar — a saída da tela anterior nem
              chega a ficar visível o tempo de uma animação de saída rodar,
              já que o React desmonta o módulo antigo no mesmo commit que
              monta o novo. Por isso a entrada é o ponto certo pra animar (é
              o que fica pra "acontecer"): a `key={activeModule}` já força
              este `div` a ser recriado do zero a cada troca — como é um nó
              de DOM novo, a animação CSS reinicia sozinha, sem precisar de
              nenhuma lógica extra em JS. */}
          <React.Suspense fallback={<LoadingState text="Carregando módulo..." />}>
            <div key={activeModule} className="animate-[pageIn_var(--motion-page)_var(--motion-ease)]">
              <ErrorBoundary key={activeModule}>{renderModule()}</ErrorBoundary>
            </div>
          </React.Suspense>
        </main>
      </div>
      {mostrarAjuda && <CentralAjuda onClose={() => setMostrarAjuda(false)} onReiniciarTour={reiniciarTour} />}
      {mostrarTour && !loading && <TourGuiado chave={chaveTour} passos={passosTour} onFechar={() => setMostrarTour(false)} />}
      {buscaAberta && (
        <ComandoPaleta
          onFechar={() => setBuscaAberta(false)}
          onNavegar={(moduloKey, payload) => { setModulePayload(payload); setActiveModule(moduloKey); }}
        />
      )}
      <AssistenteAjuda />
    </div>
  );
}

export default function App() {
  const { user, verificandoSessao } = useAuth();

  // Rota especial fora do fluxo normal de autenticação (07/07/2026): sem
  // router (este app é uma SPA de tela única — ver comentário no topo do
  // arquivo), a única forma de "linkar" pra uma tela específica é checar a
  // URL direto. Usada pelo link de redefinição de senha que chega por
  // e-mail — precisa funcionar mesmo sem estar logado, então checa antes de
  // qualquer coisa relacionada a `user`.
  if (window.location.pathname === "/redefinir-senha") {
    return <RedefinirSenhaPage />;
  }

  // Persistência de Login (08/07/2026): enquanto o AuthProvider ainda está
  // tentando restaurar a sessão a partir do cookie httpOnly (ver
  // AuthContext.tsx), mostra um loading em vez de decidir Login/AppShell
  // com base num `user` que ainda pode virar não-nulo em um instante — sem
  // isso, todo F5 com sessão válida piscava a tela de Login por uma fração
  // de segundo antes do React re-renderizar com o usuário restaurado.
  if (verificandoSessao) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.bg }}>
        <LoadingState text="Carregando sessão..." />
      </div>
    );
  }

  if (!user) return <LoginPage />;
  if (user.precisaTrocarSenha) return <TrocarSenhaObrigatoriaPage />;
  return <AppShell />;
}
