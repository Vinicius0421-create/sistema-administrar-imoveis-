import React, { useRef, useState } from "react";
import { FileText, Upload, Download, AlertTriangle } from "./icons";
import { documentosColaboradorApi } from "../api/documentos";
import { ApiError } from "../lib/apiClient";
import { useFeedback } from "../contexts/FeedbackContext";
import { DocumentoColaborador, STATUS_DOCUMENTO_LABEL } from "../types";
import { Button, EmptyState, fmtDate, Stamp } from "./ui";

// "Meus Documentos" — autoatendimento do colaborador no Portal (11/08/2026,
// Fase RH da Evolução Completa). Recebe `documentos` já filtrados pelo
// backend (GET /documentos-colaborador/meus escopa por request.user.
// colaboradorId — nunca por um id vindo do cliente), mesmo racional de
// MeusPagamentos/minhasServ em PortalColaborador.tsx: este componente só
// exibe, nunca decide de quem são os dados.

const TONE_POR_STATUS: Record<DocumentoColaborador["status"], "pos" | "neg" | "pend"> = {
  SOLICITADO: "pend",
  ENVIADO: "pend",
  EM_ANALISE: "pend",
  APROVADO: "pos",
  REJEITADO: "neg",
  EXPIRADO: "neg",
  CANCELADO: "neg",
};

// Nome do componente evita colidir com `MeusDocumentos` já existente neste
// mesmo arquivo (PortalColaborador.tsx) — aquele é sobre documentos de
// PATRIMÔNIO (termo de responsabilidade + anexos de equipamento, ambos
// somente-leitura pro colaborador); este é o fluxo de RH, com upload de
// verdade. Assuntos diferentes o bastante pra não virarem uma seção só.
export function DocumentosRH({ documentos, onChanged }: { documentos: DocumentoColaborador[]; onChanged: () => void }) {
  if (documentos.length === 0) {
    return (
      <div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Documentos (RH)</h3>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Documentos solicitados pelo RH aparecem aqui.</p>
        <EmptyState icon={FileText} text="Nenhum documento solicitado até o momento." />
      </div>
    );
  }

  const ordenados = [...documentos].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());

  return (
    <div>
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Documentos (RH)</h3>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        Acompanhe o que o RH solicitou, envie pendências e veja o motivo de uma rejeição.
      </p>
      <div className="space-y-2.5">
        {ordenados.map((doc) => (
          <CardDocumento key={doc.id} documento={doc} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function CardDocumento({ documento, onChanged }: { documento: DocumentoColaborador; onChanged: () => void }) {
  const { sucesso } = useFeedback();
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const precisaEnviar = documento.status === "SOLICITADO" || documento.status === "REJEITADO";
  const temArquivo = !!documento.arquivoUrl;

  async function enviarArquivo(file: File) {
    setEnviando(true);
    setErro(null);
    try {
      await documentosColaboradorApi.enviar(documento.id, file);
      onChanged();
      sucesso("Documento enviado — aguardando análise do RH.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar o arquivo.");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function baixar() {
    setBaixando(true);
    try {
      const { blob, nomeArquivo } = await documentosColaboradorApi.baixarArquivo(documento.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo || documento.arquivoNomeOriginal || "documento";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErro("Não foi possível baixar o arquivo.");
    } finally {
      setBaixando(false);
    }
  }

  const diasParaVencer = documento.dataValidade
    ? Math.ceil((new Date(documento.dataValidade).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const vencendoEmBreve = documento.status === "APROVADO" && diasParaVencer !== null && diasParaVencer <= 30;

  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-[var(--radius-card)] p-3.5 bg-white dark:bg-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{documento.tipoDocumento.nome}</p>
          {documento.tipoDocumento.descricao && (
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{documento.tipoDocumento.descricao}</p>
          )}
        </div>
        <Stamp tone={TONE_POR_STATUS[documento.status]}>{STATUS_DOCUMENTO_LABEL[documento.status]}</Stamp>
      </div>

      {documento.status === "REJEITADO" && documento.motivoRejeicao && (
        <p className="text-xs text-rose-700 dark:text-rose-400 mt-2 bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-800 rounded-[var(--radius-control)] p-2">
          Motivo da rejeição: {documento.motivoRejeicao}
        </p>
      )}

      {documento.status === "APROVADO" && documento.dataValidade && (
        <p className={`text-xs mt-2 flex items-center gap-1 ${vencendoEmBreve ? "text-amber-700 dark:text-amber-400" : "text-gray-500 dark:text-slate-400"}`}>
          {vencendoEmBreve && <AlertTriangle size={13} />}
          Válido até {fmtDate(documento.dataValidade)}
        </p>
      )}

      {documento.status === "EXPIRADO" && (
        <p className="text-xs text-rose-700 dark:text-rose-400 mt-2">Este documento venceu — o RH pode solicitar reenvio.</p>
      )}

      {erro && <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">{erro}</p>}

      <div className="flex items-center gap-2 mt-3">
        {precisaEnviar && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) enviarArquivo(file);
              }}
            />
            <Button variant="primary" className="text-xs py-1.5 px-3" disabled={enviando} onClick={() => inputRef.current?.click()}>
              <Upload size={13} /> {enviando ? "Enviando..." : documento.status === "REJEITADO" ? "Reenviar" : "Enviar documento"}
            </Button>
          </>
        )}
        {temArquivo && (
          <Button variant="ghost" className="text-xs py-1.5 px-3 border border-gray-200 dark:border-slate-700" disabled={baixando} onClick={baixar}>
            <Download size={13} /> {baixando ? "Baixando..." : "Baixar"}
          </Button>
        )}
      </div>
    </div>
  );
}

