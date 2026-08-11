import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buscaApi } from "../api/busca";
import { ResultadoBusca, TipoResultadoBusca } from "../types";
import { COLORS, FOCUS_RING_CLASS, Spinner } from "./ui";
import { Key, Laptop, Package, Search, ShoppingCart, Sparkles, Users, Wrench, X } from "./icons";

// Busca Global — Ctrl+K/Cmd+K (Onda 2.1 do redesign, 21/07/2026, pedido do
// Vini: "estilo Notion/Linear"). Ver seção 2.4 da auditoria
// (`claude/Auditoria_Redesign_Portal_Corporativo_21-07-2026.md`) — não
// existia nenhuma busca cross-módulo antes disso.
//
// Decisão de não reaproveitar <Modal>: o resto do sistema reaproveita
// <Modal> pra tudo que é diálogo (ver comentário no topo de
// CentralNotificacoes.tsx) exatamente pra não duplicar a lógica de
// Esc/clique-fora/foco preso já auditada — mas <Modal> tem um cabeçalho de
// título fixo, e uma paleta de comando precisa do campo de busca ANCORADO
// no topo, com foco automático, resultado ao vivo por baixo e navegação por
// seta — um formato genuinamente diferente. Em vez de forçar esse encaixe,
// este componente reimplementa só o essencial (Esc fecha, clique fora
// fecha, foco preso, `createPortal` pra escapar de qualquer
// `backdrop-blur`/`transform` de ancestral — mesma causa-raiz documentada
// no Modal), com o layout próprio que a paleta de comando exige.

const ICONE_POR_TIPO: Record<TipoResultadoBusca, React.ComponentType<{ size?: number; className?: string }>> = {
  colaborador: Users,
  equipamento: Laptop,
  chamado: Wrench,
  sol_equipamento: ShoppingCart,
  sol_papelaria: Package,
  sol_servico: Sparkles,
  sistema_acesso: Key,
};

const LABEL_POR_TIPO: Record<TipoResultadoBusca, string> = {
  colaborador: "Colaborador",
  equipamento: "Equipamento",
  chamado: "Chamado",
  sol_equipamento: "Solicitação",
  sol_papelaria: "Papelaria",
  sol_servico: "Serviço",
  sistema_acesso: "Sistema",
};

// Mesmo limiar de 2 caracteres aplicado no backend (ver busca.routes.ts) —
// evita disparar uma busca (e mostrar "nenhum resultado" por um instante)
// a cada tecla antes de haver texto suficiente pra valer a pena.
const TAMANHO_MINIMO_BUSCA = 2;
const ATRASO_DEBOUNCE_MS = 220;

interface Props {
  onFechar: () => void;
  onNavegar: (moduloKey: string, payload: Record<string, unknown>) => void;
}

export function ComandoPaleta({ onFechar, onNavegar }: Props) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Guarda contra resposta desatualizada chegando depois de uma mais nova
  // (rede não garante ordem de chegada) — sem AbortController disponível no
  // `apiRequest` compartilhado, um contador de requisição resolve o mesmo
  // problema de forma simples: só a resposta da ÚLTIMA busca disparada é
  // aplicada ao estado.
  const requisicaoAtualRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const termoLimpo = termo.trim();
    if (termoLimpo.length < TAMANHO_MINIMO_BUSCA) {
      setResultados([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const minhaRequisicao = ++requisicaoAtualRef.current;
    const t = window.setTimeout(() => {
      buscaApi
        .buscar(termoLimpo)
        .then((r) => {
          if (requisicaoAtualRef.current !== minhaRequisicao) return; // resposta velha, ignora
          setResultados(r.resultados);
          setIndiceAtivo(0);
        })
        .catch(() => {
          if (requisicaoAtualRef.current !== minhaRequisicao) return;
          setResultados([]);
        })
        .finally(() => {
          if (requisicaoAtualRef.current === minhaRequisicao) setCarregando(false);
        });
    }, ATRASO_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [termo]);

  function selecionar(r: ResultadoBusca) {
    onNavegar(r.moduloKey, r.payload);
    onFechar();
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onFechar();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndiceAtivo((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndiceAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const escolhido = resultados[indiceAtivo];
      if (escolhido) selecionar(escolhido);
    }
  }

  const semResultado = !carregando && termo.trim().length >= TAMANHO_MINIMO_BUSCA && resultados.length === 0;
  const abaixoDoMinimo = termo.trim().length < TAMANHO_MINIMO_BUSCA;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/50 backdrop-blur-[2px] p-4 pt-[12vh] animate-[fadeIn_var(--motion-fast)_ease-out]"
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Busca global"
    >
      <div
        ref={containerRef}
        className="w-full max-w-[560px] bg-white dark:bg-slate-900 rounded-[var(--radius-card)] shadow-[var(--elevation-3)] overflow-hidden animate-[modalIn_var(--motion-panel)_var(--motion-ease)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 dark:border-slate-700">
          <Search size={18} className="text-gray-400 dark:text-slate-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={aoTeclar}
            placeholder="Buscar colaboradores, equipamentos, chamados, solicitações..."
            className={`flex-1 bg-transparent border-none outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 ${FOCUS_RING_CLASS}`}
            aria-label="Buscar"
            aria-autocomplete="list"
          />
          {carregando && <Spinner size={14} />}
          <button
            onClick={onFechar}
            aria-label="Fechar busca"
            className={`text-gray-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 flex-shrink-0 ${FOCUS_RING_CLASS} rounded`}
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[min(60vh,420px)] overflow-y-auto py-1.5">
          {abaixoDoMinimo ? (
            <p className="text-xs text-gray-500 dark:text-slate-400 text-center py-8 px-4">
              Digite pelo menos {TAMANHO_MINIMO_BUSCA} letras para buscar em todo o sistema.
            </p>
          ) : semResultado ? (
            <p className="text-xs text-gray-500 dark:text-slate-400 text-center py-8 px-4">
              Nada encontrado para "{termo.trim()}".
            </p>
          ) : (
            resultados.map((r, i) => {
              const Icone = ICONE_POR_TIPO[r.tipo];
              return (
                <button
                  key={`${r.tipo}-${r.id}`}
                  onClick={() => selecionar(r)}
                  onMouseEnter={() => setIndiceAtivo(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-[var(--motion-fast)] ${
                    i === indiceAtivo ? "bg-brand-50 dark:bg-brand-500/15" : "hover:bg-gray-50 dark:hover:bg-slate-800"
                  }`}
                >
                  <span
                    className="flex-shrink-0 w-8 h-8 rounded-[var(--radius-control)] flex items-center justify-center"
                    style={{ background: COLORS.surfaceAlt, color: COLORS.inkSoft }}
                  >
                    <Icone size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{r.titulo}</span>
                    {r.subtitulo && <span className="block text-xs text-gray-500 dark:text-slate-400 truncate">{r.subtitulo}</span>}
                  </span>
                  <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                    {LABEL_POR_TIPO[r.tipo]}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-100 dark:border-slate-700 text-[10px] text-gray-400 dark:text-slate-500">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>Esc fechar</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
