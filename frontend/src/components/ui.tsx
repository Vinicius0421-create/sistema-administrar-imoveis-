import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Sentry from "@sentry/react";
import { ArrowLeftRight, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, EyeOff, MoreVertical, Search as SearchIcon, X } from "./icons";
import { tone } from "../types";

// Fase 5 (Identidade Visual, Opção C — reformulação completa, 05/07/2026):
// `brass`/`brick` deixaram de ser um vermelho genérico (Tailwind red-600/700,
// #DC2626/#B91C1C) pra virar o vermelho real da marca. A cor pura da logo
// (medida pixel a pixel no arquivo em `src/assets/logo.ts`) é #FD2F37 — mais
// vibrante/rosada que o vermelho antigo — só que ela mesma, usada como texto
// branco sobre fundo sólido, cai pra 3.7:1 de contraste (abaixo do mínimo
// AA de 4.5:1 pra texto normal). `brass` por isso usa uma versão levemente
// mais escurecida/pura do mesmo tom (mesmo matiz, mesma saturação alta),
// que já garante 4.55:1 — a cor pura da logo continua disponível como
// `brand-500` no Tailwind (ver `tailwind.config.js`) pra usos decorativos
// onde contraste de texto não é o problema (ícones, bordas, glow).
// 10/07/2026 (Preferências → Tema, pedido do Vini): estes valores viraram
// `var(--color-*)` em vez de hex fixo. As variáveis são definidas em
// index.css (`:root` = claro, `.dark` = escuro) — como praticamente toda
// tela do sistema já lê cor daqui via `style={{ color: COLORS.ink }}` etc.,
// isso dá suporte a tema escuro em todo lugar que usa COLORS sem precisar
// editar cada ponto de uso individualmente. Ver theme/ThemeContext.tsx pra
// quem aplica a classe `dark` em <html>.
export const COLORS = {
  bg: "var(--color-bg)",
  surface: "var(--color-surface)",
  surfaceAlt: "var(--color-surface-alt)",
  ink: "var(--color-ink)",
  inkSoft: "var(--color-ink-soft)",
  brass: "var(--color-brass)",
  brick: "var(--color-brick)",
  sage: "var(--color-sage)",
  amber: "var(--color-amber)",
  border: "var(--color-border)",
  // Ver comentário em index.css — fundo de chrome de marca (sidebar,
  // avatar, badges), fixo entre os dois temas, distinto de `ink` (que
  // precisa clarear no escuro por ser cor de TEXTO na maior parte dos usos).
  chrome: "var(--color-chrome)",
};
// Fonte de destaque (títulos de página, modal, marca na sidebar) trocada de
// Helvetica Neue (genérica, sem personalidade) pra Plus Jakarta Sans — sans
// geométrica moderna, mesma família usada em produtos SaaS/imobiliário
// contemporâneos, mantendo o texto do corpo (tabelas, formulários) na stack
// padrão do Tailwind pra não sacrificar densidade/legibilidade de dado.
export const FONT_DISPLAY = "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";
export const FONT_MONO = "ui-monospace, 'SF Mono', Consolas, monospace";

// Sombra padrão de cartão — mais suave que uma borda dura de 1px, dá
// profundidade sutil sem parecer "flutuante" demais. Usada em card, modal,
// KPICard etc. pra manter a mesma linguagem visual em todo o sistema.
// 13/07/2026 (Fundação Visual — sistema de elevação): eram strings rgba
// fixas, tunadas só pro tema claro — no escuro, uma sombra quase-preta
// contra um fundo já escuro não cria nenhuma profundidade perceptível (o
// mesmo problema de cor-fixa-sem-par-dark já corrigido nos tokens de cor
// semânticos). Viraram referências a `--elevation-1`/`--elevation-2` (ver
// index.css, valores próprios por tema) — nenhum dos ~15 pontos de uso
// espalhados pelo sistema (KPICard, cartões de Colaboradores, telas de
// autenticação etc.) precisou mudar, porque todos já passavam por estas
// duas constantes em vez de repetir a sombra em cada lugar.
export const CARD_SHADOW = "var(--elevation-1)";
export const CARD_SHADOW_HOVER = "var(--elevation-2)";

// Etapa 4 (auditoria de frontend, 08/07/2026): fundo das 4 telas de
// autenticação (Login x2, RedefinirSenha, TrocarSenhaObrigatoria) — estava
// copiado e colado idêntico em cada arquivo, sem nenhuma fonte única. Uma
// mudança de tom precisaria lembrar de editar os 4 lugares (mesmo risco já
// visto com PAPEIS_QUE_VEEM_TUDO no backend). #0f172a bate com COLORS.ink;
// #1e293b (slate-800) não tinha token nomeado antes.
export const AUTH_BG_GRADIENT = "radial-gradient(circle at 50% 0%, #1e293b 0%, #0f172a 55%, #0f172a 100%)";

