import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X } from "../components/icons";

// Padronização de Animações (11/07/2026) — item "feedback visual de ações":
// a auditoria de cobertura (Ciclo de Evolução Contínua) encontrou que ações
// importantes (salvar, editar, excluir, aprovar, enviar, concluir, mudar
// status, anexar) não davam nenhuma confirmação visual além de a tela
// atualizar sozinha — fácil de não perceber, principalmente em conexões
// mais lentas ou telas cheias de informação. Este é o primeiro lugar do
// sistema com um toast de SUCESSO de ação, deliberadamente separado do
// ToastNotificacoes de CentralNotificacoes.tsx (que é sobre notificações
// em tempo real vindas do backend/outros usuários — categoria diferente de
// coisa, mesmo reaproveitando o mesmo par de keyframes toastIn/toastOut já
// definido em index.css, pra manter a identidade visual consistente).
//
// Por que Context em vez de um componente local por página: a mesma
// necessidade ("confirme que a ação deu certo") se repete em praticamente
// toda página do sistema (Colaboradores, Equipamentos, Linhas, Acessos,
// Chamados, Solicitações, Movimentações, Configurações, Mensagens...).
// Um Provider único montado uma vez em main.tsx, com um hook simples
// (`useFeedback().sucesso("mensagem")`), evita duplicar estado de toast em
// cada página — mesmo padrão arquitetural de AuthContext/ThemeContext.
interface FeedbackToastAcao {
  // Rótulo curto do botão de ação do toast (ex: "Desfazer").
  label: string;
  onClick: () => void;
}

interface FeedbackToastItem {
  id: number;
  mensagem: string;
  saindo: boolean;
  acao?: FeedbackToastAcao;
}

interface FeedbackContextValue {
  // Uso: useFeedback().sucesso("Colaborador salvo com sucesso.")
  // Mantido deliberadamente enxuto (só sucesso) — erros já têm seu próprio
  // padrão consistente de exibição (banner inline vermelho/brand, com
  // animate-[fadeIn...], ver auditoria de 11/07/2026) em praticamente toda
  // página; duplicar isso como toast seria inconsistente com o que já
  // existe e ia confundir "onde eu leio o erro?".
  //
  // `acao` (achado S6 do checkup, 22/07/2026) — segundo parâmetro OPCIONAL:
  // some do toast quando omitido (comportamento de sempre, nenhum chamador
  // existente precisa mudar). Quando presente, o toast ganha um botão
  // (ex: "Desfazer") e fica visível por mais tempo — pensado pra mudanças
  // de status/atribuição de responsável (chamado, solicitação), que são
  // reversíveis mas não merecem uma confirmação bloqueante antes do fato.
  sucesso: (mensagem: string, acao?: FeedbackToastAcao) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

// Tempo visível antes do auto-dismiss. Mais curto que o toast de
// notificação (que fica ~6s, ver TOAST_DURACAO_MS em CentralNotificacoes —
// notificação pode exigir leitura/decisão) porque aqui a mensagem é curta
// e a pessoa normalmente já sabe o que fez; só precisa da confirmação
// rápida no canto do olho, sem competir por atenção por muito tempo.
const DURACAO_VISIVEL_MS = 2600;
// Toast COM ação (ex: "Desfazer") fica mais tempo visível — a pessoa
// precisa de uma janela real pra perceber, ler e decidir clicar, não só
// confirmar com o canto do olho como o toast simples. 7s fica no meio do
// intervalo de 5-8s pedido no achado S6.
const DURACAO_VISIVEL_COM_ACAO_MS = 7000;
// Tempo da animação de saída (toastOut) — mesmo valor de --motion-panel
// (220ms) usado em CentralNotificacoes, mantido em sincronia com o CSS.
const DURACAO_SAIDA_MS = 220;

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [itens, setItens] = useState<FeedbackToastItem[]>([]);
  const proximoId = useRef(0);
  const timersRef = useRef<Record<number, number>>({});

  const remover = useCallback((id: number) => {
    setItens((atual) => atual.filter((item) => item.id !== id));
    if (timersRef.current[id]) {
      window.clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  const iniciarSaida = useCallback(
    (id: number) => {
      const reduzMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduzMovimento) {
        remover(id);
        return;
      }
      setItens((atual) => atual.map((item) => (item.id === id ? { ...item, saindo: true } : item)));
      timersRef.current[id] = window.setTimeout(() => remover(id), DURACAO_SAIDA_MS);
    },
    [remover]
  );

  const sucesso = useCallback(
    (mensagem: string, acao?: FeedbackToastAcao) => {
      const id = proximoId.current++;
      setItens((atual) => [...atual, { id, mensagem, saindo: false, acao }]);
      window.setTimeout(() => iniciarSaida(id), acao ? DURACAO_VISIVEL_COM_ACAO_MS : DURACAO_VISIVEL_MS);
    },
    [iniciarSaida]
  );

  const value = useMemo(() => ({ sucesso }), [sucesso]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {itens.length > 0 &&
        createPortal(
          // Canto inferior esquerdo, deliberadamente oposto ao canto
          // superior direito usado por ToastNotificacoes (CentralNotifi-
          // cacoes.tsx) — os dois sistemas podem aparecer juntos (ex: salvar
          // um colaborador enquanto uma notificação chega) sem se sobrepor
          // nem competir visualmente pelo mesmo canto da tela.
          <div className="fixed bottom-4 left-4 z-[70] flex flex-col-reverse gap-2 w-[calc(100%-2rem)] max-w-xs pointer-events-none">
            {itens.map((item) => (
              <div
                key={item.id}
                role="status"
                aria-live="polite"
                className={`pointer-events-auto bg-slate-900 dark:bg-slate-800 text-white rounded-lg shadow-2xl pl-3 pr-2 py-2.5 flex items-center gap-2 ${
                  item.saindo
                    ? "animate-[toastOut_var(--motion-panel)_var(--motion-ease-out)_forwards]"
                    : "animate-[toastIn_var(--motion-panel)_var(--motion-ease)]"
                }`}
              >
                <CheckCircle2 size={16} className="flex-shrink-0 text-emerald-400" />
                <p className="text-xs font-medium flex-1 min-w-0">{item.mensagem}</p>
                {/* Botão de ação (S6, 22/07/2026) — ex: "Desfazer" numa
                    mudança de status/técnico. Clicar já fecha o toast (a
                    própria ação de desfazer é a confirmação de que a pessoa
                    viu e decidiu). */}
                {item.acao && (
                  <button
                    onClick={() => { item.acao!.onClick(); iniciarSaida(item.id); }}
                    className="text-xs font-semibold text-brand-300 hover:text-brand-200 underline flex-shrink-0 px-1"
                  >
                    {item.acao.label}
                  </button>
                )}
                <button
                  onClick={() => iniciarSaida(item.id)}
                  aria-label="Fechar"
                  title="Fechar"
                  className="text-slate-400 hover:text-white rounded p-0.5 flex-shrink-0 transition-colors active:scale-90"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback precisa estar dentro de <FeedbackProvider>");
  return ctx;
}
