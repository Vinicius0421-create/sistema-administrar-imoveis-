import React, { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Search } from "../components/icons";
import { AppData } from "../hooks/useAppData";
import { documentosColaboradorApi, tiposDocumentoApi, TipoDocumentoInput } from "../api/documentos";
import { ApiError } from "../lib/apiClient";
import { useFeedback } from "../contexts/FeedbackContext";
import {
  DocumentoColaborador, STATUS_DOCUMENTO_LABEL, StatusDocumentoColaborador, TipoDocumento,
} from "../types";
import {
  Button, EmptyState, Field, fmtDate, LoadingState, Modal, PageHeader, Paginacao, SearchBox,
  Select, Stamp, TextArea, TextInput, usePaginacaoCliente,
} from "../components/ui";

// Painel do RH/Admin de Documentos de Colaborador (11/08/2026, Fase RH da
// Evolução Completa). Recebe `data.documentos` já com TODOS os documentos
// (útil pro RH/ADMIN — ver useAppData.ts, que decide entre listAll()/meus()
// pelo papel de quem chamou); esta página não faz outra checagem de papel
// porque o próprio item de menu (App.tsx, NAV) e a rota no backend
// (PAPEIS_GERENCIAM em documentos.routes.ts) já restringem quem chega aqui.

const STATUS_FILTRAVEIS: StatusDocumentoColaborador[] = [
  "SOLICITADO", "ENVIADO", "EM_ANALISE", "APROVADO", "REJEITADO", "EXPIRADO", "CANCELADO",
];

const TONE_POR_STATUS: Record<StatusDocumentoColaborador, "pos" | "neg" | "pend"> = {
  SOLICITADO: "pend", ENVIADO: "pend", EM_ANALISE: "pend",
  APROVADO: "pos", REJEITADO: "neg", EXPIRADO: "neg", CANCELADO: "neg",
};