export function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function fmtMoney(v: number | string | null | undefined) {
  const n = Number(v) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// Movidos pra cá (Onda 2.3 do redesign, 21/07/2026) de dentro de
// ChamadoDetalhe.tsx, onde nasceram (09/07/2026) — ChamadoDetalhe.tsx
// continua reexportando os dois (ver final do arquivo) pra não quebrar quem
// já importava de lá (SolicitacoesPapelaria.tsx). A mudança de endereço foi
// necessária pra `TimelineEventos.tsx` (novo, ver componente) poder usá-los
// sem criar import circular — ele é importado POR ChamadoDetalhe.tsx, então
// não pode também importar DE ChamadoDetalhe.tsx.
export function fmtDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtDuracao(ms: number | null) {
  if (ms === null) return "—";
  const horas = Math.floor(ms / 3_600_000);
  const dias = Math.floor(horas / 24);
  if (dias > 0) return `${dias}d ${horas % 24}h`;
  if (horas > 0) return `${horas}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}min`;
}

// Achado de auditoria (08/07/2026, Etapa 6 — Acessibilidade): vários cards
// clicáveis do sistema (equipamentos, chamados/solicitações no Kanban,
// itens de "atenção" no dashboard) eram `<div onClick={...}>` — sem
// `tabIndex`, sem `role`, sem resposta a Enter/Space, então ficavam
// inatingíveis por teclado ou leitor de tela. `cardClicavelProps` centraliza
// o trio `role`/`tabIndex`/`onKeyDown` (+ indicador de foco visível) que
// cada um desses cards precisa, pra não reimplementar o mesmo `onKeyDown`
// em 7 lugares diferentes — espalhar em vez de duplicar por área.
export const FOCUS_RING_CLASS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30";
export function cardClicavelProps(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

// Achado (13/07/2026, Fundação Visual — Modernização Completa, Fase 1):
// auditoria encontrou 61 usos de `emerald-*`/`amber-*`/`brand-*` sem par
// `dark:` em 16 arquivos (ver relatório da fase). `Stamp` era o pior caso —
// usado em quase toda tela do sistema pra status (ATIVO/INATIVO, prioridade
// de chamado, SLA) — cores `-50` (quase brancas) contra fundo escuro do
// tema `.dark` ficavam praticamente ilegíveis/destoantes, confirmado por
// captura de tela real em Colaboradores e no Kanban de Chamados. Convenção
// usada (mesma já estabelecida no `Button` variant="danger" acima: texto
// sobe pra tom -400, borda/anel desce pra tom -800/500 com opacidade baixa,
// fundo vira um tingimento translúcido em vez do quase-branco -50):
//   texto:  700/800/900 (claro) → 400 (escuro)
//   fundo:  50 (claro)          → 500/15 translúcido (escuro)
//   anel:   600/20 (claro)      → 400/30 (escuro)
const TONE_CLASS: Record<string, string> = {
  pos: "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-600/20 dark:ring-emerald-400/30",
  neg: "bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 ring-1 ring-brand-600/20 dark:ring-brand-400/30",
  pend: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-600/20 dark:ring-amber-400/30",
};
const TONE_DOT: Record<string, string> = {
  pos: "bg-emerald-600 dark:bg-emerald-400",
  neg: "bg-brand-600 dark:bg-brand-400",
  pend: "bg-amber-600 dark:bg-amber-400",
};

// `tone` opcional (22/07/2026, pedido do Vini: cores erradas em Pagamentos —
// "aquele pagamento que estiver pendente ou aberto for em amarelo e aquele
// que estiver pago ou fechado em verde"). Causa raiz: sem override, `Stamp`
// sempre deduzia a cor via `tone(children)` — que faz correspondência exata
// contra os `Set`s genéricos POSITIVOS/NEGATIVOS em types.ts (ex: "Ativo",
// "Cancelado") e cai em "pend" (âmbar) pra qualquer rótulo que não bata
// exatamente. Rótulos deste sistema como "Aberta"/"Fechada"/"Pago"/"Gerada"/
// "Processada"/"Rejeitada" não batem com essas listas genéricas — por isso
// quase tudo em Pagamentos saía âmbar, mesmo "Pago" ou "Fechada". Em vez de
// expandir as listas genéricas (usadas em telas fora de Pagamentos também —
// arriscaria mudar cor em lugares que não deveriam mudar), este prop deixa
// quem renderiza decidir explicitamente a cor certa por domínio (ver mapas
// STATUS_PAGAMENTO_TONE/STATUS_FOLHA_TONE/STATUS_REMESSA_TONE em types.ts).
// Sem o prop, o comportamento antigo (auto-detecção) continua idêntico.
export function Stamp({ children, tone: toneOverride }: { children?: string | null; tone?: "pos" | "neg" | "pend" }) {
  if (!children) return null;
  const t = toneOverride ?? tone(children);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${TONE_CLASS[t]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[t]}`} />
      {children}
    </span>
  );
}

// Achado (13/07/2026, Fundação Visual — Modernização Completa, Fase 1,
// Tarefa "Escala de tipografia e espaçamento"): o título de cada página do
// sistema (Colaboradores, Equipamentos, Chamados etc. — 10 telas) era um
// `<h2>` copiado e colado em cada arquivo, sempre com `style={{ fontFamily:
// FONT_DISPLAY, color: COLORS.ink }}` mas SEM `fontWeight` explícito.
// Diferença de peso confirmada via `getComputedStyle` num navegador real:
// o `<h2>` renderizava em 400 (regular) — porque Tailwind Preflight reseta
// `font-weight` de heading pra `inherit`, e nada na cadeia (body/html)
// define um peso diferente de 400 — enquanto o `<h1>` das telas de
// autenticação (Login, Redefinir Senha) e o título do `Modal` (logo acima
// nesta mesma tela) usam 800 e 700 respectivamente. Resultado prático:
// o título de página — o elemento que mais precisa de destaque visual numa
// hierarquia tipográfica — era o texto MENOS encorpado da tela inteira,
// mais fraco que o próprio subtítulo em alguns navegadores/fontes de
// fallback. `PageHeader` centraliza o que as 10 telas já faziam quase
// identicamente (título + subtítulo opcional + ações opcionais à direita,
// ícone opcional antes do título — usado em Configurações e Portal do
// Suporte de TI) num único componente com peso explícito (700, mesmo valor
// do título do Modal, mantendo a hierarquia: título de página e título de
// modal no mesmo nível de destaque). Continua `<h2>` de propósito — cogitei
// promover pra `<h1>` (semanticamente seria o título "principal" da view),
// mas o AppShell (App.tsx) já usa `<h1>` pra marca "ADMINISTRAR IMÓVEIS" no
// topo da barra lateral, presente em toda tela — promover o título de
// página pra `<h1>` também criaria DOIS `<h1>` na mesma página, quebrando a
// expectativa de leitor de tela de um único heading de nível 1 por
// documento. `<h2>` mantém a hierarquia correta: marca (h1) → título de
// página (h2) → seções internas (h3 em diante, onde existirem).
export function PageHeader({
  title,
  icon: Icon,
  subtitle,
  actions,
  semMargem,
}: {
  title: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  // Home.tsx é a única tela que envolve suas seções num container
  // `space-y-6` (ritmo vertical automático entre irmãos) — a margem
  // inferior própria do PageHeader somaria a esse espaçamento e dobraria o
  // respiro só depois do cabeçalho. `semMargem` deixa o `space-y-6` do pai
  // ser a única fonte de verdade nesse caso específico.
  semMargem?: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${semMargem ? "" : actions ? "mb-4" : "mb-5"}`}>
      <div>
        {/* Redesign visual "Stripe Dashboard rico" (14/07/2026): hierarquia
            tipográfica reforçada — título de página sobe de text-2xl (24px)
            pra 1.85rem (~30px) com tracking mais fechado, pra ficar
            claramente um degrau acima de qualquer outro texto da tela (o
            problema apontado era hierarquia fraca demais, título e corpo
            quase no mesmo peso visual à primeira vista). */}
        <h2 className="text-[1.85rem] leading-tight tracking-tight flex items-center gap-2" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, color: COLORS.ink }}>
          {Icon && <Icon size={24} />}
          {title}
        </h2>
        {subtitle && <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3.5">
      <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

// Achado (10/07/2026, Padronização de Animações): campos de formulário
// trocavam de borda/sombra no foco instantaneamente — `transition-shadow`
// sozinho não cobre a borda, então só a sombra animava e a borda "pulava".
// `transition-[border-color,box-shadow]` anima os dois juntos, com a mesma
// duração/curva usada em todo o resto do sistema (--motion-fast + ease
// padrão do navegador é suficiente aqui — curva customizada seria
// imperceptível numa transição de cor tão curta).
// Redesign visual "Stripe Dashboard rico" (14/07/2026): raio subiu de
// `rounded-lg` (8px) pra `rounded-xl` (12px, via --radius-control) e a
// sombra deixou de ser o `shadow-sm` genérico do Tailwind (quase invisível)
// pra usar o token de elevação do sistema — mesma sombra que já existe em
// KPICard/cartões, só que nenhum input/select/textarea usava antes (eram os
// únicos "superfície" do sistema sem profundidade nenhuma).
const inputCls =
  "w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-[var(--radius-control)] text-sm text-slate-900 dark:text-slate-100 shadow-[var(--elevation-1)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-gray-400 dark:placeholder:text-slate-500 hover:border-gray-300 dark:hover:border-slate-500 focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls + " " + (props.className || "")} />;
}

// Achado de auditoria (06/07/2026): todo campo de senha do sistema (login,
// troca obrigatória) era só `type="password"` sem nenhuma forma de conferir
// o que foi digitado antes de enviar — no celular, onde autocorretor e teclas
// próximas erram fácil, isso gera "senha errada" por erro de digitação, não
// por esquecimento real. O botão de mostrar/ocultar é o padrão esperado hoje
// em qualquer formulário de senha.
export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visivel ? "text" : "password"} className={inputCls + " pr-10 " + (props.className || "")} />
      {/* Achado de auditoria (08/07/2026, Etapa 6 — Acessibilidade): este
          botão tinha `tabIndex={-1}`, o que tirava "Mostrar senha" da ordem
          de Tab por completo — quem navega só por teclado não tinha NENHUMA
          forma de acioná-lo. Removido: agora entra na ordem natural (logo
          depois do campo de senha no DOM), sem precisar de atalho especial. */}
      <button
        type="button"
        onClick={() => setVisivel((v) => !v)}
        aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
        title={visivel ? "Ocultar senha" : "Mostrar senha"}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
      >
        {visivel ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
// Redesign visual "Stripe Dashboard rico" (14/07/2026): antes disto, todo
// `<select>` do sistema (~15 telas) usava a seta nativa do navegador — o
// tipo de detalhe pequeno que sozinho já denuncia "não foi desenhado", por
// mais que borda/sombra/cor estejam certas ao redor dele. `appearance-none`
// remove a seta nativa (inclusive no Safari, que precisa do prefixo
// `-webkit-appearance-none` — coberto via className abaixo); `ChevronDown`
// próprio substitui, com o mesmo tratamento de cor/dark mode do resto do
// sistema. `pointer-events-none` no ícone garante que o clique sempre
// alcança o `<select>` por baixo, não o ícone.
export function Select({ children, className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={inputCls + " cursor-pointer appearance-none [-webkit-appearance:none] pr-9 " + className}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
      />
    </div>
  );
}
export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} rows={props.rows || 3} className={inputCls + " resize-none " + (props.className || "")} />;
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "accent" | "ghost" | "danger";
}
export function Button({ children, variant = "primary", className = "", ...props }: ButtonProps) {
  // Redesign visual "Stripe Dashboard rico" (14/07/2026): `primary`/`accent`
  // eram cor sólida chapada — trocado por um gradiente vertical sutil (mesmo
  // tom, só mais claro no topo/mais escuro embaixo) e sombra colorida mais
  // generosa no repouso (não só no hover, como antes). É a assinatura visual
  // mais reconhecível do Stripe Dashboard em botão primário: parece ter uma
  // fonte de luz por cima, não uma chapa de cor plana.
  const variants: Record<string, string> = {
    primary:
      "bg-gradient-to-b from-slate-800 to-slate-950 text-gray-50 shadow-[0_1px_2px_rgba(15,23,42,0.3),0_8px_16px_-4px_rgba(15,23,42,0.35)] hover:from-slate-700 hover:to-slate-900 hover:shadow-[0_1px_2px_rgba(15,23,42,0.35),0_12px_24px_-4px_rgba(15,23,42,0.4)] active:from-slate-900 active:to-slate-950 dark:bg-gradient-to-b dark:from-white dark:to-slate-200 dark:text-slate-900 dark:hover:from-white dark:hover:to-slate-100",
    accent:
      "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[0_1px_2px_rgba(237,2,11,0.35),0_8px_18px_-4px_rgba(237,2,11,0.45)] hover:from-brand-500 hover:to-brand-700 hover:shadow-[0_1px_2px_rgba(237,2,11,0.4),0_14px_26px_-4px_rgba(237,2,11,0.5)] active:from-brand-600 active:to-brand-800",
    ghost:
      "bg-white/70 dark:bg-slate-800/60 text-slate-900 border border-slate-200 shadow-[var(--elevation-1)] hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-800 dark:hover:border-slate-500 dark:active:bg-slate-700",
    danger:
      "bg-transparent text-brand-700 border border-brand-300 hover:bg-brand-50 hover:border-brand-400 active:bg-brand-100 dark:text-brand-400 dark:border-brand-800 dark:hover:bg-brand-950/40",
  };
  return (
    <button
      {...props}
      // Achado de auditoria (06/07/2026): nenhum botão do sistema tinha
      // indicador de foco visível — quem navega por teclado (ou usa switch
      // control/acessibilidade no celular) não tinha como saber qual botão
      // está selecionado. focus-visible (não :focus puro) garante que o
      // anel só aparece pra navegação por teclado, sem poluir cliques de
      // mouse/touch.
      // Achado (10/07/2026, Padronização de Animações): nenhum botão do
      // sistema dava feedback de "eu recebi seu clique" além da mudança de
      // cor — `active:scale-[0.97]` é o microgesto padrão de apps SaaS
      // modernos (Linear, Stripe Dashboard) pra isso: um encolhimento
      // quase imperceptível, rápido o bastante (--motion-instant) pra não
      // atrapalhar cliques em sequência.
      className={`px-4 py-2.5 rounded-[var(--radius-control)] text-sm font-medium transition-all duration-[var(--motion-fast)] active:scale-[0.97] active:duration-[var(--motion-instant)] inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  // Achado (10/07/2026, Padronização de Animações e Transições): o Modal só
  // tinha animação de ENTRADA — fechar era instantâneo (desmontava no mesmo
  // frame do clique), quebrando a consistência com a abertura suave e
  // parecendo um corte seco no meio de uma experiência "fluida". `fechar()`
  // troca a animação do overlay/painel pra saída (modalOut/fadeOut) e só
  // chama o `onClose` de verdade — que desmonta o componente — depois dela
  // terminar. A duração do setTimeout replica --motion-panel (ver
  // index.css); se os dois divergirem no futuro o pior caso é o modal
  // sumir um pouco antes/depois da animação acabar, nunca travar aberto.
  // Pula a espera inteiramente quando o usuário tem prefers-reduced-motion
  // ativado — nesse caso a duração da animação já é ~0 via CSS global, então
  // esperar 220ms seria só um atraso artificial sem nenhum efeito visual.
  const [fechando, setFechando] = React.useState(false);
  const timeoutFechamentoRef = React.useRef<number | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const fechar = React.useCallback(() => {
    const reduzMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduzMovimento) {
      onCloseRef.current();
      return;
    }
    setFechando(true);
    timeoutFechamentoRef.current = window.setTimeout(() => {
      onCloseRef.current();
    }, 220);
  }, []);
  React.useEffect(() => {
    return () => {
      if (timeoutFechamentoRef.current) window.clearTimeout(timeoutFechamentoRef.current);
    };
  }, []);

  // Achado de auditoria (06/07/2026): Esc não fechava nenhum modal do
  // sistema — comportamento padrão que qualquer usuário de teclado espera,
  // e ausente aqui.
  React.useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") fechar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [fechar]);

  // Achado de auditoria (08/07/2026, Etapa 6 — Acessibilidade): o modal não
  // tinha `role="dialog"`/`aria-modal` (leitor de tela não anunciava como
  // diálogo) e, mais grave, não movia o foco pra dentro ao abrir nem devolvia
  // pro elemento que abriu ao fechar — quem navega por teclado abria um modal
  // e continuava com o foco "preso" atrás dele, na página. `tituloId` associa
  // o título ao diálogo via aria-labelledby; o container recebe o foco no
  // mount (tabIndex={-1} pra ser focável via script sem entrar na ordem de
  // Tab) e o elemento anterior é restaurado no unmount.
  const tituloId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const elementoAnterior = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => {
      elementoAnterior?.focus?.();
    };
  }, []);

  // Achado (Fase B, 09/07/2026, durante o teste ponta a ponta da Central de
  // Notificações): todo Modal aberto de dentro do cabeçalho (o <header>
  // fixo no topo da AppShell/Portal, que usa `backdrop-blur-sm`) renderizava
  // encolhido dentro da própria caixinha do cabeçalho em vez de cobrir a
  // tela inteira — MenuUsuario já sofria disso, só nunca tinha sido notado
  // porque nenhum teste visual (screenshot real de navegador) tinha sido
  // feito nele antes de hoje. Causa: `backdrop-filter` (a propriedade por
  // trás de `backdrop-blur-*`) cria, pela spec de CSS, um "containing
  // block" novo pra qualquer descendente `position: fixed` — o `inset-0`
  // do Modal parava de valer "tela inteira" e passava a valer "caixinha do
  // header", que é bem menor. `createPortal` tira o Modal inteiro da árvore
  // do DOM de onde foi chamado e o desenha direto em `document.body`,
  // fora do alcance de qualquer `backdrop-blur`/`filter`/`transform` de
  // ancestral — a correção padrão da indústria pra esse problema, e
  // corrige de uma vez todo lugar que já usa (ou vier a usar) este mesmo
  // componente `Modal`, não só a Central de Notificações.
  //
  // Achado (09/07/2026, pedido do Vini: "quando eu clico em uma solicitação,
  // não consigo ver tudo, tenho que ficar diminuindo o tamanho da página" —
  // reproduzido em qualquer tela, não só Solicitações: Colaboradores,
  // Chamados etc., porque todas usam este mesmo `Modal`). Causa: a versão
  // anterior tinha `items-start sm:items-center` no container flex — a
  // partir de 640px de largura (a maioria dos monitores), o modal ficava
  // CENTRALIZADO verticalmente. Isso por si só é inofensivo, mas combinado
  // com `overflow-y-auto` no mesmo elemento é um bug conhecido do CSS
  // (flexbox/grid "centering cuts off overflow"): quando o conteúdo do
  // filho é mais alto que o container, metade do transbordamento fica
  // ACIMA do topo da viewport e metade ABAIXO — e o navegador só consegue
  // rolar até o meio do que ficou acima, deixando a parte de baixo
  // inacessível por scroll (exatamente o "MUDAR STATUS" cortado no rodapé
  // relatado). Diminuir o zoom "resolvia" só porque encolhe o modal até
  // caber inteiro na viewport, sem precisar rolar. Correção: manter o modal
  // sempre ancorado no topo (`items-start`, sem a variante `sm:items-center`)
  // — com `my-8` já dando a margem/respiro visual em telas grandes, e o
  // scroll do container (`overflow-y-auto`) volta a funcionar de ponta a
  // ponta porque não há mais conteúdo "escondido" acima do topo da viewport.
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center bg-slate-950/50 backdrop-blur-[2px] p-4 overflow-y-auto ${
        fechando
          ? "animate-[fadeOut_var(--motion-fast)_ease-out_forwards]"
          : "animate-[fadeIn_var(--motion-fast)_ease-out]"
      }`}
      onClick={(e) => { if (e.target === e.currentTarget) fechar(); }}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className={`bg-white dark:bg-slate-900 rounded-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} my-8 focus:outline-none ${
          fechando
            ? "animate-[modalOut_var(--motion-panel)_var(--motion-ease-out)_forwards]"
            : "animate-[modalIn_var(--motion-panel)_var(--motion-ease)]"
        }`}
        // 13/07/2026 (Fundação Visual — sistema de elevação): `shadow-2xl`
        // (utilitário do Tailwind) é uma sombra preta fixa — no tema
        // escuro, contra o overlay já escurecido atrás do modal
        // (`bg-slate-950/50`), praticamente não se percebia nenhuma sombra
        // separando o modal do fundo. `--elevation-3` (index.css) tem valor
        // próprio por tema, igual `CARD_SHADOW`/`CARD_SHADOW_HOVER` acima —
        // mais forte que os dois porque o modal precisa se destacar tanto
        // da página quanto do próprio overlay semitransparente.
        style={{ border: "1px solid " + COLORS.border, boxShadow: "var(--elevation-3)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h3 id={tituloId} className="text-lg" style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, color: COLORS.ink }}>
            {title}
          </h3>
          <button onClick={fechar} aria-label="Fechar" title="Fechar" className="text-gray-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800 rounded-lg p-1.5 transition-colors active:scale-90">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// Achado de auditoria (06/07/2026): cada tela que precisava mostrar "está
// carregando" reinventava o próprio texto estático (`<p>Carregando...</p>`),
// sem nenhum indicador visual de que algo está de fato em andamento — numa
// rede de celular lenta, um texto parado é indistinguível de uma tela travada.
// Este spinner substitui os textos estáticos espalhados pelo sistema.
export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingState({ text = "Carregando..." }: { text?: string }) {
  // Padronização de Animações (10/07/2026): este bloco costumava aparecer e
  // desaparecer sem nenhuma transição — some de uma vez pro conteúdo real
  // assim que a resposta chega, um corte perceptível quando a rede é rápida
  // o bastante pra piscar. `fadeIn` na entrada resolve o "pop"; a saída
  // continua instantânea de propósito (o próprio conteúdo carregado já
  // ocupa o lugar, não vale a pena replicar o padrão mirror-list dos toasts
  // só pra isso).
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-slate-400 py-10 animate-[fadeIn_var(--motion-fast)_ease-out]">
      <Spinner size={16} />
      <span>{text}</span>
    </div>
  );
}

// Achado (10/07/2026, Padronização de Animações — seção "Carregamento de
// Dados"): antes disto, o único estado de carregamento do sistema era um
// spinner + texto centralizado (`LoadingState`) — a tela ficava em branco e
// depois "pulava" pro layout final de uma vez, sem nenhuma pista visual de
// qual formato o conteúdo vai ter. Skeleton mostra a FORMA do conteúdo final
// (cartão, linha de lista) antes dele chegar, técnica padrão de apps SaaS
// modernos (Linear, Notion, GitHub) — percebido como mais rápido mesmo
// quando o tempo de carregamento real é idêntico. `Skeleton` é o bloco
// primitivo (usa a classe `.skeleton`/`@keyframes shimmer` de index.css);
// `SkeletonKPIGrid`/`SkeletonListaCartoes` são composições prontas pros dois
// formatos mais comuns do sistema (grade de indicadores do Dashboard, e a
// grade de cartões usada em Colaboradores/Equipamentos/Linhas/etc.).
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonKPIGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-900 rounded-[var(--radius-card)] border border-gray-100 dark:border-slate-700 p-4 flex items-center gap-3.5">
          <Skeleton className="w-12 h-12 rounded-2xl flex-shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-3 w-20 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonListaCartoes({ count = 6 }: { count?: number }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-4 space-y-2.5">
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-3 w-1/2 rounded" />
          <Skeleton className="h-3 w-2/3 rounded" />
        </div>
      ))}
    </div>
  );
}

// Accordion (Onda 1 do redesenho, 21/07/2026, pedido do Vini: "reduzir
// carga cognitiva... informações abertas devem virar cards retráteis").
// Estado (aberto/fechado) fica com quem usa — não é um componente com
// estado interno próprio — porque a Home e o Portal precisam decidir qual
// seção abre por padrão (ex: "Meus Chamados" já vem aberta, o resto não),
// e isso é decisão de cada tela, não do componente genérico. Anima por
// max-height (não display:none) pra reaproveitar os tokens de motion já
// existentes (--motion-panel) em vez de inventar uma transição nova.
export function Accordion({
  titulo, contador, aberto, onToggle, icon: Icon, defaultAberto: _defaultAberto, children,
}: {
  titulo: string;
  contador?: number;
  aberto: boolean;
  onToggle: () => void;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  defaultAberto?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] overflow-hidden mb-2.5"
      style={{ boxShadow: CARD_SHADOW }}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left ${FOCUS_RING_CLASS}`}
        aria-expanded={aberto}
      >
        <span className="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-slate-200">
          {Icon && <Icon size={15} className="text-gray-400 dark:text-slate-500" />}
          {titulo}
          {contador !== undefined && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400">
              {contador}
            </span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`text-gray-400 dark:text-slate-500 transition-transform duration-[var(--motion-panel)] ${aberto ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-[var(--motion-panel)] ease-[var(--motion-ease)]"
        style={{ gridTemplateRows: aberto ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3.5 border-t border-gray-100 dark:border-slate-800 pt-2.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Hook auxiliar pra controlar um grupo de Accordion por chave (ex: "chamados",
// "equipamentos"...) — evita repetir `useState<Record<string,bool>>` em toda
// tela que usa Accordion. `abertosPorPadrao` deixa a tela decidir quais
// seções já começam expandidas.
export function useAccordions(abertosPorPadrao: string[] = []) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>(
    () => Object.fromEntries(abertosPorPadrao.map((k) => [k, true]))
  );
  return {
    estaAberto: (chave: string) => !!abertos[chave],
    alternar: (chave: string) => setAbertos((prev) => ({ ...prev, [chave]: !prev[chave] })),
  };
}

export function EmptyState({ icon: Icon, text }: { icon: React.ComponentType<{ size?: number; className?: string }>; text: string }) {
  return (
    <div className="text-center py-14 text-gray-400 dark:text-slate-500">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
        <Icon size={26} className="opacity-50" />
      </div>
      <p className="text-sm">{text}</p>
    </div>
  );
}

// Paginação no cliente (Fase 2 — Estrutura e Navegação, 14/07/2026, tarefa
// #153): a auditoria de layout (relatório em claude/) achou 6 telas que
// buscam a lista inteira via fetchAllPages (ver comentário em api/util.ts —
// decisão deliberada, o volume atual não justifica trocar a estratégia de
// busca) e depois renderizam TUDO de uma vez, sem nenhum controle — Acessos,
// Movimentações, Histórico, Linhas, Mensagens e Colaboradores. Isso não
// muda a busca (continua trazendo tudo do servidor, pros KPIs/filtros no
// cliente continuarem funcionando), só corta a RENDERIZAÇÃO em fatias — é
// puramente uma melhoria de UI, sem chamada extra à API. Cada tela decide
// o próprio `porPagina` de acordo com o tamanho do card.
export function usePaginacaoCliente<T>(itens: T[], porPagina = 24) {
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));
  // Sem isso, trocar um filtro que reduz a lista podia deixar a pessoa
  // "presa" numa página que não existe mais (ex: estava na página 4 de uma
  // lista de 100, filtrou pra 10 itens que cabem numa página só).
  useEffect(() => {
    if (pagina > totalPaginas) setPagina(1);
  }, [totalPaginas, pagina]);
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  const itensPagina = itens.slice(inicio, inicio + porPagina);
  return {
    itensPagina,
    pagina: paginaSegura,
    totalPaginas,
    setPagina,
    total: itens.length,
    inicioExibicao: itens.length === 0 ? 0 : inicio + 1,
    fimExibicao: Math.min(inicio + porPagina, itens.length),
  };
}

export function Paginacao({
  pagina, totalPaginas, onChange, total, inicioExibicao, fimExibicao, itemLabel = "itens",
}: {
  pagina: number;
  totalPaginas: number;
  onChange: (p: number) => void;
  total: number;
  inicioExibicao: number;
  fimExibicao: number;
  itemLabel?: string;
}) {
  // Some sozinho quando tudo cabe numa página só — nenhuma tela ganha um
  // controle de paginação visível à toa com poucos registros (mesmo
  // critério do resto do sistema: nada aparece "por garantia").
  if (totalPaginas <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
      <p className="text-xs text-gray-400 dark:text-slate-500">
        {inicioExibicao}–{fimExibicao} de {total} {itemLabel}
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" onClick={() => onChange(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior">
          <ChevronLeft size={16} /> Anterior
        </Button>
        <span className="text-xs text-gray-500 dark:text-slate-400 px-1.5 tabular-nums">
          Página {pagina} de {totalPaginas}
        </span>
        <Button variant="ghost" onClick={() => onChange(pagina + 1)} disabled={pagina >= totalPaginas} aria-label="Próxima página">
          Próxima <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

// Menu de contexto / "kebab" (Fase 3 — Componentes Inteligentes, 14/07/2026,
// tarefa #164) — pra cards que hoje exigem abrir o item inteiro só pra achar
// uma ação secundária (ex: Equipamentos, que não tinha NENHUMA ação inline
// no card, diferente de Linhas/Movimentações/Histórico, que já usam botões
// diretos). Posicionamento é `absolute` relativo ao próprio botão (não
// portal): suficiente pro tamanho de menu usado aqui (poucos itens, cards
// numa grade), e evita reimplementar o cálculo de posição de viewport que o
// Modal precisa (esse sim cobre a tela inteira). Fecha ao clicar fora, ao
// pressionar Esc, ou depois de qualquer ação escolhida.
export function MenuAcoes({
  itens,
}: {
  itens: { label: string; onClick: () => void; destrutivo?: boolean; icon?: React.ComponentType<{ size?: number; className?: string }> }[];
}) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return (
    <div ref={containerRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label="Mais ações"
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="text-gray-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg p-1 -m-1 transition-colors"
      >
        <MoreVertical size={16} />
      </button>
      {aberto && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-20 min-w-[9rem] bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-control)] py-1.5 animate-[fadeIn_var(--motion-fast)_ease-out]"
          style={{ boxShadow: "var(--elevation-3)" }}
        >
          {itens.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              onClick={() => {
                setAberto(false);
                item.onClick();
              }}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors ${
                item.destrutivo ? "text-brand-700 dark:text-brand-400" : "text-slate-700 dark:text-slate-300"
              }`}
            >
              {item.icon && <item.icon size={13} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex-1 max-w-xs">
      <SearchIcon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Buscar..."}
        // Achado de auditoria (08/07/2026, Etapa 6 — Acessibilidade): usado
        // em ~10 páginas de listagem sem nenhum nome acessível além do
        // placeholder — que some ao digitar e não é um substituto válido de
        // `<label>`/aria-label pra leitor de tela. aria-label reaproveita o
        // mesmo texto do placeholder (ou o padrão "Buscar...") como nome.
        aria-label={placeholder || "Buscar..."}
        className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-[var(--radius-control)] text-sm text-slate-900 dark:text-slate-100 shadow-[var(--elevation-1)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] hover:border-gray-300 dark:hover:border-slate-500 focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600"
      />
    </div>
  );
}

// Botão "Exportar" padrão (10/07/2026, "Consulta Rápida" — pedido do Vini:
// puxar listas específicas, ex. corretores de uma unidade, sempre com os
// campos mais importantes) — mesmo botão em toda página de listagem que
// tiver exportação em CSV, pra manter posição/rótulo/ícone consistentes em
// vez de cada página inventar o seu. `quantidade` é opcional só pra dar
// feedback de quantos registros serão exportados (reflete o filtro atual da
// tela); com 0 registros o botão fica desabilitado — não faz sentido baixar
// um CSV vazio.
export function BotaoExportarCsv({ onClick, quantidade, label }: { onClick: () => void; quantidade?: number; label?: string }) {
  const semRegistros = quantidade === 0;
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={semRegistros}
      title={semRegistros ? "Nenhum registro para exportar com os filtros atuais" : "Exportar a lista filtrada em CSV"}
    >
      <Download size={16} /> {label || "Exportar"}
      {typeof quantidade === "number" && quantidade > 0 ? ` (${quantidade})` : ""}
    </Button>
  );
}

