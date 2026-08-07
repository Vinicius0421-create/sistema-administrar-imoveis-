import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PassoTour } from "../ajuda/tours";
import { Button } from "./ui";
import { X } from "./icons";

// Item 4 da missão "Melhorias Adicionais" (08/07/2026) — motor genérico do
// tour guiado: recebe uma lista de passos (seletor CSS + texto) e desenha
// um "spotlight" (destaque recortado do restante escurecido da tela) sobre
// o elemento real de cada passo, com um balão de explicação ao lado.
//
// Decisão de arquitetura: nenhuma biblioteca de tour de terceiros (ex:
// react-joyride) foi adicionada — a necessidade aqui é simples o bastante
// (poucos passos, sem ramificação) pra não justificar mais uma dependência
// externa nova só pra isso; o efeito de "recorte" é só CSS
// (`box-shadow: 0 0 0 9999px`), sem nenhum truque frágil de z-index múltiplo.
//
// Progresso ("já vi o tour") é guardado em localStorage — apropriado aqui
// porque este é um app web real publicado (Vite/Vercel), não um Artifact
// do claude.ai (a restrição de localStorage do ambiente de Artifacts não
// se aplica a este projeto).
const LS_PREFIX = "administrar_imoveis_tour_concluido_";

export function tourJaVisto(chave: string): boolean {
  try {
    return localStorage.getItem(LS_PREFIX + chave) === "1";
  } catch {
    return false; // Storage bloqueado (modo privado restritivo etc.) — trata como "nunca visto", só reaparece com mais frequência do que o ideal, sem quebrar nada.
  }
}

export function marcarTourVisto(chave: string) {
  try {
    localStorage.setItem(LS_PREFIX + chave, "1");
  } catch {
    /* ignorado de propósito — ver tourJaVisto */
  }
}

interface Props {
  chave: string;
  passos: PassoTour[];
  onFechar: () => void;
}

