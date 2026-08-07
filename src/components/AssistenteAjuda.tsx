import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ArtigoAjuda, artigosParaPapel } from "../ajuda/conteudo";
import { ResultadoBusca, responderPergunta } from "../ajuda/busca";
import { ArtigoDetalhe } from "./CentralAjuda";
import { Modal } from "./ui";
import { ChevronRight, MessageCircle, Send, X } from "./icons";

// Assistente de Ajuda (17/07/2026, pedido do Vini: "gostei da ideia de um
// assistente de IA"). Depois de ver os custos reais de um assistente que
// chama a API da Anthropic por mensagem, ele escolheu explicitamente a
// versão sem custo: um widget flutuante que "conversa" só na aparência —
// por baixo, é busca por palavra-chave sobre o mesmo conteúdo já cadastrado
// em src/ajuda/conteudo.ts (o motor fica em ajuda/busca.ts). Nenhuma chamada
// de rede além do que o próprio sistema já faz, nenhum custo por uso,
// nenhum dado sai do navegador da pessoa.
//
// Importante NÃO prometer mais do que isso entrega: o subtítulo do painel
// deixa claro que é busca automática, não um modelo de linguagem — evita a
// pessoa achar que pode "conversar" livremente ou pedir pro assistente
// fazer alguma ação (ele nunca executa nada, só indica onde olhar).
//
// Reaproveita o mesmo filtro por papel da Central de Ajuda (artigosParaPapel)
// e a mesma renderização de artigo completo (ArtigoDetalhe, exportado de
// CentralAjuda.tsx) — nenhuma duplicação de "quem vê o quê" nem de como um
// artigo é desenhado.

type Mensagem =
  | { id: number; autor: "usuario"; texto: string }
  | { id: number; autor: "assistente"; tipo: "saudacao" | "sem-resultado"; texto: string }
  | { id: number; autor: "assistente"; tipo: "resposta"; principal: ResultadoBusca; relacionados: ResultadoBusca[] };

const SAUDACAO =
  "Oi! Eu só busco palavra-chave no conteúdo da Central de Ajuda (não sou uma IA de verdade, então não converso livremente nem faço nada por você) — mas costumo achar a resposta rápido. Pergunte algo como \"como troco minha senha\" ou \"como abro um chamado\".";

const SEM_RESULTADO =
  "Não achei nada específico sobre isso na Central de Ajuda ainda. Tenta reformular com outras palavras, ou abre a Central de Ajuda completa pra navegar por categoria — e se for algo técnico, um chamado de manutenção também resolve.";

// Sugestões iniciais (17/07/2026) — pega até 4 perguntas de FAQ já
// cadastradas entre os artigos que o papel logado enxerga, priorizando
// "Conta e Acesso" (relevante pra qualquer pessoa, de qualquer papel).
// Dinâmico de propósito: nunca sugere uma pergunta de um artigo que o
// usuário não teria permissão de ver.
function sugestoesIniciais(artigos: ArtigoAjuda[]): string[] {
  // Comparador precisa ser antissimétrico (sort(a,b) e sort(b,a) com sinais
  // opostos) — a versão original retornava -1 pra qualquer par onde os dois
  // fossem "Conta e Acesso", o que violava esse contrato e deixava a ordem
  // entre os artigos dessa categoria imprevisível de um build pro outro.
  const peso = (a: ArtigoAjuda) => (a.categoria === "Conta e Acesso" ? 0 : 1);
  const ordenados = [...artigos].sort((a, b) => peso(a) - peso(b));
  const perguntas: string[] = [];
  for (const a of ordenados) {
    for (const f of a.faq ?? []) {
      if (perguntas.length >= 4) break;
      perguntas.push(f.pergunta);
    }
    if (perguntas.length >= 4) break;
  }
  return perguntas;
}