export function KPICard({
  label,
  value,
  icon: Icon,
  accent,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  const corAcento = accent || COLORS.ink;
  return (
    <Tag
      onClick={onClick}
      style={{ boxShadow: CARD_SHADOW }}
      // Redesign visual "Stripe Dashboard rico" (14/07/2026): raio subiu pra
      // --radius-card (16px, era 12px), e ganhou uma barra de acento no topo
      // (2px, cor do próprio ícone) — recurso clássico de dashboard "rico"
      // pra dar identidade de cor ao cartão inteiro sem pintar o fundo
      // inteiro (que ficaria pesado demais pra um KPI). `overflow-hidden`
      // é necessário pra a barra (posicionada via ::before, ver style abaixo)
      // respeitar o raio arredondado do cartão em vez de vazar nos cantos.
      className={`relative overflow-hidden bg-white dark:bg-slate-900 rounded-[var(--radius-card)] border border-gray-100 dark:border-slate-700 p-4 flex items-center gap-3.5 w-full text-left transition-all duration-[var(--motion-fast)] ${
        onClick ? "cursor-pointer hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-500 active:translate-y-0 active:scale-[0.99] active:duration-[var(--motion-instant)]" : ""
      }`}
      onMouseEnter={onClick ? (e) => (e.currentTarget.style.boxShadow = CARD_SHADOW_HOVER) : undefined}
      onMouseLeave={onClick ? (e) => (e.currentTarget.style.boxShadow = CARD_SHADOW) : undefined}
    >
      <span className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: corAcento }} aria-hidden="true" />
      {/* 10/07/2026 (tema escuro): antes usava `(accent || COLORS.ink) + "12"`,
          um hack que assumia `accent`/COLORS.ink sempre seria um hex de 6
          dígitos (concatenar "12" de alpha no final). Isso quebrou quando
          COLORS.* virou `var(--color-*)` — "var(--color-ink)12" não é uma
          cor válida, o `background` simplesmente some. `color-mix()` resolve
          qualquer cor válida (hex literal OU var()) sem esse pressuposto.
          14/07/2026: badge do ícone ganhou gradiente (12%→22% da cor de
          acento) em vez de tingimento plano — mesmo racional do gradiente
          nos botões, dá sensação de luz/profundidade em vez de cor chapada. */}
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${corAcento} 22%, transparent), color-mix(in srgb, ${corAcento} 10%, transparent))`, color: corAcento }}
      >
        <Icon size={21} />
      </div>
      <div className="min-w-0">
        <div className="text-[1.7rem] font-bold leading-tight tracking-tight" style={{ color: COLORS.ink, fontFamily: FONT_MONO }}>
          {value}
        </div>
        {/* Achado de auditoria (08/07/2026, Etapa 7 — Responsividade): `truncate`
            cortava o rótulo pra "C.." em telas de ~768-1024px (ver grid de 4
            colunas em Home.tsx, ainda estreito nesses breakpoints) — pior que
            deixar quebrar em 2 linhas, que continua legível sem perder a
            informação. */}
        <div className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide leading-snug">{label}</div>
      </div>
    </Tag>
  );
}

// `onItemClick` (Fase 4 — Dashboard interativo, 06/07/2026) é opcional: sem
// ele o gráfico continua puramente visual, como sempre foi. Quando passado,
// cada barra vira um alvo de clique próprio — parou de fazer sentido só ter
// o painel inteiro clicável levando pra lista genérica quando dá pra pular
// direto pro setor/status específico que a pessoa acabou de olhar no gráfico.
export function SimpleBarChart({
  data, labelKey, valueKey, color, onItemClick,
}: {
  data: any[]; labelKey: string; valueKey: string; color?: string; onItemClick?: (item: any, index: number) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div
          key={i}
          role={onItemClick ? "button" : undefined}
          tabIndex={onItemClick ? 0 : undefined}
          onClick={onItemClick ? (e) => { e.stopPropagation(); onItemClick(d, i); } : undefined}
          className={`flex items-center gap-2 text-xs -mx-1 px-1 py-0.5 rounded transition-colors duration-[var(--motion-fast)] ${onItemClick ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800" : ""}`}
        >
          <div className="w-24 truncate text-right text-slate-600 dark:text-slate-400">{d[labelKey]}</div>
          <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded h-4 overflow-hidden">
            {/* Achado (10/07/2026, Padronização de Animações — seção "Tabelas"):
                ao filtrar/reordenar, a barra pulava direto pro novo tamanho.
                `transition-[width]` anima a mudança em vez de saltar. */}
            <div className="h-full rounded transition-[width] duration-[var(--motion-page)] ease-out" style={{ width: `${(d[valueKey] / max) * 100}%`, background: color || COLORS.ink }} />
          </div>
          <div className="w-6 text-slate-500 dark:text-slate-400 font-mono">{d[valueKey]}</div>
        </div>
      ))}
      {data.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Sem dados.</p>}
    </div>
  );
}
export function SimplePieLegend({
  data, colors, onItemClick,
}: {
  data: { name: string; value: number; [key: string]: any }[];
  colors: string[];
  onItemClick?: (item: { name: string; value: number; [key: string]: any }, index: number) => void;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div
          key={i}
          role={onItemClick ? "button" : undefined}
          tabIndex={onItemClick ? 0 : undefined}
          onClick={onItemClick ? (e) => { e.stopPropagation(); onItemClick(d, i); } : undefined}
          className={`flex items-center gap-2 text-xs -mx-1 px-1 py-0.5 rounded transition-colors duration-[var(--motion-fast)] ${onItemClick ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800" : ""}`}
        >
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colors[i % colors.length] }} />
          <span className="flex-1 text-slate-600 dark:text-slate-400">{d.name}</span>
          <span className="font-mono text-slate-500 dark:text-slate-400">
            {d.value} ({Math.round((d.value / total) * 100)}%)
          </span>
        </div>
      ))}
      {data.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Sem dados.</p>}
    </div>
  );
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown; copiado: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null, copiado: false };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error, copiado: false };
  }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Sem Sentry.init() rodado (falta VITE_SENTRY_DSN no build), isto é um
    // no-op silencioso — não quebra nada pra quem não configurar.
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }
  // Achado de auditoria (06/07/2026): antes, o stack trace bruto (nomes de
  // arquivo, números de linha, jargão técnico em inglês) ficava exposto
  // direto na tela pro colaborador — assustador e inútil pra quem não é
  // desenvolvedor. Agora a tela mostra só uma mensagem amigável; o stack
  // continua disponível (pra quem for reportar o problema) atrás de um botão
  // "Copiar detalhes técnicos", igual ao suporte técnico faria.
  copiarDetalhes = () => {
    const err = this.state.error;
    const texto = String(err instanceof Error ? err.stack || err.message : err);
    navigator.clipboard
      ?.writeText(texto)
      .then(() => {
        this.setState({ copiado: true });
        setTimeout(() => this.setState({ copiado: false }), 2500);
      })
      .catch(() => {});
  };
  render() {
    if (this.state.error) {
      // 13/07/2026 (Fundação Visual — refazer componentes compartilhados com
      // os novos tokens): esta era a única tela do sistema inteiro com cores
      // 100% fixas (`#fef2f2`/`#991b1b`/branco) sem NENHUM caminho pro tema
      // escuro — nem `dark:` (o componente usa `style`, não `className`,
      // então nem poderia), nem `COLORS`/`var(--color-*)`. Resultado: se um
      // módulo quebrasse com o tema escuro ativo, a pessoa via um retângulo
      // rosa-claro/branco ofuscante no meio de uma interface inteira escura
      // — o oposto de "acalmar" alguém vendo uma tela de erro. Como o
      // componente só usa `style` (proposital: fica resiliente mesmo se
      // Tailwind falhar em compilar algo), a correção usa `var(--color-*)`
      // direto — resolve sozinho conforme a classe `dark` em <html>, sem
      // precisar de nenhuma lógica JS de tema aqui. `color-mix()` cria um
      // fundo com tingimento de vermelho da marca sobre o fundo do tema
      // atual (claro: rosa pálido; escuro: um vinho escuro sutil) em vez de
      // um tom sólido que só funcionaria num dos dois.
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "sans-serif",
            background: "color-mix(in srgb, var(--color-brass) 10%, var(--color-bg))",
            color: "var(--color-ink)",
            minHeight: "50vh",
          }}
        >
          <h2 style={{ fontWeight: 800, fontSize: 18, marginBottom: 8, color: "var(--color-brass)" }}>⚠ Ocorreu um erro neste módulo</h2>
          <p style={{ fontSize: 13, marginBottom: 16 }}>
            Algo deu errado ao carregar esta parte do sistema. Tente novamente — se o problema continuar, use o botão
            abaixo para copiar os detalhes técnicos e enviar ao suporte.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ padding: "8px 16px", background: "var(--color-brass)", color: "#fff", borderRadius: 6, border: "none", fontWeight: 600, cursor: "pointer" }}
            >
              Tentar novamente
            </button>
            <button
              onClick={this.copiarDetalhes}
              style={{
                padding: "8px 16px",
                background: "var(--color-surface)",
                color: "var(--color-brass)",
                borderRadius: 6,
                border: "1px solid var(--color-brass)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {this.state.copiado ? "Detalhes copiados!" : "Copiar detalhes técnicos"}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Achado A5 do checkup de sistema (já conhecido desde 10/07/2026, sem
// resolução até agora, 22/07/2026): o Kanban só dava pra mover um cartão de
// coluna arrastando (mouse/toque) ou abrindo o modal de detalhe e mudando o
// status lá dentro — não existia um jeito de mover direto pelo cartão
// focado via teclado. Tecla "M" (documentada no próprio botão, sempre
// visível — não é um atalho invisível que só quem já sabe descobre) abre um
// menu "Mover para..." com as colunas de destino válidas, navegável por
// seta e confirmável por Enter/clique. Escape fecha e devolve o foco pro
// botão que abriu.
function MenuMoverCartao({
  destinos,
  columnLabels,
  onEscolher,
  onFechar,
}: {
  destinos: string[];
  columnLabels: Record<string, string>;
  onEscolher: (destino: string) => void;
  onFechar: () => void;
}) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const primeiroItemRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    primeiroItemRef.current?.focus();
  }, []);

  React.useEffect(() => {
    function aoClicarFora(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onFechar();
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function navegar(e: React.KeyboardEvent, indiceAtual: number) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onFechar();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const proximo = e.key === "ArrowDown" ? (indiceAtual + 1) % destinos.length : (indiceAtual - 1 + destinos.length) % destinos.length;
      const botoes = menuRef.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]");
      botoes?.[proximo]?.focus();
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Mover cartão para outra coluna"
      className="absolute z-20 top-8 right-1 min-w-[10rem] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-[var(--radius-control)] shadow-[var(--elevation-2)] py-1"
      onKeyDown={(e) => e.stopPropagation()}
    >
      {destinos.map((destino, i) => (
        <button
          key={destino}
          ref={i === 0 ? primeiroItemRef : undefined}
          type="button"
          role="menuitem"
          onClick={(e) => { e.stopPropagation(); onEscolher(destino); }}
          onKeyDown={(e) => navegar(e, i)}
          className={`w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-950/40 focus-visible:bg-brand-50 dark:focus-visible:bg-brand-950/40 focus-visible:outline-none ${FOCUS_RING_CLASS}`}
        >
          {columnLabels[destino] || destino}
        </button>
      ))}
    </div>
  );
}

