import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { notificacoesApi } from "../api/notificacoes";
import { useNotificacoesStream, EventoDados } from "../hooks/useNotificacoesStream";
import { Button, COLORS, EmptyState, LoadingState, Modal, Select, Stamp, TextInput } from "./ui";
import { Bell, BellOff, CheckCheck, MessageCircle, Settings, Trash2, X } from "./icons";
import {
  CATEGORIA_NOTIFICACAO_LABEL,
  CategoriaNotificacao,
  Colaborador,
  Notificacao,
  PreferenciaNotificacao,
  PRIORIDADE_LABEL,
  Prioridade,
} from "../types";
import { DestinoNotificacao, resolverDestinoNotificacao } from "../lib/notificacaoDestino";

// Central de Notificações (Fase B, 09/07/2026, pedido do Vini) — sino no
// cabeçalho + painel com histórico/filtros/preferências. Usado tanto na
// AppShell (equipe interna) quanto no Portal do Colaborador — mesmo
// componente, único ponto de manutenção.
//
// Decisão de design: em vez de um dropdown posicionado manualmente (que
// precisaria reimplementar click-fora/Esc/foco preso do zero), reaproveita
// o componente <Modal> já usado em todo o resto do sistema (ver
// MenuUsuario.tsx) — mesma linguagem visual, mesmo comportamento de
// acessibilidade já auditado, e menos superfície nova pra ter bug.

function fmtQuando(iso: string): string {
  const data = new Date(iso);
  const agora = new Date();
  const diffMin = Math.round((agora.getTime() - data.getTime()) / 60000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Beep curto via Web Audio API — não depende de nenhum arquivo de áudio
// externo (evita mais uma requisição/asset pra manter).
function tocarBeep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => ctx.close();
  } catch {
    // ambiente sem suporte a Web Audio - silencioso, não é crítico
  }
}