export function DocumentosPage({ data, onChanged }: { data: AppData; onChanged: () => void }) {
  const { sucesso } = useFeedback();
  const [tipos, setTipos] = useState<TipoDocumento[]>([]);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusDocumentoColaborador | "">("");
  const [solicitando, setSolicitando] = useState(false);
  const [gerenciandoTipos, setGerenciandoTipos] = useState(false);
  const [selecionado, setSelecionado] = useState<DocumentoColaborador | null>(null);

  const carregarTipos = React.useCallback(() => {
    tiposDocumentoApi.list(true).then(setTipos).catch(() => {});
  }, []);
  useEffect(() => { carregarTipos(); }, [carregarTipos]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return data.documentos
      .filter((d) => !filtroStatus || d.status === filtroStatus)
      .filter((d) => !termo || d.colaborador?.nomeCompleto.toLowerCase().includes(termo) || d.tipoDocumento.nome.toLowerCase().includes(termo))
      .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());
  }, [data.documentos, busca, filtroStatus]);

  const { itensPagina, pagina, totalPaginas, setPagina, total, inicioExibicao, fimExibicao } = usePaginacaoCliente(filtrados, 20);

  return (
    <div>
      <PageHeader
        title="Documentos"
        icon={FileText}
        subtitle="Solicite, acompanhe e analise documentos dos colaboradores."
        actions={
          <>
            <Button variant="ghost" onClick={() => setGerenciandoTipos(true)}>Tipos de documento</Button>
            <Button variant="primary" onClick={() => setSolicitando(true)}><Plus size={16} /> Solicitar documento</Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2.5 mb-4">
        <div className="flex-1 min-w-[220px]">
          <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por colaborador ou documento..." />
        </div>
        <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as StatusDocumentoColaborador | "")} className="max-w-[220px]">
          <option value="">Todos os status</option>
          {STATUS_FILTRAVEIS.map((s) => <option key={s} value={s}>{STATUS_DOCUMENTO_LABEL[s]}</option>)}
        </Select>
      </div>

      {filtrados.length === 0 ? (
        <EmptyState icon={Search} text="Nenhum documento encontrado com esses filtros." />
      ) : (
        <div className="border border-gray-200 dark:border-slate-700 rounded-[var(--radius-card)] overflow-hidden bg-white dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2.5">Colaborador</th>
                <th className="text-left px-4 py-2.5">Documento</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Validade</th>
                <th className="text-left px-4 py-2.5">Solicitado em</th>
              </tr>
            </thead>
            <tbody>
              {itensPagina.map((doc) => (
                <tr
                  key={doc.id}
                  className="border-t border-gray-100 dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-900/30"
                  onClick={() => setSelecionado(doc)}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{doc.colaborador?.nomeCompleto ?? "—"}</td>
                  <td className="px-4 py-2.5">{doc.tipoDocumento.nome}</td>
                  <td className="px-4 py-2.5"><Stamp tone={TONE_POR_STATUS[doc.status]}>{STATUS_DOCUMENTO_LABEL[doc.status]}</Stamp></td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">{doc.dataValidade ? fmtDate(doc.dataValidade) : "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">{fmtDate(doc.solicitadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-3">
            <Paginacao pagina={pagina} totalPaginas={totalPaginas} onChange={setPagina} total={total} inicioExibicao={inicioExibicao} fimExibicao={fimExibicao} itemLabel="documentos" />
          </div>
        </div>
      )}

      {solicitando && (
        <SolicitarDocumentoModal
          colaboradores={data.colaboradores}
          tipos={tipos.filter((t) => t.status === "ATIVO")}
          onClose={() => setSolicitando(false)}
          onSolicitado={() => { setSolicitando(false); onChanged(); sucesso("Documento solicitado ao colaborador."); }}
        />
      )}

      {gerenciandoTipos && (
        <TiposDocumentoModal tipos={tipos} onClose={() => setGerenciandoTipos(false)} onAtualizado={carregarTipos} />
      )}

      {selecionado && (
        <DetalheDocumentoModal
          documento={selecionado}
          onClose={() => setSelecionado(null)}
          onAtualizado={() => { onChanged(); }}
        />
      )}
    </div>
  );
}

function SolicitarDocumentoModal({
  colaboradores, tipos, onClose, onSolicitado,
}: {
  colaboradores: AppData["colaboradores"];
  tipos: TipoDocumento[];
  onClose: () => void;
  onSolicitado: () => void;
}) {
  const [colaboradorId, setColaboradorId] = useState("");
  const [tipoDocumentoId, setTipoDocumentoId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const colaboradoresAtivos = useMemo(
    () => [...colaboradores].filter((c) => c.status === "ATIVO").sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto)),
    [colaboradores]
  );

  async function enviar() {
    if (!colaboradorId || !tipoDocumentoId) {
      setErro("Escolha o colaborador e o tipo de documento.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await documentosColaboradorApi.solicitar({ colaboradorId, tipoDocumentoId, observacaoSolicitacao: observacao || undefined });
      onSolicitado();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível solicitar o documento.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal title="Solicitar documento" onClose={onClose}>
      {tipos.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">
          Nenhum tipo de documento cadastrado ainda. Cadastre um em "Tipos de documento" antes de solicitar.
        </p>
      ) : (
        <>
          <Field label="Colaborador">
            <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
              <option value="">Selecione...</option>
              {colaboradoresAtivos.map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
            </Select>
          </Field>
          <Field label="Tipo de documento">
            <Select value={tipoDocumentoId} onChange={(e) => setTipoDocumentoId(e.target.value)}>
              <option value="">Selecione...</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          </Field>
          <Field label="Observação (opcional)">
            <TextArea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex: necessário para a renovação do contrato." />
          </Field>
          {erro && <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">{erro}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={enviando} onClick={enviar}>{enviando ? "Enviando..." : "Solicitar"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function TiposDocumentoModal({ tipos, onClose, onAtualizado }: { tipos: TipoDocumento[]; onClose: () => void; onAtualizado: () => void }) {
  const { sucesso } = useFeedback();
  const [nome, setNome] = useState("");
  const [exigeValidade, setExigeValidade] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    if (!nome.trim()) { setErro("Informe o nome do documento."); return; }
    setCriando(true);
    setErro(null);
    try {
      const data: TipoDocumentoInput = { nome: nome.trim(), exigeValidade };
      await tiposDocumentoApi.create(data);
      setNome("");
      setExigeValidade(false);
      onAtualizado();
      sucesso("Tipo de documento cadastrado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível cadastrar.");
    } finally {
      setCriando(false);
    }
  }

  async function alternarStatus(tipo: TipoDocumento) {
    await tiposDocumentoApi.update(tipo.id, { status: tipo.status === "ATIVO" ? "INATIVO" : "ATIVO" });
    onAtualizado();
  }

  return (
    <Modal title="Tipos de documento" onClose={onClose} wide>
      <div className="mb-5 pb-5 border-b border-gray-100 dark:border-slate-800">
        <Field label="Novo tipo">
          <TextInput value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Comprovante de residência" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 mb-3">
          <input type="checkbox" checked={exigeValidade} onChange={(e) => setExigeValidade(e.target.checked)} />
          Exige data de validade ao aprovar (ex: certidões, exames periódicos)
        </label>
        {erro && <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{erro}</p>}
        <Button variant="primary" disabled={criando} onClick={criar}>{criando ? "Cadastrando..." : "Cadastrar tipo"}</Button>
      </div>

      {tipos.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">Nenhum tipo cadastrado ainda.</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {tipos.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 py-1.5">
              <div>
                <p className="text-sm text-slate-900 dark:text-slate-100">{t.nome}</p>
                {t.exigeValidade && <p className="text-xs text-gray-400 dark:text-slate-500">Exige validade</p>}
              </div>
              <div className="flex items-center gap-2">
                <Stamp tone={t.status === "ATIVO" ? "pos" : "neg"}>{t.status === "ATIVO" ? "Ativo" : "Inativo"}</Stamp>
                <Button variant="ghost" className="text-xs py-1 px-2.5" onClick={() => alternarStatus(t)}>
                  {t.status === "ATIVO" ? "Desativar" : "Reativar"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function DetalheDocumentoModal({
  documento, onClose, onAtualizado,
}: {
  documento: DocumentoColaborador;
  onClose: () => void;
  onAtualizado: () => void;
}) {
  const { sucesso } = useFeedback();
  const [detalhe, setDetalhe] = useState<DocumentoColaborador | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [dataValidade, setDataValidade] = useState("");
  const [motivoRejeicao, setMotivoRejeicao] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = React.useCallback(() => {
    setCarregando(true);
    documentosColaboradorApi.getOne(documento.id).then(setDetalhe).catch(() => {}).finally(() => setCarregando(false));
  }, [documento.id]);
  useEffect(() => { carregar(); }, [carregar]);

  const podeAnalisar = detalhe?.status === "ENVIADO" || detalhe?.status === "EM_ANALISE";

  async function analisar(aprovado: boolean) {
    if (aprovado && detalhe?.tipoDocumento.exigeValidade && !dataValidade) {
      setErro("Este tipo de documento exige data de validade.");
      return;
    }
    if (!aprovado && !motivoRejeicao.trim()) {
      setErro("Informe o motivo da rejeição.");
      return;
    }
    setProcessando(true);
    setErro(null);
    try {
      await documentosColaboradorApi.analisar(documento.id, {
        aprovado,
        motivoRejeicao: aprovado ? undefined : motivoRejeicao,
        dataValidade: aprovado && dataValidade ? dataValidade : undefined,
      });
      onAtualizado();
      sucesso(aprovado ? "Documento aprovado." : "Documento rejeitado.");
      carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível concluir a análise.");
    } finally {
      setProcessando(false);
    }
  }

  async function baixar() {
    const { blob, nomeArquivo } = await documentosColaboradorApi.baixarArquivo(documento.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo || documento.arquivoNomeOriginal || "documento";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function cancelar() {
    setProcessando(true);
    try {
      await documentosColaboradorApi.cancelar(documento.id);
      onAtualizado();
      sucesso("Solicitação cancelada.");
      onClose();
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Modal title={documento.tipoDocumento.nome} onClose={onClose} wide>
      {carregando || !detalhe ? (
        <LoadingState text="Carregando documento..." />
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{detalhe.colaborador?.nomeCompleto}</p>
              <p className="text-xs text-gray-400 dark:text-slate-500">Solicitado em {fmtDate(detalhe.solicitadoEm)}</p>
            </div>
            <Stamp tone={TONE_POR_STATUS[detalhe.status]}>{STATUS_DOCUMENTO_LABEL[detalhe.status]}</Stamp>
          </div>

          {detalhe.arquivoUrl && (
            <Button variant="ghost" className="mb-4" onClick={baixar}><FileText size={14} /> Baixar arquivo enviado</Button>
          )}

          {podeAnalisar && (
            <div className="border border-gray-200 dark:border-slate-700 rounded-[var(--radius-card)] p-3.5 mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2.5">Analisar documento</p>
              {detalhe.tipoDocumento.exigeValidade && (
                <Field label="Data de validade (obrigatória para aprovar)">
                  <TextInput type="date" value={dataValidade} onChange={(e) => setDataValidade(e.target.value)} />
                </Field>
              )}
              <Field label="Motivo (obrigatório para rejeitar)">
                <TextArea value={motivoRejeicao} onChange={(e) => setMotivoRejeicao(e.target.value)} placeholder="Ex: foto ilegível, envie novamente." />
              </Field>
              {erro && <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{erro}</p>}
              <div className="flex gap-2">
                <Button variant="primary" disabled={processando} onClick={() => analisar(true)}>Aprovar</Button>
                <Button variant="danger" disabled={processando} onClick={() => analisar(false)}>Rejeitar</Button>
              </div>
            </div>
          )}

          {(detalhe.status === "SOLICITADO" || detalhe.status === "REJEITADO") && (
            <Button variant="ghost" className="mb-4 text-rose-600" disabled={processando} onClick={cancelar}>Cancelar solicitação</Button>
          )}

          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Histórico</p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {(detalhe.eventos ?? []).map((ev) => (
              <div key={ev.id} className="text-xs text-gray-600 dark:text-slate-400 border-l-2 border-gray-200 dark:border-slate-700 pl-2.5">
                <span className="text-gray-400 dark:text-slate-500">{fmtDate(ev.criadoEm)} — </span>
                {ev.mensagem || ev.tipo}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
