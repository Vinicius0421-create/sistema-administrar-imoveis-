import React, { useState } from "react";
import { Button, fmtDataHora, TextInput } from "./ui";
import { Send, X } from "./icons";

// Timeline de Eventos (Onda 2.3 do redesign, 21/07/2026, pedido do Vini:
// "extrair um componente de detalhe... parametrizado por tipo, em vez de
// 3-4 arquivos parecidos copiados" — ver seção 2.2 da auditoria,
// `claude/Auditoria_Redesign_Portal_Corporativo_21-07-2026.md`).
//
// Escopo desta extração — DELIBERADAMENTE parcial, não os 4 fluxos de
// solicitação de uma vez: só a RENDERIZAÇÃO DA LINHA DO TEMPO (cartão de
// mensagem, linha de evento de sistema, caixa de novo comentário) de
// ChamadoDetalhe.tsx e SolicitacoesPapelaria.tsx (`SolicitacaoPapelariaDetalhe`)
// era, na prática, código quase idêntico copiado — mesmas classes, mesmo
// layout, mesmo padrão de exclusão. `Solicitacoes.tsx` (Equipamento) nunca
// teve timeline nenhuma (nada a extrair) e `SolicitacoesServico.tsx` tem uma
// lista de eventos estruturalmente mais simples (sem `tipo`, sem `autor`,
// sem comentário livre — são só efeitos colaterais de ações de fluxo) —
// forçar os 4 no mesmo componente agora exigiria inventar campos que
// Serviço não tem, ou mudar o backend dele antes — mais risco do que a
// duplicação (~10 linhas de JSX lá) justifica hoje. Ver relatório da
// investigação desta Onda no histórico da sessão — pode virar item de uma
// onda futura se o modelo de Serviço ganhar `tipo`/`autor`/comentário.
//
// O restante de cada tela (campo de ficha, aprovação, edição, exclusão da
// solicitação inteira) continua 100% onde estava — são regras de negócio
// genuinamente diferentes entre os 4 fluxos (ver seção 0 da auditoria:
// "motor único só na camada visual, não no schema"), não duplicação.

export interface EventoTimeline {
  id: string;
  tipo: string;
  criadoEm: string;
  mensagem?: string | null;
  detalhe?: Record<string, unknown> | null;
  autor?: unknown;
}

interface Props<E extends EventoTimeline> {
  titulo: string;
  eventos: E[];
  // Classes do container externo (borda/sombra) — mantidas como prop porque
  // ChamadoDetalhe e SolicitacaoPapelariaDetalhe já divergiam nisso antes
  // desta extração (borda gray-200 sem sombra vs. borda gray-100 com
  // `--elevation-1`) — preservar exatamente como cada tela já usava, em vez
  // de forçar as duas a ficarem visualmente idênticas por conveniência do
  // componente (isso seria mudança estética sem justificativa técnica,
  // proibida pela regra principal deste redesenho).
  containerClassName: string;
  // Decide como cada evento é desenhado: "mensagem" (cartão com autor+texto,
  // like Chamado.MENSAGEM/Papelaria.COMENTARIO), "anexo" (delega pra
  // `renderAnexo`, hoje só usado por Chamado) ou "sistema" (linha de log
  // discreta, itálico, usando `descricaoEvento`).
  variante: (evento: E) => "mensagem" | "anexo" | "sistema";
  descricaoEvento: Record<string, (detalhe: Record<string, unknown> | null) => string>;
  autorLabel: (autor: E["autor"]) => string;
  // `undefined` = sem tooltip (Papelaria nunca teve); Chamado passa
  // `(autor) => (autor as {email?: string})?.email`.
  autorTitle?: (autor: E["autor"]) => string | undefined;
  // Papelaria mostra o autor também na linha de evento de sistema
  // ("Status alterado... · Fulano · 10/07/26 14:00"); Chamado nunca mostrou
  // (só descrição + data) — diferença de comportamento real, preservada.
  autorNaLinhaSistema?: boolean;
  renderAnexo?: (evento: E) => React.ReactNode;
  podeExcluirEvento: (evento: E) => boolean;
  onExcluirEvento: (eventoId: string) => void | Promise<void>;
  tituloExcluir?: string;
  // Caixa de novo comentário — ausente (`podeComentar=false`) some por
  // completo, mesmo comportamento de antes (Papelaria escondia atrás de
  // `podeGerenciar`; Chamado sempre mostrava).
  podeComentar: boolean;
  placeholderComentario: string;
  onEnviarComentario: (texto: string) => void | Promise<void>;
  // Slot pro botão "Anexar" + input de arquivo do Chamado — Papelaria não
  // usa, então não vira responsabilidade deste componente genérico.
  controlesExtras?: React.ReactNode;
  avisoRodape?: React.ReactNode;
}

