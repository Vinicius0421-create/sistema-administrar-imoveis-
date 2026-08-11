import React, { useMemo, useState } from "react";
import { equipamentosApi } from "../api/equipamentos";
import { linhasApi } from "../api/linhas";
import { acessosApi } from "../api/acessos";
import { colaboradoresApi } from "../api/colaboradores";
import { movimentacoesApi } from "../api/movimentacoes";
import { ApiError } from "../lib/apiClient";
import { Button, Modal, Select, Stamp } from "./ui";
import { AlertTriangle, CheckCircle2, Key, Laptop, Phone } from "./icons";
import { AcessoSistema, Colaborador, colaboradorOperacionalmenteAtivo, Equipamento, LinhaTelefonica, Papel, rotuloEquipamento } from "../types";
import { maskTelefone } from "../lib/mascaras";

// Melhoria 1 (17/07/2026, pedido do Vini: "muito chato quando um colaborador
// sai... tenho que ir em aba de equipamento para transferir, ir em aba de
// linha telefônica, quero uma forma mais rápida e prática") — antes deste
// modal, desligar alguém de verdade (não só marcar o cadastro como INATIVO)
// exigia navegar por 3 telas separadas (Equipamentos, Linhas, Acessos),
// resolvendo cada vínculo manualmente, sem nenhuma visão unificada do que
// ainda faltava. O botão dedicado "Desligar" (POST /colaboradores/:id/
// desligar) já existia no backend desde 10/07 mas nunca teve UI real — só
// marcava o cadastro como INATIVO + revogava o login, sem tocar em
// equipamento/linha/acesso, e a MovimentacaoColaborador gerada
// (impacto*=PENDENTE_REVISAO) nunca virava ação de verdade, só um lembrete
// que ninguém executava (ver /concluir em movimentacoes.routes.ts, que
// sempre só virou flags, nunca disparou as transferências/devoluções).
//
// Este modal junta os 3 vínculos numa tela só, com a ação de resolver cada
// um (devolver ao estoque OU transferir pra outro colaborador — o pedido do
// Vini usa a palavra "transferir" explicitamente, não só "devolver"), e só
// então chama o desligamento de verdade. Reaproveita 100% dos endpoints já
// existentes (equipamentosApi.devolver/linhasApi.update/acessosApi.
// alternarStatus/colaboradoresApi.desligar/movimentacoesApi.concluir) — não
// foi preciso nenhuma rota nova no backend.
//
// Reorganização de hierarquia (mesmo pedido do Vini, mesma data): quem
// devolve/transfere equipamento, desvincula linha e revoga acesso a sistema
// agora é exclusivo de ADMINISTRADOR/SUPORTE_TI (ver requireRole em
// equipamentos/linhas/acessos.routes.ts, "patrimônio" fora do escopo de
// GESTOR_COORDENADOR desde a reorganização). GESTOR_COORDENADOR ainda pode
// abrir este modal e finalizar o desligamento (revoga login, marca INATIVO)
// — mas as 3 seções de vínculo aparecem só como LISTA, com aviso claro de
// que precisam de Suporte/TI, em vez de botão de ação que resultaria em 403.
interface Props {
  colaborador: Colaborador;
  equipamentosVinculados: Equipamento[];
  linhasVinculadas: LinhaTelefonica[];
  acessosVinculados: AcessoSistema[];
  colaboradoresParaTransferencia: Colaborador[];
  papel: Papel;
  onClose: () => void;
  onConcluido: () => Promise<void> | void;
}

type AcaoEquipamento = { tipo: "devolver" } | { tipo: "transferir"; paraColaboradorId: string };
type AcaoLinha = { tipo: "desvincular" } | { tipo: "transferir"; paraColaboradorId: string };

