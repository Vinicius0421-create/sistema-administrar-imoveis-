import React, { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ArtigoAjuda, artigosParaPapel, categoriasParaPapel } from "../ajuda/conteudo";
import { normalizar } from "../ajuda/busca";
import { Modal } from "./ui";
import { ChevronRight, HelpCircle, Search, X } from "./icons";

// Item 4 da missão "Melhorias Adicionais" (08/07/2026, pedido do Vini) —
// Central de Ajuda: busca por assunto, categorias, FAQ, guias completos por
// módulo. Todo o conteúdo vem de src/ajuda/conteudo.ts, já filtrado pelos
// papéis que enxergam cada artigo — este componente só decide COMO mostrar,
// nunca duplica a regra de "quem vê o quê" (isso vive só em conteudo.ts).
//
// Estrutura de navegação: lista (com busca + categorias) → artigo aberto.
// Sem router (ver comentário em App.tsx sobre este app ser SPA de tela
// única) — a navegação interna do modal é só estado local, resetado ao
// fechar, igual ao padrão já usado em MenuUsuario.tsx.
//
// `normalizar` mora em ajuda/busca.ts (17/07/2026, Assistente de Ajuda) —
// tanto esta busca simples quanto o motor de pontuação do Assistente
// precisam do mesmo tratamento de acento/maiúscula, então ficou num só
// lugar em vez de duplicada aqui e lá.

function artigoBateComBusca(artigo: ArtigoAjuda, termoNormalizado: string): boolean {
  if (!termoNormalizado) return true;
  const campos = [
    artigo.titulo,
    artigo.resumo,
    artigo.objetivo,
    artigo.quandoUsar,
    ...artigo.passoAPasso,
    ...(artigo.faq?.flatMap((f) => [f.pergunta, f.resposta]) ?? []),
    ...(artigo.errosComuns ?? []),
    ...(artigo.boasPraticas ?? []),
  ];
  return campos.some((c) => normalizar(c).includes(termoNormalizado));
}

// Exportado (17/07/2026, Assistente de Ajuda) — o novo widget flutuante
// reaproveita esta mesma renderização de artigo completo pro botão "Ver
// artigo completo" dentro do chat, em vez de duplicar a montagem do detalhe.
export function ArtigoDetalhe({
  artigo, onVoltar, textoVoltar = "Voltar para a lista",
}: { artigo: ArtigoAjuda; onVoltar: () => void; textoVoltar?: string }) {
  return (
    <div>
      <button onClick={onVoltar} className="text-xs text-brand-700 dark:text-brand-400 hover:underline flex items-center gap-1 mb-3">
        ← {textoVoltar}
      </button>
      <h3 className="text-lg font-bold text-slate-900 mb-1">{artigo.titulo}</h3>
      <p className="text-xs text-gray-400 mb-4">Atualizado em {new Date(artigo.atualizadoEm + "T00:00:00").toLocaleDateString("pt-BR")}</p>

      <div className="space-y-5 text-sm">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Objetivo</h4>
          <p className="text-slate-700">{artigo.objetivo}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Quando usar</h4>
          <p className="text-slate-700">{artigo.quandoUsar}</p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Passo a passo</h4>
          <ol className="space-y-1.5">
            {artigo.passoAPasso.map((passo, i) => (
              <li key={i} className="flex gap-2.5 text-slate-700">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                <span className="pt-0.5">{passo}</span>
              </li>
            ))}
          </ol>
        </div>
        {artigo.exemplos && artigo.exemplos.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Exemplos</h4>
            <ul className="space-y-1 list-disc list-inside text-slate-700">
              {artigo.exemplos.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {artigo.boasPraticas && artigo.boasPraticas.length > 0 && (
          <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300 mb-1.5">Boas práticas</h4>
            <ul className="space-y-1 list-disc list-inside text-emerald-900 dark:text-emerald-200">
              {artigo.boasPraticas.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
        {artigo.errosComuns && artigo.errosComuns.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300 mb-1.5">Erros comuns</h4>
            <ul className="space-y-1 list-disc list-inside text-amber-900 dark:text-amber-200">
              {artigo.errosComuns.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {artigo.faq && artigo.faq.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Perguntas frequentes</h4>
            <div className="space-y-2">
              {artigo.faq.map((f, i) => (
                <details key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 group">
                  <summary className="text-sm font-medium text-slate-800 cursor-pointer list-none flex items-center justify-between gap-2">
                    {f.pergunta}
                    <ChevronRight size={14} className="text-slate-400 flex-shrink-0 transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="text-slate-600 mt-1.5">{f.resposta}</p>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function CentralAjuda({ onClose, onReiniciarTour }: { onClose: () => void; onReiniciarTour?: () => void }) {
  const { user } = useAuth();
  const [busca, setBusca] = useState("");
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);
  const [artigoAberto, setArtigoAberto] = useState<ArtigoAjuda | null>(null);

  const papel = user?.papel;
  const artigos = useMemo(() => (papel ? artigosParaPapel(papel) : []), [papel]);
  const categorias = useMemo(() => (papel ? categoriasParaPapel(papel) : []), [papel]);

  const termoNormalizado = normalizar(busca.trim());
  const artigosFiltrados = artigos.filter(
    (a) => (!categoriaAtiva || a.categoria === categoriaAtiva) && artigoBateComBusca(a, termoNormalizado)
  );

  if (!user) return null;

  return (
    <Modal title={artigoAberto ? "Central de Ajuda" : "Central de Ajuda"} onClose={onClose} wide>
      {artigoAberto ? (
        <ArtigoDetalhe artigo={artigoAberto} onVoltar={() => setArtigoAberto(null)} />
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por assunto, tela ou dúvida..."
              className="w-full pl-9 pr-8 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-4 focus:ring-brand-600/20 focus:border-brand-500"
            />
            {busca && (
              <button onClick={() => setBusca("")} aria-label="Limpar busca" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-slate-700">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCategoriaAtiva(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!categoriaAtiva ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              Todas
            </button>
            {categorias.map((c) => (
              <button
                key={c}
                onClick={() => setCategoriaAtiva(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${categoriaAtiva === c ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {c}
              </button>
            ))}
          </div>

          {artigosFiltrados.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <HelpCircle size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum artigo encontrado para "{busca}".</p>
            </div>
          ) : (
            <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {artigosFiltrados.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => setArtigoAberto(a)}
                    className="w-full text-left flex items-center justify-between gap-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3.5 py-2.5 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{a.titulo}</p>
                      <p className="text-xs text-gray-500 truncate">{a.resumo}</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {onReiniciarTour && (
            <div className="pt-2 border-t border-gray-200 text-center">
              <button onClick={onReiniciarTour} className="text-xs text-brand-700 dark:text-brand-400 hover:underline">
                Rever o tour guiado de introdução
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// Botão de entrada, mesmo padrão visual do IndicadorConexao/MenuUsuario no
// header — usado tanto no AppShell quanto no Portal do Colaborador.
export function BotaoAjuda({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Abrir Central de Ajuda"
      title="Central de Ajuda"
      className="flex items-center justify-center w-9 h-9 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30"
    >
      <HelpCircle size={18} />
    </button>
  );
}