export function KanbanBoard<T extends { id: string }>({
  items,
  columns,
  columnLabels,
  statusField,
  onStatusChange,
  renderCard,
  // A5 — tabela de transições válidas por item, pra restringir o menu
  // "Mover para..." (teclado) às mesmas transições que cada módulo já
  // valida no arrastar-soltar (ex: TRANSICOES_SOLIC_PAPELARIA em
  // SolicitacoesPapelaria.tsx). Quando omitido, todas as outras colunas
  // viram destino válido — mesmo comportamento livre que o arrastar-soltar
  // sempre teve nos módulos sem tabela de transição (ex: Chamados/
  // Solicitação de Equipamento, que aceitam qualquer status via drag).
  transicoesValidas,
}: {
  items: T[];
  columns: string[];
  columnLabels: Record<string, string>;
  statusField: keyof T;
  onStatusChange: (id: string, status: string) => void;
  renderCard: (item: T) => React.ReactNode;
  transicoesValidas?: (item: T) => string[];
}) {
  const [dragId, setDragId] = React.useState<string | null>(null);
  // Achado (10/07/2026, Padronização de Animações): arrastar um cartão sobre
  // uma coluna não dava NENHUM sinal visual de "solte aqui" — só se sabia se
  // o drop tinha funcionado depois de soltar. `dragOverCol` destaca a coluna
  // sob o cursor durante o arraste, feedback padrão de qualquer Kanban
  // (Trello, Linear, GitHub Projects).
  const [dragOverCol, setDragOverCol] = React.useState<string | null>(null);
  // A5 — id do cartão com o menu "Mover para..." aberto (null = nenhum).
  const [menuMoverId, setMenuMoverId] = React.useState<string | null>(null);
  const botoesMoverRef = React.useRef<Record<string, HTMLButtonElement | null>>({});

  function fecharMenuMover(idParaFoco?: string) {
    setMenuMoverId(null);
    if (idParaFoco) botoesMoverRef.current[idParaFoco]?.focus();
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
      {columns.map((col) => {
        const colItems = items.filter((i) => i[statusField] === col);
        return (
          <div
            key={col}
            onDragOver={(e) => { e.preventDefault(); if (dragOverCol !== col) setDragOverCol(col); }}
            onDragLeave={() => setDragOverCol((atual) => (atual === col ? null : atual))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) onStatusChange(dragId, col);
              setDragId(null);
              setDragOverCol(null);
            }}
            className={`flex-shrink-0 w-64 rounded-[var(--radius-card)] p-2 border transition-colors duration-[var(--motion-fast)] ${
              dragOverCol === col
                ? "bg-brand-50 dark:bg-brand-950/30 border-brand-400 dark:border-brand-700"
                : "bg-gray-100/70 dark:bg-slate-800/70 border-gray-300 dark:border-slate-600"
            }`}
          >
            <div className="font-semibold text-xs uppercase tracking-wide mb-2 flex items-center justify-between text-slate-700 dark:text-slate-300 px-1">
              <span>{columnLabels[col] || col}</span>
              <span className="text-gray-400 dark:text-slate-500">{colItems.length}</span>
            </div>
            <div className="space-y-2 min-h-16">
              {colItems.map((item) => {
                const colunaAtual = String(item[statusField]);
                const destinos = (transicoesValidas ? transicoesValidas(item) : columns).filter((c) => c !== colunaAtual);
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={() => { setDragId(null); setDragOverCol(null); }}
                    onKeyDown={(e) => {
                      // A5 — tecla M abre "Mover para...", com o cartão (ou
                      // qualquer elemento focável dentro dele, ex: o próprio
                      // botão do menu) em foco. Não usa Enter/Espaço aqui —
                      // esses já são o atalho de abrir o detalhe do cartão
                      // (ver cardClicavelProps), reaproveitado por
                      // renderCard em cada tela.
                      if ((e.key === "m" || e.key === "M") && destinos.length > 0 && menuMoverId !== item.id) {
                        e.preventDefault();
                        setMenuMoverId(item.id);
                      }
                    }}
                    className="relative group cursor-move transition-[opacity,transform] duration-[var(--motion-fast)] hover:-translate-y-0.5 active:opacity-50"
                  >
                    {renderCard(item)}
                    {destinos.length > 0 && (
                      <button
                        ref={(el) => { botoesMoverRef.current[item.id] = el; }}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setMenuMoverId((atual) => (atual === item.id ? null : item.id)); }}
                        title="Mover para outra coluna (tecla M)"
                        aria-label="Mover cartão para outra coluna"
                        aria-haspopup="menu"
                        aria-expanded={menuMoverId === item.id}
                        className={`absolute top-1 right-1 p-1 rounded bg-white/90 dark:bg-slate-900/90 text-gray-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 focus-visible:opacity-100 ${FOCUS_RING_CLASS} ${
                          menuMoverId === item.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <ArrowLeftRight size={12} />
                      </button>
                    )}
                    {menuMoverId === item.id && (
                      <MenuMoverCartao
                        destinos={destinos}
                        columnLabels={columnLabels}
                        onEscolher={(destino) => { onStatusChange(item.id, destino); fecharMenuMover(item.id); }}
                        onFechar={() => fecharMenuMover(item.id)}
                      />
                    )}
                  </div>
                );
              })}
              {colItems.length === 0 && <div className="text-xs text-gray-500 dark:text-slate-500 italic px-1 py-2">Arraste um cartão aqui</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
