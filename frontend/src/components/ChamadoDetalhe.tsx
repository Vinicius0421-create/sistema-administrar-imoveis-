import React, { useEffect, useRef, useState } from "react";
import { chamadosApi, Tecnico } from "../api/chamados";
import { ApiError } from "../lib/apiClient";
import { AppData } from "../hooks/useAppData";
import { Button, COLORS, Field, fmtDataHora, fmtDuracao, fmtMoney, LoadingState, Modal, Select, Spinner, Stamp, TextArea, TextInput } from "../components/ui";
import { Download, FileText, Paperclip, X } from "./icons";
import { TimelineEventos } from "./TimelineEventos";
import {
  CATEGORIA_CHAMADO_LABEL, CATEGORIAS_CHAMADO, CategoriaChamado, ChamadoEvento, ChamadoManutencao, Papel,
  PRIORIDADE_LABEL, PRIORIDADE_TONE, Prioridade, rotuloEquipamento, STATUS_CHAMADO_LABEL, STATUS_CHAMADO_TONE, StatusChamado,
  TIPO_SOLICITACAO_IMOVIEW_LABEL, TIPOS_SOLICITACAO_IMOVIEW, TipoSolicitacaoImoview,
} from "../types";
import { useFeedback } from "../contexts/FeedbackContext";

// Mesma lista/limite do backend (src/utils/anexos.ts) — validar aqui só
// evita um round-trip de rede pra um erro que já dava pra saber na hora;
// o backend continua sendo a fonte de verdade, revalida tudo de novo.
const ANEXO_MIME_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
const ANEXO_TAMANHO_MAXIMO = 10 * 1024 * 1024;

function fmtTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Renderiza um evento tipo ANEXO na linha do tempo — imagem vira preview
// inline, PDF vira um cartão com ícone. Os dois precisam buscar o arquivo
// como Blob autenticado (ver apiDownloadBlob) porque uma <img>/<a> comum não
// manda o header Authorization sozinha; a object URL criada é revogada no
// unmount pra não vazar memória.
function AnexoEvento({
  chamadoId, evento, podeExcluir, onRemovido,
}: {
  chamadoId: string;
  evento: ChamadoEvento;
  podeExcluir: boolean;
  onRemovido: () => void;
}) {
  const detalhe = (evento.detalhe || {}) as { nomeArquivoOriginal?: string; mimeType?: string; tamanhoBytes?: number };
  const ehImagem = (detalhe.mimeType || "").startsWith("image/");
  const [urlImagem, setUrlImagem] = useState<string | null>(null);
  const [carregandoImagem, setCarregandoImagem] = useState(ehImagem);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    if (!ehImagem) return;
    let ativo = true;
    let urlCriada: string | null = null;
    chamadosApi.baixarAnexo(chamadoId, evento.id).then(({ blob }) => {
      if (!ativo) return;
      urlCriada = URL.createObjectURL(blob);
      setUrlImagem(urlCriada);
      setCarregandoImagem(false);
    }).catch(() => setCarregandoImagem(false));
    return () => {
      ativo = false;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chamadoId, evento.id]);

  async function baixar() {
    setBaixando(true);
    try {
      const { blob, nomeArquivo } = await chamadosApi.baixarAnexo(chamadoId, evento.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo || detalhe.nomeArquivoOriginal || "anexo";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] p-2 text-sm group relative">
      {/* Achado de auditoria (Etapa 4 — Frontend, 08/07/2026): e-mail (sem
          espaços internos pro navegador quebrar) e data disputavam a linha
          sem `min-w-0`/`truncate` — um e-mail comprido (o sistema tem
          exemplos reais, ex: captadorlocacaoigarape@administrarimoveis.com.br)
          conseguia vazar pra fora do card em vez de quebrar. */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate min-w-0" title={evento.autor?.email || undefined}>
          {evento.autor?.email || "—"}
        </span>
        <span className="text-[10px] text-gray-400 dark:text-slate-500 flex-shrink-0">{fmtDataHora(evento.criadoEm)}</span>
      </div>
      {ehImagem ? (
        carregandoImagem ? (
          <div className="h-24 flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-slate-500">
            <Spinner size={14} /> Carregando imagem...
          </div>
        ) : urlImagem ? (
          <a href={urlImagem} target="_blank" rel="noreferrer">
            <img src={urlImagem} alt={detalhe.nomeArquivoOriginal || "Anexo"} className="max-h-40 rounded-[var(--radius-control)] border border-gray-200 dark:border-slate-700" />
          </a>
        ) : (
          <p className="text-xs text-brand-700 dark:text-brand-400">Não foi possível carregar a imagem.</p>
        )
      ) : (
        <button
          onClick={baixar}
          disabled={baixando}
          className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 disabled:opacity-50"
        >
          <FileText size={16} />
          <span className="underline">{detalhe.nomeArquivoOriginal || "Anexo"}</span>
        </button>
      )}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-gray-400 dark:text-slate-500">{detalhe.tamanhoBytes ? fmtTamanho(detalhe.tamanhoBytes) : ""}</span>
        {!ehImagem && (
          <button onClick={baixar} disabled={baixando} className="text-gray-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 disabled:opacity-50" title="Baixar" aria-label="Baixar anexo">
            <Download size={13} />
          </button>
        )}
      </div>
      {podeExcluir && (
        // Achado de auditoria (06/07/2026): opacity-0 + group-hover deixava
        // este botão permanentemente invisível em telas de toque (não existe
        // "hover" em celular) — ninguém no celular conseguia excluir um
        // anexo enviado por engano. Fica visível o tempo todo, só discreto.
        <button
          className="absolute top-1 right-1 text-gray-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 p-1"
          title="Excluir anexo (correção de engano)"
          aria-label="Excluir anexo"
          onClick={async () => { await chamadosApi.removerEvento(chamadoId, evento.id); onRemovido(); }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// Painel de detalhe reaproveitado tanto pelo Sistema Administrativo
// (ChamadosPage — visão de quem administra) quanto pelo Portal do
// Colaborador (quem abriu o chamado) — a diferença entre os dois é só o
// parâmetro `podeGerenciar`, que liga/desliga os controles de status,
// atribuição de técnico e edição de campos internos. O chat e a linha do
// tempo são exatamente os mesmos pros dois lados, porque é o mesmo espaço
// de conversa entre colaborador e suporte.
interface Props {
  chamadoId: string;
  papel: Papel;
  podeGerenciar: boolean;
  onClose: () => void;
  onChanged: () => void;
  colaboradores?: AppData["colaboradores"];
  equipamentos?: AppData["equipamentos"];
  unidades?: AppData["dominios"]["unidades"];
}

// Reexportados (09/07/2026) para reuso em SolicitacoesPapelaria.tsx — mesmo
// formato de data/hora e de duração usado na linha do tempo/tempo de
// atendimento do módulo de Papelaria e Compras, sem duplicar a lógica.
// Onda 2.3 (21/07/2026): a implementação em si se mudou pra ui.tsx (pra
// TimelineEventos.tsx poder usá-la sem criar import circular com este
// arquivo) — `fmtDataHora`/`fmtDuracao` já entram no escopo local pelo
// `import` no topo do arquivo; esta linha só reexporta o mesmo símbolo, sem
// duplicar a implementação, então nenhum outro arquivo que já importava
// daqui precisa mudar.
export { fmtDataHora, fmtDuracao };

const DESCRICAO_EVENTO: Record<string, (detalhe: Record<string, unknown> | null) => string> = {
  ABERTURA: () => "Chamado aberto",
  MUDANCA_STATUS: (d) => `Status alterado: ${STATUS_CHAMADO_LABEL[d?.de as StatusChamado] || d?.de} → ${STATUS_CHAMADO_LABEL[d?.para as StatusChamado] || d?.para}`,
  ATRIBUICAO: (d) => (d?.para ? "Técnico atribuído" : "Técnico removido"),
  ATUALIZACAO: (d) => `Dados atualizados${d?.camposAlterados ? ` (${(d.camposAlterados as string[]).join(", ")})` : ""}`,
  // Fase 2 — Melhorias Estruturais (09/07/2026).
  REABERTURA: (d) => `Chamado reaberto${d?.motivo ? `: ${d.motivo}` : ""}`,
  AVALIACAO: (d) => `Avaliação registrada: ${d?.nota}/5${d?.comentario ? ` — "${d.comentario}"` : ""}`,
};

// Fase 2 (09/07/2026) — mesma paleta de "risco" já usada no resto do
// sistema (vermelho pra chamar atenção, sem novo padrão visual pra
// aprender): SLA vencido é sempre vermelho, dentro do prazo fica neutro
// (não precisa de destaque, só o atraso é que é acionável).
function slaInfo(chamado: Pick<ChamadoManutencao, "slaPrazo" | "status">) {
  if (!chamado.slaPrazo) return null;
  const terminal = chamado.status === "RESOLVIDO" || chamado.status === "ENCERRADO";
  const atrasado = !terminal && new Date(chamado.slaPrazo).getTime() < Date.now();
  return { prazo: chamado.slaPrazo, atrasado, terminal };
}

function EstrelasAvaliacao({ nota, onChange }: { nota: number; onChange?: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={`text-xl leading-none ${onChange ? "cursor-pointer" : "cursor-default"} ${n <= nota ? "text-amber-400" : "text-gray-300 dark:text-slate-600"}`}
          aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function ChamadoDetalhe({ chamadoId, papel, podeGerenciar, onClose, onChanged, colaboradores, equipamentos, unidades }: Props) {
  const { sucesso } = useFeedback();
  const [chamado, setChamado] = useState<ChamadoManutencao | null>(null);
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState<"idle" | "confirmando" | "processando">("idle");
  const [anexando, setAnexando] = useState(false);
  const inputArquivoRef = useRef<HTMLInputElement>(null);
  // Fase 2 — Melhorias Estruturais (09/07/2026): reabertura e avaliação.
  const [reabrindoForm, setReabrindoForm] = useState(false);
  const [motivoReabertura, setMotivoReabertura] = useState("");
  const [reabrindo, setReabrindo] = useState(false);
  const [notaAvaliacao, setNotaAvaliacao] = useState(0);
  const [comentarioAvaliacao, setComentarioAvaliacao] = useState("");
  const [avaliando, setAvaliando] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const c = await chamadosApi.getOne(chamadoId);
      setChamado(c);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar o chamado.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    if (podeGerenciar) chamadosApi.tecnicos().then(setTecnicos).catch(() => setTecnicos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chamadoId]);

  // Onda 2.3 (21/07/2026) — a caixa de texto/botão de enviar/estado
  // "enviando" agora são internos ao <TimelineEventos> (ver componente);
  // esta função só cuida da parte que é específica de Chamado: chamar a
  // API certa, reportar erro no banner desta tela e recarregar. Precisa
  // RELANÇAR o erro (`throw`) — é assim que o componente genérico sabe que
  // deu errado e preserva o texto digitado em vez de limpar o campo.
  async function enviarMensagem(texto: string) {
    setErro(null);
    try {
      await chamadosApi.enviarMensagem(chamadoId, texto);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar a mensagem.");
      throw e;
    }
  }

  async function anexarArquivo(file: File) {
    setErro(null);
    if (!ANEXO_MIME_PERMITIDOS.has(file.type)) {
      setErro("Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou PDF.");
      return;
    }
    if (file.size > ANEXO_TAMANHO_MAXIMO) {
      setErro("Arquivo excede o tamanho máximo permitido (10MB).");
      return;
    }
    setAnexando(true);
    try {
      await chamadosApi.anexar(chamadoId, file);
      await carregar();
      sucesso("Anexo enviado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível anexar o arquivo.");
    } finally {
      setAnexando(false);
      if (inputArquivoRef.current) inputArquivoRef.current.value = "";
    }
  }

  // S6 (achado do checkup, 22/07/2026) — mudar status/técnico é 1 ação sem
  // confirmação nem desfazer, inconsistente com outras ações de risco do
  // sistema (excluir chamado, por exemplo, exige 2 passos). Em vez de uma
  // confirmação bloqueante (pioraria mudanças corriqueiras), o toast de
  // sucesso ganha um botão "Desfazer" temporário (~7s, ver
  // FeedbackContext.tsx) que reaplica o valor anterior — mesmo padrão usado
  // em Chamados.tsx (Kanban) pra mudança de status por arrastar-soltar.
  async function mudarStatus(status: StatusChamado) {
    setErro(null);
    const statusAnterior = chamado?.status;
    try {
      await chamadosApi.mudarStatus(chamadoId, status);
      await carregar();
      onChanged();
      sucesso(
        `Status alterado para "${STATUS_CHAMADO_LABEL[status]}".`,
        statusAnterior && statusAnterior !== status
          ? {
              label: "Desfazer",
              onClick: async () => {
                try {
                  await chamadosApi.mudarStatus(chamadoId, statusAnterior);
                  await carregar();
                  onChanged();
                } catch {
                  setErro("Não foi possível desfazer a mudança de status.");
                }
              },
            }
          : undefined
      );
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível mudar o status.");
    }
  }

  // Desde 07/07/2026 técnico responsável é obrigatório (ver comentário em
  // chamados.routes.ts) — "atribuir" sempre troca por outro técnico real,
  // não existe mais opção de deixar sem ninguém atribuído.
  async function atribuir(responsavelId: string) {
    if (!responsavelId) return;
    setErro(null);
    const responsavelAnteriorId = chamado?.responsavelId;
    try {
      await chamadosApi.atribuir(chamadoId, responsavelId);
      await carregar();
      onChanged();
      sucesso(
        "Técnico atribuído.",
        responsavelAnteriorId && responsavelAnteriorId !== responsavelId
          ? {
              label: "Desfazer",
              onClick: async () => {
                try {
                  await chamadosApi.atribuir(chamadoId, responsavelAnteriorId);
                  await carregar();
                  onChanged();
                } catch {
                  setErro("Não foi possível desfazer a atribuição do técnico.");
                }
              },
            }
          : undefined
      );
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível atribuir o técnico.");
    }
  }

  // Fase 2 — Melhorias Estruturais (09/07/2026).
  async function reabrirChamado() {
    setReabrindo(true);
    setErro(null);
    try {
      await chamadosApi.reabrir(chamadoId, motivoReabertura.trim() || undefined);
      setReabrindoForm(false);
      setMotivoReabertura("");
      await carregar();
      onChanged();
      sucesso("Chamado reaberto.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível reabrir o chamado.");
    } finally {
      setReabrindo(false);
    }
  }

  async function enviarAvaliacao() {
    if (notaAvaliacao < 1) return;
    setAvaliando(true);
    setErro(null);
    try {
      await chamadosApi.avaliar(chamadoId, notaAvaliacao, comentarioAvaliacao.trim() || undefined);
      await carregar();
      onChanged();
      sucesso("Avaliação enviada. Obrigado!");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar sua avaliação.");
    } finally {
      setAvaliando(false);
    }
  }

  async function salvarEdicao(campos: Parameters<typeof chamadosApi.update>[1]) {
    setErro(null);
    try {
      await chamadosApi.update(chamadoId, campos);
      await carregar();
      onChanged();
      setEditando(false);
      sucesso("Chamado atualizado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    }
  }

  // Exclusão do chamado inteiro (diferente de excluir uma mensagem isolada
  // no histórico, ver botão X em cada evento abaixo) — mais sensível, por
  // isso restrita a ADMINISTRADOR e sempre com confirmação.
  async function excluirChamado() {
    setExcluindo("processando");
    setErro(null);
    try {
      await chamadosApi.remove(chamadoId);
      onChanged();
      sucesso("Chamado excluído.");
      onClose();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
      setExcluindo("idle");
    }
  }

  if (carregando || !chamado) {
    return (
      <Modal title="Chamado" onClose={onClose}>
        <LoadingState />
      </Modal>
    );
  }

  // Achado de auditoria S11 (22/07/2026) — "editado" é derivado da própria
  // linha do tempo, não de um campo novo no banco: o último evento
  // ATUALIZACAO cujo `camposAlterados` inclui "descricao" é quem marca a
  // descrição como editada (e quando).
  const descricaoEditada = [...(chamado.eventos || [])]
    .filter((ev) => ev.tipo === "ATUALIZACAO" && Array.isArray((ev.detalhe as { camposAlterados?: string[] } | null)?.camposAlterados) && (ev.detalhe as { camposAlterados: string[] }).camposAlterados.includes("descricao"))
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())[0];

  return (
    <Modal title={`Chamado #${chamado.numero} — ${CATEGORIA_CHAMADO_LABEL[chamado.categoria]}`} onClose={onClose} wide>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          {editando ? (
            <EdicaoForm chamado={chamado} equipamentos={equipamentos} unidades={unidades} onSave={salvarEdicao} onCancel={() => setEditando(false)} />
          ) : (
            <div className="space-y-2 text-sm mb-3">
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Solicitante</span><br />{chamado.solicitante?.nomeCompleto}</div>
              {chamado.tipoSolicitacaoImoview && (
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Tipo da solicitação (Imoview)</span><br />{TIPO_SOLICITACAO_IMOVIEW_LABEL[chamado.tipoSolicitacaoImoview]}</div>
              )}
              {chamado.codigoImovel && (
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Código do imóvel</span><br />{chamado.codigoImovel}</div>
              )}
              <div>
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">
                  Descrição
                  {/* Achado de auditoria S11 (22/07/2026): a descrição original
                      não era editável — só campos internos (categoria,
                      prioridade, solução aplicada etc.) tinham formulário de
                      edição. Reaproveita a própria linha do tempo de eventos
                      (ATUALIZACAO já grava `camposAlterados`) em vez de criar
                      um campo novo só pra marcar "editado" — mesmo racional
                      de "reaproveitar o que já existe" usado no resto do
                      sistema. */}
                  {descricaoEditada && (
                    <span className="normal-case font-normal text-gray-400 dark:text-slate-500"> · editado em {fmtDataHora(descricaoEditada.criadoEm)}</span>
                  )}
                </span>
                <br />{chamado.descricao}
              </div>
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Unidade</span><br />{chamado.unidade?.nome || "—"}</div>
              {chamado.local && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Local</span><br />{chamado.local}</div>}
              {chamado.equipamento && (
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Equipamento</span><br />{chamado.equipamento.tipo}{chamado.equipamento.patrimonio && ` — Patrimônio ${chamado.equipamento.patrimonio}`}</div>
              )}
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Prioridade</span><br /><Stamp tone={PRIORIDADE_TONE[chamado.prioridade]}>{PRIORIDADE_LABEL[chamado.prioridade]}</Stamp></div>
              <div>
                <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Status</span><br />
                <span className="inline-flex items-center gap-2">
                  <Stamp tone={STATUS_CHAMADO_TONE[chamado.status]}>{STATUS_CHAMADO_LABEL[chamado.status]}</Stamp>
                  {chamado.reaberturas > 0 && (
                    <span className="text-[11px] text-gray-500 dark:text-slate-400">
                      Reaberto {chamado.reaberturas}x
                    </span>
                  )}
                </span>
              </div>
              {/* Fase 2 (09/07/2026) — prazo de SLA calculado automaticamente
                  na abertura por categoria/prioridade; vermelho só quando
                  vencido e o chamado ainda não foi resolvido. */}
              {slaInfo(chamado) && (
                <div>
                  <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Prazo (SLA)</span><br />
                  <span className={slaInfo(chamado)!.atrasado ? "text-brand-700 dark:text-brand-400 font-semibold" : undefined}>
                    {fmtDataHora(chamado.slaPrazo!)}
                    {slaInfo(chamado)!.atrasado && " — atrasado"}
                  </span>
                </div>
              )}
              {chamado.responsavel && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Técnico responsável</span><br />{chamado.responsavel.nome}</div>}
              {/* Achado de auditoria (06/07/2026): fornecedor externo e valor
                  pago eram visíveis pra qualquer um que abrisse o chamado,
                  incluindo o colaborador solicitante — informação financeira/
                  de fornecedor não é da conta de quem só abriu o chamado. */}
              {podeGerenciar && chamado.fornecedorExterno && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Fornecedor Externo</span><br />{chamado.fornecedorExterno}</div>}
              {podeGerenciar && !!chamado.valorFinal && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Valor</span><br />{fmtMoney(chamado.valorFinal)}</div>}
              {chamado.solucaoAplicada && <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Solução aplicada</span><br />{chamado.solucaoAplicada}</div>}
              {podeGerenciar && chamado.observacoesInternas && (
                <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Observações internas</span><br />{chamado.observacoesInternas}</div>
              )}
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Aberto em</span><br />{fmtDataHora(chamado.dataAbertura)}</div>
              <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Tempo de atendimento</span><br />{fmtDuracao(chamado.tempoAtendimentoMs)}</div>
              {/* Avaliação já enviada — visível pros dois lados (o
                  colaborador vê o que ele mesmo avaliou; quem gerencia vê
                  como feedback do atendimento). */}
              {chamado.avaliacaoNota && (
                <div>
                  <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Avaliação do atendimento</span><br />
                  <EstrelasAvaliacao nota={chamado.avaliacaoNota} />
                  {chamado.avaliacaoComentario && <p className="text-sm mt-1">"{chamado.avaliacaoComentario}"</p>}
                </div>
              )}
            </div>
          )}

          {/* Reabertura (Fase 2, 09/07/2026) — só depois de RESOLVIDO/
              ENCERRADO; disponível pra quem gerencia e pro próprio
              colaborador que abriu o chamado (o backend valida a
              propriedade de qualquer forma, isto aqui é só a exibição). */}
          {!editando && (chamado.status === "RESOLVIDO" || chamado.status === "ENCERRADO") && (podeGerenciar || papel === "COLABORADOR") && (
            <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mt-2">
              {reabrindoForm ? (
                <div className="space-y-2">
                  <Field label="Motivo da reabertura (opcional)">
                    <TextInput value={motivoReabertura} onChange={(e) => setMotivoReabertura(e.target.value)} placeholder="O que ainda não foi resolvido?" />
                  </Field>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setReabrindoForm(false)} disabled={reabrindo}>Cancelar</Button>
                    <Button variant="primary" onClick={reabrirChamado} disabled={reabrindo}>
                      {reabrindo ? "Reabrindo..." : "Confirmar reabertura"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setReabrindoForm(true)}>Reabrir chamado</Button>
              )}
            </div>
          )}

          {/* Avaliação pós-atendimento (Fase 2, 09/07/2026) — só o
              colaborador que abriu o chamado avalia, e só depois de
              resolvido/encerrado. Uma vez avaliado, mostra a nota enviada
              (acima, no bloco de leitura) em vez do formulário de novo. */}
          {!editando && papel === "COLABORADOR" && (chamado.status === "RESOLVIDO" || chamado.status === "ENCERRADO") && !chamado.avaliadoEm && (
            <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mt-2 space-y-2">
              <Field label="Como foi o atendimento?">
                <EstrelasAvaliacao nota={notaAvaliacao} onChange={setNotaAvaliacao} />
              </Field>
              <Field label="Comentário (opcional)">
                <TextInput value={comentarioAvaliacao} onChange={(e) => setComentarioAvaliacao(e.target.value)} placeholder="Conte como foi..." />
              </Field>
              <Button variant="primary" onClick={enviarAvaliacao} disabled={notaAvaliacao < 1 || avaliando}>
                {avaliando ? "Enviando..." : "Enviar avaliação"}
              </Button>
            </div>
          )}

          {podeGerenciar && !editando && (
            <div className="space-y-2 border-t border-gray-100 dark:border-slate-700 pt-3">
              <Field label="Mudar status">
                <Select value={chamado.status} onChange={(e) => mudarStatus(e.target.value as StatusChamado)}>
                  {Object.entries(STATUS_CHAMADO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Atribuir técnico">
                <Select value={chamado.responsavelId} onChange={(e) => atribuir(e.target.value)}>
                  {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </Select>
              </Field>
              <Button variant="ghost" onClick={() => setEditando(true)}>Editar dados do chamado</Button>
            </div>
          )}

          {papel === "ADMINISTRADOR" && !editando && (
            <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mt-2">
              {excluindo === "confirmando" ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-brand-700 dark:text-brand-400">Excluir o chamado inteiro, sem desfazer?</span>
                  <Button variant="ghost" onClick={() => setExcluindo("idle")}>Cancelar</Button>
                  <Button variant="danger" onClick={excluirChamado} disabled={excluindo !== "confirmando"}>Confirmar exclusão</Button>
                </div>
              ) : (
                <Button variant="ghost" className="!text-brand-700 dark:!text-brand-400" onClick={() => setExcluindo("confirmando")}>
                  Excluir chamado
                </Button>
              )}
            </div>
          )}
        </div>

        <TimelineEventos
          titulo="Histórico e conversa"
          eventos={chamado.eventos || []}
          containerClassName="flex flex-col border border-gray-200 dark:border-slate-700 rounded-[var(--radius-card)] overflow-hidden"
          variante={(ev) => (ev.tipo === "MENSAGEM" ? "mensagem" : ev.tipo === "ANEXO" ? "anexo" : "sistema")}
          descricaoEvento={DESCRICAO_EVENTO}
          autorLabel={(autor) => (autor as ChamadoEvento["autor"])?.nome || (autor as ChamadoEvento["autor"])?.email || "—"}
          autorTitle={(autor) => (autor as ChamadoEvento["autor"])?.email || undefined}
          renderAnexo={(ev) => (
            <AnexoEvento
              chamadoId={chamadoId}
              evento={ev}
              podeExcluir={papel === "ADMINISTRADOR"}
              onRemovido={carregar}
            />
          )}
          podeExcluirEvento={(ev) => ev.tipo === "MENSAGEM" && papel === "ADMINISTRADOR"}
          onExcluirEvento={async (eventoId) => { await chamadosApi.removerEvento(chamadoId, eventoId); await carregar(); }}
          tituloExcluir="Excluir evento (correção de engano)"
          podeComentar
          placeholderComentario="Escrever mensagem..."
          onEnviarComentario={enviarMensagem}
          controlesExtras={
            <>
              <input
                ref={inputArquivoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) anexarArquivo(f); }}
              />
              <Button
                variant="ghost"
                onClick={() => inputArquivoRef.current?.click()}
                disabled={anexando}
                title="Anexar foto ou PDF"
                aria-label="Anexar foto ou PDF"
              >
                {/*
                  Achado em auditoria de 06/07/2026: só o ícone de clipe, sem
                  texto, dependia do `title` (tooltip) pra explicar o que
                  fazia — e tooltip não existe em toque, então no celular
                  ninguém descobria que dava pra mandar foto do problema.
                  Texto "Anexar" some só em telas muito estreitas (< 400px),
                  onde o espaço é mais disputado; o ícone sozinho ainda fica,
                  mas ganha `aria-label` de qualquer forma.
                */}
                <Paperclip size={14} />
                <span className="hidden min-[400px]:inline">Anexar</span>
              </Button>
            </>
          }
          avisoRodape={anexando && <p className="text-[11px] text-gray-400 dark:text-slate-500 px-2 pb-1">Enviando anexo...</p>}
        />
      </div>
    </Modal>
  );
}

function EdicaoForm({
  chamado, equipamentos, unidades, onSave, onCancel,
}: {
  chamado: ChamadoManutencao;
  equipamentos?: AppData["equipamentos"];
  unidades?: AppData["dominios"]["unidades"];
  onSave: (campos: Parameters<typeof chamadosApi.update>[1]) => void;
  onCancel: () => void;
}) {
  const [categoria, setCategoria] = useState<CategoriaChamado>(chamado.categoria);
  // Descrição original editável (achado de auditoria S11, 22/07/2026) —
  // antes só dava pra editar campos internos (categoria, solução aplicada
  // etc.), nunca o texto que o colaborador escreveu ao abrir o chamado.
  const [descricao, setDescricao] = useState(chamado.descricao);
  // Imoview CRM (09/07/2026) — ver comentário em types.ts.
  const [tipoSolicitacaoImoview, setTipoSolicitacaoImoview] = useState<TipoSolicitacaoImoview | "">(chamado.tipoSolicitacaoImoview || "");
  const [codigoImovel, setCodigoImovel] = useState(chamado.codigoImovel || "");
  const [prioridade, setPrioridade] = useState<Prioridade>(chamado.prioridade);
  const [unidadeId, setUnidadeId] = useState(chamado.unidadeId);
  const [local, setLocal] = useState(chamado.local || "");
  const [equipamentoId, setEquipamentoId] = useState(chamado.equipamentoId || "");
  const [fornecedorExterno, setFornecedorExterno] = useState(chamado.fornecedorExterno || "");
  const [valorFinal, setValorFinal] = useState(chamado.valorFinal?.toString() || "");
  const [solucaoAplicada, setSolucaoAplicada] = useState(chamado.solucaoAplicada || "");
  const [observacoesInternas, setObservacoesInternas] = useState(chamado.observacoesInternas || "");

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria">
          <Select
            value={categoria}
            onChange={(e) => {
              const nova = e.target.value as CategoriaChamado;
              setCategoria(nova);
              if (nova !== "IMOVIEW_CRM") { setTipoSolicitacaoImoview(""); setCodigoImovel(""); }
            }}
          >
            {CATEGORIAS_CHAMADO.map((c) => <option key={c} value={c}>{CATEGORIA_CHAMADO_LABEL[c]}</option>)}
          </Select>
        </Field>
        <Field label="Prioridade">
          <Select value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade)}>
            <option value="ALTA">Alta</option>
            <option value="MEDIA">Média</option>
            <option value="BAIXA">Baixa</option>
          </Select>
        </Field>
      </div>
      {categoria === "IMOVIEW_CRM" && (
        <Field label="Tipo da solicitação">
          <Select
            value={tipoSolicitacaoImoview}
            onChange={(e) => { setTipoSolicitacaoImoview(e.target.value as TipoSolicitacaoImoview); setCodigoImovel(""); }}
          >
            <option value="">—</option>
            {TIPOS_SOLICITACAO_IMOVIEW.map((t) => <option key={t} value={t}>{TIPO_SOLICITACAO_IMOVIEW_LABEL[t]}</option>)}
          </Select>
        </Field>
      )}
      {categoria === "IMOVIEW_CRM" && tipoSolicitacaoImoview === "PROBLEMA_IMOVEL" && (
        <Field label="Código do imóvel">
          <TextInput value={codigoImovel} onChange={(e) => setCodigoImovel(e.target.value)} placeholder="Ex: IT-0123" />
        </Field>
      )}
      <Field label="Descrição">
        <TextArea value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </Field>
      {unidades && (
        <Field label="Unidade">
          <Select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Detalhe do local (opcional)">
        <TextInput value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Ex: Sala TI, Recepção" />
      </Field>
      {equipamentos && (
        <Field label="Equipamento relacionado">
          <Select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)}>
            <option value="">—</option>
            {equipamentos.map((eq) => <option key={eq.id} value={eq.id}>{rotuloEquipamento(eq)}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Fornecedor externo">
        <TextInput value={fornecedorExterno} onChange={(e) => setFornecedorExterno(e.target.value)} />
      </Field>
      <Field label="Valor final">
        <TextInput type="number" value={valorFinal} onChange={(e) => setValorFinal(e.target.value)} />
      </Field>
      <Field label="Solução aplicada (visível pro colaborador)">
        <TextArea value={solucaoAplicada} onChange={(e) => setSolucaoAplicada(e.target.value)} />
      </Field>
      <Field label="Observações internas (só Administrador/Suporte TI veem)">
        <TextArea value={observacoesInternas} onChange={(e) => setObservacoesInternas(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button
          variant="primary"
          disabled={
            !descricao.trim() ||
            (categoria === "IMOVIEW_CRM" && !tipoSolicitacaoImoview) ||
            (tipoSolicitacaoImoview === "PROBLEMA_IMOVEL" && !codigoImovel.trim())
          }
          onClick={() =>
            onSave({
              categoria,
              descricao: descricao.trim(),
              tipoSolicitacaoImoview: categoria === "IMOVIEW_CRM" && tipoSolicitacaoImoview ? tipoSolicitacaoImoview : null,
              codigoImovel: categoria === "IMOVIEW_CRM" && tipoSolicitacaoImoview === "PROBLEMA_IMOVEL" && codigoImovel ? codigoImovel : null,
              prioridade,
              unidadeId,
              local: local || null,
              equipamentoId: equipamentoId || null,
              fornecedorExterno: fornecedorExterno || null,
              valorFinal: valorFinal ? Number(valorFinal) : null,
              solucaoAplicada: solucaoAplicada || null,
              observacoesInternas: observacoesInternas || null,
            })
          }
        >
          Salvar
        </Button>
      </div>
    </div>
  );
}
