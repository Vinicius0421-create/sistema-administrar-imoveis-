import React, { useCallback, useEffect, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { pagamentosApi, PagamentoInput, PagamentoLoteItemInput, PaginaNaoIdentificada } from "../api/pagamentos";
import { DadosBancariosColaborador } from "../types";
import { ApiError } from "../lib/apiClient";
import { parseValorMonetario } from "../lib/mascaras";
import { Button, EmptyState, Field, fmtDate, fmtMoney, FONT_MONO, Modal, PageHeader, Paginacao, Select, SearchBox, Spinner, Stamp, TextArea, TextInput, usePaginacaoCliente } from "../components/ui";
import { Banknote, Download, Plus, Settings, Upload, X } from "../components/icons";
import {
  colaboradorOperacionalmenteAtivo, ConfiguracaoPagamento, FolhaPagamento, FormaPagamento, FORMA_PAGAMENTO_LABEL,
  PagamentoColaborador, RemessaCnab, STATUS_FOLHA_TONE, STATUS_PAGAMENTO_LABEL, STATUS_PAGAMENTO_TONE,
  STATUS_REMESSA_LABEL, STATUS_REMESSA_TONE, TIPO_PAGAMENTO_LABEL, TipoPagamentoColaborador,
} from "../types";
import { useFeedback } from "../contexts/FeedbackContext";

// Pagamentos de Colaboradores — CNAB 240 Sicoob (20/07/2026, pedido do
// Vini). Substitui o fluxo manual planilha + script Python: folha por
// competência → lançamentos → "Gerar Remessa CNAB" (arquivo .rem no layout
// homologado, validado byte a byte contra a Remessa 08 real) → download →
// envio ao banco → importação do retorno → baixa automática. Página
// visível só pra ADMINISTRADOR/FINANCEIRO (ver NAV em App.tsx); o backend
// impõe os mesmos papéis em toda rota.

interface Props {
  data: AppData;
}

function classePilula(ativa: boolean): string {
  return `px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors duration-[var(--motion-fast)] ${ativa ? "bg-slate-900 text-white" : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`;
}

const MESES_COMPETENCIA = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function competenciaPadrao(): string {
  const agora = new Date();
  return `${MESES_COMPETENCIA[agora.getMonth()]}/${agora.getFullYear()}`;
}

export function PagamentosPage({ data }: Props) {
  const { sucesso } = useFeedback();
  const [aba, setAba] = useState<"folhas" | "remessas" | "avulsos">("folhas");
  const [folhas, setFolhas] = useState<FolhaPagamento[]>([]);
  const [remessas, setRemessas] = useState<RemessaCnab[]>([]);
  // Avulsos (22/07/2026, pedido do Vini: "incluir pagamentos avulsos em
  // geral, apenas para ter registro, sem precisar de arquivo de remessa nem
  // nada") — aba própria, separada de Folhas/Remessas, já que não passa por
  // nenhuma das duas (é só um PagamentoColaborador com folhaId nulo).
  const [avulsos, setAvulsos] = useState<PagamentoColaborador[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [erroDetalhes, setErroDetalhes] = useState<string[]>([]);
  const [folhaAberta, setFolhaAberta] = useState<string | null>(null);
  const [novaFolha, setNovaFolha] = useState(false);
  const [configAberta, setConfigAberta] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const inputRetornoRef = React.useRef<HTMLInputElement>(null);

  const recarregar = useCallback(async () => {
    try {
      const [f, r, a] = await Promise.all([pagamentosApi.folhas(), pagamentosApi.remessas(), pagamentosApi.pagamentosAvulsos()]);
      setFolhas(f);
      setRemessas(r);
      setAvulsos(a);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os pagamentos.");
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);

  async function criarFolha(competencia: string, descricao: string, tipo: TipoPagamentoColaborador, dataPagamento: string) {
    setSalvando(true);
    setErro(null);
    try {
      const folha = await pagamentosApi.criarFolha({ competencia, descricao: descricao || null, tipo, dataPagamento: dataPagamento || null });
      await recarregar();
      setNovaFolha(false);
      setFolhaAberta(folha.id);
      sucesso("Folha criada.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível criar a folha.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirFolha(id: string, numero: number) {
    if (!window.confirm(`Excluir a folha #${numero}? Isso não pode ser desfeito.`)) return;
    setErro(null);
    try {
      await pagamentosApi.excluirFolha(id);
      if (folhaAberta === id) setFolhaAberta(null);
      await recarregar();
      sucesso("Folha excluída.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir a folha.");
    }
  }

  async function importarRetorno(file: File) {
    setSalvando(true);
    setErro(null);
    setErroDetalhes([]);
    try {
      const r = await pagamentosApi.importarRetorno(file);
      await recarregar();
      sucesso(`Retorno importado: ${r.pagos} pago(s), ${r.rejeitados} rejeitado(s)${r.naoEncontrados.length ? `, ${r.naoEncontrados.length} não localizado(s)` : ""}.`);
      // Fechamento automático de folha (21/07/2026, pedido do Vini) — se
      // todos os pagamentos de uma folha foram pagos, ela vira Fechada
      // sozinha; avisar quais fecharam evita o usuário ter que ir conferir
      // manualmente. Rejeitados aparecem detalhados pra já saber o que
      // precisa de reenvio, sem precisar abrir cada folha uma por uma.
      if (r.folhasFechadasAutomaticamente.length > 0) {
        sucesso(`Folha(s) fechada(s) automaticamente: ${r.folhasFechadasAutomaticamente.map((n) => `#${n}`).join(", ")}.`);
      }
      if (r.rejeitadosDetalhe.length > 0) {
        setErro(`${r.rejeitadosDetalhe.length} pagamento(s) rejeitado(s) — a folha continua aberta. Marque-os na tabela da folha pra reenviar.`);
        setErroDetalhes(r.rejeitadosDetalhe.map((d) => `${d.colaborador}: ${d.motivo}`));
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível importar o retorno.");
    } finally {
      setSalvando(false);
    }
  }

  const folhaSelecionada = folhas.find((f) => f.id === folhaAberta) || null;

  if (carregando) {
    return <div className="flex items-center justify-center py-20"><Spinner size={28} /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Pagamentos de Colaboradores"
        subtitle="Folhas, remessas CNAB 240 (Sicoob) e baixa automática pelo retorno do banco"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfigAberta(true)}><Settings size={15} /> Configuração</Button>
            {aba === "folhas" && (
              <Button variant="primary" onClick={() => setNovaFolha(true)}><Plus size={15} /> Nova Folha</Button>
            )}
          </div>
        }
      />

      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-full p-1 mb-4 w-fit">
        <button onClick={() => setAba("folhas")} className={classePilula(aba === "folhas")}>Folhas de Pagamento</button>
        <button onClick={() => setAba("remessas")} className={classePilula(aba === "remessas")}>Remessas CNAB</button>
        <button onClick={() => setAba("avulsos")} className={classePilula(aba === "avulsos")}>Pagamentos Avulsos</button>
      </div>

      {erro && (
        <div className="mb-3 text-xs bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2.5">
          {erro}
          {erroDetalhes.length > 0 && (
            <ul className="mt-1.5 list-disc list-inside">{erroDetalhes.map((d, i) => <li key={i}>{d}</li>)}</ul>
          )}
        </div>
      )}

      {aba === "folhas" ? (
        folhas.length === 0 ? (
          <EmptyState icon={Banknote} text="Nenhuma folha criada ainda — comece por 'Nova Folha'." />
        ) : (
          // Agrupamento por competência (21/07/2026, pedido do Vini) — dentro
          // de cada mês podem existir várias folhas (Salário, Adiantamento,
          // Férias...). `folhas` já vem ordenada por número decrescente (a
          // mais recente primeiro), então o primeiro encontro de cada
          // competência já preserva a ordem "mais recente primeiro" sem
          // precisar reordenar nada.
          <div className="space-y-5">
            {Array.from(new Set(folhas.map((f) => f.competencia))).map((competencia) => {
              const folhasDoMes = folhas.filter((f) => f.competencia === competencia);
              return (
                <div key={competencia}>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-2">
                    {competencia} <span className="font-normal normal-case">· {folhasDoMes.length} folha(s)</span>
                  </h3>
                  <div className="space-y-2">
                    {folhasDoMes.map((f) => (
                      <div key={f.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-4">
                        <div
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                          onClick={() => setFolhaAberta(folhaAberta === f.id ? null : f.id)}
                        >
                          <div>
                            <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                              Folha #{f.numero} — {TIPO_PAGAMENTO_LABEL[f.tipo]}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-slate-400">
                              {f.pagamentos.length} pagamento(s) · total {fmtMoney(Number(f.valorTotal))}
                              {f.dataPagamento ? ` · pagamento em ${fmtDate(f.dataPagamento)}` : ""}
                              {f.descricao ? ` · ${f.descricao}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {f.remessas.map((r) => (
                              <Stamp key={r.id} tone={STATUS_REMESSA_TONE[r.status]}>{`Remessa ${r.numero}: ${STATUS_REMESSA_LABEL[r.status]}`}</Stamp>
                            ))}
                            <Stamp tone={STATUS_FOLHA_TONE[f.status]}>{f.status === "ABERTA" ? "Aberta" : "Fechada"}</Stamp>
                            {/* Exclusão de folha (22/07/2026, pedido do Vini: "poder
                                excluir as folhas de pagamento... que não forem
                                lançadas") — só oferece o botão quando o backend
                                de fato aceitaria (ABERTA e sem remessa gerada),
                                evitando clique que só resultaria em erro. */}
                            {f.status === "ABERTA" && f.remessas.length === 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); excluirFolha(f.id, f.numero); }}
                                aria-label="Excluir folha"
                                className="text-gray-400 hover:text-brand-600"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        {folhaAberta === f.id && (
                          <FolhaDetalhe
                            folha={f}
                            data={data}
                            onChanged={recarregar}
                            onErroValidacao={(msg, detalhes) => { setErro(msg); setErroDetalhes(detalhes); }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : aba === "remessas" ? (
        <div>
          <div className="mb-3">
            <input
              ref={inputRetornoRef}
              type="file"
              accept=".ret,.rem,.txt,.crt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) importarRetorno(file);
              }}
            />
            <Button variant="ghost" onClick={() => inputRetornoRef.current?.click()} disabled={salvando}>
              <Upload size={15} /> {salvando ? "Importando..." : "Importar arquivo de retorno"}
            </Button>
          </div>
          <RemessasSection remessas={remessas} onChanged={recarregar} />
        </div>
      ) : (
        <AvulsosSection
          avulsos={avulsos}
          colaboradores={data.colaboradores}
          onChanged={recarregar}
          onErroValidacao={(msg, detalhes) => { setErro(msg); setErroDetalhes(detalhes); }}
        />
      )}

      {novaFolha && (
        <NovaFolhaModal onSalvar={criarFolha} onFechar={() => setNovaFolha(false)} salvando={salvando} />
      )}
      {configAberta && <ConfiguracaoModal onFechar={() => setConfigAberta(false)} />}
      {/* placeholder pra manter folhaSelecionada usado (detalhe renderiza inline) */}
      {folhaSelecionada ? null : null}
    </div>
  );
}

// ---------------- Revisão de páginas não identificadas ----------------
// Achado do Vini (22/07/2026, testando na prática): um PDF bruto misturando
// gente de folha com gente avulsa (ex: "Ana Luiza/Ágata de folha + Daisy
// avulsa") deixava a página da Daisy sem filtro automático — e a única saída
// era reenviar o PDF INTEIRO pela rota de anexo manual, colando o bruto
// inteiro como "recibo" da pessoa errada. Agora cada página não identificada
// fica estacionada no servidor (ver PASTA_RECIBOS_PENDENTES no backend) e
// este painel oferece: (1) visualizar só aquela página isolada antes de
// decidir, (2) escolher o pagamento certo entre os candidatos desta tela e
// (3) vincular sem reenviar nada. Compartilhado entre FolhaDetalhe e
// AvulsosSection — cada um passa seus próprios candidatos (pagamentos da
// folha vs. avulsos em aberto), já que os dois têm pools diferentes (ver
// comentário em pagamentos.routes.ts sobre por que isso é por design).
function RevisaoRecibosPendentes({
  itens, candidatos, onVinculado, onErroValidacao,
}: {
  itens: PaginaNaoIdentificada[];
  candidatos: { id: string; label: string }[];
  onVinculado: (caminhoRelativo: string) => void;
  onErroValidacao: (msg: string, detalhes: string[]) => void;
}) {
  const { sucesso } = useFeedback();
  const [selecoes, setSelecoes] = useState<Record<string, string>>({});
  const [vinculando, setVinculando] = useState<string | null>(null);
  const [visualizando, setVisualizando] = useState<string | null>(null);

  async function visualizar(caminhoRelativo: string) {
    setVisualizando(caminhoRelativo);
    // Abre a aba ANTES do await — se abrir só depois de a promise resolver,
    // navegadores tratam como popup não-solicitado e bloqueiam.
    const janela = window.open("", "_blank");
    try {
      const { blob } = await pagamentosApi.previewReciboPendente(caminhoRelativo);
      const url = URL.createObjectURL(blob);
      if (janela) janela.location.href = url;
      else onErroValidacao("O navegador bloqueou a aba de visualização — permita pop-ups pra este site.", []);
    } catch (e) {
      janela?.close();
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível abrir a página.", []);
    } finally {
      setVisualizando(null);
    }
  }

  async function vincular(item: PaginaNaoIdentificada) {
    const caminhoRelativo = item.caminhoRelativo;
    const pagamentoId = caminhoRelativo ? selecoes[caminhoRelativo] : undefined;
    if (!caminhoRelativo || !pagamentoId) return;
    setVinculando(caminhoRelativo);
    try {
      const { colaborador } = await pagamentosApi.vincularReciboPendente({ caminhoRelativo, pagamentoId });
      sucesso(`Página ${item.pagina} vinculada ao recibo de ${colaborador}.`);
      onVinculado(caminhoRelativo);
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível vincular a página.", []);
    } finally {
      setVinculando(null);
    }
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-brand-700 dark:text-brand-400 font-medium">
        {itens.length} página(s) não identificada(s) automaticamente — visualize e vincule ao pagamento certo:
      </p>
      {itens.map((n) => (
        <div
          key={n.pagina}
          className="flex flex-wrap items-center gap-1.5 bg-white dark:bg-slate-900/40 border border-gray-100 dark:border-slate-700 rounded p-2"
        >
          <div className="flex-1 min-w-[220px]">
            <p className="text-gray-600 dark:text-slate-300">Página {n.pagina}: {n.motivo}</p>
            <p className="text-gray-400 dark:text-slate-500 italic">"{n.amostraTexto}..."</p>
          </div>
          {n.caminhoRelativo ? (
            <>
              <Button
                variant="ghost"
                onClick={() => visualizar(n.caminhoRelativo!)}
                disabled={visualizando === n.caminhoRelativo}
              >
                {visualizando === n.caminhoRelativo ? "Abrindo..." : "Visualizar página"}
              </Button>
              <Select
                value={selecoes[n.caminhoRelativo] || ""}
                onChange={(e) => setSelecoes((prev) => ({ ...prev, [n.caminhoRelativo!]: e.target.value }))}
                className="!w-auto min-w-[200px] max-w-[260px]"
              >
                <option value="">Vincular a...</option>
                {candidatos.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
              <Button
                variant="primary"
                onClick={() => vincular(n)}
                disabled={!selecoes[n.caminhoRelativo] || vinculando === n.caminhoRelativo}
              >
                {vinculando === n.caminhoRelativo ? "Vinculando..." : "Vincular"}
              </Button>
            </>
          ) : (
            <p className="text-gray-400 dark:text-slate-500 italic">Página expirada — reenvie o PDF.</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- Detalhe da folha ----------------
function FolhaDetalhe({
  folha, data, onChanged, onErroValidacao,
}: {
  folha: FolhaPagamento;
  data: AppData;
  onChanged: () => Promise<void>;
  onErroValidacao: (msg: string, detalhes: string[]) => void;
}) {
  const { sucesso } = useFeedback();
  const [adicionando, setAdicionando] = useState(false);
  const [emLote, setEmLote] = useState(false);
  const [gerando, setGerando] = useState(false);
  // Data de pagamento pré-preenchida com a da folha (21/07/2026) — sempre
  // ajustável aqui, mas evita redigitar o que já foi decidido na criação da
  // folha ou editado logo abaixo em "editandoData".
  const [dataPagamento, setDataPagamento] = useState(folha.dataPagamento ? folha.dataPagamento.slice(0, 10) : "");
  const [editandoData, setEditandoData] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviandoRecibos, setEnviandoRecibos] = useState(false);
  const [resultadoRecibos, setResultadoRecibos] = useState<{
    totalPaginas: number;
    vinculados: { pagina: number; colaborador: string; motivoIdentificacao: "cpf" | "nome" }[];
    naoIdentificados: PaginaNaoIdentificada[];
  } | null>(null);
  const [selecionadosRejeitados, setSelecionadosRejeitados] = useState<string[]>([]);
  const inputRecibosRef = React.useRef<HTMLInputElement>(null);
  const inputReciboAvulsoRef = React.useRef<HTMLInputElement>(null);
  const [pagamentoParaRecibo, setPagamentoParaRecibo] = useState<string | null>(null);
  // Estorno (22/07/2026, pedido do Vini) — o pedido original foi no contexto
  // de avulso, mas a rota do backend vale pra qualquer PagamentoColaborador
  // já PAGO, avulso ou de folha (reversão de Pix/TED pelo banco não escolhe
  // origem) — oferecido aqui também por consistência.
  const [estornando, setEstornando] = useState<PagamentoColaborador | null>(null);

  const podeEditar = folha.status === "ABERTA";
  const pendentes = folha.pagamentos.filter((p) => p.status === "PENDENTE");
  const rejeitados = folha.pagamentos.filter((p) => p.status === "REJEITADO");

  async function adicionarPagamento(form: PagamentoInput) {
    setSalvando(true);
    try {
      await pagamentosApi.criarPagamento(folha.id, form);
      await onChanged();
      setAdicionando(false);
      sucesso("Pagamento lançado.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível lançar o pagamento.", []);
    } finally {
      setSalvando(false);
    }
  }

  async function lancarEmLote(itens: PagamentoLoteItemInput[]) {
    setSalvando(true);
    try {
      const { criados, ignoradosPorJaExistir } = await pagamentosApi.criarPagamentosLote(folha.id, itens);
      await onChanged();
      setEmLote(false);
      sucesso(
        `${criados.length} pagamento(s) lançado(s)` +
          (ignoradosPorJaExistir.length ? ` — ${ignoradosPorJaExistir.length} já tinham pagamento nesta folha e foram ignorados.` : ".")
      );
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível lançar os pagamentos em lote.", []);
    } finally {
      setSalvando(false);
    }
  }

  async function removerPagamento(id: string) {
    try {
      await pagamentosApi.excluirPagamento(id);
      await onChanged();
      sucesso("Pagamento removido.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível remover.", []);
    }
  }

  async function salvarDataPagamento() {
    setSalvando(true);
    try {
      await pagamentosApi.atualizarFolha(folha.id, { dataPagamento: dataPagamento || null });
      await onChanged();
      setEditandoData(false);
      sucesso("Data de pagamento da folha atualizada.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível atualizar a data.", []);
    } finally {
      setSalvando(false);
    }
  }

  async function gerarRemessa(somenteRejeitados: boolean) {
    if (!dataPagamento) return;
    setSalvando(true);
    try {
      const remessa = await pagamentosApi.gerarRemessa(folha.id, {
        dataPagamento,
        ...(somenteRejeitados ? { pagamentoIds: selecionadosRejeitados } : {}),
      });
      await onChanged();
      setGerando(false);
      setSelecionadosRejeitados([]);
      // Download imediato do arquivo gerado — o mesmo que fica guardado pra
      // re-download na aba Remessas.
      const { blob, nomeArquivo } = await pagamentosApi.baixarArquivoRemessa(remessa.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo || remessa.arquivoNome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      sucesso(`Remessa ${remessa.numero} gerada — arquivo baixado, pronto pra enviar ao banco.`);
    } catch (e) {
      if (e instanceof ApiError) {
        const detalhes = Array.isArray((e as ApiError & { detalhes?: unknown }).detalhes)
          ? ((e as ApiError & { detalhes?: string[] }).detalhes as string[])
          : [];
        onErroValidacao(e.message, detalhes);
      } else {
        onErroValidacao("Não foi possível gerar a remessa.", []);
      }
    } finally {
      setSalvando(false);
    }
  }

  // Upload do PDF bruto com todos os recibos da folha (21/07/2026, pedido do
  // Vini) — o backend separa por página e vincula por CPF/nome; o que não
  // dá pra identificar automaticamente volta na lista de "não
  // identificados" pra resolver manualmente (nunca um chute).
  async function enviarPdfRecibos(file: File) {
    setEnviandoRecibos(true);
    setResultadoRecibos(null);
    try {
      const resultado = await pagamentosApi.uploadRecibosFolha(folha.id, file);
      await onChanged();
      setResultadoRecibos(resultado);
      sucesso(`${resultado.vinculados.length} de ${resultado.totalPaginas} página(s) vinculada(s) automaticamente.`);
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível processar o PDF de recibos.", []);
    } finally {
      setEnviandoRecibos(false);
    }
  }

  async function baixarRecibo(pagamentoId: string, nomeColaborador: string) {
    try {
      const { blob } = await pagamentosApi.baixarRecibo(pagamentoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recibo-${nomeColaborador.replace(/\s+/g, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível baixar o recibo.", []);
    }
  }

  async function anexarReciboAvulso(pagamentoId: string, file: File) {
    setSalvando(true);
    try {
      await pagamentosApi.anexarReciboManual(pagamentoId, file);
      await onChanged();
      sucesso("Recibo anexado.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível anexar o recibo.", []);
    } finally {
      setSalvando(false);
      setPagamentoParaRecibo(null);
    }
  }

  function alternarSelecaoRejeitado(id: string) {
    setSelecionadosRejeitados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function confirmarEstorno(dados: { motivo: string; dataEstorno: string | null }) {
    if (!estornando) return;
    setSalvando(true);
    try {
      await pagamentosApi.estornarPagamento(estornando.id, dados);
      await onChanged();
      setEstornando(null);
      sucesso("Pagamento marcado como estornado.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível registrar o estorno.", []);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
      {/* Data única de pagamento da folha (21/07/2026) — o CNAB só comporta
          uma data por remessa; aqui dá pra ver/ajustar antes de gerar. */}
      <div className="flex items-center gap-2 mb-3 text-xs">
        <span className="text-gray-500 dark:text-slate-400">Data de pagamento da folha:</span>
        {editandoData ? (
          <>
            <TextInput type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
            <Button variant="primary" onClick={salvarDataPagamento} disabled={salvando}>Salvar</Button>
            <Button variant="ghost" onClick={() => { setEditandoData(false); setDataPagamento(folha.dataPagamento ? folha.dataPagamento.slice(0, 10) : ""); }}>Cancelar</Button>
          </>
        ) : (
          <>
            <span className="font-medium text-slate-800 dark:text-slate-200">{folha.dataPagamento ? fmtDate(folha.dataPagamento) : "não definida"}</span>
            {podeEditar && <button className="text-brand-600 hover:underline" onClick={() => setEditandoData(true)}>editar</button>}
          </>
        )}
      </div>

      {folha.pagamentos.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">Nenhum pagamento lançado nesta folha ainda.</p>
      ) : (
        <div className="overflow-x-auto mb-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-slate-400 uppercase text-[10px]">
                <th className="py-1.5 pr-3" />
                <th className="py-1.5 pr-3">Nº</th>
                <th className="py-1.5 pr-3">Colaborador</th>
                <th className="py-1.5 pr-3">Tipo</th>
                <th className="py-1.5 pr-3">Valor</th>
                <th className="py-1.5 pr-3">Prevista</th>
                <th className="py-1.5 pr-3">Situação</th>
                <th className="py-1.5 pr-3">Recibo</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {folha.pagamentos.map((p) => (
                <tr key={p.id} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3">
                    {p.status === "REJEITADO" && (
                      <input
                        type="checkbox"
                        checked={selecionadosRejeitados.includes(p.id)}
                        onChange={() => alternarSelecaoRejeitado(p.id)}
                        aria-label="Selecionar para reenvio"
                      />
                    )}
                  </td>
                  <td className="py-1.5 pr-3" style={{ fontFamily: FONT_MONO }}>{p.numero}</td>
                  <td className="py-1.5 pr-3 text-slate-800 dark:text-slate-200">{p.colaborador?.nomeCompleto}</td>
                  <td className="py-1.5 pr-3">{TIPO_PAGAMENTO_LABEL[p.tipo]}</td>
                  <td className="py-1.5 pr-3" style={{ fontFamily: FONT_MONO }}>{fmtMoney(Number(p.valor))}</td>
                  <td className="py-1.5 pr-3">{p.dataPrevista ? fmtDate(p.dataPrevista) : "—"}</td>
                  <td className="py-1.5 pr-3">
                    <Stamp tone={STATUS_PAGAMENTO_TONE[p.status]}>{STATUS_PAGAMENTO_LABEL[p.status]}</Stamp>
                    {p.ocorrencias && <span className="block text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{p.ocorrencias}</span>}
                    {p.status === "ESTORNADO" && p.motivoEstorno && (
                      <span className="block text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
                        {p.motivoEstorno}{p.dataEstorno ? ` · ${fmtDate(p.dataEstorno)}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {p.reciboUrl ? (
                      <button
                        className="text-brand-600 hover:underline flex items-center gap-1"
                        onClick={() => baixarRecibo(p.id, p.colaborador?.nomeCompleto || "colaborador")}
                        title={p.reciboNomeOriginal || undefined}
                      >
                        <Download size={12} /> baixar
                      </button>
                    ) : (
                      <button className="text-gray-400 hover:text-brand-600" onClick={() => { setPagamentoParaRecibo(p.id); inputReciboAvulsoRef.current?.click(); }}>
                        anexar
                      </button>
                    )}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {p.status === "PAGO" && (
                      <button onClick={() => setEstornando(p)} className="text-brand-600 hover:underline mr-3">estornar</button>
                    )}
                    {p.status === "PENDENTE" && podeEditar && (
                      <button onClick={() => removerPagamento(p.id)} aria-label="Remover pagamento" className="text-gray-400 hover:text-brand-600"><X size={13} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Input escondido reutilizado pro anexo manual avulso de recibo —
          alternativa ao split automático, pra quando o recibo de alguém não
          veio no PDF bruto ou não foi identificado automaticamente. */}
      <input
        ref={inputReciboAvulsoRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && pagamentoParaRecibo) anexarReciboAvulso(pagamentoParaRecibo, file);
        }}
      />

      {podeEditar && (
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="ghost" onClick={() => setAdicionando(true)}><Plus size={14} /> Lançar pagamento</Button>
          <Button variant="ghost" onClick={() => setEmLote(true)}><Plus size={14} /> Adicionar colaboradores em lote</Button>
          <input
            ref={inputRecibosRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) enviarPdfRecibos(file);
            }}
          />
          {/* Achado de auditoria F8 (22/07/2026): botão ficava visível mesmo
              sem nenhum pagamento lançado na folha ainda (nada pra vincular
              recibo nenhum) — mesmo critério já usado no botão "Gerar
              Remessa CNAB" logo abaixo (`pendentes.length > 0`). */}
          {folha.pagamentos.length > 0 && (
            <Button variant="ghost" onClick={() => inputRecibosRef.current?.click()} disabled={enviandoRecibos}>
              <Upload size={14} /> {enviandoRecibos ? "Processando..." : "Anexar PDF de recibos (folha inteira)"}
            </Button>
          )}
          {pendentes.length > 0 && (
            gerando ? (
              <div className="flex items-end gap-2">
                <Field label="Data de pagamento">
                  <TextInput type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
                </Field>
                <Button variant="primary" onClick={() => gerarRemessa(false)} disabled={salvando || !dataPagamento}>
                  {salvando ? "Gerando..." : `Confirmar (${pendentes.length} pagamento(s))`}
                </Button>
                <Button variant="ghost" onClick={() => setGerando(false)}>Cancelar</Button>
              </div>
            ) : (
              <Button variant="primary" onClick={() => setGerando(true)}>
                <Banknote size={14} /> Gerar Remessa CNAB
              </Button>
            )
          )}
          {rejeitados.length > 0 && selecionadosRejeitados.length > 0 && (
            <Button variant="primary" onClick={() => gerarRemessa(true)} disabled={salvando || !dataPagamento}>
              {salvando ? "Gerando..." : `Reenviar ${selecionadosRejeitados.length} rejeitado(s)`}
            </Button>
          )}
        </div>
      )}

      {resultadoRecibos && (
        <div className="mt-3 text-xs bg-slate-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3">
          <p className="font-medium text-slate-800 dark:text-slate-200 mb-1">
            PDF processado: {resultadoRecibos.totalPaginas} página(s), {resultadoRecibos.vinculados.length} vinculada(s) automaticamente.
          </p>
          {resultadoRecibos.naoIdentificados.length > 0 && (
            <RevisaoRecibosPendentes
              itens={resultadoRecibos.naoIdentificados}
              candidatos={folha.pagamentos.map((p) => ({
                id: p.id,
                label: `${p.colaborador?.nomeCompleto || "?"} — ${TIPO_PAGAMENTO_LABEL[p.tipo]} — ${fmtMoney(p.valor)}`,
              }))}
              onVinculado={(caminhoRelativo) => {
                setResultadoRecibos((prev) =>
                  prev ? { ...prev, naoIdentificados: prev.naoIdentificados.filter((n) => n.caminhoRelativo !== caminhoRelativo) } : prev
                );
                onChanged();
              }}
              onErroValidacao={onErroValidacao}
            />
          )}
        </div>
      )}

      {adicionando && (
        <PagamentoModal
          colaboradores={data.colaboradores}
          tipoFolha={folha.tipo}
          onSalvar={adicionarPagamento}
          onFechar={() => setAdicionando(false)}
          salvando={salvando}
        />
      )}
      {emLote && (
        <LancamentoLoteModal
          colaboradores={data.colaboradores}
          folha={folha}
          onSalvar={lancarEmLote}
          onFechar={() => setEmLote(false)}
          salvando={salvando}
        />
      )}
      {estornando && (
        <EstornoModal
          pagamento={estornando}
          onSalvar={confirmarEstorno}
          onFechar={() => setEstornando(null)}
          salvando={salvando}
        />
      )}
    </div>
  );
}

// Lançamento em lote (21/07/2026, pedido do Vini) — seleciona vários
// colaboradores de uma vez, trazendo o salário/adiantamento padrão
// cadastrado (conforme o tipo da folha) como SUGESTÃO de valor pra cada um,
// sempre editável linha a linha antes de confirmar. Busca os dados
// bancários (que carregam salarioPadrao/valorAdiantamentoPadrao) só pra
// quem for selecionado, um de cada vez — evita puxar dado sensível de
// salário de todo mundo de uma vez só por causa desta tela.
function LancamentoLoteModal({
  colaboradores, folha, onSalvar, onFechar, salvando,
}: {
  colaboradores: AppData["colaboradores"];
  folha: FolhaPagamento;
  onSalvar: (itens: PagamentoLoteItemInput[]) => void;
  onFechar: () => void;
  salvando: boolean;
}) {
  const jaLancados = new Set(folha.pagamentos.filter((p) => p.status !== "CANCELADO").map((p) => p.colaboradorId));
  const disponiveis = colaboradores.filter((c) => colaboradorOperacionalmenteAtivo(c.status) && !jaLancados.has(c.id));
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [valores, setValores] = useState<Record<string, string>>({});
  const [carregandoId, setCarregandoId] = useState<string | null>(null);

  async function alternar(colaboradorId: string) {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(colaboradorId)) {
        novo.delete(colaboradorId);
      } else {
        novo.add(colaboradorId);
      }
      return novo;
    });
    if (!selecionados.has(colaboradorId) && valores[colaboradorId] === undefined) {
      setCarregandoId(colaboradorId);
      try {
        const dados: DadosBancariosColaborador | null = await pagamentosApi.dadosBancarios(colaboradorId);
        const sugestao =
          folha.tipo === "SALARIO" ? dados?.salarioPadrao : folha.tipo === "ADIANTAMENTO" ? dados?.valorAdiantamentoPadrao : null;
        setValores((prev) => ({ ...prev, [colaboradorId]: sugestao != null ? String(sugestao) : "" }));
      } catch {
        setValores((prev) => ({ ...prev, [colaboradorId]: "" }));
      } finally {
        setCarregandoId(null);
      }
    }
  }

  function confirmar() {
    const itens: PagamentoLoteItemInput[] = Array.from(selecionados)
      .map((id) => ({ colaboradorId: id, valor: parseValorMonetario(valores[id] || "0") }))
      .filter((i) => i.valor > 0);
    if (itens.length > 0) onSalvar(itens);
  }

  return (
    <Modal title={`Adicionar colaboradores — ${TIPO_PAGAMENTO_LABEL[folha.tipo]}`} onClose={onFechar}>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
        O valor sugerido vem do {folha.tipo === "SALARIO" ? "salário" : folha.tipo === "ADIANTAMENTO" ? "adiantamento" : "cadastro"} padrão do colaborador, quando cadastrado — sempre editável, nunca obrigatório bater.
      </p>
      <div className="max-h-80 overflow-y-auto space-y-1.5 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
        {disponiveis.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-slate-500 p-2">Todos os colaboradores ativos já têm pagamento lançado nesta folha.</p>
        ) : (
          disponiveis.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={selecionados.has(c.id)} onChange={() => alternar(c.id)} />
              <span className="flex-1 text-slate-800 dark:text-slate-200">{c.nomeCompleto}</span>
              {selecionados.has(c.id) && (
                carregandoId === c.id ? (
                  <Spinner size={14} />
                ) : (
                  <TextInput
                    type="number"
                    step="0.01"
                    min="0"
                    className="!w-28"
                    value={valores[c.id] ?? ""}
                    onChange={(e) => setValores((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    placeholder="Valor (R$)"
                  />
                )
              )}
            </div>
          ))
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
        <Button variant="primary" onClick={confirmar} disabled={salvando || selecionados.size === 0}>
          {salvando ? "Lançando..." : `Lançar (${selecionados.size})`}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------- Lista de remessas ----------------
// Achado de auditoria F7 (22/07/2026): a lista de remessas era um `.map`
// direto sem busca nem paginação — mesmo padrão de dor já corrigido em 5+
// outras telas do sistema (Colaboradores, Equipamentos, Linhas...). Extraída
// pra componente próprio só pra caber o estado de busca/paginação sem inchar
// mais o corpo de PagamentosPage. Busca por número da remessa, competência/
// número da folha vinculada, status ou nome de quem gerou.
function RemessasSection({ remessas, onChanged }: { remessas: RemessaCnab[]; onChanged: () => Promise<void> }) {
  const [busca, setBusca] = useState("");
  const filtradas = remessas.filter((r) => {
    const alvo = busca.toLowerCase();
    if (!alvo) return true;
    const nomeGerador = r.geradoPor?.colaborador?.nomeCompleto || r.geradoPor?.email || "";
    return (
      String(r.numero).includes(alvo) ||
      (r.folha ? `${r.folha.competencia} #${r.folha.numero}`.toLowerCase().includes(alvo) : false) ||
      STATUS_REMESSA_LABEL[r.status].toLowerCase().includes(alvo) ||
      nomeGerador.toLowerCase().includes(alvo) ||
      r.arquivoNome.toLowerCase().includes(alvo)
    );
  });
  const { itensPagina, pagina, totalPaginas, setPagina, total, inicioExibicao, fimExibicao } =
    usePaginacaoCliente(filtradas, 20);

  if (remessas.length === 0) {
    return <EmptyState icon={Banknote} text="Nenhuma remessa gerada ainda." />;
  }
  return (
    <div>
      <div className="mb-3">
        <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por número, folha, status ou responsável..." />
      </div>
      {filtradas.length === 0 ? (
        <EmptyState icon={Banknote} text="Nenhuma remessa encontrada com os filtros atuais." />
      ) : (
        <>
          <div className="space-y-2">
            {itensPagina.map((r) => (
              <RemessaCard key={r.id} remessa={r} onChanged={onChanged} />
            ))}
          </div>
          <Paginacao
            pagina={pagina}
            totalPaginas={totalPaginas}
            onChange={setPagina}
            total={total}
            inicioExibicao={inicioExibicao}
            fimExibicao={fimExibicao}
            itemLabel="remessas"
          />
        </>
      )}
    </div>
  );
}

// ---------------- Card de remessa ----------------
function RemessaCard({ remessa, onChanged }: { remessa: RemessaCnab; onChanged: () => Promise<void> }) {
  const { sucesso } = useFeedback();
  const [expandida, setExpandida] = useState(false);
  const [agindo, setAgindo] = useState(false);
  const nomeUsuario = remessa.geradoPor?.colaborador?.nomeCompleto || remessa.geradoPor?.email || "—";

  async function baixar() {
    const { blob, nomeArquivo } = await pagamentosApi.baixarArquivoRemessa(remessa.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo || remessa.arquivoNome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function mudarStatus(status: "ENVIADA" | "CANCELADA") {
    setAgindo(true);
    try {
      await pagamentosApi.mudarStatusRemessa(remessa.id, status);
      await onChanged();
      sucesso(status === "ENVIADA" ? "Remessa marcada como enviada." : "Remessa cancelada — pagamentos voltaram pra pendente.");
    } finally {
      setAgindo(false);
    }
  }

  async function excluir() {
    if (!window.confirm(`Excluir a remessa nº ${remessa.numero}? Os pagamentos ligados voltam para pendentes.`)) return;
    setAgindo(true);
    try {
      await pagamentosApi.excluirRemessa(remessa.id);
      await onChanged();
      sucesso("Remessa excluída — pagamentos voltaram pra pendente.");
    } finally {
      setAgindo(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer" onClick={() => setExpandida(!expandida)}>
        <div>
          <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">
            Remessa nº {remessa.numero}
            {remessa.folha ? ` — Folha #${remessa.folha.numero} (${remessa.folha.competencia})` : ""}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            {new Date(remessa.dataGeracao).toLocaleString("pt-BR")} · {nomeUsuario} · {remessa.quantidadePagamentos} pagamento(s) · {fmtMoney(Number(remessa.valorTotal))}
          </p>
        </div>
        <Stamp tone={STATUS_REMESSA_TONE[remessa.status]}>{STATUS_REMESSA_LABEL[remessa.status]}</Stamp>
      </div>
      {expandida && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
          <ul className="text-xs space-y-1 mb-3">
            {remessa.pagamentos.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span>{p.colaborador?.nomeCompleto} — {TIPO_PAGAMENTO_LABEL[p.tipo]}</span>
                <span style={{ fontFamily: FONT_MONO }}>
                  {fmtMoney(Number(p.valor))} · {STATUS_PAGAMENTO_LABEL[p.status]}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={baixar}><Download size={14} /> Baixar arquivo</Button>
            {remessa.status === "GERADA" && (
              <Button variant="ghost" onClick={() => mudarStatus("ENVIADA")} disabled={agindo}>Marcar como enviada</Button>
            )}
            {(remessa.status === "GERADA" || remessa.status === "ENVIADA") && (
              <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => mudarStatus("CANCELADA")} disabled={agindo}>
                Cancelar remessa
              </Button>
            )}
            {/* Exclusão definitiva (22/07/2026, pedido do Vini: "poder excluir
                remessas que não forem lançadas") — só enquanto GERADA (ver
                gate igual no backend); depois de ENVIADA só dá pra cancelar,
                nunca apagar, porque o arquivo já pode ter sido entregue ao
                banco fisicamente. */}
            {remessa.status === "GERADA" && (
              <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={excluir} disabled={agindo}>
                <X size={14} /> Excluir remessa
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Pagamentos avulsos ----------------
// 22/07/2026, pedido do Vini: "incluir pagamentos avulsos em geral, apenas
// para ter registro, sem precisar de arquivo de remessa nem nada". Aba
// independente de Folhas/Remessas — lista plana, sem agrupamento por
// competência (não faz sentido pra algo que por definição não pertence a
// nenhuma folha). Reaproveita as MESMAS rotas genéricas de edição/exclusão/
// recibo que os pagamentos de folha já usavam (excluirPagamento,
// atualizarPagamento), só a criação e a listagem têm rota própria
// (pagamentosAvulsos/criarPagamentoAvulso), e "marcar como pago" é
// exclusivo daqui (quem tem folha/remessa recebe baixa automática pelo
// retorno CNAB).
function AvulsosSection({
  avulsos, colaboradores, onChanged, onErroValidacao,
}: {
  avulsos: PagamentoColaborador[];
  colaboradores: AppData["colaboradores"];
  onChanged: () => Promise<void>;
  onErroValidacao: (msg: string, detalhes: string[]) => void;
}) {
  const { sucesso } = useFeedback();
  const [novoAberto, setNovoAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [agindoId, setAgindoId] = useState<string | null>(null);
  // Recibo por avulso (22/07/2026, pedido do Vini: "anexar o recibo pdf...
  // em cada pagamento avulso e deixar todo tipo de pagamento feito
  // disponível para o colaborador correspondente") — reaproveita a MESMA
  // rota genérica de anexo manual que a Folha já usa (POST
  // .../pagamentos-colaborador/:id/recibo), só que direto na linha do
  // avulso, já que aqui não existe PDF de "folha inteira" pra dividir
  // automaticamente — é sempre um lançamento avulso, um recibo por vez.
  // Ficar disponível pro colaborador no Portal já é automático assim que o
  // recibo é anexado: GET /perfil/pagamentos devolve TODO PagamentoColaborador
  // do próprio colaborador, independente de folhaId — não precisa de nenhum
  // passo extra de "publicar" ou "fixar".
  const [enviandoReciboId, setEnviandoReciboId] = useState<string | null>(null);
  const [pagamentoParaRecibo, setPagamentoParaRecibo] = useState<string | null>(null);
  const inputReciboRef = React.useRef<HTMLInputElement>(null);
  // Split automático do PDF bruto pra avulsos (22/07/2026, pedido do Vini:
  // "adiciona aquele mesmo filtro de PDF bruto que tem em remessa") — mesmo
  // mecanismo da Folha (ver enviarPdfRecibos em FolhaDetalhe), mas casando
  // cada página contra TODOS os avulsos em aberto, já que aqui não existe um
  // agrupamento natural tipo "folha".
  const [enviandoRecibosLote, setEnviandoRecibosLote] = useState(false);
  const [resultadoRecibosLote, setResultadoRecibosLote] = useState<{
    totalPaginas: number;
    vinculados: { pagina: number; colaborador: string; motivoIdentificacao: "cpf" | "nome" }[];
    naoIdentificados: PaginaNaoIdentificada[];
  } | null>(null);
  const inputRecibosLoteRef = React.useRef<HTMLInputElement>(null);
  // Edição (22/07/2026, pedido do Vini: "poder editar a o pagamento avulso")
  // — reaproveita a rota genérica atualizarPagamento; só oferecida quando o
  // backend de fato aceitaria (PENDENTE ou REJEITADO), evitando clique que
  // só resultaria em erro 409.
  const [editando, setEditando] = useState<PagamentoColaborador | null>(null);
  // Estorno (22/07/2026, pedido do Vini: "ter uma forma de estorno, pois
  // muitas vezes o pagamento via Pix, TED, etc é estornado e dias depois o
  // financeiro descobre") — só oferecido quando PAGO.
  const [estornando, setEstornando] = useState<PagamentoColaborador | null>(null);
  // Achado de auditoria F7 (22/07/2026): esta tabela crescia sem busca nem
  // paginação — mesmo padrão já corrigido em 5+ outras telas (ver
  // usePaginacaoCliente/SearchBox em Colaboradores.tsx/Equipamentos.tsx/
  // Linhas.tsx). Busca por colaborador, tipo, forma de pagamento ou
  // observações, que são os campos com texto livre/rótulo pesquisável desta
  // tabela.
  const [busca, setBusca] = useState("");
  const avulsosFiltrados = avulsos.filter((p) => {
    const alvo = busca.toLowerCase();
    if (!alvo) return true;
    return (
      (p.colaborador?.nomeCompleto || "").toLowerCase().includes(alvo) ||
      TIPO_PAGAMENTO_LABEL[p.tipo].toLowerCase().includes(alvo) ||
      (p.formaPagamento ? FORMA_PAGAMENTO_LABEL[p.formaPagamento].toLowerCase().includes(alvo) : false) ||
      (p.observacoes || "").toLowerCase().includes(alvo)
    );
  });
  const { itensPagina: avulsosPagina, pagina, totalPaginas, setPagina, total, inicioExibicao, fimExibicao } =
    usePaginacaoCliente(avulsosFiltrados, 20);

  async function criar(form: PagamentoInput) {
    setSalvando(true);
    try {
      await pagamentosApi.criarPagamentoAvulso(form);
      await onChanged();
      setNovoAberto(false);
      sucesso("Pagamento avulso registrado.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível registrar o pagamento avulso.", []);
    } finally {
      setSalvando(false);
    }
  }

  async function anexarRecibo(pagamentoId: string, file: File) {
    setEnviandoReciboId(pagamentoId);
    try {
      await pagamentosApi.anexarReciboManual(pagamentoId, file);
      await onChanged();
      sucesso("Recibo anexado — já disponível para o colaborador no Portal.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível anexar o recibo.", []);
    } finally {
      setEnviandoReciboId(null);
      setPagamentoParaRecibo(null);
    }
  }

  async function baixarRecibo(pagamentoId: string, nomeColaborador: string) {
    try {
      const { blob } = await pagamentosApi.baixarRecibo(pagamentoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recibo-${nomeColaborador.replace(/\s+/g, "-").toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível baixar o recibo.", []);
    }
  }

  async function marcarPago(id: string) {
    setAgindoId(id);
    try {
      await pagamentosApi.marcarPago(id);
      await onChanged();
      sucesso("Pagamento marcado como pago.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível marcar como pago.", []);
    } finally {
      setAgindoId(null);
    }
  }

  async function excluir(id: string) {
    if (!window.confirm("Excluir este pagamento avulso?")) return;
    setAgindoId(id);
    try {
      await pagamentosApi.excluirPagamento(id);
      await onChanged();
      sucesso("Pagamento avulso excluído.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível excluir.", []);
    } finally {
      setAgindoId(null);
    }
  }

  async function salvarEdicao(form: PagamentoInput) {
    if (!editando) return;
    setSalvando(true);
    try {
      await pagamentosApi.atualizarPagamento(editando.id, form);
      await onChanged();
      setEditando(null);
      sucesso("Pagamento avulso atualizado.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível salvar as alterações.", []);
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarEstorno(dados: { motivo: string; dataEstorno: string | null }) {
    if (!estornando) return;
    setSalvando(true);
    try {
      await pagamentosApi.estornarPagamento(estornando.id, dados);
      await onChanged();
      setEstornando(null);
      sucesso("Pagamento marcado como estornado.");
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível registrar o estorno.", []);
    } finally {
      setSalvando(false);
    }
  }

  async function enviarPdfRecibosLote(file: File) {
    setEnviandoRecibosLote(true);
    setResultadoRecibosLote(null);
    try {
      const resultado = await pagamentosApi.uploadRecibosAvulsos(file);
      await onChanged();
      setResultadoRecibosLote(resultado);
      sucesso(`${resultado.vinculados.length} de ${resultado.totalPaginas} página(s) vinculada(s) automaticamente.`);
    } catch (e) {
      onErroValidacao(e instanceof ApiError ? e.message : "Não foi possível processar o PDF de recibos.", []);
    } finally {
      setEnviandoRecibosLote(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setNovoAberto(true)}><Plus size={15} /> Novo Pagamento Avulso</Button>
        <input
          ref={inputRecibosLoteRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) enviarPdfRecibosLote(file);
          }}
        />
        {/* Achado de auditoria F8 (22/07/2026): condicionado à existência de
            pelo menos um avulso lançado — sem isso não há nada pra vincular
            (a própria rota do backend recusa com 409 nesse caso). */}
        {avulsos.length > 0 && (
          <Button variant="ghost" onClick={() => inputRecibosLoteRef.current?.click()} disabled={enviandoRecibosLote}>
            <Upload size={15} /> {enviandoRecibosLote ? "Processando..." : "Anexar PDF de recibos (múltiplos avulsos)"}
          </Button>
        )}
      </div>
      {avulsos.length > 0 && (
        <div className="mb-3">
          <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por colaborador, tipo, forma ou observações..." />
        </div>
      )}
      {resultadoRecibosLote && (
        <div className="mb-3 text-xs bg-slate-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3">
          <p className="font-medium text-slate-800 dark:text-slate-200 mb-1">
            PDF processado: {resultadoRecibosLote.totalPaginas} página(s), {resultadoRecibosLote.vinculados.length} vinculada(s) automaticamente.
          </p>
          {resultadoRecibosLote.naoIdentificados.length > 0 && (
            <RevisaoRecibosPendentes
              itens={resultadoRecibosLote.naoIdentificados}
              candidatos={avulsos.map((p) => ({
                id: p.id,
                label: `${p.colaborador?.nomeCompleto || "?"} — ${TIPO_PAGAMENTO_LABEL[p.tipo]} — ${fmtMoney(p.valor)}`,
              }))}
              onVinculado={(caminhoRelativo) => {
                setResultadoRecibosLote((prev) =>
                  prev ? { ...prev, naoIdentificados: prev.naoIdentificados.filter((n) => n.caminhoRelativo !== caminhoRelativo) } : prev
                );
                onChanged();
              }}
              onErroValidacao={onErroValidacao}
            />
          )}
        </div>
      )}
      {avulsos.length === 0 ? (
        <EmptyState icon={Banknote} text="Nenhum pagamento avulso registrado ainda." />
      ) : avulsosFiltrados.length === 0 ? (
        <EmptyState icon={Banknote} text="Nenhum pagamento avulso encontrado com os filtros atuais." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-slate-400 uppercase text-[10px]">
                <th className="py-1.5 pr-3">Nº</th>
                <th className="py-1.5 pr-3">Colaborador</th>
                <th className="py-1.5 pr-3">Tipo</th>
                <th className="py-1.5 pr-3">Valor</th>
                <th className="py-1.5 pr-3">Forma</th>
                <th className="py-1.5 pr-3">Prevista</th>
                <th className="py-1.5 pr-3">Observações</th>
                <th className="py-1.5 pr-3">Situação</th>
                <th className="py-1.5 pr-3">Recibo</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {avulsosPagina.map((p) => (
                <tr key={p.id} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3" style={{ fontFamily: FONT_MONO }}>{p.numero}</td>
                  <td className="py-1.5 pr-3 text-slate-800 dark:text-slate-200">{p.colaborador?.nomeCompleto}</td>
                  <td className="py-1.5 pr-3">{TIPO_PAGAMENTO_LABEL[p.tipo]}</td>
                  <td className="py-1.5 pr-3" style={{ fontFamily: FONT_MONO }}>{fmtMoney(Number(p.valor))}</td>
                  <td className="py-1.5 pr-3">{p.formaPagamento ? FORMA_PAGAMENTO_LABEL[p.formaPagamento] : "—"}</td>
                  <td className="py-1.5 pr-3">{p.dataPrevista ? fmtDate(p.dataPrevista) : "—"}</td>
                  <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{p.observacoes || "—"}</td>
                  <td className="py-1.5 pr-3">
                    <Stamp tone={STATUS_PAGAMENTO_TONE[p.status]}>{STATUS_PAGAMENTO_LABEL[p.status]}</Stamp>
                    {p.status === "ESTORNADO" && p.motivoEstorno && (
                      <span className="block text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
                        {p.motivoEstorno}{p.dataEstorno ? ` · ${fmtDate(p.dataEstorno)}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {enviandoReciboId === p.id ? (
                      <Spinner size={13} />
                    ) : p.reciboUrl ? (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <button
                          className="text-brand-600 hover:underline flex items-center gap-1"
                          onClick={() => baixarRecibo(p.id, p.colaborador?.nomeCompleto || "colaborador")}
                          title={p.reciboNomeOriginal || undefined}
                        >
                          <Download size={12} /> baixar
                        </button>
                        {/* Substituir anexo (22/07/2026, pedido do Vini: "um
                            botão para substituir anexo") — o backend já
                            sobrescreve o arquivo anterior sozinho (mesma
                            rota de anexo manual), só faltava a entrada na
                            UI pra reabrir o seletor de arquivo quando já
                            existe um recibo. */}
                        <button
                          className="text-gray-400 hover:text-brand-600 flex items-center gap-1"
                          onClick={() => { setPagamentoParaRecibo(p.id); inputReciboRef.current?.click(); }}
                        >
                          <Upload size={12} /> trocar
                        </button>
                      </span>
                    ) : (
                      <button
                        className="text-gray-400 hover:text-brand-600 flex items-center gap-1"
                        onClick={() => { setPagamentoParaRecibo(p.id); inputReciboRef.current?.click(); }}
                      >
                        <Upload size={12} /> anexar
                      </button>
                    )}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {(p.status === "PENDENTE" || p.status === "REJEITADO") && (
                      <button
                        onClick={() => setEditando(p)}
                        disabled={agindoId === p.id}
                        className="text-slate-500 dark:text-slate-400 hover:underline mr-3"
                      >
                        editar
                      </button>
                    )}
                    {p.status === "PENDENTE" && (
                      <button
                        onClick={() => marcarPago(p.id)}
                        disabled={agindoId === p.id}
                        className="text-brand-600 hover:underline mr-3"
                      >
                        marcar pago
                      </button>
                    )}
                    {/* Estorno (22/07/2026, pedido do Vini) — só faz sentido
                        pra quem já foi de fato pago; PENDENTE já tem
                        "excluir" pra desfazer um lançamento errado. */}
                    {p.status === "PAGO" && (
                      <button
                        onClick={() => setEstornando(p)}
                        disabled={agindoId === p.id}
                        className="text-brand-600 hover:underline mr-3"
                      >
                        estornar
                      </button>
                    )}
                    {p.status === "PENDENTE" && (
                      <button onClick={() => excluir(p.id)} aria-label="Excluir pagamento" className="text-gray-400 hover:text-brand-600" disabled={agindoId === p.id}>
                        <X size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Paginacao
            pagina={pagina}
            totalPaginas={totalPaginas}
            onChange={setPagina}
            total={total}
            inicioExibicao={inicioExibicao}
            fimExibicao={fimExibicao}
            itemLabel="pagamentos avulsos"
          />
        </div>
      )}
      {/* Input escondido reutilizado por todas as linhas — `pagamentoParaRecibo`
          guarda qual avulso recebe o próximo arquivo escolhido. */}
      <input
        ref={inputReciboRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && pagamentoParaRecibo) anexarRecibo(pagamentoParaRecibo, file);
        }}
      />
      {novoAberto && (
        <PagamentoModal
          colaboradores={colaboradores}
          tipoFolha="OUTROS"
          onSalvar={criar}
          onFechar={() => setNovoAberto(false)}
          salvando={salvando}
        />
      )}
      {editando && (
        <PagamentoModal
          colaboradores={colaboradores}
          tipoFolha={editando.tipo}
          pagamento={editando}
          onSalvar={salvarEdicao}
          onFechar={() => setEditando(null)}
          salvando={salvando}
        />
      )}
      {estornando && (
        <EstornoModal
          pagamento={estornando}
          onSalvar={confirmarEstorno}
          onFechar={() => setEstornando(null)}
          salvando={salvando}
        />
      )}
    </div>
  );
}

// ---------------- Modais ----------------
function NovaFolhaModal({
  onSalvar, onFechar, salvando,
}: { onSalvar: (competencia: string, descricao: string, tipo: TipoPagamentoColaborador, dataPagamento: string) => void; onFechar: () => void; salvando: boolean }) {
  const [competencia, setCompetencia] = useState(competenciaPadrao());
  const [tipo, setTipo] = useState<TipoPagamentoColaborador>("SALARIO");
  const [descricao, setDescricao] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  return (
    <Modal title="Nova Folha de Pagamento" onClose={onFechar}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Competência">
          <TextInput value={competencia} onChange={(e) => setCompetencia(e.target.value)} placeholder="Ex: Julho/2026" />
        </Field>
        {/* Tipo da folha (21/07/2026, pedido do Vini) — dentro da mesma
            competência podem existir várias folhas, uma por tipo (Salário,
            Adiantamento, Férias...). Todo pagamento lançado nesta folha
            herda este tipo por padrão. */}
        <Field label="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoPagamentoColaborador)}>
            {Object.entries(TIPO_PAGAMENTO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Descrição (opcional)">
        <TextInput value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Folha mensal" />
      </Field>
      <Field label="Data de pagamento (opcional aqui — pode ser definida/ajustada depois, antes de gerar a remessa)">
        <TextInput type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
        <Button variant="primary" onClick={() => onSalvar(competencia, descricao, tipo, dataPagamento)} disabled={salvando || competencia.trim().length < 4}>
          {salvando ? "Criando..." : "Criar folha"}
        </Button>
      </div>
    </Modal>
  );
}

function PagamentoModal({
  colaboradores, tipoFolha, pagamento, onSalvar, onFechar, salvando,
}: {
  colaboradores: AppData["colaboradores"];
  tipoFolha: TipoPagamentoColaborador;
  // Edição (22/07/2026, pedido do Vini: "poder editar o pagamento avulso") —
  // quando informado, o modal abre pré-preenchido com os dados desse
  // pagamento e vira "Editar Pagamento" em vez de "Lançar Pagamento". O
  // colaborador não é reeditável aqui de propósito (trocar o titular de um
  // pagamento já lançado é um cenário raro e arriscado o bastante pra exigir
  // excluir e relançar em vez de um campo que convida ao erro).
  pagamento?: PagamentoColaborador | null;
  onSalvar: (form: PagamentoInput) => void;
  onFechar: () => void;
  salvando: boolean;
}) {
  // Tipo do pagamento herda o tipo da folha por padrão (21/07/2026) — ainda
  // ajustável aqui caso um lançamento avulso dentro da folha precise ser de
  // outro tipo, mas o padrão evita ficar redefinindo o óbvio toda vez.
  const [form, setForm] = useState<PagamentoInput>(
    pagamento
      ? {
          colaboradorId: pagamento.colaboradorId,
          tipo: pagamento.tipo,
          valor: Number(pagamento.valor),
          dataPrevista: pagamento.dataPrevista ? pagamento.dataPrevista.slice(0, 10) : null,
          formaPagamento: pagamento.formaPagamento,
          observacoes: pagamento.observacoes || "",
        }
      : { colaboradorId: "", tipo: tipoFolha, valor: 0, dataPrevista: null, formaPagamento: null, observacoes: "" }
  );
  return (
    <Modal title={pagamento ? `Editar Pagamento #${pagamento.numero}` : "Lançar Pagamento"} onClose={onFechar}>
      <Field label="Colaborador">
        {pagamento ? (
          <p className="text-sm text-slate-800 dark:text-slate-200 py-1.5">{pagamento.colaborador?.nomeCompleto}</p>
        ) : (
          <Select value={form.colaboradorId} onChange={(e) => setForm({ ...form, colaboradorId: e.target.value })}>
            <option value="">—</option>
            {colaboradores.filter((c) => colaboradorOperacionalmenteAtivo(c.status)).map((c) => (
              <option key={c.id} value={c.id}>{c.nomeCompleto}</option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoPagamentoColaborador })}>
            {Object.entries(TIPO_PAGAMENTO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Valor (R$)">
          {/* Achado de auditoria F6 (Fase 2, 22/07/2026): este campo aceitava
              só ponto como decimal (Number(e.target.value) puro) — o modal de
              lançamento em lote (LancamentoLoteModal, acima) já tratava
              vírgula corretamente. parseValorMonetario (lib/mascaras.ts) é
              agora a mesma função usada nos dois, garantindo comportamento
              idêntico. */}
          <TextInput type="number" step="0.01" min="0.01" value={form.valor || ""} onChange={(e) => setForm({ ...form, valor: parseValorMonetario(e.target.value) })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data prevista de pagamento (opcional)">
          <TextInput type="date" value={form.dataPrevista || ""} onChange={(e) => setForm({ ...form, dataPrevista: e.target.value || null })} />
        </Field>
        {/* Forma de pagamento (22/07/2026, pedido do Vini) — opcional. Mais
            relevante em avulso (sem CNAB pra deduzir o meio usado), mas
            deixado disponível aqui também porque este modal é compartilhado
            com o lançamento dentro de folha. */}
        <Field label="Forma de pagamento (opcional)">
          <Select value={form.formaPagamento || ""} onChange={(e) => setForm({ ...form, formaPagamento: (e.target.value || null) as FormaPagamento | null })}>
            <option value="">—</option>
            {Object.entries(FORMA_PAGAMENTO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Observações">
        <TextArea value={form.observacoes || ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
        <Button variant="primary" onClick={() => onSalvar(form)} disabled={salvando || !form.colaboradorId || !form.valor || form.valor <= 0}>
          {salvando ? "Salvando..." : pagamento ? "Salvar alterações" : "Lançar"}
        </Button>
      </div>
    </Modal>
  );
}

// Estorno (22/07/2026, pedido do Vini: "muitas vezes o pagamento via Pix,
// TED, etc é estornado e dias depois o financeiro descobre") — modal
// dedicado porque o motivo é obrigatório (texto livre) e a data do estorno
// é intencionalmente separada de "agora" (o banco pode ter revertido dias
// antes de alguém perceber e registrar aqui).
function EstornoModal({
  pagamento, onSalvar, onFechar, salvando,
}: {
  pagamento: PagamentoColaborador;
  onSalvar: (dados: { motivo: string; dataEstorno: string | null }) => void;
  onFechar: () => void;
  salvando: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  const [dataEstorno, setDataEstorno] = useState(() => new Date().toISOString().slice(0, 10));
  const motivoValido = motivo.trim().length >= 3;
  return (
    <Modal title={`Estornar Pagamento #${pagamento.numero}`} onClose={onFechar}>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
        {pagamento.colaborador?.nomeCompleto} — {fmtMoney(Number(pagamento.valor))}
        {pagamento.formaPagamento ? ` via ${FORMA_PAGAMENTO_LABEL[pagamento.formaPagamento]}` : ""}. O pagamento fica
        marcado como <strong>Estornado</strong> (não é excluído — o histórico completo é mantido pra conciliação).
      </p>
      <Field label="Motivo do estorno">
        <TextArea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex: conta encerrada, chave Pix inválida, saldo insuficiente do favorecido..."
        />
      </Field>
      <Field label="Data em que o banco reverteu o valor">
        <TextInput type="date" value={dataEstorno} onChange={(e) => setDataEstorno(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
        <Button
          variant="primary"
          className="!bg-brand-600 hover:!bg-brand-700"
          onClick={() => onSalvar({ motivo: motivo.trim(), dataEstorno: dataEstorno || null })}
          disabled={salvando || !motivoValido}
        >
          {salvando ? "Estornando..." : "Confirmar estorno"}
        </Button>
      </div>
    </Modal>
  );
}

function ConfiguracaoModal({ onFechar }: { onFechar: () => void }) {
  const { sucesso } = useFeedback();
  const [config, setConfig] = useState<ConfiguracaoPagamento | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    pagamentosApi.configuracao().then(setConfig).catch(() => setErro("Não foi possível carregar a configuração."));
  }, []);

  async function salvar() {
    if (!config) return;
    setSalvando(true);
    setErro(null);
    try {
      await pagamentosApi.salvarConfiguracao(config);
      sucesso("Configuração salva.");
      onFechar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const campo = (rotulo: string, chave: keyof ConfiguracaoPagamento) => (
    <Field label={rotulo}>
      <TextInput
        // Achado de auditoria F9 (22/07/2026): "Próximo sequencial de
        // remessa" é o único campo numérico deste modal, mas usava o mesmo
        // input de texto livre dos outros (endereço, CEP, UF...) — sem
        // teclado numérico no mobile e sem a seta de incremento do
        // navegador que um `type="number"` já dá de graça.
        type={chave === "proximoSequencialRemessa" ? "number" : "text"}
        value={String(config?.[chave] ?? "")}
        onChange={(e) => config && setConfig({ ...config, [chave]: chave === "proximoSequencialRemessa" ? Number(e.target.value) : e.target.value })}
      />
    </Field>
  );

  return (
    <Modal title="Configuração da Empresa Pagadora (CNAB)" onClose={onFechar} wide>
      {!config ? (
        <div className="py-8 text-center"><Spinner size={22} /></div>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
            Estes dados entram no cabeçalho de toda remessa. O sequencial abaixo é controlado automaticamente — só ajuste se precisar alinhar com o histórico do banco.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {campo("Código do banco", "bancoCodigo")}
            {campo("Nome do banco", "bancoNome")}
            {campo("Razão social", "razaoSocial")}
            {campo("CNPJ", "cnpj")}
            {campo("Convênio", "convenio")}
            {campo("Agência", "agencia")}
            {campo("DV agência", "agenciaDv")}
            {campo("Conta", "conta")}
            {campo("DV conta", "contaDv")}
            {campo("Endereço", "endereco")}
            {campo("Número", "numero")}
            {campo("Complemento", "complemento")}
            {campo("Cidade", "cidade")}
            {campo("CEP", "cep")}
            {campo("UF", "uf")}
            {campo("Próximo sequencial de remessa", "proximoSequencialRemessa")}
          </div>
          {erro && <p className="text-xs text-brand-700 dark:text-brand-400 mt-2">{erro}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button variant="primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