export function TourGuiado({ chave, passos, onFechar }: Props) {
  const [indice, setIndice] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const passo = passos[indice];
    if (!passo) {
      finalizar();
      return;
    }
    const el = document.querySelector(passo.seletor) as HTMLElement | null;
    if (!el) {
      // Elemento não existe nesta tela/papel (ex: item de navegação que este
      // papel não tem) — pula direto pro próximo passo em vez de travar o
      // tour num destaque vazio.
      if (indice < passos.length - 1) {
        setIndice((i) => i + 1);
      } else {
        finalizar();
      }
      return;
    }

    let cancelado = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });

    function medir() {
      if (cancelado || !el) return;
      setRect(el.getBoundingClientRect());
    }
    // Pequeno atraso pro scroll suave assentar antes de medir a posição final.
    const t = window.setTimeout(medir, 280);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      cancelado = true;
      window.clearTimeout(t);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice]);

  // Acha onde o balão cabe INTEIRO na tela, medindo a altura/largura reais
  // já renderizadas (`tooltipRef`) em vez de estimar — a versão anterior
  // decidia "acima ou abaixo" só com base numa altura presumida (200px) e
  // depois calculava a posição a partir da altura do elemento em destaque,
  // o que quebrava pra elementos muito altos (ex: a navegação lateral
  // inteira): o balão acabava posicionado abaixo do fim da própria
  // viewport, sem nenhum jeito de rolar até ele (é `position: fixed`).
  // `useLayoutEffect` roda antes do navegador pintar a tela — a correção
  // de posição (que só é possível depois de medir o balão já montado) não
  // chega a aparecer como um "pulo" visual pro usuário.
  useLayoutEffect(() => {
    if (!rect || !tooltipRef.current) {
      setPosicao(null);
      return;
    }
    const alturaTooltip = tooltipRef.current.offsetHeight;
    const larguraTooltip = tooltipRef.current.offsetWidth;
    const MARGEM = 12;
    const espacoAbaixo = window.innerHeight - (rect.bottom + MARGEM);
    const espacoAcima = rect.top - MARGEM;
    const cabeAbaixo = espacoAbaixo >= alturaTooltip;
    const cabeAcima = espacoAcima >= alturaTooltip;
    let top: number;
    if (cabeAbaixo || !cabeAcima) {
      top = rect.bottom + MARGEM;
    } else {
      top = rect.top - MARGEM - alturaTooltip;
    }
    // Trava final: mesmo se nem acima nem abaixo "coubesse de sobra" (ex:
    // elemento em destaque ocupa quase a tela toda), o balão nunca fica
    // com nenhuma parte fora da viewport.
    top = Math.min(Math.max(MARGEM, top), Math.max(MARGEM, window.innerHeight - alturaTooltip - MARGEM));
    const left = Math.min(Math.max(MARGEM, rect.left), Math.max(MARGEM, window.innerWidth - larguraTooltip - MARGEM));
    setPosicao({ top, left });
  }, [rect]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") finalizar();
      if (e.key === "ArrowRight") proximo();
      if (e.key === "ArrowLeft") anterior();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice]);

  function finalizar() {
    marcarTourVisto(chave);
    onFechar();
  }

  function proximo() {
    if (indice < passos.length - 1) {
      setRect(null);
      setIndice((i) => i + 1);
    } else {
      finalizar();
    }
  }

  function anterior() {
    if (indice > 0) {
      setRect(null);
      setIndice((i) => i - 1);
    }
  }

  if (!rect) return null; // aguardando medir o elemento do passo atual (ou já pulou pro próximo)

  const passo = passos[indice];
  const PAD = 8;
  const box = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Tour guiado">
      {/* Camada escurecida com "recorte" no elemento em destaque — feito só
          com box-shadow (sem múltiplas divs de máscara), então o próprio
          box abaixo cobre a tela inteira ao redor de si mesmo. */}
      <div
        className="absolute rounded-[var(--radius-card)] transition-all duration-[var(--motion-page)] ease-out pointer-events-none"
        style={{
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          // Auditoria de padronização (Onda 1.7, 21/07/2026): scrim e outline
          // seguem sendo `rgba()` cru de propósito — são cor fixa (escurecer
          // a tela por trás do spotlight, contornar o elemento em destaque
          // com branco), não uma superfície de UI que precise trocar de tom
          // no dark mode; o restante do componente (texto, fundo do balão) é
          // que precisava dos tokens claro/escuro e foi corrigido abaixo.
          boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.68)",
          outline: "2px solid rgba(255,255,255,0.9)",
        }}
      />
      {/* Captura cliques fora do balão pra impedir interação com o resto da
          tela enquanto o tour está ativo (evita, por exemplo, trocar de
          módulo no meio da explicação e o destaque apontar pro lugar
          errado). O próprio balão fica acima, com pointer-events próprio. */}
      <div className="absolute inset-0" onClick={finalizar} />

      <div
        ref={tooltipRef}
        className="absolute w-[320px] max-w-[calc(100vw-24px)] bg-white dark:bg-slate-900 rounded-[var(--radius-card)] shadow-[var(--elevation-3)] p-4"
        style={{
          top: posicao?.top ?? -9999,
          left: posicao?.left ?? -9999,
          opacity: posicao ? 1 : 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{passo.titulo}</h4>
          <button onClick={finalizar} aria-label="Fechar tour" className="text-gray-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 flex-shrink-0 -mt-0.5 -mr-0.5">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{passo.texto}</p>
        <div className="flex items-center justify-between mt-3.5">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">{indice + 1} de {passos.length}</span>
          <div className="flex gap-1.5">
            {indice > 0 && (
              <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={anterior}>Voltar</Button>
            )}
            <Button variant="accent" className="!px-3 !py-1.5 text-xs" onClick={proximo}>
              {indice < passos.length - 1 ? "Próximo" : "Concluir"}
            </Button>
          </div>
        </div>
        <button onClick={finalizar} className="text-[11px] text-gray-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:underline mt-2">
          Pular tutorial
        </button>
      </div>
    </div>
  );
}