function PainelPreferencias({
  preferencias,
  onSalvar,
}: {
  preferencias: PreferenciaNotificacao;
  onSalvar: (p: Partial<Omit<PreferenciaNotificacao, "usuarioId" | "atualizadoEm">>) => Promise<void>;
}) {
  const [categoriasSilenciadas, setCategoriasSilenciadas] = useState<CategoriaNotificacao[]>(preferencias.categoriasSilenciadas);
  const [prioridadeMinima, setPrioridadeMinima] = useState<Prioridade>(preferencias.prioridadeMinima);
  const [som, setSom] = useState(preferencias.som);
  const [notifNavegador, setNotifNavegador] = useState(preferencias.notificacaoNavegador);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [permissaoNegada, setPermissaoNegada] = useState(false);

  function alternarCategoria(cat: CategoriaNotificacao) {
    setCategoriasSilenciadas((atual) => (atual.includes(cat) ? atual.filter((c) => c !== cat) : [...atual, cat]));
  }

  async function salvar() {
    setErro(null);

    // Notificações do navegador exigem permissão explícita do usuário — só
    // pede quando ele de fato tenta ligar a opção (nunca no carregamento da
    // página, isso é considerado prática abusiva pelos próprios navegadores).
    let notifFinal = notifNavegador;
    if (notifNavegador && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const resultado = await Notification.requestPermission();
      if (resultado !== "granted") {
        notifFinal = false;
        setNotifNavegador(false);
        setPermissaoNegada(true);
      }
    }

    setSalvando(true);
    try {
      await onSalvar({ categoriasSilenciadas, prioridadeMinima, som, notificacaoNavegador: notifFinal });
    } catch {
      setErro("Não foi possível salvar suas preferências. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Categorias silenciadas</h4>
        <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">Você continua vendo essas notificações na lista — só não recebe alerta em tempo real.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {(Object.keys(CATEGORIA_NOTIFICACAO_LABEL) as CategoriaNotificacao[]).map((cat) => (
            <label key={cat} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={categoriasSilenciadas.includes(cat)} onChange={() => alternarCategoria(cat)} className="rounded border-gray-300 dark:border-slate-600 dark:bg-slate-800" />
              {CATEGORIA_NOTIFICACAO_LABEL[cat]}
            </label>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5">Prioridade mínima</h4>
        <Select value={prioridadeMinima} onChange={(e) => setPrioridadeMinima(e.target.value as Prioridade)}>
          {(Object.keys(PRIORIDADE_LABEL) as Prioridade[]).map((p) => (
            <option key={p} value={p}>
              {PRIORIDADE_LABEL[p]}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
          <input type="checkbox" checked={som} onChange={(e) => setSom(e.target.checked)} className="rounded border-gray-300 dark:border-slate-600 dark:bg-slate-800" />
          Tocar som ao chegar uma notificação nova
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={notifNavegador}
            onChange={(e) => {
              setPermissaoNegada(false);
              setNotifNavegador(e.target.checked);
            }}
            className="rounded border-gray-300 dark:border-slate-600 dark:bg-slate-800"
          />
          Mostrar notificação do navegador
        </label>
        {permissaoNegada && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Permissão de notificação negada pelo navegador. Habilite nas configurações do site para usar esta opção.
          </p>
        )}
      </div>

      {erro && <p className="text-xs text-brand-700 dark:text-brand-400">{erro}</p>}

      <Button variant="accent" onClick={salvar} disabled={salvando} className="w-full justify-center">
        {salvando ? "Salvando..." : "Salvar preferências"}
      </Button>

      {/* Achado M7 do check-up (Fase 2, 22/07/2026) — este painel é a
          preferência GERAL, por categoria; existe uma segunda camada
          específica por conversa/canal dentro de Mensagens (ícone de sino
          no cabeçalho de cada conversa aberta) — nota curta pra quem só
          acha um dos dois não ficar sem saber do outro. */}
      <p className="text-[11px] text-gray-400 dark:text-slate-500 border-t border-gray-100 dark:border-slate-700 pt-3">
        Isto controla a categoria "Mensagem" como um todo. Pra silenciar ou só receber menções de UMA conversa/canal específico, use o
        sino que aparece no cabeçalho dela dentro de Mensagens.
      </p>
    </div>
  );
}

// Tempo que o pop-up fica na tela antes de sumir sozinho — 8s é o padrão de
// mercado pra toast (Gmail, Slack): tempo suficiente pra ler título +
// mensagem sem pressa, curto o bastante pra não empilhar se chegarem várias
// notificações seguidas.
const TOAST_DURACAO_MS = 8000;
// Nunca mais de 4 pop-ups visíveis ao mesmo tempo — um pico de notificações
// (ex: vários chamados abertos em sequência) não deve tomar a tela toda;
// as demais continuam contabilizadas no sino/badge normalmente.
const TOAST_MAX_VISIVEIS = 4;

function corPrioridadeToast(p: Prioridade): string {
  if (p === "ALTA") return COLORS.brass;
  if (p === "MEDIA") return COLORS.amber;
  return COLORS.border;
}

// Pop-up de notificação em tempo real (09/07/2026, pedido do Vini: "a
// notificação chegar em pop-up e conseguir clicar e ir no destino") —
// `createPortal` pro mesmo motivo do <Modal> em ui.tsx (ver comentário lá):
// o header usa `backdrop-blur-sm`, que cria um novo containing block pra
// qualquer `position: fixed` descendente, então "fixed" dentro da árvore do
// header não cobriria a tela inteira. Renderizando direto em
// `document.body` o pop-up fica sempre no canto da viewport, não importa de
// onde este componente é montado (AppShell ou Portal do Colaborador).
function ToastNotificacoes({
  toasts,
  onClicar,
  onFechar,
}: {
  toasts: Notificacao[];
  onClicar: (n: Notificacao) => void;
  onFechar: (id: string) => void;
}) {
  // Achado (10/07/2026, Padronização de Animações): o toast só animava ao
  // aparecer — tanto o botão "Fechar" quanto o auto-dismiss por tempo (ver
  // TOAST_DURACAO_MS, controlado pelo componente pai) tiravam o item do
  // array `toasts` no mesmo frame, e o pop-up simplesmente desaparecia. Em
  // vez de duplicar a lógica de timer aqui, este componente mantém um
  // espelho local (`render`) da lista: quando um id some do array do pai,
  // ele continua desenhado aqui por mais um instante com a animação de
  // saída (toastOut), e só sai da tela de vez depois dela terminar — o pai
  // não precisa saber nada sobre animação, só decide QUANDO remover.
  const [render, setRender] = React.useState<{ n: Notificacao; saindo: boolean }[]>([]);
  const timersRef = React.useRef<Record<string, number>>({});

  React.useEffect(() => {
    setRender((atual) => {
      const idsAtuais = new Set(toasts.map((t) => t.id));
      const mantidos = atual.map((item) => (idsAtuais.has(item.n.id) ? item : { ...item, saindo: true }));
      const novos = toasts.filter((t) => !atual.some((item) => item.n.id === t.id)).map((n) => ({ n, saindo: false }));
      return [...mantidos, ...novos];
    });
  }, [toasts]);

  React.useEffect(() => {
    const reduzMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    render.forEach((item) => {
      if (item.saindo && !timersRef.current[item.n.id]) {
        const remover = () => {
          delete timersRef.current[item.n.id];
          setRender((atual) => atual.filter((x) => x.n.id !== item.n.id));
        };
        if (reduzMovimento) remover();
        else timersRef.current[item.n.id] = window.setTimeout(remover, 220);
      }
    });
  }, [render]);

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  if (render.length === 0) return null;
  return createPortal(
    <div className="fixed top-4 right-4 z-[70] flex flex-col gap-2.5 w-[calc(100%-2rem)] max-w-sm">
      {render.map(({ n, saindo }) => (
        <div
          key={n.id}
          role="button"
          tabIndex={0}
          onClick={() => onClicar(n)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onClicar(n);
          }}
          className={`bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 pl-3.5 pr-2.5 py-3 flex items-start gap-2.5 cursor-pointer transition-shadow focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30 ${
            saindo
              ? "animate-[toastOut_var(--motion-panel)_var(--motion-ease-out)_forwards]"
              : "animate-[toastIn_var(--motion-panel)_var(--motion-ease)]"
          }`}
          style={{ borderLeft: `3px solid ${corPrioridadeToast(n.prioridade)}`, boxShadow: "var(--elevation-3)" }}
        >
          <Bell size={16} className="flex-shrink-0 mt-0.5 text-brand-600 dark:text-brand-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{n.titulo}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mt-0.5">{n.mensagem}</p>
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">{CATEGORIA_NOTIFICACAO_LABEL[n.categoria]}</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFechar(n.id);
            }}
            aria-label="Fechar notificação"
            title="Fechar"
            className="text-gray-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg p-1 flex-shrink-0 transition-colors active:scale-90"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

export function CentralNotificacoes({
  ativo,
  colaboradores,
  onAbrirDestino,
  onDados,
  onAbrirMensagens,
}: {
  ativo: boolean;
  // Usada só pra resolver USUARIO+entidade "Usuario" → colaborador certo a
  // abrir (ver comentário em lib/notificacaoDestino.ts). Lista vazia é um
  // valor perfeitamente válido (ex: primeiro carregamento) — o resolver
  // simplesmente não encontra correspondência e não navega, sem quebrar.
  colaboradores: Colaborador[];
  // Ausente = clique só marca como lida, sem navegar (ex: nenhum contexto de
  // navegação disponível). Quem monta este componente decide como um
  // `DestinoNotificacao` vira uma navegação de verdade — AppShell troca de
  // módulo (App.tsx), Portal do Colaborador troca de `tela` (ver
  // PortalColaborador.tsx) — por isso a tradução final não mora aqui.
  onAbrirDestino?: (destino: DestinoNotificacao) => void;
  // "Tudo instantâneo" (09/07/2026) — repassa o evento "dados" (ver
  // useNotificacoesStream) pra fora: quem monta este componente é quem sabe
  // como recarregar cada recurso (useAppData.refetch), este componente só é
  // dono da conexão SSE em si, não da lógica de invalidação de cache.
  onDados?: (evento: EventoDados) => void;
  // Comunicação unificada (Onda 1 do redesenho, 21/07/2026, pedido do Vini:
  // "eliminar o módulo Mensagens... criar uma única Central de
  // Notificações"). Mensagens continua sendo uma tela própria por baixo —
  // é um chat de verdade (2 colunas, lista de conversas + thread), a
  // auditoria descartou encaixar isso dentro deste painel pequeno (seria
  // piorar a experiência de quem usa o chat, não simplificar). O que muda
  // é a ENTRADA: "Mensagens" deixou de ser item de menu lateral — agora só
  // se chega lá por aqui, pelo mesmo sino usado pra notificações. Ausente
  // (ex: nenhum destino de navegação disponível) esconde o botão.
  onAbrirMensagens?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [mostrarPreferencias, setMostrarPreferencias] = useState(false);
  const [toasts, setToasts] = useState<Notificacao[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(
    () => () => {
      // Limpa todos os timers de auto-dismiss pendentes ao desmontar (troca
      // de papel/logout) — sem isso, um `setTimeout` tentando atualizar
      // estado de um componente já desmontado gera warning do React.
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current.clear();
    },
    []
  );

  function removerToast(id: string) {
    setToasts((atual) => atual.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }

  const [itens, setItens] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);

  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaNotificacao | "">("");
  const [filtroPrioridade, setFiltroPrioridade] = useState<Prioridade | "">("");
  const [somenteNaoLidas, setSomenteNaoLidas] = useState(false);
  const [busca, setBusca] = useState("");

  const [preferencias, setPreferencias] = useState<PreferenciaNotificacao | null>(null);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const buscaDebounce = useRef<number | null>(null);

  const { naoLidas, marcarComoLidaLocal, zerarNaoLidas, refetchContagem } = useNotificacoesStream({
    ativo,
    onDados,
    onNotificacao: (n) => {
      // Só toca som/mostra notificação do navegador se a preferência já foi
      // carregada e está ligada — antes disso (preferências ainda não
      // buscadas nesta sessão), fica em silêncio por padrão, mais seguro
      // que assumir "ligado" sem confirmação.
      if (preferencias?.som) tocarBeep();
      if (preferencias?.notificacaoNavegador && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(n.titulo, { body: n.mensagem });
        } catch {
          // navegador pode recusar em certos contextos (ex: aba em segundo
          // plano em alguns sistemas) - não é crítico
        }
      }
      // Se o painel já está aberto olhando a primeira página sem filtro de
      // "lida", injeta a notificação nova no topo da lista em tempo real.
      setItens((atual) => (aberto && pagina === 1 ? [n, ...atual] : atual));

      // Pop-up (09/07/2026, pedido do Vini) — aparece sempre que a
      // notificação chega, com ou sem o painel aberto (é justamente o caso
      // de o painel estar FECHADO o mais comum: sem pop-up, a única pista de
      // que chegou algo novo era o número no sino, fácil de não notar).
      // `slice` limita a fila visível (ver TOAST_MAX_VISIVEIS); a mais
      // antiga sai da tela mas continua contabilizada no sino normalmente,
      // nada se perde — só não fica empilhando pop-up indefinidamente.
      setToasts((atual) => [...atual, n].slice(-TOAST_MAX_VISIVEIS));
      const timer = window.setTimeout(() => removerToast(n.id), TOAST_DURACAO_MS);
      timersRef.current.set(n.id, timer);
    },
  });

  // Busca as preferências uma vez por sessão (não a cada abertura do painel)
  // — usadas tanto pra decidir som/notificação do navegador quanto exibidas
  // no sub-painel de preferências.
  useEffect(() => {
    if (!ativo) return;
    notificacoesApi
      .preferencias()
      .then(setPreferencias)
      .catch(() => {});
  }, [ativo]);

  function carregar(paginaAlvo: number, substituir: boolean) {
    setCarregando(true);
    notificacoesApi
      .list({
        page: paginaAlvo,
        pageSize: 15,
        categoria: filtroCategoria || undefined,
        prioridade: filtroPrioridade || undefined,
        lida: somenteNaoLidas ? false : undefined,
        busca: busca || undefined,
      })
      .then((r) => {
        setItens((atual) => (substituir ? r.items : [...atual, ...r.items]));
        setTotalPaginas(r.meta.totalPages);
        setPagina(r.meta.page);
      })
      .catch(() => {
        if (substituir) setItens([]);
      })
      .finally(() => setCarregando(false));
  }

  function abrir() {
    setAberto(true);
    setMostrarPreferencias(false);
    carregar(1, true);
  }

  function fechar() {
    setAberto(false);
  }

  // Refiltra do zero sempre que um filtro muda, enquanto o painel está
  // aberto. Busca por texto é debounced (300ms) pra não disparar uma
  // requisição a cada tecla.
  useEffect(() => {
    if (!aberto) return;
    if (buscaDebounce.current) window.clearTimeout(buscaDebounce.current);
    buscaDebounce.current = window.setTimeout(() => carregar(1, true), 300);
    return () => {
      if (buscaDebounce.current) window.clearTimeout(buscaDebounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, filtroCategoria, filtroPrioridade, somenteNaoLidas, busca]);

  async function marcarLida(n: Notificacao) {
    if (n.lida) return;
    setItens((atual) => atual.map((i) => (i.id === n.id ? { ...i, lida: true, lidaEm: new Date().toISOString() } : i)));
    marcarComoLidaLocal(1);
    try {
      await notificacoesApi.marcarLida(n.id);
    } catch {
      refetchContagem();
    }
  }

  // Clique (09/07/2026, pedido do Vini) — usado tanto pelo pop-up quanto
  // pelo item na lista do painel: os dois precisam do mesmo comportamento
  // (marcar como lida + navegar pro destino, se houver um mapeado — ver
  // lib/notificacaoDestino.ts). Sempre marca como lida mesmo quando não há
  // destino de navegação (ex: categoria SISTEMA) — clicar já é o mesmo sinal
  // de "vi isso" que marcar manualmente.
  function abrirNotificacao(n: Notificacao) {
    marcarLida(n);
    removerToast(n.id);
    const destino = resolverDestinoNotificacao(n, colaboradores);
    if (destino.tipo !== "nenhum" && onAbrirDestino) {
      fechar();
      onAbrirDestino(destino);
    }
  }

  async function marcarTodasLidas() {
    setProcessandoId("todas");
    try {
      await notificacoesApi.marcarTodasLidas();
      setItens((atual) => atual.map((i) => ({ ...i, lida: true, lidaEm: i.lidaEm || new Date().toISOString() })));
      zerarNaoLidas();
    } finally {
      setProcessandoId(null);
    }
  }

  async function remover(n: Notificacao) {
    setProcessandoId(n.id);
    try {
      await notificacoesApi.remover(n.id);
      setItens((atual) => atual.filter((i) => i.id !== n.id));
      if (!n.lida) marcarComoLidaLocal(1);
    } finally {
      setProcessandoId(null);
    }
  }

  async function salvarPreferencias(p: Partial<Omit<PreferenciaNotificacao, "usuarioId" | "atualizadoEm">>) {
    const atualizada = await notificacoesApi.atualizarPreferencias(p);
    setPreferencias(atualizada);
  }

  const naoLidasTexto = naoLidas > 99 ? "99+" : String(naoLidas);

  return (
    <>
      <ToastNotificacoes toasts={toasts} onClicar={abrirNotificacao} onFechar={removerToast} />
      <button
        onClick={abrir}
        aria-label={naoLidas > 0 ? `Notificações, ${naoLidas} não lidas` : "Notificações"}
        title="Notificações"
        className="relative p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-[var(--motion-fast)] active:scale-90 text-slate-500 dark:text-slate-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30"
      >
        <Bell size={18} />
        {naoLidas > 0 && (
          // `key` força o badge a remontar a cada mudança de contagem — o
          // navegador reinicia a animação de entrada num nó de DOM novo
          // automaticamente, dando um pequeno "pop" a cada notificação nova
          // sem precisar de nenhuma lógica extra em JS (mesmo truque usado
          // na transição de módulo em App.tsx).
          <span
            key={naoLidasTexto}
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center animate-[toastIn_var(--motion-fast)_var(--motion-ease)]"
            style={{ background: COLORS.brass }}
          >
            {naoLidasTexto}
          </span>
        )}
      </button>

      {aberto && (
        <Modal title="Notificações" onClose={fechar} wide>
          {mostrarPreferencias ? (
            <div>
              <button onClick={() => setMostrarPreferencias(false)} className="text-xs text-brand-700 dark:text-brand-400 hover:underline mb-4">
                ← Voltar para a lista
              </button>
              {preferencias ? (
                <PainelPreferencias preferencias={preferencias} onSalvar={salvarPreferencias} />
              ) : (
                <LoadingState text="Carregando preferências..." />
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <TextInput placeholder="Buscar..." value={busca} onChange={(e) => setBusca(e.target.value)} className="flex-1 min-w-[140px]" />
                <Select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value as CategoriaNotificacao | "")} className="w-auto">
                  <option value="">Todas as categorias</option>
                  {(Object.keys(CATEGORIA_NOTIFICACAO_LABEL) as CategoriaNotificacao[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORIA_NOTIFICACAO_LABEL[c]}
                    </option>
                  ))}
                </Select>
                <Select value={filtroPrioridade} onChange={(e) => setFiltroPrioridade(e.target.value as Prioridade | "")} className="w-auto">
                  <option value="">Qualquer prioridade</option>
                  {(Object.keys(PRIORIDADE_LABEL) as Prioridade[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORIDADE_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={somenteNaoLidas} onChange={(e) => setSomenteNaoLidas(e.target.checked)} className="rounded border-gray-300 dark:border-slate-600 dark:bg-slate-800" />
                  Só não lidas
                </label>
                <div className="flex items-center gap-3">
                  {onAbrirMensagens && (
                    <button
                      onClick={() => { fechar(); onAbrirMensagens(); }}
                      className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-1"
                    >
                      <MessageCircle size={13} /> Mensagens
                    </button>
                  )}
                  <button onClick={() => setMostrarPreferencias(true)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-1">
                    <Settings size={13} /> Preferências
                  </button>
                  {naoLidas > 0 && (
                    <button
                      onClick={marcarTodasLidas}
                      disabled={processandoId === "todas"}
                      className="text-xs text-brand-700 dark:text-brand-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                    >
                      <CheckCheck size={13} /> {processandoId === "todas" ? "Marcando..." : "Marcar todas como lidas"}
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
                {carregando && itens.length === 0 ? (
                  <LoadingState text="Carregando notificações..." />
                ) : itens.length === 0 ? (
                  <EmptyState icon={BellOff} text="Nenhuma notificação encontrada." />
                ) : (
                  <ul className="space-y-1.5">
                    {itens.map((n) => (
                      <li
                        key={n.id}
                        onClick={() => abrirNotificacao(n)}
                        className={`rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors duration-[var(--motion-fast)] ${
                          n.lida
                            ? "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                            : "bg-brand-50/40 dark:bg-brand-500/15 border-brand-100 dark:border-brand-800 hover:bg-brand-50 dark:hover:bg-brand-500/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              {!n.lida && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: COLORS.brass }} />}
                              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{n.titulo}</span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{n.mensagem}</p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className="text-[10px] text-gray-400 dark:text-slate-500">{fmtQuando(n.criadoEm)}</span>
                              <span className="text-[10px] text-gray-400 dark:text-slate-500">· {CATEGORIA_NOTIFICACAO_LABEL[n.categoria]}</span>
                              {n.prioridade === "ALTA" && <Stamp tone="neg">Alta</Stamp>}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              remover(n);
                            }}
                            disabled={processandoId === n.id}
                            aria-label="Remover notificação"
                            title="Remover"
                            className="text-gray-400 hover:text-brand-700 dark:hover:text-brand-400 flex-shrink-0 p-1 disabled:opacity-50 transition-colors active:scale-90"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {pagina < totalPaginas && (
                <div className="text-center">
                  <Button variant="ghost" onClick={() => carregar(pagina + 1, false)} disabled={carregando}>
                    {carregando ? "Carregando..." : "Carregar mais"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