export function TimelineEventos<E extends EventoTimeline>({
  titulo,
  eventos,
  containerClassName,
  variante,
  descricaoEvento,
  autorLabel,
  autorTitle,
  autorNaLinhaSistema,
  renderAnexo,
  podeExcluirEvento,
  onExcluirEvento,
  tituloExcluir = "Excluir (correção de engano)",
  podeComentar,
  placeholderComentario,
  onEnviarComentario,
  controlesExtras,
  avisoRodape,
}: Props<E>) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await onEnviarComentario(texto.trim());
      setTexto(""); // só limpa em caso de sucesso — o texto digitado fica preservado se der erro
    } catch {
      // erro já reportado pelo chamador (que seta seu próprio estado de erro,
      // mostrado no banner acima da tela) — aqui só evita um "unhandled
      // rejection" no console, já que este onClick não é aguardado por
      // ninguém.
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={containerClassName} style={{ maxHeight: 420 }}>
      <div className="px-3 py-2 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 text-xs font-bold uppercase text-gray-500 dark:text-slate-400">
        {titulo}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {eventos.map((ev) => {
          const v = variante(ev);
          if (v === "anexo" && renderAnexo) {
            return <React.Fragment key={ev.id}>{renderAnexo(ev)}</React.Fragment>;
          }
          if (v === "mensagem") {
            return (
              <div key={ev.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] p-2 text-sm group relative">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate min-w-0" title={autorTitle?.(ev.autor)}>
                    {autorLabel(ev.autor)}
                  </span>
                  <span className="text-[10px] text-gray-400 dark:text-slate-500 flex-shrink-0">{fmtDataHora(ev.criadoEm)}</span>
                </div>
                <p className="text-slate-800 dark:text-slate-100 mt-0.5">{ev.mensagem}</p>
                {podeExcluirEvento(ev) && (
                  <button
                    className="absolute top-1 right-1 text-gray-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 p-1"
                    title={tituloExcluir}
                    aria-label="Excluir mensagem"
                    onClick={() => onExcluirEvento(ev.id)}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          }
          // "sistema" (ou "anexo" sem renderAnexo — degrada pra linha de log
          // em vez de sumir silenciosamente, mais seguro que quebrar o render).
          return (
            <div key={ev.id} className="text-[11px] text-gray-400 dark:text-slate-500 italic px-1 flex items-center justify-between gap-1">
              <span>
                {descricaoEvento[ev.tipo]?.(ev.detalhe ?? null) || ev.tipo}
                {autorNaLinhaSistema && <> · {autorLabel(ev.autor)}</>} · {fmtDataHora(ev.criadoEm)}
              </span>
              {podeExcluirEvento(ev) && (
                <button
                  className="text-gray-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 flex-shrink-0"
                  title={tituloExcluir}
                  aria-label="Excluir evento"
                  onClick={() => onExcluirEvento(ev.id)}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
        {eventos.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-6">Sem histórico ainda.</p>}
      </div>
      {podeComentar && (
        <>
          <div className="p-2 border-t border-gray-200 dark:border-slate-700 flex gap-2">
            {controlesExtras}
            <TextInput
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={placeholderComentario}
              onKeyDown={(e) => { if (e.key === "Enter") enviar(); }}
            />
            <Button variant="primary" onClick={enviar} disabled={!texto.trim() || enviando}>
              <Send size={14} />
            </Button>
          </div>
          {avisoRodape}
        </>
      )}
    </div>
  );
}