export function DesligamentoModal({
  colaborador, equipamentosVinculados, linhasVinculadas, acessosVinculados, colaboradoresParaTransferencia,
  papel, onClose, onConcluido,
}: Props) {
  // "Patrimônio" (Equipamentos/Linhas/Acessos) — ver comentário acima.
  const podePatrimonio = papel === "ADMINISTRADOR" || papel === "SUPORTE_TI";

  const acessosAtivos = useMemo(() => acessosVinculados.filter((a) => a.status === "ATIVO"), [acessosVinculados]);
  const destinosPossiveis = useMemo(
    () => colaboradoresParaTransferencia.filter((c) => c.id !== colaborador.id && colaboradorOperacionalmenteAtivo(c.status)),
    [colaboradoresParaTransferencia, colaborador.id]
  );

  const [acoesEquipamento, setAcoesEquipamento] = useState<Record<string, AcaoEquipamento>>(
    () => Object.fromEntries(equipamentosVinculados.map((e) => [e.id, { tipo: "devolver" } as AcaoEquipamento]))
  );
  const [acoesLinha, setAcoesLinha] = useState<Record<string, AcaoLinha>>(
    () => Object.fromEntries(linhasVinculadas.map((l) => [l.id, { tipo: "desvincular" } as AcaoLinha]))
  );

  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);

  async function confirmarDesligamento() {
    setProcessando(true);
    setErro(null);
    try {
      const falhas: string[] = [];

      if (podePatrimonio) {
        const resultadosEquip = await Promise.allSettled(
          equipamentosVinculados.map((e) => {
            const acao = acoesEquipamento[e.id];
            return acao?.tipo === "transferir"
              ? equipamentosApi.update(e.id, { colaboradorId: acao.paraColaboradorId })
              : equipamentosApi.devolver(e.id);
          })
        );
        resultadosEquip.forEach((r, i) => {
          if (r.status === "rejected") falhas.push(`Equipamento "${equipamentosVinculados[i].tipo}"`);
        });

        const resultadosLinha = await Promise.allSettled(
          linhasVinculadas.map((l) => {
            const acao = acoesLinha[l.id];
            return acao?.tipo === "transferir"
              ? linhasApi.update(l.id, { colaboradorId: acao.paraColaboradorId, principal: false })
              : linhasApi.update(l.id, { colaboradorId: null, principal: false });
          })
        );
        resultadosLinha.forEach((r, i) => {
          if (r.status === "rejected") falhas.push(`Linha "${linhasVinculadas[i].numero}"`);
        });

        const resultadosAcesso = await Promise.allSettled(
          acessosAtivos.map((a) => acessosApi.alternarStatus(a.id))
        );
        resultadosAcesso.forEach((r, i) => {
          if (r.status === "rejected") falhas.push(`Acesso a "${acessosAtivos[i].sistema?.nome || "sistema"}"`);
        });
      }

      if (falhas.length > 0) {
        setErro(`Não foi possível resolver: ${falhas.join(", ")}. Corrija e tente novamente — o desligamento ainda não foi confirmado.`);
        setProcessando(false);
        return;
      }

      const resultado = await colaboradoresApi.desligar(colaborador.id);

      // Se este papel resolveu os 3 vínculos agora mesmo (podePatrimonio),
      // a movimentação criada pelo /desligar (sempre PENDENTE_REVISAO por
      // padrão, ver comentário no backend) já reflete a realidade — conclui
      // na hora em vez de deixar um lembrete "pendente" que já foi
      // resolvido. GESTOR_COORDENADOR (sem podePatrimonio) deixa PENDENTE
      // de propósito: Suporte/TI ainda precisa agir, e a movimentação é
      // exatamente o rastro disso.
      if (podePatrimonio && resultado.movimentacao) {
        await movimentacoesApi.concluir(resultado.movimentacao.id);
      }

      setConcluido(true);
      await onConcluido();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível concluir o desligamento.");
    } finally {
      setProcessando(false);
    }
  }

  const totalVinculos = equipamentosVinculados.length + linhasVinculadas.length + acessosAtivos.length;

  return (
    <Modal title={`Desligar ${colaborador.nomeCompleto}`} onClose={onClose} wide>
      {concluido ? (
        <div className="text-center py-6">
          <CheckCircle2 size={40} className="mx-auto text-emerald-600 mb-3" />
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Desligamento concluído.</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">O login foi desativado e o histórico foi preservado.</p>
          <Button variant="primary" className="mt-4" onClick={onClose}>Fechar</Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
            Isto marca o cadastro como Inativo, registra a data de desligamento e desativa o login imediatamente
            (nenhum acesso novo funciona, mesmo que a pessoa já esteja logada em algum aparelho).
            {totalVinculos > 0 && " Resolva os vínculos abaixo antes de confirmar."}
          </p>

          {!podePatrimonio && totalVinculos > 0 && (
            <div className="mb-4 text-xs bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 flex gap-2">
              <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
              <span>
                Equipamento, linha e acesso a sistema só podem ser resolvidos por Suporte/TI ou Administrador.
                Confirmar aqui desliga a pessoa (login desativado) e deixa esses vínculos pendentes — visíveis em
                Movimentações para quem for revisar.
              </span>
            </div>
          )}

          {equipamentosVinculados.length > 0 && (
            <div className="mb-4">
              <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                <Laptop size={14} /> Equipamentos ({equipamentosVinculados.length})
              </h5>
              <div className="space-y-2">
                {equipamentosVinculados.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700 p-2.5 text-xs">
                    <span className="min-w-0 break-words">{rotuloEquipamento(e)}</span>
                    {podePatrimonio ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Select
                          aria-label={`Destino de ${e.tipo}`}
                          value={acoesEquipamento[e.id]?.tipo === "transferir" ? acoesEquipamento[e.id].tipo : "devolver"}
                          onChange={(ev) => {
                            const tipo = ev.target.value as "devolver" | "transferir";
                            setAcoesEquipamento((prev) => ({
                              ...prev,
                              [e.id]: tipo === "devolver" ? { tipo: "devolver" } : { tipo: "transferir", paraColaboradorId: destinosPossiveis[0]?.id || "" },
                            }));
                          }}
                          className="!py-1 !text-xs"
                        >
                          <option value="devolver">Devolver ao estoque</option>
                          {destinosPossiveis.length > 0 && <option value="transferir">Transferir para...</option>}
                        </Select>
                        {acoesEquipamento[e.id]?.tipo === "transferir" && (
                          <Select
                            aria-label={`Colaborador destino de ${e.tipo}`}
                            value={(acoesEquipamento[e.id] as { paraColaboradorId: string }).paraColaboradorId}
                            onChange={(ev) => setAcoesEquipamento((prev) => ({ ...prev, [e.id]: { tipo: "transferir", paraColaboradorId: ev.target.value } }))}
                            className="!py-1 !text-xs"
                          >
                            {destinosPossiveis.map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
                          </Select>
                        )}
                      </div>
                    ) : (
                      <Stamp tone="pend">Pendente — Suporte/TI</Stamp>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {linhasVinculadas.length > 0 && (
            <div className="mb-4">
              <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                <Phone size={14} /> Linhas Telefônicas ({linhasVinculadas.length})
              </h5>
              <div className="space-y-2">
                {linhasVinculadas.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700 p-2.5 text-xs">
                    <span style={{ fontFamily: "monospace" }}>{maskTelefone(l.numero)}</span>
                    {podePatrimonio ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Select
                          aria-label={`Destino da linha ${l.numero}`}
                          value={acoesLinha[l.id]?.tipo === "transferir" ? acoesLinha[l.id].tipo : "desvincular"}
                          onChange={(ev) => {
                            const tipo = ev.target.value as "desvincular" | "transferir";
                            setAcoesLinha((prev) => ({
                              ...prev,
                              [l.id]: tipo === "desvincular" ? { tipo: "desvincular" } : { tipo: "transferir", paraColaboradorId: destinosPossiveis[0]?.id || "" },
                            }));
                          }}
                          className="!py-1 !text-xs"
                        >
                          <option value="desvincular">Desvincular</option>
                          {destinosPossiveis.length > 0 && <option value="transferir">Transferir para...</option>}
                        </Select>
                        {acoesLinha[l.id]?.tipo === "transferir" && (
                          <Select
                            aria-label={`Colaborador destino da linha ${l.numero}`}
                            value={(acoesLinha[l.id] as { paraColaboradorId: string }).paraColaboradorId}
                            onChange={(ev) => setAcoesLinha((prev) => ({ ...prev, [l.id]: { tipo: "transferir", paraColaboradorId: ev.target.value } }))}
                            className="!py-1 !text-xs"
                          >
                            {destinosPossiveis.map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
                          </Select>
                        )}
                      </div>
                    ) : (
                      <Stamp tone="pend">Pendente — Suporte/TI</Stamp>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {acessosAtivos.length > 0 && (
            <div className="mb-4">
              <h5 className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                <Key size={14} /> Acessos a Sistemas ativos ({acessosAtivos.length})
              </h5>
              <div className="flex flex-wrap gap-1.5">
                {acessosAtivos.map((a) => (
                  <span key={a.id} className="text-xs bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-2 py-1 rounded-[var(--radius-control)]">
                    {a.sistema?.nome}
                  </span>
                ))}
              </div>
              {podePatrimonio && (
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">Todos serão revogados (bloqueados) ao confirmar.</p>
              )}
            </div>
          )}

          {totalVinculos === 0 && (
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">Nenhum equipamento, linha ou acesso vinculado — só o login será desativado.</p>
          )}

          {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={processando}>Cancelar</Button>
            <Button variant="danger" onClick={confirmarDesligamento} disabled={processando}>
              {processando ? "Desligando..." : "Confirmar desligamento"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
