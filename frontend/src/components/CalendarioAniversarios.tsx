import { CARD_SHADOW, CARD_SHADOW_HOVER, cardClicavelProps, COLORS, FOCUS_RING_CLASS } from "./ui";
import { Cake, ChevronRight } from "./icons";
import { agruparAniversariantesPorMes, MESES_PT_COMPLETO, proximoAniversario } from "../lib/aniversarios";
import { Colaborador } from "../types";

// Calendário anual de Aniversários (17/07/2026, pedido do Vini: além do
// widget do mês no Painel Geral, "uma aba interativa com os aniversariantes
// de todo o ano, separado em cada mês, igual a foto que mandei [pôster do
// RH], de forma interativa e criativa") — grade de 12 meses (mesmo formato
// visual do pôster), mais um destaque de "Próximo aniversário" no topo, que
// não existe no pôster de papel: é a parte "interativa e criativa" —
// responde de cara "quem faz aniversário primeiro a partir de hoje", sem
// precisar escanear os 12 cartões pra achar. Cada nome é clicável e abre o
// mesmo modal de detalhe da lista normal de Colaboradores — ver
// `onSelecionar`, repassado pelo componente pai.
interface Props {
  colaboradores: Colaborador[];
  onSelecionar: (colaborador: Colaborador) => void;
}

export function CalendarioAniversarios({ colaboradores, onSelecionar }: Props) {
  const porMes = agruparAniversariantesPorMes(colaboradores);
  const mesAtual = new Date().getMonth();
  const proximo = proximoAniversario(colaboradores);

  return (
    <div className="space-y-4">
      {proximo && (
        <div
          className="animate-[staggerIn_var(--motion-page)_var(--motion-ease)_both] rounded-[var(--radius-card)] border border-brand-600/20 bg-gradient-to-br from-brand-50 to-white dark:from-brand-500/10 dark:to-slate-900 p-4 flex items-center gap-3"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <div className="w-10 h-10 rounded-full bg-brand-600/10 dark:bg-brand-500/20 flex items-center justify-center flex-shrink-0">
            <Cake size={20} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
              Próximo aniversário
            </p>
            <p className="text-sm text-slate-800 dark:text-slate-200 truncate">
              <button
                onClick={() => onSelecionar(proximo.colaborador)}
                className={`font-semibold hover:underline ${FOCUS_RING_CLASS} rounded`}
              >
                {proximo.colaborador.nomeCompleto}
              </button>
              {" — "}
              {proximo.diasRestantes === 0
                ? "hoje!"
                : proximo.diasRestantes === 1
                  ? "amanhã"
                  : `em ${proximo.diasRestantes} dias`}
              {" "}
              <span className="text-slate-400 dark:text-slate-500">
                ({String(proximo.dia).padStart(2, "0")}/{String(proximo.mes + 1).padStart(2, "0")})
              </span>
            </p>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {MESES_PT_COMPLETO.map((nomeMes, mes) => {
          const doMes = porMes[mes];
          const ehMesAtual = mes === mesAtual;
          return (
            <div
              key={nomeMes}
              className={`animate-[staggerIn_var(--motion-page)_var(--motion-ease)_both] rounded-[var(--radius-card)] border p-4 transition-colors duration-[var(--motion-fast)] ${
                ehMesAtual
                  ? "border-brand-600/40 bg-brand-50/60 dark:bg-brand-500/10"
                  : "border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900"
              }`}
              style={{ boxShadow: CARD_SHADOW, animationDelay: `${mes * 40}ms` }}
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className={`text-sm font-semibold ${ehMesAtual ? "text-brand-700 dark:text-brand-400" : "text-slate-900 dark:text-slate-100"}`}>
                  {nomeMes}
                </h4>
                <div className="flex items-center gap-1.5">
                  {ehMesAtual && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400 bg-brand-600/10 dark:bg-brand-500/15 rounded-full px-2 py-0.5">
                      Agora
                    </span>
                  )}
                  <span className="text-xs text-gray-400 dark:text-slate-500 tabular-nums">{doMes.length}</span>
                </div>
              </div>
              {doMes.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum aniversariante.</p>
              ) : (
                <ul className="space-y-1.5">
                  {doMes.map(({ colaborador: c, dia }) => {
                    const ativar = () => onSelecionar(c);
                    return (
                      <li
                        key={c.id}
                        onClick={ativar}
                        {...cardClicavelProps(ativar)}
                        className={`flex items-center gap-2 text-xs cursor-pointer rounded px-1 py-1 -mx-1 hover:bg-white dark:hover:bg-slate-800 ${FOCUS_RING_CLASS}`}
                      >
                        <span
                          className="flex-shrink-0 w-7 text-center font-mono text-[10px] font-bold rounded px-1 py-0.5"
                          style={{ backgroundColor: `${COLORS.brass}1a`, color: COLORS.brass }}
                        >
                          {String(dia).padStart(2, "0")}
                        </span>
                        <span className="truncate text-slate-700 dark:text-slate-300">{c.nomeCompleto}</span>
                        <ChevronRight size={12} className="text-gray-300 dark:text-slate-600 ml-auto flex-shrink-0" aria-hidden="true" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