function CartaoResultado({ resultado, onAbrir }: { resultado: ResultadoBusca; onAbrir: (a: ArtigoAjuda) => void }) {
  const { artigo, faqDestaque } = resultado;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm">
      <p className="text-slate-700 dark:text-slate-300">
        {faqDestaque ? faqDestaque.resposta : artigo.resumo}
      </p>
      {!faqDestaque && artigo.passoAPasso.length > 0 && (
        <ol className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
          {artigo.passoAPasso.slice(0, 2).map((p, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="flex-shrink-0">{i + 1}.</span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      )}
      <button
        onClick={() => onAbrir(artigo)}
        className="mt-2 text-xs font-semibold text-brand-700 dark:text-brand-400 hover:underline flex items-center gap-0.5"
      >
        Ver artigo completo "{artigo.titulo}" <ChevronRight size={12} />
      </button>
    </div>
  );
}

export function AssistenteAjuda() {
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [artigoAberto, setArtigoAberto] = useState<ArtigoAjuda | null>(null);
  const proximoId = useRef(1);
  const fimDaListaRef = useRef<HTMLDivElement>(null);

  const papel = user?.papel;
  const artigos = useMemo(() => (papel ? artigosParaPapel(papel) : []), [papel]);
  const sugestoes = useMemo(() => sugestoesIniciais(artigos), [artigos]);

  useEffect(() => {
    fimDaListaRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, aberto]);

  if (!user) return null;

  function perguntar(pergunta: string) {
    const limpo = pergunta.trim();
    if (!limpo) return;
    const idUsuario = proximoId.current++;
    const resultados = responderPergunta(limpo, artigos);
    const idResposta = proximoId.current++;
    const respostaMsg: Mensagem =
      resultados.length === 0
        ? { id: idResposta, autor: "assistente", tipo: "sem-resultado", texto: SEM_RESULTADO }
        : { id: idResposta, autor: "assistente", tipo: "resposta", principal: resultados[0], relacionados: resultados.slice(1, 4) };
    setMensagens((prev) => [...prev, { id: idUsuario, autor: "usuario", texto: limpo }, respostaMsg]);
    setTexto("");
  }

  function abrirWidget() {
    setAberto(true);
    if (mensagens.length === 0) {
      setMensagens([{ id: proximoId.current++, autor: "assistente", tipo: "saudacao", texto: SAUDACAO }]);
    }
  }

  return (
    <>
      {aberto && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Assistente de Ajuda"
          className="fixed bottom-24 right-4 sm:right-6 z-40 w-[calc(100%-2rem)] max-w-sm h-[28rem] max-h-[70vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-3)] flex flex-col overflow-hidden animate-[fadeIn_var(--motion-fast)_ease-out]"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Assistente de Ajuda</h4>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate">Busca automática na Central de Ajuda — sem IA, sem custo</p>
            </div>
            <button
              onClick={() => setAberto(false)}
              aria-label="Fechar assistente"
              className="flex-shrink-0 text-gray-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {mensagens.map((m) => {
              if (m.autor === "usuario") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm rounded-2xl rounded-br-sm px-3.5 py-2">
                      {m.texto}
                    </div>
                  </div>
                );
              }
              if (m.tipo === "resposta") {
                return (
                  <div key={m.id} className="space-y-1.5">
                    <CartaoResultado resultado={m.principal} onAbrir={setArtigoAberto} />
                    {m.relacionados.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pl-1">
                        {m.relacionados.map((r) => (
                          <button
                            key={r.artigo.id}
                            onClick={() => setArtigoAberto(r.artigo)}
                            className="text-[11px] px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                          >
                            {r.artigo.titulo}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div key={m.id} className="max-w-[90%] bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                  {m.texto}
                </div>
              );
            })}

            {mensagens.length <= 1 && sugestoes.length > 0 && (
              <div className="pt-1 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">Perguntas comuns</p>
                <div className="flex flex-wrap gap-1.5">
                  {sugestoes.map((s) => (
                    <button
                      key={s}
                      onClick={() => perguntar(s)}
                      className="text-xs px-2.5 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={fimDaListaRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              perguntar(texto);
            }}
            className="flex items-center gap-2 px-3 py-2.5 border-t border-slate-100 dark:border-slate-700 flex-shrink-0"
          >
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Digite sua dúvida..."
              aria-label="Digite sua dúvida"
              className="flex-1 min-w-0 px-3 py-2 rounded-full border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-4 focus:ring-brand-600/20 focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={!texto.trim()}
              aria-label="Enviar pergunta"
              className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-b from-brand-500 to-brand-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:from-brand-500 hover:to-brand-700 transition-colors"
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => (aberto ? setAberto(false) : abrirWidget())}
        aria-label={aberto ? "Fechar assistente de ajuda" : "Abrir assistente de ajuda"}
        title="Assistente de Ajuda"
        className="fixed bottom-4 right-4 sm:right-6 z-40 w-12 h-12 rounded-full bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[0_1px_2px_rgba(237,2,11,0.35),0_8px_18px_-4px_rgba(237,2,11,0.45)] hover:from-brand-500 hover:to-brand-700 flex items-center justify-center transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30"
      >
        {aberto ? <X size={20} /> : <MessageCircle size={20} />}
      </button>

      {artigoAberto && (
        <Modal title="Central de Ajuda" onClose={() => setArtigoAberto(null)} wide>
          <ArtigoDetalhe artigo={artigoAberto} onVoltar={() => setArtigoAberto(null)} textoVoltar="Voltar para o assistente" />
        </Modal>
      )}
    </>
  );
}
